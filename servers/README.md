# NATS Core servers

Este diretório contém dez implementações de referência do mesmo contrato de servidor **NATS Core**:

- `nats-rust/src/main.rs` — servidor TCP nativo em Rust, com entrypoint extra para smoke test em WASI/WASM.
- `nats-zig/server.zig` — servidor TCP nativo em Zig.
- `nats-jai/server.jai` — servidor TCP nativo em Jai.
- `nats-go/main.go` — servidor TCP nativo em Go.
- `nats-c/server.c` — servidor TCP nativo em C.
- `nats-cpp/server.cpp` — servidor TCP nativo em C++.
- `nats-haskell/Main.hs` — servidor TCP nativo em Haskell.
- `nats-odin/server.odin` — servidor TCP nativo em Odin.
- `nats-curry/server.curry` — servidor TCP em Curry.
- `nats-mojo/server.mojo` — servidor Mojo usando interop Python para sockets.

Todas seguem a especificação comum em [`../docs/nats-core-server-spec.md`](../docs/nats-core-server-spec.md). Para começar pelo caminho mais curto, veja também [`../QUICKSTART.md`](../QUICKSTART.md). A ideia é que clientes NATS comuns consigam usar publish/subscribe, queue groups e request/reply contra qualquer uma das dez implementações sem mudar o código do cliente.

> Escopo: isto é NATS Core. JetStream, clustering, gateways/leafnodes, TLS, contas/JWT/NKey, WebSocket/MQTT e endpoints HTTP de monitoramento estão fora do escopo destas implementações de referência.

## Recursos implementados

| Recurso | Rust/Zig/Jai | Go/C/C++ | Haskell/Odin/Curry/Mojo |
| --- | --- | --- | --- |
| TCP listener em `0.0.0.0:4222` por padrão | ✅ | ✅ | ✅ |
| `INFO` inicial com `headers` e `max_payload` | ✅ | ✅ | ✅ |
| `CONNECT`, `PING`, `PONG` | ✅ | ✅ | ✅ |
| `SUB`, `UNSUB` e auto-unsubscribe por `max_msgs` | ✅ | ✅ | ✅ |
| `PUB` e request/reply via reply subject | ✅ | ✅ | ✅ |
| `HPUB`/`HMSG` para headers NATS | ✅ | ✅ | ✅ |
| Wildcards de subject (`*` e `>`) | ✅ | ✅ | ✅ |
| Queue groups com entrega round-robin | ✅ | ✅ | ✅ |
| `verbose: true` com `+OK` | ✅ | ✅ | ✅ |
| `echo:false`/`no_echo` | ✅ | ✅ | ✅ |
| Smoke test automatizado via npm | ✅ | ✅* | ✅* |

\* Os scripts existem para todos. No ambiente atual, Zig e Jai precisam estar instalados para seus scripts passarem.

## Pré-requisitos

- **Node.js** para rodar os scripts npm e o smoke test (`scripts/smoke-nats-server.mjs`).
- **Rust + Cargo** para `nats:rust:*`.
- **Zig** no `PATH` para `nats:zig:*`.
- **Jai** no `PATH` para `nats:jai:*`.
- **Go, gcc, g++, GHC, Odin, PAKCS/KiCS2 e Mojo** para compilar/benchmarkar as implementações adicionais.
- Opcional: **NATS CLI** (`nats`) para testar manualmente com um cliente real.

## Scripts npm

Cada implementação possui três scripts principais: compilar, subir o servidor e testar. A raiz do projeto também possui atalhos `run:rust`, `run:rust:wasm`, `run:zig`, `run:jai` e `run:benchmark`. O teste automatizado sobe o servidor em uma porta temporária, conecta dois sockets como clientes NATS, valida `INFO`, `CONNECT`, `SUB`, `PING`, `PUB` e a entrega `MSG`, e encerra o processo.

### Rust

| Ação | Comando | O que faz |
| --- | --- | --- |
| Compilar | `npm run nats:rust:build` | Executa `cargo build` para `servers/nats-rust`. |
| Subir servidor | `npm run nats:rust:start` | Sobe o servidor Rust na porta padrão `4222`. |
| Subir em outra porta | `npm run nats:rust:start -- 4223` | Encaminha a porta para o binário Rust. |
| Testar | `npm run nats:rust:test` | Roda testes unitários Rust e smoke test NATS em `44222`. |
| WASM | `npm run nats:rust:wasm` | Compila para `wasm32-wasip1` e executa o smoke test WASI no Node. |

