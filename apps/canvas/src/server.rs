//! The app's side of tapestry-server (`apps/server`).
//!
//! When a server is running, terminals live there instead of in the app:
//! the app's terminal cards, the server's page on a phone and any other
//! window all show the same terminals, and closing the app doesn't end
//! them. Every computer can run one. The first is found without setup,
//! here first (`127.0.0.1:7878`), then as `tapestry-server` on Tailscale;
//! the rest are the devices it says run one too. `TAPESTRY_SERVER=<host:port>`
//! names the first; `TAPESTRY_SERVER=off` keeps terminals in the app.

use std::io::ErrorKind;
use std::net::{IpAddr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use eframe::egui;
use serde_json::json;
use tungstenite::Message;

pub const PORT: u16 = 7878;

pub struct Server {
    /// `host:port`.
    addr: String,
    /// On this machine: its terminals' processes are ours to follow.
    pub local: bool,
    /// The computer it runs on.
    pub name: String,
}

/// A terminal the server keeps.
#[derive(Clone)]
pub struct Remote {
    pub id: u64,
    pub cwd: PathBuf,
    pub pid: Option<u32>,
    /// The other device it's logged in to, if it isn't this one.
    pub on: Option<String>,
}

/// One of your other computers, to open a terminal on.
#[derive(Clone, PartialEq)]
pub struct Device {
    pub name: String,
    pub host: String,
    pub online: bool,
    /// Who to log in as.
    pub user: String,
    pub ip: Option<IpAddr>,
    /// It runs a server of its own.
    pub server: bool,
}

impl Server {
    /// Look for a server. Blocks for up to a couple of seconds.
    pub fn find() -> Option<Self> {
        let named = std::env::var("TAPESTRY_SERVER").ok();
        let candidates: Vec<String> = match named.as_deref() {
            Some("off") => return None,
            Some(addr) => vec![addr.to_owned()],
            None => vec![format!("127.0.0.1:{PORT}"), format!("tapestry-server:{PORT}")],
        };
        candidates.into_iter().find_map(|addr| Self::at(addr, None))
    }

    /// The server at `addr`, if it answers. Its name is what it calls its
    /// machine, unless given.
    pub fn at(addr: String, name: Option<String>) -> Option<Self> {
        let local = addr.starts_with("127.0.0.1:") || addr.starts_with("localhost:");
        let mut s = Self { addr, local, name: name.unwrap_or_default() };
        s.list()?;
        if s.name.is_empty() {
            s.name = s.devices().map_or_else(|| s.addr.clone(), |(here, _)| here);
        }
        Some(s)
    }

    /// A device's server, at its Tailscale name. It's named by what it calls
    /// itself, which may not be its Tailscale name (grumbus is `tapestry-server`).
    pub fn of(d: &Device) -> Option<Self> {
        Self::at(format!("{}:{PORT}", d.host), None)
    }

    /// This computer's address as the server sees it: on another computer,
    /// its Tailscale address. (Nothing is sent; this only asks which of our
    /// addresses a packet to the server would leave from.)
    pub fn my_ip(&self) -> Option<IpAddr> {
        let to = self.addr.to_socket_addrs().ok()?.next()?;
        let any: SocketAddr = if to.is_ipv4() { ([0, 0, 0, 0], 0).into() } else { (Ipv6Addr::UNSPECIFIED, 0).into() };
        let sock = UdpSocket::bind(any).ok()?;
        sock.connect(to).ok()?;
        Some(sock.local_addr().ok()?.ip())
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    /// The server only takes changes that come from its own page.
    fn origin(&self) -> String {
        format!("http://{}", self.addr)
    }

    fn agent(&self) -> ureq::Agent {
        ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(if self.local { 1 } else { 3 })))
            .build()
            .into()
    }

    /// Every terminal it keeps, or `None` if it can't be reached.
    pub fn list(&self) -> Option<Vec<Remote>> {
        let mut r = self.agent().get(&self.url("/api/sessions")).call().ok()?;
        if r.status() != 200 {
            return None;
        }
        let v: serde_json::Value = r.body_mut().read_json().ok()?;
        Some(
            v.get("sessions")?
                .as_array()?
                .iter()
                .filter_map(|s| {
                    Some(Remote {
                        id: s.get("id")?.as_u64()?,
                        cwd: PathBuf::from(s.get("cwd")?.as_str()?),
                        pid: s.get("pid").and_then(|p| p.as_u64()).map(|p| p as u32),
                        on: s.get("device").and_then(|d| d.as_str()).map(str::to_owned),
                    })
                })
                .collect(),
        )
    }

    /// The server's own machine, and your other computers.
    pub fn devices(&self) -> Option<(String, Vec<Device>)> {
        let mut r = self.agent().get(&self.url("/api/devices")).call().ok()?;
        let v: serde_json::Value = r.body_mut().read_json().ok()?;
        let here = v.get("here").and_then(|h| h.as_str()).unwrap_or("this machine").to_owned();
        let list = v
            .get("devices")?
            .as_array()?
            .iter()
            .filter_map(|d| {
                let s = |k: &str| Some(d.get(k)?.as_str()?.to_owned());
                Some(Device {
                    name: s("name")?,
                    host: s("host")?,
                    user: s("user")?,
                    online: d.get("online")?.as_bool()?,
                    ip: d.get("ip").and_then(|i| i.as_str()).and_then(|i| i.parse().ok()),
                    server: d.get("server").and_then(|s| s.as_bool()).unwrap_or(false),
                })
            })
            .collect();
        Some((here, list))
    }

    /// Open a shell in `cwd`, or, given a device, one logged in to it.
    pub fn create(&self, cwd: &Path, on: Option<&Device>) -> Result<Remote, String> {
        let body = match on {
            Some(d) => json!({ "device": d.host, "user": d.user }),
            None => json!({ "cwd": cwd }),
        };
        let mut r = self
            .agent()
            .post(&self.url("/api/sessions"))
            .header("Origin", &self.origin())
            .send_json(body)
            .map_err(|e| e.to_string())?;
        if r.status() != 200 {
            return Err(r.body_mut().read_to_string().unwrap_or_default());
        }
        let v: serde_json::Value = r.body_mut().read_json().map_err(|e| e.to_string())?;
        let id = v.get("id").and_then(|i| i.as_u64()).ok_or("no id")?;
        // Its process, to follow (the list has it).
        let pid = self.list().and_then(|l| l.into_iter().find(|r| r.id == id)).and_then(|r| r.pid);
        Ok(Remote {
            id,
            cwd: cwd.to_path_buf(),
            pid,
            on: on.map(|d| d.name.clone()),
        })
    }

    /// End a terminal, for everyone.
    pub fn close(&self, id: u64) {
        let _ = self
            .agent()
            .delete(&self.url(&format!("/api/sessions/{id}")))
            .header("Origin", &self.origin())
            .call();
    }

    /// Tell the server which world's notes to serve.
    pub fn set_world(&self, world: &Path) {
        let _ = self
            .agent()
            .put(&self.url("/api/world"))
            .header("Origin", &self.origin())
            .send_json(json!({ "path": world }));
    }

    /// Show terminal `id`: its screen goes into `parser` as the server sends
    /// it, until it ends (`exited`) or the link is dropped. A dropped
    /// connection is made again.
    pub fn connect(
        &self,
        id: u64,
        parser: Arc<Mutex<vt100::Parser>>,
        exited: Arc<AtomicBool>,
        ctx: egui::Context,
    ) -> Link {
        let (tx, rx) = mpsc::channel();
        let closed = Arc::new(AtomicBool::new(false));
        let link = Link {
            tx,
            closed: closed.clone(),
        };
        let addr = self.addr.clone();
        let origin = self.origin();
        std::thread::spawn(move || {
            let mut size: Option<(u16, u16)> = None;
            while !closed.load(Ordering::Relaxed) {
                match pipe(&addr, &origin, id, &parser, &rx, &mut size, &closed, &ctx) {
                    End::Over => {
                        exited.store(true, Ordering::Relaxed);
                        ctx.request_repaint();
                        return;
                    }
                    End::Dropped => std::thread::sleep(Duration::from_secs(2)),
                    End::Closed => return,
                }
            }
        });
        link
    }
}

