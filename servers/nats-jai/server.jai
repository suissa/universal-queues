// Universal Queues NATS Core server in Jai.
//
// Build/run (with a local Jai toolchain):
//   jai server.jai
//   ./server 4222
//
// This implementation follows docs/nats-core-server-spec.md. It is a compact
// reference server for Core NATS clients: INFO, CONNECT, PING/PONG, SUB, UNSUB,
// PUB, HPUB, wildcard subjects, queue groups, verbose +OK, and protocol errors.

#import "Basic";
#import "Socket";
#import "String";

MAX_PAYLOAD :: 1024 * 1024;
DEFAULT_PORT :: 4222;
SERVER_ID :: "UJAINATS0000000000000001";

Subscription :: struct {
    subject: string;
    queue: string;
    sid: string;
    delivered: int;
    max_msgs: int; // -1 means unlimited, 0 means remove now.
}

Client :: struct {
    id: int;
    socket: Socket;
    subscriptions: [..]Subscription;
    verbose: bool;
    echo: bool = true;
    headers: bool;
    closed: bool;
    write_mutex: Mutex;
}

Match :: struct {
    client: *Client;
    sub_index: int;
}

Broker :: struct {
    mutex: Mutex;
    clients: [..]*Client;
    next_client_id: int = 1;
    queue_cursors: Table(string, int);
}

main :: () {
    port := DEFAULT_PORT;
    if args.count > 1 {
        port = string_to_int(args[1]);
    }

    broker: Broker;
    table_init(*broker.queue_cursors);

    listener := socket_create(.TCP);
    socket_set_reuse_address(listener, true);
    socket_bind(listener, "0.0.0.0", port);
    socket_listen(listener, 256);

    print("universal-queues Jai NATS core server listening on 0.0.0.0:%\n", port);

    while true {
        conn := socket_accept(listener);
        client := New(Client);
        client.socket = conn;
        array_init(*client.subscriptions);
        mutex_init(*client.write_mutex);
        broker_add_client(*broker, client);
        thread_create(handle_client, client, *broker, port);
    }
}

broker_add_client :: (broker: *Broker, client: *Client) {
    mutex_lock(*broker.mutex);
    defer mutex_unlock(*broker.mutex);
    client.id = broker.next_client_id;
    broker.next_client_id += 1;
    array_add(*broker.clients, client);
}

broker_remove_client :: (broker: *Broker, client: *Client) {
    mutex_lock(*broker.mutex);
    defer mutex_unlock(*broker.mutex);
    client.closed = true;
    for i: 0..broker.clients.count-1 {
        if broker.clients[i] == client {
            array_ordered_remove_by_index(*broker.clients, i);
            break;
        }
    }
}

handle_client :: (client: *Client, broker: *Broker, port: int) {
    defer {
        broker_remove_client(broker, client);
        socket_close(client.socket);
        for * sub: client.subscriptions {
            free(sub.subject);
            if sub.queue.count > 0 free(sub.queue);
            free(sub.sid);
        }
        array_free(*client.subscriptions);
        free(client);
    }

    socket_write(client.socket, tprint("INFO {\"server_id\":\"%\",\"server_name\":\"universal-queues-jai\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":%,\"headers\":true,\"max_payload\":%}\r\n", SERVER_ID, port, MAX_PAYLOAD));

    while true {
        line, ok := read_line(client.socket);
        if !ok return;
        line = trim_right(line, "\r");
        if line.count == 0 continue;
        if !process_line(broker, client, line) {
            send_error(client, "'Invalid Protocol'");
            return;
        }
    }
}

