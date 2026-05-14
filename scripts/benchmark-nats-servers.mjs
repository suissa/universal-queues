import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_PHASE_SECONDS = 120;
const phaseSeconds = readPositiveNumber(process.env.BENCH_DURATION_SECONDS, DEFAULT_PHASE_SECONDS);
const payloadSize = readPositiveNumber(process.env.BENCH_PAYLOAD_BYTES, 128);
const stressPublishers = readPositiveNumber(process.env.BENCH_STRESS_PUBLISHERS, 8);
const stressSubscribers = readPositiveNumber(process.env.BENCH_STRESS_SUBSCRIBERS, 4);

const servers = [
  {
    name: 'rust',
    port: 45222,
    check: ['cargo', '--version'],
    build: ['cargo', 'build', '--manifest-path', 'servers/nats-rust/Cargo.toml'],
    run: ['cargo', 'run', '--manifest-path', 'servers/nats-rust/Cargo.toml', '--'],
  },
  {
    name: 'zig',
    port: 45223,
    check: ['zig', 'version'],
    build: ['zig', 'build-exe', 'servers/nats-zig/server.zig', '-femit-bin=servers/nats-zig/nats-zig'],
    run: ['servers/nats-zig/nats-zig'],
  },
  {
    name: 'jai',
    port: 45224,
    check: ['jai', '--version'],
    build: ['bash', '-lc', 'cd servers/nats-jai && jai server.jai'],
    run: ['servers/nats-jai/server'],
  },
];

console.log('NATS benchmark configuration');
console.log(`- phase duration: ${phaseSeconds}s per load/stress phase`);
console.log(`- payload size: ${payloadSize} bytes`);
console.log(`- stress publishers: ${stressPublishers}`);
console.log(`- stress subscribers: ${stressSubscribers}`);
console.log('');

let ran = 0;
for (const server of servers) {
  if (!commandAvailable(server.check)) {
    console.log(`SKIP ${server.name}: toolchain command not available (${server.check.join(' ')})`);
    continue;
  }

  console.log(`\n=== ${server.name.toUpperCase()} ===`);
  if (!runCommand(server.build, `${server.name} build`)) {
    console.log(`SKIP ${server.name}: build failed`);
    continue;
  }

  const child = spawn(server.run[0], [...server.run.slice(1), String(server.port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const output = collectOutput(child);

  try {
    await waitForPort(server.port, child, 15_000);
    const load = await runLoadPhase(server.port, phaseSeconds, payloadSize);
    printResult(server.name, 'load', load);
    const stress = await runStressPhase(server.port, phaseSeconds, payloadSize, stressPublishers, stressSubscribers);
    printResult(server.name, 'stress', stress);
    ran += 1;
  } catch (error) {
    console.error(`FAIL ${server.name}: ${error instanceof Error ? error.message : String(error)}`);
    if (output.text().trim()) {
      console.error('--- server output ---');
      console.error(output.text().trim());
    }
  } finally {
    await stopProcess(child);
  }
}

if (ran === 0) {
  console.error('\nNo NATS server benchmarks ran. Install at least one toolchain (Rust, Zig, or Jai).');
  process.exitCode = 1;
}

function readPositiveNumber(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function commandAvailable(command) {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'ignore' });
  return result.status === 0;
}

function runCommand(command, label) {
  console.log(`$ ${command.join(' ')}`);
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`${label} exited with code ${result.status}`);
    return false;
  }
  return true;
}

function collectOutput(child) {
  let data = '';
  child.stdout.on('data', (chunk) => {
    data += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    data += chunk.toString();
  });
  return { text: () => data };
}

async function runLoadPhase(port, seconds, size) {
  const subject = 'bench.load';
  const payload = 'x'.repeat(size);
  const subscriber = await createClient(port, false);
  const publisher = await createClient(port, false);
  let received = 0;
  let bytes = 0;
  const stopReading = readMessages(subscriber.socket, () => {
    received += 1;
    bytes += size;
  });

  subscriber.write(`SUB ${subject} 1\r\n`);
  await sleep(50);

  const deadline = Date.now() + seconds * 1000;
  let published = 0;
  try {
    while (Date.now() < deadline) {
      const ok = publisher.write(`PUB ${subject} ${size}\r\n${payload}\r\n`);
      published += 1;
      if (!ok) await onceDrain(publisher.socket);
    }
    await sleep(250);
  } finally {
    stopReading();
    subscriber.close();
    publisher.close();
  }

  return { published, received, bytes, seconds };
}

