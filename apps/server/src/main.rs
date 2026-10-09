//! tapestry-server: terminals and Claude Code sessions that outlive the app.
//!
//! It keeps every terminal it opens running, whatever is or isn't looking at
//! it, and reopens them after a restart (Claude ones with `--resume`). Any
//! device can attach through the page it serves.
//!
//! It only listens on this machine and on its Tailscale address, so only your
//! own devices reach it. Requests must name a host it answers to and come
//! from its own page, so a website in your browser can't drive it.

mod claude;
mod devices;
mod notes;
mod procs;
mod session;

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{delete, get};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use session::{Saved, Session};

const PAGE: &str = include_str!("page.html");
pub const DEFAULT_PORT: u16 = 7878;

struct App {
    sessions: Mutex<BTreeMap<u64, Arc<Session>>>,
    next_id: AtomicU64,
    state_file: PathBuf,
    /// Set on SIGTERM: terminals ending now are going down with the server,
    /// not being closed, so they stay in the saved list.
    stopping: AtomicBool,
    /// Hosts the server answers to (without port).
    hosts: Mutex<Vec<String>>,
    /// The world folder whose notes it serves: the app on this machine says
    /// which (or `TAPESTRY_WORLD`).
    world: Mutex<Option<PathBuf>>,
}

type Shared = Arc<App>;

impl App {
    fn save(&self) {
        if self.stopping.load(Ordering::Relaxed) {
            return;
        }
        let list: Vec<Saved> = self
            .sessions
            .lock()
            .unwrap()
            .values()
            .filter(|s| !s.ended.load(Ordering::Relaxed))
            .map(|s| s.saved.lock().unwrap().clone())
            .collect();
        let tmp = self.state_file.with_extension("json.tmp");
        if let Ok(text) = serde_json::to_string_pretty(&list)
            && std::fs::write(&tmp, text).is_ok()
        {
            let _ = std::fs::rename(&tmp, &self.state_file);
        }
    }

    fn open(self: &Arc<Self>, saved: Saved) -> Result<u64, String> {
        let id = saved.id;
        let app = Arc::downgrade(self);
        let s = Session::spawn(saved, move |id| {
            let Some(app) = app.upgrade() else { return };
            if app.stopping.load(Ordering::Relaxed) {
                return;
            }
            app.sessions.lock().unwrap().remove(&id);
            app.save();
        })?;
        self.sessions.lock().unwrap().insert(id, s);
        Ok(id)
    }

    fn notes_dir(&self) -> Option<PathBuf> {
        self.world.lock().unwrap().as_ref().map(|w| w.join("notes"))
    }

    fn new_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }
}

pub fn state_dir() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| session::home().join(".local/state"));
    base.join("tapestry/server")
}

/// This machine's Tailscale address: the address it would send from to
/// Tailscale's own resolver (nothing is sent), if that's a Tailscale one.
fn tailscale_ip() -> Option<Ipv4Addr> {
    let sock = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    sock.connect((Ipv4Addr::new(100, 100, 100, 100), 53)).ok()?;
    let IpAddr::V4(ip) = sock.local_addr().ok()?.ip() else { return None };
    let [a, b, ..] = ip.octets();
    (a == 100 && (64..128).contains(&b)).then_some(ip)
}

/// This machine's name, without a `.local`.
pub fn hostname() -> Option<String> {
    let mut buf = [0u8; 256];
    if unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } != 0 {
        return None;
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    let name = String::from_utf8_lossy(&buf[..end]).trim_end_matches(".local").to_owned();
    (!name.is_empty()).then_some(name)
}

