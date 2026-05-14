# NATS Core reference server in Mojo.
#
# Mojo's portable socket APIs are still evolving, so this reference uses Python
# interop for TCP sockets while keeping the protocol state machine in Mojo code.

from python import Python

alias MAX_PAYLOAD = 1024 * 1024

fn subject_matches(pattern: String, subject: String) -> Bool:
    var p = pattern.split(".")
    var s = subject.split(".")
    var si = 0
    var matched = 0
    for token in p:
        if token[] == ">":
            return matched == 0 or si < len(s)
        if si >= len(s):
            return False
        if token[] != "*" and token[] != s[si][]:
            return False
        si += 1
        matched += 1
    return si == len(s)

fn main():
    var sys = Python.import_module("sys")
    var socket = Python.import_module("socket")
    var threading = Python.import_module("threading")
    var port = 4222
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    var server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", port))
    server.listen(256)
    print("universal-queues Mojo NATS core server listening on 0.0.0.0:", port)

    # Shared Python dictionaries keep the implementation compact and mirror the
    # Rust/Zig/Jai reference semantics: clients, subscriptions and queue cursors.
    var state = Python.dict()
    state["next"] = 1
    state["clients"] = Python.dict()
    state["cursors"] = Python.dict()
    var lock = threading.Lock()

    def send(conn, data):
        conn.sendall(data.encode("utf-8") if isinstance(data, str) else data)

    def deliver(client, sub, subject, reply, payload):
        if reply:
            send(client["conn"], f"MSG {subject} {sub['sid']} {reply} {len(payload)}\r\n")
        else:
            send(client["conn"], f"MSG {subject} {sub['sid']} {len(payload)}\r\n")
        client["conn"].sendall(payload)
        send(client["conn"], "\r\n")
        sub["delivered"] += 1
        if sub["max"] >= 0 and sub["delivered"] >= sub["max"]:
            sub["max"] = 0

    def publish(pub_id, subject, reply, payload):
        with lock:
            clients = state["clients"]
            pub_echo = clients[pub_id]["echo"] if pub_id in clients else True
            direct = []
            queues = {}
            for cid, client in list(clients.items()):
                if (not pub_echo) and cid == pub_id:
                    continue
                for idx, sub in enumerate(client["subs"]):
                    if not subject_matches(String(sub["subject"]), String(subject)):
                        continue
                    if sub["queue"]:
                        key = sub["subject"] + "\0" + sub["queue"]
                        queues.setdefault(key, []).append((cid, idx))
                    else:
                        direct.append((cid, idx))
            for cid, idx in direct:
                if cid in clients and idx < len(clients[cid]["subs"]):
                    deliver(clients[cid], clients[cid]["subs"][idx], subject, reply, payload)
                    clients[cid]["subs"] = [s for s in clients[cid]["subs"] if s["max"] != 0]
            for key, matches in queues.items():
                cursor = state["cursors"].get(key, 0)
                state["cursors"][key] = cursor + 1
                cid, idx = matches[cursor % len(matches)]
                if cid in clients and idx < len(clients[cid]["subs"]):
                    deliver(clients[cid], clients[cid]["subs"][idx], subject, reply, payload)
                    clients[cid]["subs"] = [s for s in clients[cid]["subs"] if s["max"] != 0]

    def handle(conn):
        with lock:
            cid = state["next"]
            state["next"] += 1
            state["clients"][cid] = {"conn": conn, "verbose": False, "echo": True, "headers": False, "subs": []}
        send(conn, f"INFO {{\"server_id\":\"UMOJONATS0000000000001\",\"server_name\":\"universal-queues-mojo\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":{port},\"headers\":true,\"max_payload\":{MAX_PAYLOAD}}}\r\n")
        buf = b""
        try:
            while True:
                while b"\n" not in buf:
                    chunk = conn.recv(8192)
                    if not chunk:
                        raise RuntimeError("closed")
                    buf += chunk
                line, buf = buf.split(b"\n", 1)
                line = line.rstrip(b"\r").decode("utf-8")
                parts = line.split()
                if not parts:
                    continue
                op = parts[0].upper()
                client = state["clients"][cid]
                if op == "PING":
                    send(conn, "PONG\r\n")
                elif op == "CONNECT":
                    client["verbose"] = '"verbose":true' in line
                    client["echo"] = '"echo":false' not in line
                    client["headers"] = '"headers":true' in line
                    if client["verbose"]: send(conn, "+OK\r\n")
                elif op == "SUB" and len(parts) in (3, 4):
                    client["subs"].append({"subject": parts[1], "queue": parts[2] if len(parts) == 4 else "", "sid": parts[3] if len(parts) == 4 else parts[2], "delivered": 0, "max": -1})
                    if client["verbose"]: send(conn, "+OK\r\n")
                elif op == "UNSUB" and len(parts) in (2, 3):
                    for sub in client["subs"]:
                        if sub["sid"] == parts[1]: sub["max"] = int(parts[2]) if len(parts) == 3 else 0
                    client["subs"] = [s for s in client["subs"] if s["max"] != 0]
                    if client["verbose"]: send(conn, "+OK\r\n")
                elif op == "PUB" and len(parts) in (3, 4):
                    reply = parts[2] if len(parts) == 4 else ""
                    size = int(parts[-1])
                    while len(buf) < size + 2:
                        buf += conn.recv(8192)
                    payload, buf = buf[:size], buf[size+2:]
                    publish(cid, parts[1], reply, payload)
                    if client["verbose"]: send(conn, "+OK\r\n")
                elif op == "HPUB" and len(parts) in (4, 5):
                    reply = parts[2] if len(parts) == 5 else ""
                    header_size = int(parts[-2])
                    total_size = int(parts[-1])
                    while len(buf) < total_size + 2:
                        buf += conn.recv(8192)
                    payload, buf = buf[header_size:total_size], buf[total_size+2:]
                    publish(cid, parts[1], reply, payload)
                    if client["verbose"]: send(conn, "+OK\r\n")
                else:
                    send(conn, "-ERR 'Invalid Protocol'\r\n")
                    break
        finally:
            with lock:
                if cid in state["clients"]: del state["clients"][cid]
            conn.close()

    while True:
        conn, _ = server.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()
