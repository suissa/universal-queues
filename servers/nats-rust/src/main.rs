#[cfg(not(target_arch = "wasm32"))]
use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::io::{self, BufRead, BufReader, Read, Write};
#[cfg(not(target_arch = "wasm32"))]
use std::net::{TcpListener, TcpStream};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::{Arc, Mutex};
#[cfg(not(target_arch = "wasm32"))]
use std::thread;

const MAX_PAYLOAD: usize = 1024 * 1024;
#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_PORT: u16 = 4222;
#[cfg(not(target_arch = "wasm32"))]
const SERVER_ID: &str = "URUSTNATS000000000000001";

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Debug)]
struct Subscription {
    subject: String,
    queue: Option<String>,
    sid: String,
    delivered: usize,
    max_msgs: Option<usize>,
}

#[cfg(not(target_arch = "wasm32"))]
struct Client {
    writer: Arc<Mutex<TcpStream>>,
    subscriptions: Vec<Subscription>,
    verbose: bool,
    echo: bool,
    headers: bool,
    closed: bool,
}

#[cfg(not(target_arch = "wasm32"))]
struct Broker {
    clients: HashMap<usize, Client>,
    next_client_id: usize,
    queue_cursors: HashMap<String, usize>,
}

#[cfg(not(target_arch = "wasm32"))]
impl Broker {
    fn new() -> Self {
        Self {
            clients: HashMap::new(),
            next_client_id: 1,
            queue_cursors: HashMap::new(),
        }
    }

    fn add_client(&mut self, writer: Arc<Mutex<TcpStream>>) -> usize {
        let id = self.next_client_id;
        self.next_client_id += 1;
        self.clients.insert(
            id,
            Client {
                writer,
                subscriptions: Vec::new(),
                verbose: false,
                echo: true,
                headers: false,
                closed: false,
            },
        );
        id
    }

    fn remove_client(&mut self, client_id: usize) {
        if let Some(client) = self.clients.get_mut(&client_id) {
            client.closed = true;
        }
        self.clients.remove(&client_id);
    }

    fn configure_client(&mut self, client_id: usize, verbose: bool, echo: bool, headers: bool) {
        if let Some(client) = self.clients.get_mut(&client_id) {
            client.verbose = verbose;
            client.echo = echo;
            client.headers = headers;
        }
    }

    fn add_subscription(
        &mut self,
        client_id: usize,
        subject: &str,
        queue: Option<&str>,
        sid: &str,
    ) {
        if let Some(client) = self.clients.get_mut(&client_id) {
            client.subscriptions.push(Subscription {
                subject: subject.to_string(),
                queue: queue.map(str::to_string),
                sid: sid.to_string(),
                delivered: 0,
                max_msgs: None,
            });
        }
    }

    fn unsubscribe(&mut self, client_id: usize, sid: &str, max_msgs: Option<usize>) {
        if let Some(client) = self.clients.get_mut(&client_id) {
            if let Some(max) = max_msgs {
                for sub in &mut client.subscriptions {
                    if sub.sid == sid {
                        sub.max_msgs = Some(max);
                    }
                }
            } else {
                client.subscriptions.retain(|sub| sub.sid != sid);
            }
        }
    }

