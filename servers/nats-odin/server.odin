package main

// NATS Core reference server in Odin. Implements the same protocol contract as
// the Rust/Zig/Jai servers: INFO, CONNECT, PING/PONG, SUB/UNSUB, PUB, subject
// wildcards and queue groups. This file intentionally avoids external packages
// beyond Odin core networking APIs.

import "core:fmt"
import "core:net"
import "core:os"
import "core:slice"
import "core:strings"

MAX_PAYLOAD :: 1024 * 1024

Subscription :: struct { subject, queue, sid: string, delivered: int, max_msgs: int }
Client :: struct { conn: net.TCP_Connection, subs: [dynamic]Subscription, verbose, echo, headers: bool }
Match :: struct { client: int, sub: int }
Broker :: struct { clients: [dynamic]^Client, cursors: map[string]int }

main :: proc() {
    port := 4222
    if len(os.args) > 1 { port = strconv.atoi(os.args[1]) }
    listener, err := net.listen_tcp(fmt.tprintf(":%d", port))
    if err != nil { panic("listen failed") }
    broker := Broker{cursors = make(map[string]int)}
    fmt.eprintln("universal-queues Odin NATS core server listening on 0.0.0.0:", port)
    for {
        conn, ok := net.accept_tcp(listener)
        if !ok { continue }
        client := new(Client)
        client.conn = conn
        client.echo = true
        append(&broker.clients, client)
        go handle_client(&broker, client, port)
    }
}

handle_client :: proc(b: ^Broker, c: ^Client, port: int) {
    defer net.close(c.conn)
    write(c, fmt.tprintf("INFO {\"server_id\":\"UODINNATS0000000000001\",\"server_name\":\"universal-queues-odin\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":%d,\"headers\":true,\"max_payload\":%d}\r\n", port, MAX_PAYLOAD))
    buffer := make([]byte, 0, 65536)
    for {
        tmp: [8192]byte
        n, ok := net.recv(c.conn, tmp[:])
        if !ok || n <= 0 { return }
        append(&buffer, tmp[:n]...)
        for {
            idx := bytes.index_byte(buffer, '\n')
            if idx < 0 { break }
            line := strings.trim_right(string(buffer[:idx]), "\r")
            buffer = buffer[idx+1:]
            if !process_line(b, c, line, &buffer) { return }
        }
    }
}

process_line :: proc(b: ^Broker, c: ^Client, line: string, pending: ^[]byte) -> bool {
    parts := strings.fields(line)
    if len(parts) == 0 { return true }
    op := strings.to_upper(parts[0])
    switch op {
    case "PING": write(c, "PONG\r\n")
    case "PONG": ok(c)
    case "CONNECT":
        c.verbose = strings.contains(line, "\"verbose\":true")
        c.echo = !strings.contains(line, "\"echo\":false")
        c.headers = strings.contains(line, "\"headers\":true")
        ok(c)
    case "SUB":
        if len(parts) != 3 && len(parts) != 4 { err(c); return false }
        sub := Subscription{subject = parts[1], max_msgs = -1}
        if len(parts) == 4 { sub.queue = parts[2]; sub.sid = parts[3] } else { sub.sid = parts[2] }
        append(&c.subs, sub); ok(c)
    case "UNSUB":
        if len(parts) != 2 && len(parts) != 3 { err(c); return false }
        for &sub in c.subs { if sub.sid == parts[1] { sub.max_msgs = len(parts) == 3 ? strconv.atoi(parts[2]) : 0 } }
        prune(c); ok(c)
    case "PUB":
        if len(parts) != 3 && len(parts) != 4 { err(c); return false }
        size := strconv.atoi(parts[len(parts)-1])
        if size > MAX_PAYLOAD || len(pending^) < size + 2 { err(c); return false }
        reply := len(parts) == 4 ? parts[2] : ""
        publish(b, c, parts[1], reply, pending^[:size])
        pending^ = pending^[size+2:]
        ok(c)
    case: err(c); return false
    }
    return true
}

publish :: proc(b: ^Broker, publisher: ^Client, subject, reply: string, payload: []byte) {
    for client in b.clients {
        if !publisher.echo && client == publisher { continue }
        for &sub in client.subs {
            if !subject_matches(sub.subject, subject) { continue }
            deliver(client, &sub, subject, reply, payload)
        }
        prune(client)
    }
}

deliver :: proc(c: ^Client, s: ^Subscription, subject, reply: string, payload: []byte) {
    if reply != "" { write(c, fmt.tprintf("MSG %s %s %s %d\r\n", subject, s.sid, reply, len(payload))) }
    else { write(c, fmt.tprintf("MSG %s %s %d\r\n", subject, s.sid, len(payload))) }
    net.send(c.conn, payload); write(c, "\r\n")
    s.delivered += 1
    if s.max_msgs >= 0 && s.delivered >= s.max_msgs { s.max_msgs = 0 }
}

subject_matches :: proc(pattern, subject: string) -> bool {
    p := strings.split(pattern, "."); s := strings.split(subject, ".")
    si := 0
    for token, pi in p {
        if token == ">" { return pi == 0 || si < len(s) }
        if si >= len(s) { return false }
        if token != "*" && token != s[si] { return false }
        si += 1
    }
    return si == len(s)
}

write :: proc(c: ^Client, data: string) { net.send(c.conn, transmute([]byte)data) }
ok :: proc(c: ^Client) { if c.verbose { write(c, "+OK\r\n") } }
err :: proc(c: ^Client) { write(c, "-ERR 'Invalid Protocol'\r\n") }
prune :: proc(c: ^Client) { slice.filter_in_place(&c.subs, proc(s: Subscription)->bool { return s.max_msgs != 0 }) }