process_line :: (broker: *Broker, client: *Client, line: string) -> bool {
    tokens := split_whitespace(line);
    if tokens.count == 0 return true;
    op := to_upper(tokens[0]);

    if op == "PING" {
        socket_write(client.socket, "PONG\r\n");
        return true;
    }
    if op == "PONG" {
        send_ok(client);
        return true;
    }
    if op == "CONNECT" {
        json := slice_from(line, tokens[0].count, line.count);
        client.verbose = contains(json, "\"verbose\":true");
        client.echo = !contains(json, "\"echo\":false");
        client.headers = contains(json, "\"headers\":true");
        send_ok(client);
        return true;
    }
    if op == "SUB" {
        if tokens.count != 3 && tokens.count != 4 return false;
        subject := copy_string(tokens[1]);
        queue: string = "";
        sid: string;
        if tokens.count == 4 {
            queue = copy_string(tokens[2]);
            sid = copy_string(tokens[3]);
        } else {
            sid = copy_string(tokens[2]);
        }
        array_add(*client.subscriptions, .{ subject = subject, queue = queue, sid = sid, max_msgs = -1 });
        send_ok(client);
        return true;
    }
    if op == "UNSUB" {
        if tokens.count != 2 && tokens.count != 3 return false;
        sid := tokens[1];
        if tokens.count == 3 {
            max := string_to_int(tokens[2]);
            for * sub: client.subscriptions if sub.sid == sid sub.max_msgs = max;
        } else {
            remove_sid(client, sid);
        }
        send_ok(client);
        return true;
    }
    if op == "PUB" {
        if tokens.count != 3 && tokens.count != 4 return false;
        subject := tokens[1];
        reply: string = "";
        size_text: string;
        if tokens.count == 4 {
            reply = tokens[2];
            size_text = tokens[3];
        } else {
            size_text = tokens[2];
        }
        size := string_to_int(size_text);
        if size > MAX_PAYLOAD {
            send_error(client, "'Maximum Payload Violation'");
            return false;
        }
        payload, ok := read_payload(client.socket, size);
        if !ok return false;
        broker_publish(broker, client, subject, reply, payload, -1);
        free(payload);
        send_ok(client);
        return true;
    }
    if op == "HPUB" {
        if tokens.count != 4 && tokens.count != 5 return false;
        subject := tokens[1];
        reply: string = "";
        hsize_text: string;
        total_text: string;
        if tokens.count == 5 {
            reply = tokens[2];
            hsize_text = tokens[3];
            total_text = tokens[4];
        } else {
            hsize_text = tokens[2];
            total_text = tokens[3];
        }
        hsize := string_to_int(hsize_text);
        total := string_to_int(total_text);
        if total > MAX_PAYLOAD || hsize > total {
            send_error(client, "'Maximum Payload Violation'");
            return false;
        }
        payload, ok := read_payload(client.socket, total);
        if !ok return false;
        broker_publish(broker, client, subject, reply, payload, hsize);
        free(payload);
        send_ok(client);
        return true;
    }

    return false;
}

broker_publish :: (broker: *Broker, publisher: *Client, subject: string, reply: string, payload: string, header_len: int) {
    mutex_lock(*broker.mutex);
    defer mutex_unlock(*broker.mutex);

    direct: [..]Match;
    queue_matches: Table(string, [..]Match);
    table_init(*queue_matches);
    defer {
        for queue_matches if it.key.count > 0 free(it.key);
        table_free(*queue_matches);
        array_free(*direct);
    }

    for client: broker.clients {
        if client.closed continue;
        if !publisher.echo && client == publisher continue;
        for i: 0..client.subscriptions.count-1 {
            sub := *client.subscriptions[i];
            if !subject_matches(sub.subject, subject) continue;
            match := Match.{ client = client, sub_index = i };
            if sub.queue.count > 0 {
                key := tprint("%\x00%", sub.subject, sub.queue);
                bucket := table_find_pointer(*queue_matches, key);
                if bucket == null {
                    copied_key := copy_string(key);
                    empty: [..]Match;
                    array_init(*empty);
                    table_add(*queue_matches, copied_key, empty);
                    bucket = table_find_pointer(*queue_matches, copied_key);
                }
                array_add(bucket, match);
            } else {
                array_add(*direct, match);
            }
        }
    }

    for match: direct deliver(match, subject, reply, payload, header_len);

    for queue_matches {
        matches := it.value;
        if matches.count == 0 continue;
        cursor := 0;
        found := table_find(*broker.queue_cursors, it.key, *cursor);
        chosen := matches[cursor % matches.count];
        table_set(*broker.queue_cursors, it.key, cursor + 1);
        deliver(chosen, subject, reply, payload, header_len);
    }
}