enum Out {
    Input(Vec<u8>),
    Size(u16, u16),
}

/// The app's end of a terminal on the server. Dropping it lets go of the
/// terminal; it keeps running there.
pub struct Link {
    tx: mpsc::Sender<Out>,
    closed: Arc<AtomicBool>,
}

impl Link {
    pub fn send(&self, bytes: &[u8]) {
        let _ = self.tx.send(Out::Input(bytes.to_vec()));
    }

    pub fn resize(&self, rows: u16, cols: u16) {
        let _ = self.tx.send(Out::Size(rows, cols));
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Relaxed);
    }
}

enum End {
    /// The terminal is over (or gone from the server).
    Over,
    /// The connection was lost; try again.
    Dropped,
    /// The app let go.
    Closed,
}

#[allow(clippy::too_many_arguments)]
fn pipe(
    addr: &str,
    origin: &str,
    id: u64,
    parser: &Mutex<vt100::Parser>,
    rx: &mpsc::Receiver<Out>,
    size: &mut Option<(u16, u16)>,
    closed: &AtomicBool,
    ctx: &egui::Context,
) -> End {
    let Some(sock) = addr.to_socket_addrs().ok().and_then(|mut a| a.next()) else {
        return End::Dropped;
    };
    let Ok(stream) = TcpStream::connect_timeout(&sock, Duration::from_secs(3)) else {
        return End::Dropped;
    };
    let _ = stream.set_nodelay(true);
    let req = tungstenite::http::Request::builder()
        .uri(format!("ws://{addr}/ws/{id}"))
        .header("Host", addr)
        .header("Origin", origin)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", tungstenite::handshake::client::generate_key())
        .body(())
        .unwrap();
    let mut ws = match tungstenite::client(req, stream) {
        Ok((ws, _)) => ws,
        Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(r))) if r.status() == 404 => {
            return End::Over;
        }
        Err(_) => return End::Dropped,
    };
    let _ = ws.get_ref().set_read_timeout(Some(Duration::from_millis(15)));
    if let Some((r, c)) = *size {
        let _ = ws.send(size_msg(r, c));
    }
    loop {
        if closed.load(Ordering::Relaxed) {
            let _ = ws.close(None);
            return End::Closed;
        }
        while let Ok(out) = rx.try_recv() {
            let msg = match out {
                Out::Input(b) => Message::Binary(b.into()),
                Out::Size(r, c) => {
                    *size = Some((r, c));
                    size_msg(r, c)
                }
            };
            if ws.send(msg).is_err() {
                return End::Dropped;
            }
        }
        match ws.read() {
            Ok(Message::Binary(b)) => {
                parser.lock().unwrap().process(&b);
                ctx.request_repaint();
            }
            Ok(Message::Text(t)) => {
                if t.as_str().contains("\"ended\"") {
                    return End::Over;
                }
            }
            Ok(Message::Close(_)) => return End::Dropped,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return End::Dropped,
        }
    }
}

fn size_msg(rows: u16, cols: u16) -> Message {
    Message::Text(json!({ "t": "size", "r": rows, "c": cols }).to_string().into())
}
