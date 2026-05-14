# Universal Queues

Universal Queues é um laboratório de mensageria para comparar APIs, padrões de resiliência e implementações de servidores compatíveis com protocolos de fila/eventos.

O pacote TypeScript original fornece abstrações para mensageria e ferramentas de healing/retry. Além disso, este repositório agora inclui implementações de referência de um servidor **NATS Core** em várias linguagens para validar interoperabilidade de clientes e comparar toolchains.

## O que existe no repositório

| Área | Caminho | Descrição |
| --- | --- | --- |
| Biblioteca TypeScript | `src/` | Interfaces, decorators e handlers para mensageria. |
| SmartCache | `SmartCache/` | Pacote experimental de cache/mensageria. |
| Frontend demo | `frontend/` | Aplicação Vite/React para experimentos visuais. |
| Especificação NATS | `docs/nats-core-server-spec.md` | Contrato comum seguido pelos servidores NATS Core. |
| Servidores NATS | `servers/` | Implementações em Rust, Zig, Jai, Odin, Curry, C, C++, Haskell, Go e Mojo. |
| Scripts | `scripts/` | Smoke test, benchmark e runner WASI/WASM. |
| Quickstart | `QUICKSTART.md` | Comandos rápidos para compilar, executar, testar e fazer benchmark. |

## Servidores NATS Core

As implementações em `servers/` têm o objetivo de aceitar clientes NATS comuns usando um subconjunto do protocolo NATS Core:

- `INFO` inicial.
- `CONNECT`, `PING`, `PONG`.
- `SUB` e `UNSUB`.
- `PUB` e request/reply via reply subject.
- `HPUB`/headers nas implementações que expõem frames de header diretamente.
- Wildcards de subject (`*` e `>`).
- Queue groups.
- `verbose: true` com `+OK`.
- `echo:false`/no-echo.

> Estas implementações são referência didática e de compatibilidade de protocolo. Elas não tentam substituir o `nats-server` oficial em produção e não implementam JetStream, clustering, TLS, contas/JWT/NKey, gateways, leafnodes, MQTT/WebSocket ou endpoints HTTP de monitoramento.

## Linguagens implementadas

| Linguagem | Arquivo principal | Observação |
| --- | --- | --- |
| Rust | `servers/nats-rust/src/main.rs` | Servidor TCP nativo, testes unitários e smoke test WASI/WASM. |
| Zig | `servers/nats-zig/server.zig` | Servidor TCP nativo. |
| Jai | `servers/nats-jai/server.jai` | Servidor TCP nativo. |
| Odin | `servers/nats-odin/server.odin` | Referência em Odin usando APIs core de rede. |
| Curry | `servers/nats-curry/server.curry` | Referência funcional-lógica com engine de protocolo e API Socket convencional de Curry. |
| C | `servers/nats-c/server.c` | Servidor TCP com threads POSIX. |
| C++ | `servers/nats-cpp/server.cpp` | Servidor TCP com `select(2)` e STL. |
| Haskell | `servers/nats-haskell/Main.hs` | Servidor TCP concorrente com `Network.Socket`. |
| Go | `servers/nats-go/main.go` | Servidor TCP concorrente com goroutines. |
| Mojo | `servers/nats-mojo/server.mojo` | Referência Mojo usando interop Python para sockets. |

## Uso rápido

Veja o guia completo em [`QUICKSTART.md`](QUICKSTART.md). Os atalhos principais são:

```bash
npm run run:rust
npm run run:rust:wasm
npm run run:zig
npm run run:jai
npm run run:benchmark
```

Os servidores escutam em `0.0.0.0:4222` por padrão, ou na porta passada como primeiro argumento quando a implementação/script suporta esse encaminhamento.

## Teste manual com NATS CLI

Em um terminal:

```bash
npm run run:rust
```

Em outro terminal:

```bash
nats --server nats://127.0.0.1:4222 sub demo
```

Em um terceiro terminal:

```bash
nats --server nats://127.0.0.1:4222 pub demo 'hello from universal-queues'
```

## Benchmark

O benchmark sequencial compila e executa cada implementação disponível no ambiente, uma por vez, rodando uma fase de carga e uma fase de stress:

```bash
npm run run:benchmark
```

Por padrão cada fase dura 2 minutos. Para uma execução rápida durante desenvolvimento:

```bash
BENCH_DURATION_SECONDS=5 npm run run:benchmark
```

## Scripts úteis

| Comando | Descrição |
| --- | --- |
| `npm run build` | Compila o TypeScript do pacote principal. |
| `npm test` | Executa a suíte Jest do repositório. |
| `npm run nats:rust:test` | Testes unitários Rust + smoke test NATS. |
| `npm run nats:zig:test` | Smoke test NATS contra Zig, se Zig estiver instalado. |
| `npm run nats:jai:test` | Smoke test NATS contra Jai, se Jai estiver instalado. |
| `node scripts/smoke-nats-server.mjs --port 4222 -- <cmd>` | Smoke test genérico contra um comando de servidor. |

## Estrutura resumida

```text
src/                         Biblioteca TypeScript principal
SmartCache/                  Pacote experimental SmartCache
frontend/                    Demo frontend
docs/nats-core-server-spec.md Contrato NATS Core
servers/                     Implementações NATS em múltiplas linguagens
scripts/                     Smoke tests, benchmarks e WASM runner
QUICKSTART.md                Guia rápido
```

## Licença

MIT.
