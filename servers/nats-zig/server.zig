const std = @import("std");

const MAX_PAYLOAD: usize = 1024 * 1024;
const DEFAULT_PORT: u16 = 4222;
const SERVER_ID = "UZIGNATS0000000000000001";

const Subscription = struct {
    subject: []const u8,
    queue: ?[]const u8,
    sid: []const u8,
    delivered: usize = 0,
    max_msgs: ?usize = null,
};

const Client = struct {
    id: usize,
    stream: std.net.Stream,
    subs: std.ArrayList(Subscription),
    verbose: bool = false,
    echo: bool = true,
    headers: bool = false,
    write_lock: std.Thread.Mutex = .{},
    closed: bool = false,
};

const Broker = struct {
    allocator: std.mem.Allocator,
    lock: std.Thread.Mutex = .{},
    clients: std.ArrayList(*Client),
    next_client_id: usize = 1,
    queue_cursor: std.StringHashMap(usize),

    fn init(allocator: std.mem.Allocator) Broker {
        return .{
            .allocator = allocator,
            .clients = std.ArrayList(*Client).init(allocator),
            .queue_cursor = std.StringHashMap(usize).init(allocator),
        };
    }

    fn addClient(self: *Broker, client: *Client) !void {
        self.lock.lock();
        defer self.lock.unlock();
        client.id = self.next_client_id;
        self.next_client_id += 1;
        try self.clients.append(client);
    }

    fn removeClient(self: *Broker, client: *Client) void {
        self.lock.lock();
        defer self.lock.unlock();
        client.closed = true;
        var i: usize = 0;
        while (i < self.clients.items.len) : (i += 1) {
            if (self.clients.items[i] == client) {
                _ = self.clients.swapRemove(i);
                break;
            }
        }
    }

    fn publish(self: *Broker, publisher: *Client, subject: []const u8, reply: ?[]const u8, payload: []const u8, headers_len: ?usize) !void {
        self.lock.lock();
        defer self.lock.unlock();

        var queue_matches = std.StringHashMap(std.ArrayList(Match)).init(self.allocator);
        defer {
            var it = queue_matches.iterator();
            while (it.next()) |entry| entry.value_ptr.deinit();
            queue_matches.deinit();
        }

        var direct = std.ArrayList(Match).init(self.allocator);
        defer direct.deinit();

        for (self.clients.items) |client| {
            if (client.closed) continue;
            if (!publisher.echo and client == publisher) continue;
            for (client.subs.items, 0..) |*sub, idx| {
                if (!subjectMatches(sub.subject, subject)) continue;
                const m = Match{ .client = client, .sub_index = idx };
                if (sub.queue) |queue| {
                    const key = try std.fmt.allocPrint(self.allocator, "{s}\x00{s}", .{ sub.subject, queue });
                    var gop = try queue_matches.getOrPut(key);
                    if (!gop.found_existing) gop.value_ptr.* = std.ArrayList(Match).init(self.allocator) else self.allocator.free(key);
                    try gop.value_ptr.append(m);
                } else {
                    try direct.append(m);
                }
            }
        }

        for (direct.items) |m| try self.deliver(m, subject, reply, payload, headers_len);

        var it = queue_matches.iterator();
        while (it.next()) |entry| {
            if (entry.value_ptr.items.len == 0) continue;
            const cursor = self.queue_cursor.get(entry.key_ptr.*) orelse 0;
            const chosen = entry.value_ptr.items[cursor % entry.value_ptr.items.len];
            try self.queue_cursor.put(entry.key_ptr.*, cursor + 1);
            try self.deliver(chosen, subject, reply, payload, headers_len);
        }
    }

    fn deliver(self: *Broker, m: Match, subject: []const u8, reply: ?[]const u8, payload: []const u8, headers_len: ?usize) !void {
        _ = self;
        var sub = &m.client.subs.items[m.sub_index];
        m.client.write_lock.lock();
        defer m.client.write_lock.unlock();

        if (headers_len) |hlen| {
            if (m.client.headers) {
                if (reply) |r| {
                    try m.client.stream.writer().print("HMSG {s} {s} {s} {d} {d}\r\n", .{ subject, sub.sid, r, hlen, payload.len });
                } else {
                    try m.client.stream.writer().print("HMSG {s} {s} {d} {d}\r\n", .{ subject, sub.sid, hlen, payload.len });
                }
                try m.client.stream.writeAll(payload);
                try m.client.stream.writeAll("\r\n");
            } else {
                const body = payload[hlen..];
                if (reply) |r| {
                    try m.client.stream.writer().print("MSG {s} {s} {s} {d}\r\n", .{ subject, sub.sid, r, body.len });
                } else {
                    try m.client.stream.writer().print("MSG {s} {s} {d}\r\n", .{ subject, sub.sid, body.len });
                }
                try m.client.stream.writeAll(body);
                try m.client.stream.writeAll("\r\n");
            }
        } else {
            if (reply) |r| {
                try m.client.stream.writer().print("MSG {s} {s} {s} {d}\r\n", .{ subject, sub.sid, r, payload.len });
            } else {
                try m.client.stream.writer().print("MSG {s} {s} {d}\r\n", .{ subject, sub.sid, payload.len });
            }
            try m.client.stream.writeAll(payload);
            try m.client.stream.writeAll("\r\n");
        }

        sub.delivered += 1;
        if (sub.max_msgs) |max| {
            if (sub.delivered >= max) sub.max_msgs = 0;
        }
        pruneDelivered(self.allocator, m.client);
    }
};