async function runStressPhase(port, seconds, size, publisherCount, subscriberCount) {
  const subject = 'bench.stress';
  const payload = 's'.repeat(size);
  const subscribers = [];
  const publishers = [];
  let received = 0;
  let bytes = 0;
  const stopReaders = [];

  try {
    for (let i = 0; i < subscriberCount; i += 1) {
      const client = await createClient(port, false);
      client.write(`SUB ${subject} ${i + 1}\r\n`);
      subscribers.push(client);
      stopReaders.push(readMessages(client.socket, () => {
        received += 1;
        bytes += size;
      }));
    }
    for (let i = 0; i < publisherCount; i += 1) {
      publishers.push(await createClient(port, false));
    }
    await sleep(100);

    let published = 0;
    let stopped = false;
    const deadline = Date.now() + seconds * 1000;
    const loops = publishers.map(async (publisher, index) => {
      while (!stopped && Date.now() < deadline) {
        const ok = publisher.write(`PUB ${subject} ${size}\r\n${payload}\r\n`);
        published += 1;
        if (!ok) await onceDrain(publisher.socket);
        if (index % 2 === 0) await Promise.resolve();
      }
    });
    await Promise.all(loops);
    stopped = true;
    await sleep(500);
    return { published, received, bytes, seconds };
  } finally {
    for (const stop of stopReaders) stop();
    for (const client of subscribers) client.close();
    for (const client of publishers) client.close();
  }
}

async function createClient(port, verbose) {
  const socket = await connect(port);
  await readLine(socket, 'INFO ');
  socket.write(`CONNECT {"verbose":${verbose ? 'true' : 'false'}}\r\n`);
  if (verbose) await readExact(socket, Buffer.byteLength('+OK\r\n'));
  return {
    socket,
    write: (data) => socket.write(data),
    close: () => socket.destroy(),
  };
}

function readMessages(socket, onMessage) {
  let buffer = Buffer.alloc(0);
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd === -1) return;
      const line = buffer.subarray(0, lineEnd).toString('utf8');
      const parts = line.split(' ');
      if (parts[0] !== 'MSG') {
        buffer = buffer.subarray(lineEnd + 2);
        continue;
      }
      const size = Number(parts.at(-1));
      const frameLength = lineEnd + 2 + size + 2;
      if (buffer.length < frameLength) return;
      buffer = buffer.subarray(frameLength);
      onMessage();
    }
  };
  socket.on('data', onData);
  return () => socket.off('data', onData);
}

function printResult(serverName, phase, result) {
  const publishedPerSecond = result.published / result.seconds;
  const receivedPerSecond = result.received / result.seconds;
  const mbPerSecond = result.bytes / result.seconds / 1024 / 1024;
  console.log(`${serverName} ${phase}: published=${result.published} (${publishedPerSecond.toFixed(0)}/s), received=${result.received} (${receivedPerSecond.toFixed(0)}/s), approx_rx=${mbPerSecond.toFixed(2)} MiB/s`);
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

async function waitForPort(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const socket = await connect(port);
      socket.destroy();
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`timed out waiting for port ${port}: ${lastError?.message ?? 'unknown error'}`);
}

function readLine(socket, prefix) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${prefix}`)), 5_000);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.includes('\r\n')) {
        cleanup();
        const line = buffer.slice(0, buffer.indexOf('\r\n') + 2);
        if (!line.startsWith(prefix)) reject(new Error(`expected ${prefix}, got ${JSON.stringify(line)}`));
        else resolve(line);
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

function readExact(socket, size) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${size} bytes`)), 5_000);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= size) {
        cleanup();
        resolve(buffer.subarray(0, size));
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

function onceDrain(socket) {
  return new Promise((resolve) => socket.once('drain', resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3_000).then(() => false),
  ]);
  if (exited === false && child.exitCode === null) child.kill('SIGKILL');
}