#[tokio::main]
async fn main() {
    let mut port = DEFAULT_PORT;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--port" => port = args.next().and_then(|p| p.parse().ok()).expect("--port <number>"),
            "-h" | "--help" => {
                println!("tapestry-server [--port N]   (default {DEFAULT_PORT}; state in {})", state_dir().display());
                return;
            }
            other => panic!("unknown argument {other}"),
        }
    }

    let dir = state_dir();
    std::fs::create_dir_all(&dir).expect("state folder");
    let state_file = dir.join("sessions.json");
    let saved: Vec<Saved> = std::fs::read_to_string(&state_file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();

    let world_file = dir.join("world.txt");
    let world = std::env::var_os("TAPESTRY_WORLD")
        .map(PathBuf::from)
        .or_else(|| std::fs::read_to_string(&world_file).ok().map(|w| PathBuf::from(w.trim())))
        .filter(|w| w.is_dir());

    let mut hosts = vec!["localhost".to_owned(), "127.0.0.1".to_owned()];
    hosts.extend(hostname());
    let app: Shared = Arc::new(App {
        next_id: AtomicU64::new(saved.iter().map(|s| s.id + 1).max().unwrap_or(1)),
        sessions: Mutex::default(),
        state_file,
        stopping: AtomicBool::new(false),
        hosts: Mutex::new(hosts),
        world: Mutex::new(world),
    });
    for s in saved {
        let id = s.id;
        if let Err(e) = app.open(s) {
            eprintln!("couldn't reopen terminal {id}: {e}");
        }
    }
    app.save();

    // Follow each terminal's folder and Claude session, so a restart reopens
    // them where they were.
    {
        let app = app.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let app = app.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let list: Vec<_> = app.sessions.lock().unwrap().values().cloned().collect();
                    if list.iter().fold(false, |c, s| s.observe() | c) {
                        app.save();
                    }
                })
                .await;
            }
        });
    }

    let router = Router::new()
        .route("/", get(|| async { Html(PAGE) }))
        .route("/api/sessions", get(list).post(create))
        .route("/api/sessions/{id}", delete(close))
        .route("/api/claude", get(past))
        .route("/api/devices", get(list_devices))
        .route("/api/world", get(get_world).put(set_world))
        .route("/api/notes", get(list_notes).post(new_note))
        .route("/api/notes/{name}", axum::routing::put(put_note).delete(delete_note))
        .route("/ws/{id}", get(attach))
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app.clone());

    serve(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port), router.clone());
    eprintln!("tapestry-server on http://127.0.0.1:{port}");

    // Tailscale may come up after us (at boot); keep looking for its address.
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut bound: Option<Ipv4Addr> = None;
            loop {
                let ip = tokio::task::spawn_blocking(tailscale_ip).await.ok().flatten();
                if let Some(ip) = ip
                    && bound != Some(ip)
                {
                    let mut hosts = app.hosts.lock().unwrap();
                    hosts.push(ip.to_string());
                    drop(hosts);
                    serve(SocketAddr::new(IpAddr::V4(ip), port), router.clone());
                    eprintln!("tapestry-server on http://{ip}:{port} (Tailscale)");
                    bound = Some(ip);
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });
    }

    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
    tokio::select! {
        _ = term.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    app.save();
    app.stopping.store(true, Ordering::Relaxed);
}

fn serve(addr: SocketAddr, router: Router) {
    tokio::spawn(async move {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                let _ = axum::serve(l, router).await;
            }
            Err(e) => eprintln!("couldn't listen on {addr}: {e}"),
        }
    });
}

/// Only answer to our own names (a page elsewhere can't rebind a name of
/// its own to us), and only to our own page (it can't post or open a
/// terminal from another origin).
async fn guard(State(app): State<Shared>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    let Some(host) = headers.get(header::HOST).and_then(|h| h.to_str().ok()).map(str::to_owned) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let name = host.rsplit_once(':').map_or(host.as_str(), |(n, _)| n);
    let known = app.hosts.lock().unwrap().iter().any(|h| h == name) || name.ends_with(".ts.net");
    if !known {
        return (StatusCode::FORBIDDEN, "unknown host").into_response();
    }
    let origin = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok());
    let same = origin.is_some_and(|o| o.split_once("://").is_some_and(|(_, rest)| rest == host));
    let writes = req.method() != axum::http::Method::GET || req.uri().path().starts_with("/ws/");
    if (origin.is_some() && !same) || (writes && !same) {
        return (StatusCode::FORBIDDEN, "not from this page").into_response();
    }
    next.run(req).await
}

