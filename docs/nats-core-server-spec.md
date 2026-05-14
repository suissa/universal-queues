# Universal Queues NATS Core Server Specification

This repository ships three independent implementations of the same NATS Core protocol subset:

- `servers/nats-zig/server.zig`
- `servers/nats-jai/server.jai`
- `servers/nats-rust/src/main.rs`

The goal is wire compatibility with ordinary NATS clients for Core NATS publish/subscribe, queue groups, and request/reply. The implementations intentionally do **not** implement JetStream persistence, clustering/gateways/leafnodes, TLS, accounts, JWT/NKey authentication, monitoring endpoints, MQTT/WebSocket adapters, or configuration reloads.

## Transport

- TCP listener, default `0.0.0.0:4222`.
- Protocol lines are terminated by `\r\n` or `\n`.
- The server writes an `INFO` line immediately after accepting a socket.
- `max_payload` defaults to `1048576` bytes and is advertised in `INFO`.

## Supported client operations

| Operation | Direction | Behavior |
| --- | --- | --- |
| `INFO` | server to client | Initial server metadata JSON. |
| `CONNECT <json>` | client to server | Parses `verbose`, `pedantic`, `echo`, `name`, `lang`, and `version` when present. Unknown fields are ignored. |
| `PING` | both | Server responds with `PONG`. |
| `PONG` | client to server | Accepted as heartbeat response. |
| `SUB <subject> [queue] <sid>` | client to server | Registers a subscription. Wildcards `*` and `>` are supported. Queue groups deliver to one member per published message. |
| `UNSUB <sid> [max_msgs]` | client to server | Removes immediately or auto-unsubscribes after `max_msgs` deliveries to that SID. |
| `PUB <subject> [reply-to] <bytes>` | client to server | Reads the payload and dispatches `MSG` frames. |
| `HPUB <subject> [reply-to] <header-bytes> <total-bytes>` | client to server | Reads headers + payload and dispatches `HMSG` frames to header-capable connections, or `MSG` with the payload portion to older connections. |
| `+OK` | server to client | Sent only when the client requested `verbose: true`. |
| `-ERR <message>` | server to client | Sent on malformed protocol, unknown commands, invalid sizes, or payload too large. |

## Subject matching

- Tokens are separated by `.`.
- `*` matches exactly one token.
- `>` is valid only as the last token. As a standalone subscription it matches every subject; after a prefix (for example `foo.>`) it requires at least one remaining subject token.
- Without wildcards, subjects must be an exact token-for-token match.

## Delivery semantics

- Normal subscribers each receive one copy of every matching publish.
- Subscribers in the same queue group share messages; one matching member is selected in round-robin order per `(subject-filter, queue)` group.
- Request/reply is regular publish delivery with the optional reply subject preserved in the `MSG`/`HMSG` line.
- `no_echo`/`echo:false` is honored: a client does not receive messages it published when echo is disabled.

## Limits and error handling

- Payloads larger than `max_payload` are rejected with `-ERR 'Maximum Payload Violation'` and the client connection is closed.
- Malformed protocol lines produce `-ERR` and close the offending connection.
- Slow consumers are handled by the operating system socket backpressure in these reference implementations.

## Reference

This contract is derived from the official NATS Client Protocol reference: <https://docs.nats.io/reference/reference-protocols/nats-protocol>.
