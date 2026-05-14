package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
)

const maxPayload = 1024 * 1024

var serverID = "UGONATS00000000000000001"

type subscription struct {
	subject string
	queue   string
	sid     string
	deliv   int
	max     int
}

type client struct {
	id      int
	conn    net.Conn
	writeMu sync.Mutex
	subs    []subscription
	verbose bool
	echo    bool
	headers bool
	closed  bool
}

type match struct{ cid, idx int }

type broker struct {
	mu      sync.Mutex
	nextID  int
	clients map[int]*client
	cursors map[string]int
}

func newBroker() *broker {
	return &broker{nextID: 1, clients: map[int]*client{}, cursors: map[string]int{}}
}

func (b *broker) add(c net.Conn) *client {
	b.mu.Lock()
	defer b.mu.Unlock()
	cl := &client{id: b.nextID, conn: c, echo: true}
	b.clients[cl.id] = cl
	b.nextID++
	return cl
}
func (b *broker) remove(id int) { b.mu.Lock(); delete(b.clients, id); b.mu.Unlock() }
func (b *broker) config(id int, verbose, echo, headers bool) {
	b.mu.Lock()
	if c := b.clients[id]; c != nil {
		c.verbose = verbose
		c.echo = echo
		c.headers = headers
	}
	b.mu.Unlock()
}
func (b *broker) sub(id int, subject, queue, sid string) {
	b.mu.Lock()
	if c := b.clients[id]; c != nil {
		c.subs = append(c.subs, subscription{subject: subject, queue: queue, sid: sid, max: -1})
	}
	b.mu.Unlock()
}
func (b *broker) unsub(id int, sid string, max *int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c := b.clients[id]
	if c == nil {
		return
	}
	out := c.subs[:0]
	for _, s := range c.subs {
		if s.sid == sid {
			if max != nil {
				s.max = *max
				out = append(out, s)
			}
		} else {
			out = append(out, s)
		}
	}
	c.subs = out
}

func (b *broker) publish(pubID int, subject, reply string, payload []byte, hlen int) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	pubEcho := true
	if p := b.clients[pubID]; p != nil {
		pubEcho = p.echo
	}
	direct := []match{}
	queues := map[string][]match{}
	for id, c := range b.clients {
		if c.closed || (!pubEcho && id == pubID) {
			continue
		}
		for i, s := range c.subs {
			if !subjectMatches(s.subject, subject) {
				continue
			}
			if s.queue != "" {
				k := s.subject + "\x00" + s.queue
				queues[k] = append(queues[k], match{id, i})
			} else {
				direct = append(direct, match{id, i})
			}
		}
	}
	for _, m := range direct {
		if err := b.deliver(m, subject, reply, payload, hlen); err != nil {
			return err
		}
	}
	for k, ms := range queues {
		if len(ms) == 0 {
			continue
		}
		cur := b.cursors[k]
		b.cursors[k] = cur + 1
		if err := b.deliver(ms[cur%len(ms)], subject, reply, payload, hlen); err != nil {
			return err
		}
	}
	return nil
}

func (b *broker) deliver(m match, subject, reply string, payload []byte, hlen int) error {
	c := b.clients[m.cid]
	if c == nil || m.idx >= len(c.subs) {
		return nil
	}
	s := &c.subs[m.idx]
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	body := payload
	if hlen >= 0 && c.headers {
		if reply != "" {
			fmt.Fprintf(c.conn, "HMSG %s %s %s %d %d\r\n", subject, s.sid, reply, hlen, len(payload))
		} else {
			fmt.Fprintf(c.conn, "HMSG %s %s %d %d\r\n", subject, s.sid, hlen, len(payload))
		}
	} else {
		if hlen >= 0 {
			body = payload[hlen:]
		}
		if reply != "" {
			fmt.Fprintf(c.conn, "MSG %s %s %s %d\r\n", subject, s.sid, reply, len(body))
		} else {
			fmt.Fprintf(c.conn, "MSG %s %s %d\r\n", subject, s.sid, len(body))
		}
	}
	if _, err := c.conn.Write(body); err != nil {
		return err
	}
	if _, err := c.conn.Write([]byte("\r\n")); err != nil {
		return err
	}
	s.deliv++
	if s.max >= 0 && s.deliv >= s.max {
		s.max = 0
	}
	out := c.subs[:0]
	for _, sub := range c.subs {
		if sub.max != 0 {
			out = append(out, sub)
		}
	}
	c.subs = out
	return nil
}

func main() {
	port := "4222"
	if len(os.Args) > 1 {
		port = os.Args[1]
	}
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		panic(err)
	}
	fmt.Fprintf(os.Stderr, "universal-queues Go NATS core server listening on 0.0.0.0:%s\n", port)
	b := newBroker()
	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}
		c := b.add(conn)
		go handle(b, c, port)
	}
}