const Match = struct { client: *Client, sub_index: usize };

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var broker = Broker.init(allocator);
    const port = try readPort();
    const address = try std.net.Address.parseIp("0.0.0.0", port);
    var server = std.net.StreamServer.init(.{ .reuse_address = true });
    defer server.deinit();
    try server.listen(address);
    std.debug.print("universal-queues Zig NATS core server listening on 0.0.0.0:{d}\n", .{port});

    while (true) {
        const conn = try server.accept();
        const client = try allocator.create(Client);
        client.* = .{ .id = 0, .stream = conn.stream, .subs = std.ArrayList(Subscription).init(allocator) };
        try broker.addClient(client);
        const thread = try std.Thread.spawn(.{}, handleClient, .{ allocator, &broker, client, port });
        thread.detach();
    }
}

fn readPort() !u16 {
    var args = std.process.args();
    _ = args.next();
    if (args.next()) |value| return try std.fmt.parseInt(u16, value, 10);
    return DEFAULT_PORT;
}

fn handleClient(allocator: std.mem.Allocator, broker: *Broker, client: *Client, port: u16) void {
    defer {
        broker.removeClient(client);
        client.stream.close();
        for (client.subs.items) |sub| {
            allocator.free(sub.subject);
            if (sub.queue) |q| allocator.free(q);
            allocator.free(sub.sid);
        }
        client.subs.deinit();
        allocator.destroy(client);
    }

    client.stream.writer().print("INFO {{\"server_id\":\"{s}\",\"server_name\":\"universal-queues-zig\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":{d},\"headers\":true,\"max_payload\":{d}}}\r\n", .{ SERVER_ID, port, MAX_PAYLOAD }) catch return;

    var reader = client.stream.reader();
    while (true) {
        const raw_line = reader.readUntilDelimiterAlloc(allocator, '\n', 64 * 1024) catch return;
        defer allocator.free(raw_line);
        const line = std.mem.trimRight(u8, raw_line, "\r");
        if (line.len == 0) continue;
        processLine(allocator, broker, client, &reader, line) catch |err| {
            sendErr(client, switch (err) {
                error.PayloadTooLarge => "'Maximum Payload Violation'",
                error.InvalidProtocol => "'Invalid Protocol'",
                else => "'Server Error'",
            }) catch {};
            return;
        };
    }
}

