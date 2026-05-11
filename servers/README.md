# NATS Core servers

This directory contains two reference implementations of the same NATS Core server contract:

- `nats-zig/server.zig` — Zig implementation.
- `nats-jai/server.jai` — Jai implementation.

Both follow `docs/nats-core-server-spec.md` and are intended for ordinary Core NATS clients that use publish/subscribe, queue subscriptions, and request/reply over plain TCP.

## Zig

```bash
zig run servers/nats-zig/server.zig -- 4222
```

## Jai

```bash
cd servers/nats-jai
jai server.jai
./server 4222
```

## Smoke test with any NATS client

In one terminal, run either server. In another terminal:

```bash
nats --server nats://127.0.0.1:4222 sub demo
nats --server nats://127.0.0.1:4222 pub demo 'hello from universal-queues'
```

The subscriber should receive the published message. Queue groups and request/reply use the standard NATS client APIs because reply subjects and `SUB <subject> <queue> <sid>` are implemented by both servers.