func handle(b *broker, c *client, port string) {
	defer func() { b.remove(c.id); c.conn.Close() }()
	fmt.Fprintf(c.conn, "INFO {\"server_id\":\"%s\",\"server_name\":\"universal-queues-go\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":%s,\"headers\":true,\"max_payload\":%d}\r\n", serverID, port, maxPayload)
	r := bufio.NewReader(c.conn)
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			continue
		}
		if err := process(b, c, r, line); err != nil {
			fmt.Fprintf(c.conn, "-ERR '%s'\r\n", err.Error())
			return
		}
	}
}

func process(b *broker, c *client, r *bufio.Reader, line string) error {
	parts := strings.Fields(line)
	if len(parts) == 0 {
		return nil
	}
	op := strings.ToUpper(parts[0])
	switch op {
	case "PING":
		_, e := c.conn.Write([]byte("PONG\r\n"))
		return e
	case "PONG":
		return ok(c)
	case "CONNECT":
		json := strings.TrimSpace(line[len(parts[0]):])
		b.config(c.id, strings.Contains(json, "\"verbose\":true"), !strings.Contains(json, "\"echo\":false"), strings.Contains(json, "\"headers\":true"))
		return ok(c)
	case "SUB":
		if len(parts) != 3 && len(parts) != 4 {
			return fmt.Errorf("Invalid Protocol")
		}
		q := ""
		sid := parts[2]
		if len(parts) == 4 {
			q = parts[2]
			sid = parts[3]
		}
		b.sub(c.id, parts[1], q, sid)
		return ok(c)
	case "UNSUB":
		if len(parts) != 2 && len(parts) != 3 {
			return fmt.Errorf("Invalid Protocol")
		}
		var max *int
		if len(parts) == 3 {
			v, err := strconv.Atoi(parts[2])
			if err != nil {
				return fmt.Errorf("Invalid Protocol")
			}
			max = &v
		}
		b.unsub(c.id, parts[1], max)
		return ok(c)
	case "PUB":
		if len(parts) != 3 && len(parts) != 4 {
			return fmt.Errorf("Invalid Protocol")
		}
		reply := ""
		szs := parts[2]
		if len(parts) == 4 {
			reply = parts[2]
			szs = parts[3]
		}
		sz, err := strconv.Atoi(szs)
		if err != nil {
			return fmt.Errorf("Invalid Protocol")
		}
		p, err := readPayload(r, sz)
		if err != nil {
			return err
		}
		if err := b.publish(c.id, parts[1], reply, p, -1); err != nil {
			return err
		}
		return ok(c)
	case "HPUB":
		if len(parts) != 4 && len(parts) != 5 {
			return fmt.Errorf("Invalid Protocol")
		}
		reply := ""
		hs, ts := parts[2], parts[3]
		if len(parts) == 5 {
			reply = parts[2]
			hs = parts[3]
			ts = parts[4]
		}
		h, err := strconv.Atoi(hs)
		if err != nil {
			return fmt.Errorf("Invalid Protocol")
		}
		total, err := strconv.Atoi(ts)
		if err != nil || h > total {
			return fmt.Errorf("Invalid Protocol")
		}
		p, err := readPayload(r, total)
		if err != nil {
			return err
		}
		if err := b.publish(c.id, parts[1], reply, p, h); err != nil {
			return err
		}
		return ok(c)
	default:
		return fmt.Errorf("Invalid Protocol")
	}
}
func readPayload(r *bufio.Reader, size int) ([]byte, error) {
	if size > maxPayload {
		return nil, fmt.Errorf("Maximum Payload Violation")
	}
	p := make([]byte, size)
	if _, err := io.ReadFull(r, p); err != nil {
		return nil, err
	}
	crlf := make([]byte, 2)
	if _, err := io.ReadFull(r, crlf); err != nil {
		return nil, err
	}
	if string(crlf) != "\r\n" {
		return nil, fmt.Errorf("Invalid Protocol")
	}
	return p, nil
}
func ok(c *client) error {
	if c.verbose {
		_, err := c.conn.Write([]byte("+OK\r\n"))
		return err
	}
	return nil
}
func subjectMatches(pattern, subject string) bool {
	p := strings.Split(pattern, ".")
	s := strings.Split(subject, ".")
	si := 0
	for pi, t := range p {
		if t == ">" {
			return pi == 0 || si < len(s)
		}
		if si >= len(s) {
			return false
		}
		if t != "*" && t != s[si] {
			return false
		}
		si++
	}
	return si == len(s)
}
