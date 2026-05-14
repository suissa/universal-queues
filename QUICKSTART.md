# QUICKSTART — NATS Core em múltiplas linguagens

Este guia mostra os comandos rápidos para compilar, executar, testar e fazer benchmark das dez implementações de referência do servidor NATS Core deste repositório.

## 1. Pré-requisitos

Instale apenas as toolchains que você pretende usar:

- **Node.js + npm**: obrigatório para os scripts `npm run ...`.
- **Rust + Cargo**: necessário para `run:rust`, `run:rust:wasm` e benchmarks da versão Rust.
- **Zig**: necessário para `run:zig` e benchmarks da versão Zig.
- **Jai**: necessário para `run:jai` e benchmarks da versão Jai.
- **Go, gcc, g++, GHC, Odin, Curry/PAKCS e Mojo**: necessários para compilar/benchmarkar as implementações adicionais.
- Opcional: **NATS CLI** (`nats`) para testes manuais com um cliente NATS real.

## 2. Comandos rápidos para compilar e executar

Todos os comandos abaixo compilam primeiro e depois executam a implementação correspondente.

### Rust nativo

```bash
npm run run:rust
```

Para usar outra porta:

```bash
npm run run:rust -- 4223
```

### Rust em WASM/WASI

```bash
npm run run:rust:wasm
```

Este comando compila o Rust para `wasm32-wasip1` e executa o smoke test WASI via Node. O servidor TCP completo continua sendo nativo, pois WASI preview 1 não fornece sockets TCP portáveis.

### Zig

```bash
npm run run:zig
```

Para usar outra porta:

```bash
npm run run:zig -- 4223
```

### Jai

```bash
npm run run:jai
```

Para usar outra porta:

```bash
npm run run:jai -- 4223
```

## 3. Scripts detalhados por implementação

Se quiser separar build, start e teste:

| Implementação | Compilar | Subir servidor | Testar |
| --- | --- | --- | --- |
| Rust | `npm run nats:rust:build` | `npm run nats:rust:start` | `npm run nats:rust:test` |
| Zig | `npm run nats:zig:build` | `npm run nats:zig:start` | `npm run nats:zig:test` |
| Jai | `npm run nats:jai:build` | `npm run nats:jai:start` | `npm run nats:jai:test` |
| Go | `cd servers/nats-go && go build -o nats-go .` | `servers/nats-go/nats-go` | via `npm run run:benchmark` |
| C | `gcc -std=gnu11 -O2 -o servers/nats-c/nats-c servers/nats-c/server.c` | `servers/nats-c/nats-c` | via `npm run run:benchmark` |
| C++ | `g++ -std=c++17 -O2 -o servers/nats-cpp/nats-cpp servers/nats-cpp/server.cpp` | `servers/nats-cpp/nats-cpp` | via `npm run run:benchmark` |
| Haskell | `ghc -threaded -O2 servers/nats-haskell/Main.hs -o servers/nats-haskell/nats-haskell` | `servers/nats-haskell/nats-haskell` | via `npm run run:benchmark` |
| Odin | `odin build servers/nats-odin -out:servers/nats-odin/nats-odin` | `servers/nats-odin/nats-odin` | via `npm run run:benchmark` |
| Curry | depende da distribuição Curry instalada | `servers/nats-curry/nats-curry` | via `npm run run:benchmark` |
| Mojo | `mojo build servers/nats-mojo/server.mojo -o servers/nats-mojo/nats-mojo` | `servers/nats-mojo/nats-mojo` | via `npm run run:benchmark` |

Os testes `nats:*:test` sobem o servidor em uma porta temporária e validam frames básicos do protocolo NATS com `scripts/smoke-nats-server.mjs`.

## 4. Teste manual com NATS CLI

Em um terminal, suba uma implementação:

```bash
npm run run:rust
# ou
npm run run:zig
# ou
npm run run:jai
```

Em outro terminal, assine um subject:

```bash
nats --server nats://127.0.0.1:4222 sub demo
```

Em um terceiro terminal, publique uma mensagem:

```bash
nats --server nats://127.0.0.1:4222 pub demo 'hello from universal-queues'
```

O assinante deve receber a mensagem publicada.

## 5. Benchmark: carga e stress

Rode:

```bash
npm run run:benchmark
```

O benchmark faz o seguinte, **uma implementação por vez**:

1. Verifica se a toolchain existe (`cargo`, `zig`, `jai`, `go`, `gcc`, `g++`, `ghc`, `odin`, `pakcs` e `mojo`).
2. Compila a implementação disponível.
3. Sobe o servidor em uma porta dedicada.
4. Executa um teste de **carga** por 2 minutos.
5. Executa um teste de **stress** por 2 minutos.
6. Encerra o servidor antes de passar para a próxima implementação.

Portas usadas pelo benchmark:

- Rust: `45222`.
- Zig: `45223`.
- Jai: `45224`.
- Go: `45225`.
- C: `45226`.
- C++: `45227`.
- Haskell: `45228`.
- Odin: `45229`.
- Curry: `45230`.
- Mojo: `45231`.

Se uma toolchain não estiver instalada, essa implementação é ignorada e o benchmark continua com as próximas.

### Ajustar duração e intensidade

Por padrão, cada fase dura `120` segundos. Para rodar uma verificação curta durante desenvolvimento:

```bash
BENCH_DURATION_SECONDS=5 npm run run:benchmark
```

Também é possível ajustar payload e concorrência do stress:

```bash
BENCH_PAYLOAD_BYTES=256 \
BENCH_STRESS_PUBLISHERS=16 \
BENCH_STRESS_SUBSCRIBERS=8 \
npm run run:benchmark
```

## 6. Arquivos importantes

- `docs/nats-core-server-spec.md`: contrato de protocolo comum.
- `servers/README.md`: documentação completa dos servidores e scripts.
- `servers/nats-rust/src/main.rs`: implementação Rust.
- `servers/nats-zig/server.zig`: implementação Zig.
- `servers/nats-jai/server.jai`: implementação Jai.
- `servers/nats-go/main.go`: implementação Go.
- `servers/nats-c/server.c`: implementação C.
- `servers/nats-cpp/server.cpp`: implementação C++.
- `servers/nats-haskell/Main.hs`: implementação Haskell.
- `servers/nats-odin/server.odin`: implementação Odin.
- `servers/nats-curry/server.curry`: implementação Curry.
- `servers/nats-mojo/server.mojo`: implementação Mojo.
- `scripts/smoke-nats-server.mjs`: smoke test funcional do protocolo NATS.
- `scripts/benchmark-nats-servers.mjs`: benchmark sequencial de carga e stress.
- `scripts/run-nats-rust-wasm.mjs`: runner WASI para o smoke test Rust/WASM.
