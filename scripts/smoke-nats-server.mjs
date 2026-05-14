import net from 'node:net';
import { spawn } from 'node:child_process';

const delimiterIndex = process.argv.indexOf('--', 2);
if (delimiterIndex === -1) {
  console.error('Usage: node scripts/smoke-nats-server.mjs --port <port> -- <server command> [args...]');
  process.exit(2);
}

const optionArgs = process.argv.slice(2, delimiterIndex);
const commandArgs = process.argv.slice(delimiterIndex + 1);
const portFlagIndex = optionArgs.indexOf('--port');
const port = portFlagIndex >= 0 ? Number(optionArgs[portFlagIndex + 1]) : 4222;

if (!Number.isInteger(port) || port <= 0 || commandArgs.length === 0) {
  console.error('Invalid arguments. Expected --port <port> and a server command after --.');
  process.exit(2);
}

const [command, ...args] = commandArgs;
const child = spawn(command, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

let childOutput = '';
child.stdout.on('data', (chunk) => {
  childOutput += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  childOutput += chunk.toString();
});

const cleanup = () => {
  if (!child.killed) child.kill('SIGTERM');
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

try {
  await waitForPort(port, 15_000);
  await runProtocolSmoke(port);
  console.log(`NATS protocol smoke test passed on 127.0.0.1:${port}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (childOutput.trim()) {
    console.error('\n--- server output ---');
    console.error(childOutput.trim());
  }
  process.exitCode = 1;
} finally {
  cleanup();
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server command exited early with code ${child.exitCode}`);
    }
    try {
      const socket = await connect(port);
      socket.destroy();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for 127.0.0.1:${port}: ${lastError?.message ?? 'unknown error'}`);
}

async function runProtocolSmoke(port) {
  const subscriber = await connect(port);
  const publisher = await connect(port);
  try {
    subscriber.setTimeout(5_000);
    publisher.setTimeout(5_000);

    const subInfo = await readFrame(subscriber, 'INFO ');
    if (!subInfo.startsWith('INFO ')) throw new Error(`Expected INFO for subscriber, got ${JSON.stringify(subInfo)}`);

    subscriber.write('CONNECT {"verbose":true,"headers":true}\r\n');
    await expectFrame(subscriber, '+OK\r\n');
    subscriber.write('SUB smoke.demo 1\r\n');
    await expectFrame(subscriber, '+OK\r\n');

    const pubInfo = await readFrame(publisher, 'INFO ');
    if (!pubInfo.startsWith('INFO ')) throw new Error(`Expected INFO for publisher, got ${JSON.stringify(pubInfo)}`);

    publisher.write('CONNECT {"verbose":true}\r\n');
    await expectFrame(publisher, '+OK\r\n');
    publisher.write('PING\r\n');
    await expectFrame(publisher, 'PONG\r\n');
    publisher.write('PUB smoke.demo 11\r\nhello smoke\r\n');
    await expectFrame(publisher, '+OK\r\n');
    await expectFrame(subscriber, 'MSG smoke.demo 1 11\r\nhello smoke\r\n');
  } finally {
    subscriber.destroy();
    publisher.destroy();
  }
}

function readFrame(socket, prefix) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for frame ${prefix}`)), 5_000);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.startsWith(prefix) && buffer.includes('\r\n')) {
        cleanup();
        resolve(buffer.slice(0, buffer.indexOf('\r\n') + 2));
      } else if (!prefix.startsWith(buffer) && !buffer.startsWith(prefix)) {
        cleanup();
        reject(new Error(`Unexpected frame while waiting for ${JSON.stringify(prefix)}: ${JSON.stringify(buffer)}`));
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function expectFrame(socket, expected) {
  const actual = await readExact(socket, Buffer.byteLength(expected));
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function readExact(socket, size) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${size} bytes`)), 5_000);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= size) {
        cleanup();
        resolve(buffer.subarray(0, size).toString('utf8'));
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}