    fn publish(
        &mut self,
        publisher_id: usize,
        subject: &str,
        reply: Option<&str>,
        payload: &[u8],
        header_len: Option<usize>,
    ) -> io::Result<()> {
        let publisher_echo = self
            .clients
            .get(&publisher_id)
            .map(|client| client.echo)
            .unwrap_or(true);

        let mut direct = Vec::new();
        let mut queue_matches: HashMap<String, Vec<(usize, usize)>> = HashMap::new();

        for (client_id, client) in &self.clients {
            if client.closed || (!publisher_echo && *client_id == publisher_id) {
                continue;
            }

            for (sub_index, sub) in client.subscriptions.iter().enumerate() {
                if !subject_matches(&sub.subject, subject) {
                    continue;
                }

                if let Some(queue) = &sub.queue {
                    let key = format!("{}\0{}", sub.subject, queue);
                    queue_matches
                        .entry(key)
                        .or_default()
                        .push((*client_id, sub_index));
                } else {
                    direct.push((*client_id, sub_index));
                }
            }
        }

        for target in direct {
            self.deliver(target, subject, reply, payload, header_len)?;
        }

        for (queue_key, matches) in queue_matches {
            if matches.is_empty() {
                continue;
            }
            let cursor = self.queue_cursors.entry(queue_key).or_insert(0);
            let chosen = matches[*cursor % matches.len()];
            *cursor += 1;
            self.deliver(chosen, subject, reply, payload, header_len)?;
        }

        Ok(())
    }

    fn deliver(
        &mut self,
        target: (usize, usize),
        subject: &str,
        reply: Option<&str>,
        payload: &[u8],
        header_len: Option<usize>,
    ) -> io::Result<()> {
        let (client_id, sub_index) = target;
        let Some(client) = self.clients.get_mut(&client_id) else {
            return Ok(());
        };
        if sub_index >= client.subscriptions.len() {
            return Ok(());
        }

        let sid = client.subscriptions[sub_index].sid.clone();
        let headers = client.headers;
        let writer = Arc::clone(&client.writer);

        {
            let mut stream = writer.lock().expect("client writer lock poisoned");
            match (header_len, headers) {
                (Some(hlen), true) => {
                    if let Some(reply_to) = reply {
                        write!(
                            stream,
                            "HMSG {subject} {sid} {reply_to} {hlen} {}\r\n",
                            payload.len()
                        )?;
                    } else {
                        write!(stream, "HMSG {subject} {sid} {hlen} {}\r\n", payload.len())?;
                    }
                    stream.write_all(payload)?;
                }
                (Some(hlen), false) => {
                    let body = &payload[hlen..];
                    if let Some(reply_to) = reply {
                        write!(stream, "MSG {subject} {sid} {reply_to} {}\r\n", body.len())?;
                    } else {
                        write!(stream, "MSG {subject} {sid} {}\r\n", body.len())?;
                    }
                    stream.write_all(body)?;
                }
                (None, _) => {
                    if let Some(reply_to) = reply {
                        write!(
                            stream,
                            "MSG {subject} {sid} {reply_to} {}\r\n",
                            payload.len()
                        )?;
                    } else {
                        write!(stream, "MSG {subject} {sid} {}\r\n", payload.len())?;
                    }
                    stream.write_all(payload)?;
                }
            }
            stream.write_all(b"\r\n")?;
            stream.flush()?;
        }

        if let Some(sub) = client.subscriptions.get_mut(sub_index) {
            sub.delivered += 1;
            if sub.max_msgs.is_some_and(|max| sub.delivered >= max) {
                sub.max_msgs = Some(0);
            }
        }
        client.subscriptions.retain(|sub| sub.max_msgs != Some(0));
        Ok(())
    }

    fn is_verbose(&self, client_id: usize) -> bool {
        self.clients
            .get(&client_id)
            .map(|client| client.verbose)
            .unwrap_or(false)
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() -> io::Result<()> {
    let port = std::env::args()
        .nth(1)
        .map(|raw| raw.parse::<u16>())
        .transpose()
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err))?
        .unwrap_or(DEFAULT_PORT);

    let broker = Arc::new(Mutex::new(Broker::new()));
    let listener = TcpListener::bind(("0.0.0.0", port))?;
    eprintln!("universal-queues Rust NATS core server listening on 0.0.0.0:{port}");