Também existem aliases antigos para compatibilidade: `npm run rust:nats:build`, `npm run rust:nats:test` e `npm run rust:nats:wasm`.

### Zig

| Ação | Comando | O que faz |
| --- | --- | --- |
| Compilar | `npm run nats:zig:build` | Gera `servers/nats-zig/nats-zig` com `zig build-exe`. |
| Subir servidor | `npm run nats:zig:start` | Executa `zig run servers/nats-zig/server.zig --` na porta padrão `4222`. |
| Subir em outra porta | `npm run nats:zig:start -- 4223` | Encaminha a porta para o servidor Zig. |
| Testar | `npm run nats:zig:test` | Sobe o Zig em `44223` e roda o smoke test NATS. |

### Jai

| Ação | Comando | O que faz |
| --- | --- | --- |
| Compilar | `npm run nats:jai:build` | Entra em `servers/nats-jai` e executa `jai server.jai`. |
| Subir servidor | `npm run nats:jai:start` | Executa `servers/nats-jai/server` na porta padrão `4222` após compilação. |
| Subir em outra porta | `npm run nats:jai:start -- 4223` | Encaminha a porta para o binário Jai compilado. |
| Testar | `npm run nats:jai:test` | Compila Jai, sobe em `44224` e roda o smoke test NATS. |

## Teste manual com cliente NATS real

Em um terminal, suba uma implementação:

```bash
npm run nats:rust:start
# ou
npm run nats:zig:start
# ou, depois de compilar:
npm run nats:jai:start
```

Em outro terminal, use a CLI oficial do NATS:

```bash
nats --server nats://127.0.0.1:4222 sub demo
```

Em um terceiro terminal, publique uma mensagem:

```bash
nats --server nats://127.0.0.1:4222 pub demo 'hello from universal-queues'
```

O assinante deve receber `hello from universal-queues` independentemente da implementação escolhida.

## Teste manual sem NATS CLI

Também é possível validar o protocolo com `nc`/`netcat`:

```bash
printf 'CONNECT {"verbose":true}\r\nPING\r\n' | nc 127.0.0.1 4222
```

A resposta esperada começa com `INFO`, seguida por `+OK` e `PONG`.

## Rust em WASM/WASI

O script `npm run nats:rust:wasm` compila o Rust para `wasm32-wasip1` e executa `scripts/run-nats-rust-wasm.mjs`.

Importante: o servidor TCP completo é nativo, porque WASI preview 1 não fornece sockets TCP portáveis. O binário WASM executa um smoke test dos helpers compartilhados de protocolo, especialmente matching de subjects e limites, para garantir que o mesmo código Rust também compila e roda em WASI.

## Benchmark

Use `npm run run:benchmark` para rodar, uma implementação por vez, um teste de carga e um teste de stress. Por padrão cada fase dura 2 minutos; durante desenvolvimento, reduza com `BENCH_DURATION_SECONDS=5 npm run run:benchmark`. O runner compila e executa Rust, Zig, Jai, Go, C, C++, Haskell, Odin, Curry e Mojo quando as respectivas toolchains estão disponíveis, e pula automaticamente as que não estiverem instaladas.

## Portas usadas pelos testes

- Rust smoke test: `44222`; benchmark: `45222`.
- Zig smoke test: `44223`; benchmark: `45223`.
- Jai smoke test: `44224`; benchmark: `45224`.
- Go/C/C++/Haskell/Odin/Curry/Mojo benchmark: `45225` a `45231`.
- Execução manual: `4222` por padrão, ou a porta passada como primeiro argumento.

Se uma dessas portas já estiver em uso, altere temporariamente o comando no `package.json` ou rode o servidor manualmente em outra porta.

## Layout dos arquivos

```text
servers/
  README.md
  nats-rust/
    Cargo.toml
    src/main.rs
  nats-zig/
    server.zig
  nats-jai/
    server.jai
scripts/
  smoke-nats-server.mjs
  run-nats-rust-wasm.mjs
docs/
  nats-core-server-spec.md
```