deliver :: (match: Match, subject: string, reply: string, payload: string, header_len: int) {
    client := match.client;
    sub := *client.subscriptions[match.sub_index];
    mutex_lock(*client.write_mutex);
    defer mutex_unlock(*client.write_mutex);

    if header_len >= 0 && client.headers {
        if reply.count > 0 socket_write(client.socket, tprint("HMSG % % % % %\r\n", subject, sub.sid, reply, header_len, payload.count));
        else socket_write(client.socket, tprint("HMSG % % % %\r\n", subject, sub.sid, header_len, payload.count));
        socket_write(client.socket, payload);
        socket_write(client.socket, "\r\n");
    } else {
        body := payload;
        if header_len >= 0 body = slice_from(payload, header_len, payload.count);
        if reply.count > 0 socket_write(client.socket, tprint("MSG % % % %\r\n", subject, sub.sid, reply, body.count));
        else socket_write(client.socket, tprint("MSG % % %\r\n", subject, sub.sid, body.count));
        socket_write(client.socket, body);
        socket_write(client.socket, "\r\n");
    }

    sub.delivered += 1;
    if sub.max_msgs > 0 && sub.delivered >= sub.max_msgs sub.max_msgs = 0;
    prune_delivered(client);
}

subject_matches :: (pattern: string, subject: string) -> bool {
    p := split(pattern, ".");
    s := split(subject, ".");
    pi := 0;
    si := 0;
    while pi < p.count {
        token := p[pi];
        if token == ">" return pi == 0 || si < s.count;
        if si >= s.count return false;
        if token != "*" && token != s[si] return false;
        pi += 1;
        si += 1;
    }
    return si == s.count;
}

remove_sid :: (client: *Client, sid: string) {
    i := 0;
    while i < client.subscriptions.count {
        if client.subscriptions[i].sid == sid {
            free(client.subscriptions[i].subject);
            if client.subscriptions[i].queue.count > 0 free(client.subscriptions[i].queue);
            free(client.subscriptions[i].sid);
            array_ordered_remove_by_index(*client.subscriptions, i);
        } else i += 1;
    }
}

prune_delivered :: (client: *Client) {
    i := 0;
    while i < client.subscriptions.count {
        if client.subscriptions[i].max_msgs == 0 {
            remove_sid(client, client.subscriptions[i].sid);
        } else i += 1;
    }
}

send_ok :: (client: *Client) {
    if client.verbose socket_write(client.socket, "+OK\r\n");
}

send_error :: (client: *Client, message: string) {
    socket_write(client.socket, tprint("-ERR %\r\n", message));
}

read_line :: (socket: Socket) -> (string, bool) {
    builder: String_Builder;
    while true {
        byte: [1]u8;
        got := socket_read(socket, byte.data, 1);
        if got <= 0 return "", false;
        if byte[0] == '\n' break;
        builder_append(*builder, byte[0]);
    }
    return builder_to_string(*builder), true;
}

read_payload :: (socket: Socket, size: int) -> (string, bool) {
    payload := alloc_string(size);
    got := socket_read_exact(socket, payload.data, size);
    if got != size return "", false;
    crlf: [2]u8;
    got = socket_read_exact(socket, crlf.data, 2);
    if got != 2 || crlf[0] != '\r' || crlf[1] != '\n' return "", false;
    return payload, true;
}