    for stream in listener.incoming() {
        let stream = stream?;
        let writer = Arc::new(Mutex::new(stream.try_clone()?));
        let client_id = broker
            .lock()
            .expect("broker lock poisoned")
            .add_client(Arc::clone(&writer));
        let broker = Arc::clone(&broker);
        thread::spawn(move || {
            if let Err(err) = handle_client(stream, writer, Arc::clone(&broker), client_id, port) {
                let _ = write_error(&broker, client_id, &format!("'{}'", err));
            }
            broker
                .lock()
                .expect("broker lock poisoned")
                .remove_client(client_id);
        });
    }

    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn main() {
    println!("{}", wasm_smoke_test());
}

#[cfg(not(target_arch = "wasm32"))]
fn handle_client(
    stream: TcpStream,
    writer: Arc<Mutex<TcpStream>>,
    broker: Arc<Mutex<Broker>>,
    client_id: usize,
    port: u16,
) -> io::Result<()> {
    {
        let mut writer = writer.lock().expect("client writer lock poisoned");
        writeln!(
            writer,
            "INFO {{\"server_id\":\"{SERVER_ID}\",\"server_name\":\"universal-queues-rust\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":{port},\"headers\":true,\"max_payload\":{MAX_PAYLOAD}}}\r"
        )?;
        writer.flush()?;
    }

    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            continue;
        }
        process_line(&broker, client_id, &mut reader, line)?;
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn process_line(
    broker: &Arc<Mutex<Broker>>,
    client_id: usize,
    reader: &mut BufReader<TcpStream>,
    line: &str,
) -> io::Result<()> {
    let mut parts = line.split_whitespace();
    let op = parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid Protocol"))?
        .to_ascii_uppercase();

    match op.as_str() {
        "PING" => write_raw(broker, client_id, b"PONG\r\n"),
        "PONG" => write_ok(broker, client_id),
        "CONNECT" => {
            let json = line[op.len()..].trim();
            let verbose = json.contains("\"verbose\":true");
            let echo = !json.contains("\"echo\":false");
            let headers = json.contains("\"headers\":true");
            broker
                .lock()
                .expect("broker lock poisoned")
                .configure_client(client_id, verbose, echo, headers);
            write_ok(broker, client_id)
        }
        "SUB" => {
            let subject = parts.next().ok_or_else(invalid_protocol)?;
            let second = parts.next().ok_or_else(invalid_protocol)?;
            let third = parts.next();
            let (queue, sid) = match third {
                Some(sid) => (Some(second), sid),
                None => (None, second),
            };
            broker
                .lock()
                .expect("broker lock poisoned")
                .add_subscription(client_id, subject, queue, sid);
            write_ok(broker, client_id)
        }
        "UNSUB" => {
            let sid = parts.next().ok_or_else(invalid_protocol)?;
            let max_msgs = parts
                .next()
                .map(|raw| raw.parse::<usize>())
                .transpose()
                .map_err(|_| invalid_protocol())?;
            broker
                .lock()
                .expect("broker lock poisoned")
                .unsubscribe(client_id, sid, max_msgs);
            write_ok(broker, client_id)
        }
        "PUB" => {
            let subject = parts.next().ok_or_else(invalid_protocol)?;
            let second = parts.next().ok_or_else(invalid_protocol)?;
            let third = parts.next();
            let (reply, size_text) = match third {
                Some(size) => (Some(second), size),
                None => (None, second),
            };
            let size = size_text.parse::<usize>().map_err(|_| invalid_protocol())?;
            let payload = read_payload(reader, size)?;
            broker
                .lock()
                .expect("broker lock poisoned")
                .publish(client_id, subject, reply, &payload, None)?;
            write_ok(broker, client_id)
        }
        "HPUB" => {
            let subject = parts.next().ok_or_else(invalid_protocol)?;
            let first = parts.next().ok_or_else(invalid_protocol)?;
            let second = parts.next().ok_or_else(invalid_protocol)?;
            let third = parts.next();
            let (reply, header_size_text, total_size_text) = match third {
                Some(total) => (Some(first), second, total),
                None => (None, first, second),
            };
            let header_size = header_size_text
                .parse::<usize>()
                .map_err(|_| invalid_protocol())?;
            let total_size = total_size_text
                .parse::<usize>()
                .map_err(|_| invalid_protocol())?;
            if header_size > total_size {
                return Err(invalid_protocol());
            }
            let payload = read_payload(reader, total_size)?;
            broker.lock().expect("broker lock poisoned").publish(
                client_id,
                subject,
                reply,
                &payload,
                Some(header_size),
            )?;
            write_ok(broker, client_id)
        }
        _ => Err(invalid_protocol()),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn read_payload(reader: &mut BufReader<TcpStream>, size: usize) -> io::Result<Vec<u8>> {
    if size > MAX_PAYLOAD {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Maximum Payload Violation",
        ));
    }

    let mut payload = vec![0; size];
    reader.read_exact(&mut payload)?;
    let mut crlf = [0; 2];
    reader.read_exact(&mut crlf)?;
    if crlf != *b"\r\n" {
        return Err(invalid_protocol());
    }
    Ok(payload)
}

#[cfg(not(target_arch = "wasm32"))]
fn write_ok(broker: &Arc<Mutex<Broker>>, client_id: usize) -> io::Result<()> {
    if broker
        .lock()
        .expect("broker lock poisoned")
        .is_verbose(client_id)
    {
        write_raw(broker, client_id, b"+OK\r\n")
    } else {
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn write_error(broker: &Arc<Mutex<Broker>>, client_id: usize, message: &str) -> io::Result<()> {
    write_raw(broker, client_id, format!("-ERR {message}\r\n").as_bytes())
}

#[cfg(not(target_arch = "wasm32"))]
fn write_raw(broker: &Arc<Mutex<Broker>>, client_id: usize, bytes: &[u8]) -> io::Result<()> {
    let writer = {
        let broker = broker.lock().expect("broker lock poisoned");
        broker
            .clients
            .get(&client_id)
            .map(|client| Arc::clone(&client.writer))
    };

    if let Some(writer) = writer {
        let mut writer = writer.lock().expect("client writer lock poisoned");
        writer.write_all(bytes)?;
        writer.flush()?;
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn invalid_protocol() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid Protocol")
}

fn subject_matches(pattern: &str, subject: &str) -> bool {
    let mut pattern_tokens = pattern.split('.');
    let mut subject_tokens = subject.split('.');
    let mut matched_tokens = 0usize;

    loop {
        let Some(pattern_token) = pattern_tokens.next() else {
            return subject_tokens.next().is_none();
        };
        if pattern_token == ">" {
            return matched_tokens == 0 || subject_tokens.next().is_some();
        }
        let Some(subject_token) = subject_tokens.next() else {
            return false;
        };
        if pattern_token != "*" && pattern_token != subject_token {
            return false;
        }
        matched_tokens += 1;
    }
}

#[cfg(target_arch = "wasm32")]
fn wasm_smoke_test() -> String {
    let exact = subject_matches("demo", "demo");
    let star = subject_matches("demo.*", "demo.created");
    let greater = subject_matches("demo.>", "demo.created.us");
    format!(
        "NATS Rust WASM smoke OK: exact={exact}, star={star}, greater={greater}, max_payload={MAX_PAYLOAD}"
    )
}

#[cfg(test)]
mod tests {
    use super::subject_matches;

    #[test]
    fn matches_exact_subjects() {
        assert!(subject_matches("orders.created", "orders.created"));
        assert!(!subject_matches("orders.created", "orders.cancelled"));
    }

    #[test]
    fn matches_single_token_wildcards() {
        assert!(subject_matches("orders.*", "orders.created"));
        assert!(!subject_matches("orders.*", "orders.created.eu"));
    }

    #[test]
    fn matches_full_wildcards() {
        assert!(subject_matches(">", "orders"));
        assert!(subject_matches("orders.>", "orders.created.eu"));
        assert!(!subject_matches("orders.>", "orders"));
    }
}
