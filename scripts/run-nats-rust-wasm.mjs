import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const wasmPath = new URL('../servers/nats-rust/target/wasm32-wasip1/debug/nats-rust.wasm', import.meta.url);
const wasi = new WASI({
  version: 'preview1',
  args: ['nats-rust.wasm'],
  env: {},
});

const bytes = await readFile(wasmPath);
const module = await WebAssembly.compile(bytes);
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
wasi.start(instance);