fn processLine(allocator: std.mem.Allocator, broker: *Broker, client: *Client, reader: anytype, line: []const u8) !void {
    var parts = std.mem.tokenizeScalar(u8, line, ' ');
    const op = parts.next() orelse return error.InvalidProtocol;
    if (asciiEql(op, "PING")) {
        try client.stream.writeAll("PONG\r\n");
    } else if (asciiEql(op, "PONG")) {
        try ok(client);
    } else if (asciiEql(op, "CONNECT")) {
        const json = std.mem.trim(u8, line[op.len..], " ");
        client.verbose = std.mem.indexOf(u8, json, "\"verbose\":true") != null;
        client.echo = std.mem.indexOf(u8, json, "\"echo\":false") == null;
        client.headers = std.mem.indexOf(u8, json, "\"headers\":true") != null;
        try ok(client);
    } else if (asciiEql(op, "SUB")) {
        const subject = parts.next() orelse return error.InvalidProtocol;
        const second = parts.next() orelse return error.InvalidProtocol;
        const third = parts.next();
        const queue: ?[]const u8 = if (third) |_| second else null;
        const sid = third orelse second;
        try client.subs.append(.{
            .subject = try allocator.dupe(u8, subject),
            .queue = if (queue) |q| try allocator.dupe(u8, q) else null,
            .sid = try allocator.dupe(u8, sid),
        });
        try ok(client);
    } else if (asciiEql(op, "UNSUB")) {
        const sid = parts.next() orelse return error.InvalidProtocol;
        const max_raw = parts.next();
        if (max_raw) |mraw| {
            const max = try std.fmt.parseInt(usize, mraw, 10);
            for (client.subs.items) |*sub| if (std.mem.eql(u8, sub.sid, sid)) sub.max_msgs = max;
        } else {
            removeSid(allocator, client, sid);
        }
        try ok(client);
    } else if (asciiEql(op, "PUB")) {
        const subject = parts.next() orelse return error.InvalidProtocol;
        const second = parts.next() orelse return error.InvalidProtocol;
        const third = parts.next();
        const reply: ?[]const u8 = if (third) |_| second else null;
        const size_text = third orelse second;
        const size = try std.fmt.parseInt(usize, size_text, 10);
        if (size > MAX_PAYLOAD) return error.PayloadTooLarge;
        const payload = try readPayload(allocator, reader, size);
        defer allocator.free(payload);
        try broker.publish(client, subject, reply, payload, null);
        try ok(client);
    } else if (asciiEql(op, "HPUB")) {
        const subject = parts.next() orelse return error.InvalidProtocol;
        const a = parts.next() orelse return error.InvalidProtocol;
        const b = parts.next() orelse return error.InvalidProtocol;
        const c = parts.next();
        const reply: ?[]const u8 = if (c) |_| a else null;
        const hsize_text = if (c) |_| b else a;
        const total_text = c orelse b;
        const hsize = try std.fmt.parseInt(usize, hsize_text, 10);
        const total = try std.fmt.parseInt(usize, total_text, 10);
        if (total > MAX_PAYLOAD or hsize > total) return error.PayloadTooLarge;
        const payload = try readPayload(allocator, reader, total);
        defer allocator.free(payload);
        try broker.publish(client, subject, reply, payload, hsize);
        try ok(client);
    } else {
        return error.InvalidProtocol;
    }
}

fn readPayload(allocator: std.mem.Allocator, reader: anytype, size: usize) ![]u8 {
    const payload = try allocator.alloc(u8, size);
    errdefer allocator.free(payload);
    try reader.readNoEof(payload);
    var crlf: [2]u8 = undefined;
    try reader.readNoEof(&crlf);
    if (!(crlf[0] == '\r' and crlf[1] == '\n')) return error.InvalidProtocol;
    return payload;
}

fn ok(client: *Client) !void {
    if (client.verbose) try client.stream.writeAll("+OK\r\n");
}

fn sendErr(client: *Client, msg: []const u8) !void {
    try client.stream.writer().print("-ERR {s}\r\n", .{msg});
}

fn asciiEql(a: []const u8, b: []const u8) bool {
    return std.ascii.eqlIgnoreCase(a, b);
}

fn subjectMatches(pattern: []const u8, subject: []const u8) bool {
    var p = std.mem.tokenizeScalar(u8, pattern, '.');
    var s = std.mem.tokenizeScalar(u8, subject, '.');
    var matched_tokens: usize = 0;
    while (true) {
        const pt = p.next();
        if (pt == null) return s.next() == null;
        if (std.mem.eql(u8, pt.?, ">")) return matched_tokens == 0 or s.next() != null;
        const st = s.next() orelse return false;
        if (!std.mem.eql(u8, pt.?, "*") and !std.mem.eql(u8, pt.?, st)) return false;
        matched_tokens += 1;
    }
}

fn removeSid(allocator: std.mem.Allocator, client: *Client, sid: []const u8) void {
    var i: usize = 0;
    while (i < client.subs.items.len) {
        if (std.mem.eql(u8, client.subs.items[i].sid, sid)) {
            const sub = client.subs.swapRemove(i);
            allocator.free(sub.subject);
            if (sub.queue) |q| allocator.free(q);
            allocator.free(sub.sid);
        } else i += 1;
    }
}

fn pruneDelivered(allocator: std.mem.Allocator, client: *Client) void {
    var i: usize = 0;
    while (i < client.subs.items.len) {
        const sub = client.subs.items[i];
        if (sub.max_msgs != null and sub.max_msgs.? == 0) {
            const removed = client.subs.swapRemove(i);
            allocator.free(removed.subject);
            if (removed.queue) |q| allocator.free(q);
            allocator.free(removed.sid);
        } else i += 1;
    }
}