async fn list(State(app): State<Shared>) -> impl IntoResponse {
    let sessions = app.sessions.lock().unwrap();
    let list: Vec<_> = sessions
        .values()
        .filter(|s| !s.ended.load(Ordering::Relaxed))
        .map(|s| {
            let saved = s.saved.lock().unwrap();
            json!({
                "id": saved.id,
                "cwd": saved.cwd,
                "claude": saved.claude,
                "title": saved.title(),
                "pid": s.pid,
                "device": saved.ssh.as_ref().map(|d| &d.name),
                "started": s.started,
            })
        })
        .collect();
    axum::Json(json!({ "sessions": list, "home": session::home() }))
}

#[derive(Deserialize)]
struct Create {
    cwd: Option<PathBuf>,
    /// "new" for a new Claude Code session, or the id of one to reopen.
    claude: Option<String>,
    /// Open it on this other device instead (its host, from `/api/devices`),
    /// logged in as `user`.
    device: Option<String>,
    user: Option<String>,
}

async fn create(State(app): State<Shared>, axum::Json(req): axum::Json<Create>) -> Response {
    let claude = match req.claude.as_deref() {
        None => None,
        Some("new") => Some(uuid::Uuid::new_v4().to_string()),
        Some(id) if session::valid_claude_id(id) => {
            let open = app.sessions.lock().unwrap().values().find_map(|s| {
                let saved = s.saved.lock().unwrap();
                (saved.claude.as_deref() == Some(id)).then_some(saved.id)
            });
            if let Some(open) = open {
                return axum::Json(json!({ "id": open })).into_response();
            }
            Some(id.to_owned())
        }
        Some(_) => return (StatusCode::BAD_REQUEST, "not a session id").into_response(),
    };
    let ssh = match req.device {
        None => None,
        Some(host) => {
            let devices = tokio::task::spawn_blocking(devices::list).await.unwrap_or_default();
            let Some(d) = devices.into_iter().find(|d| d.host == host) else {
                return (StatusCode::BAD_REQUEST, "not one of your devices").into_response();
            };
            let user = req.user.filter(|u| !u.is_empty()).unwrap_or(d.user);
            if !devices::valid_word(&user) {
                return (StatusCode::BAD_REQUEST, "not a user name").into_response();
            }
            devices::remember(&d.host, &user);
            Some(devices::Ssh { name: d.name, host: d.host, user })
        }
    };
    let cwd = if ssh.is_some() { session::home() } else { req.cwd.unwrap_or_else(session::home) };
    let saved = Saved {
        id: app.new_id(),
        cwd,
        claude: if ssh.is_some() { None } else { claude },
        ssh,
    };
    let app2 = app.clone();
    match tokio::task::spawn_blocking(move || app2.open(saved)).await {
        Ok(Ok(id)) => {
            app.save();
            axum::Json(json!({ "id": id })).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn close(State(app): State<Shared>, Path(id): Path<u64>) -> StatusCode {
    let s = app.sessions.lock().unwrap().remove(&id);
    match s {
        Some(s) => {
            app.save();
            let _ = tokio::task::spawn_blocking(move || s.kill()).await;
            StatusCode::NO_CONTENT
        }
        None => StatusCode::NOT_FOUND,
    }
}

#[derive(Deserialize)]
struct Limit {
    limit: Option<usize>,
}

async fn past(Query(q): Query<Limit>) -> impl IntoResponse {
    let limit = q.limit.unwrap_or(40).min(500);
    let list = tokio::task::spawn_blocking(move || claude::recent(limit)).await.unwrap_or_default();
    axum::Json(list)
}

async fn attach(State(app): State<Shared>, Path(id): Path<u64>, ws: WebSocketUpgrade) -> Response {
    let Some(s) = app.sessions.lock().unwrap().get(&id).cloned() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    ws.on_upgrade(move |socket| pipe(socket, s))
}

#[derive(Deserialize)]
#[serde(tag = "t")]
enum FromPage {
    /// Typed or pasted.
    #[serde(rename = "in")]
    Input { d: String },
    #[serde(rename = "size")]
    Size { r: u16, c: u16 },
}

/// One window on a terminal: the screen now, then everything it writes;
/// what's typed goes in. The last window to change size sets the size.
async fn pipe(socket: WebSocket, s: Arc<Session>) {
    let (mut tx, mut rx) = socket.split();
    let (screen, mut out) = s.attach();
    if tx.send(Message::Binary(screen.into())).await.is_err() {
        return;
    }
    let s2 = s.clone();
    let mut send = tokio::spawn(async move {
        loop {
            match out.recv().await {
                Ok(bytes) if bytes.is_empty() => {
                    let _ = tx.send(Message::Text(r#"{"ended":true}"#.into())).await;
                    break;
                }
                Ok(bytes) => {
                    if tx.send(Message::Binary(bytes.to_vec().into())).await.is_err() {
                        break;
                    }
                }
                // Fell behind: redraw from the screen as it is now.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if tx.send(Message::Binary(s2.snapshot().into())).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let mut recv = tokio::spawn(async move {
        while let Some(Ok(msg)) = rx.next().await {
            let text = match msg {
                // Raw bytes, as typed: from the app.
                Message::Binary(b) => {
                    s.write(&b);
                    continue;
                }
                Message::Text(t) => t,
                _ => continue,
            };
            match serde_json::from_str::<FromPage>(&text) {
                Ok(FromPage::Input { d }) => s.write(d.as_bytes()),
                Ok(FromPage::Size { r, c }) => s.resize(r, c),
                Err(_) => {}
            }
        }
    });
    tokio::select! {
        _ = &mut send => recv.abort(),
        _ = &mut recv => send.abort(),
    }
}

async fn get_world(State(app): State<Shared>) -> impl IntoResponse {
    axum::Json(json!({ "world": *app.world.lock().unwrap() }))
}

#[derive(Deserialize)]
struct World {
    path: PathBuf,
}

/// The app on this machine names its world folder, so its notes are served.
async fn set_world(State(app): State<Shared>, axum::Json(w): axum::Json<World>) -> StatusCode {
    let Ok(path) = w.path.canonicalize() else { return StatusCode::BAD_REQUEST };
    if !path.is_dir() {
        return StatusCode::BAD_REQUEST;
    }
    let mut world = app.world.lock().unwrap();
    if world.as_ref() != Some(&path) {
        let _ = std::fs::write(state_dir().join("world.txt"), path.to_string_lossy().as_bytes());
        *world = Some(path);
    }
    StatusCode::NO_CONTENT
}

async fn list_notes(State(app): State<Shared>) -> Response {
    let Some(dir) = app.notes_dir() else {
        return axum::Json(json!({ "notes": null })).into_response();
    };
    let list = tokio::task::spawn_blocking(move || notes::list(&dir)).await.unwrap_or_default();
    axum::Json(json!({ "notes": list })).into_response()
}

/// A new note with the body as its text; answers with its name.
async fn new_note(State(app): State<Shared>, text: String) -> Response {
    let Some(dir) = app.notes_dir() else { return StatusCode::CONFLICT.into_response() };
    let name = notes::new_name(&dir);
    match notes::write(&dir, &name, &text) {
        Ok(()) => axum::Json(json!({ "name": name })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn put_note(State(app): State<Shared>, Path(name): Path<String>, text: String) -> Response {
    let Some(dir) = app.notes_dir() else { return StatusCode::CONFLICT.into_response() };
    if !notes::valid_name(&name) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match notes::write(&dir, &name, &text) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn delete_note(State(app): State<Shared>, Path(name): Path<String>) -> StatusCode {
    let Some(dir) = app.notes_dir() else { return StatusCode::CONFLICT };
    if !notes::valid_name(&name) {
        return StatusCode::BAD_REQUEST;
    }
    match notes::write(&dir, &name, "") {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// This machine, and the others you can open a terminal on.
async fn list_devices() -> impl IntoResponse {
    let devices = tokio::task::spawn_blocking(devices::list).await.unwrap_or_default();
    axum::Json(json!({ "here": hostname(), "devices": devices }))
}
