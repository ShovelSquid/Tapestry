//! Your other computers, as Tailscale knows them, to open terminals on.
//!
//! A terminal "on" another device is a terminal here running `ssh` to it,
//! so it outlives every window like any other. Phones and the browser SSH
//! console are left out: there's nothing to log in to.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Ssh {
    /// Its name, as shown.
    pub name: String,
    /// What `ssh` connects to: its Tailscale name.
    pub host: String,
    pub user: String,
}

#[derive(Serialize)]
pub struct Device {
    pub name: String,
    pub host: String,
    pub os: String,
    pub online: bool,
    /// Its Tailscale address, so an app can tell it's running on it.
    pub ip: Option<String>,
    /// It runs tapestry-server too: its terminals can be shown directly,
    /// no ssh needed.
    pub server: bool,
    /// Who to log in as: whoever you logged in as last time, else your name here.
    pub user: String,
}

/// Letters, digits, `.`, `-`, `_`: a host or user name, and nothing a shell
/// or `ssh` would read as an option.
pub fn valid_word(w: &str) -> bool {
    !w.is_empty()
        && w.len() <= 253
        && !w.starts_with('-')
        && w.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

fn users_file() -> PathBuf {
    crate::state_dir().join("devices.json")
}

fn users() -> BTreeMap<String, String> {
    std::fs::read_to_string(users_file())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Remember who you log in to `host` as.
pub fn remember(host: &str, user: &str) {
    let mut all = users();
    if all.get(host).map(String::as_str) != Some(user) {
        all.insert(host.to_owned(), user.to_owned());
        if let Ok(t) = serde_json::to_string_pretty(&all) {
            let _ = std::fs::write(users_file(), t);
        }
    }
}

/// Every other computer on your Tailscale network, online first.
pub fn list() -> Vec<Device> {
    let Some(out) = tailscale(&["status", "--json"]) else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else {
        return Vec::new();
    };
    let me = std::env::var("USER").unwrap_or_default();
    let users = users();
    let mut devices: Vec<Device> = v
        .get("Peer")
        .and_then(|p| p.as_object())
        .into_iter()
        .flat_map(|p| p.values())
        .filter_map(|p| {
            let os = p.get("OS")?.as_str()?.to_owned();
            if !["linux", "macOS", "windows", "freebsd"].contains(&os.as_str()) {
                return None;
            }
            let host = p.get("DNSName")?.as_str()?.trim_end_matches('.').to_owned();
            let name = p.get("HostName").and_then(|h| h.as_str()).unwrap_or(&host).to_owned();
            if !valid_word(&host) || name.starts_with("tailscale-ssh-console") {
                return None;
            }
            Some(Device {
                user: users.get(&host).cloned().unwrap_or_else(|| me.clone()),
                online: p.get("Online").and_then(|o| o.as_bool()).unwrap_or(false),
                ip: p.pointer("/TailscaleIPs/0").and_then(|i| i.as_str()).map(str::to_owned),
                server: false,
                name,
                host,
                os,
            })
        })
        .collect();
    // Which run a server: asked all at once, briefly.
    let asks: Vec<_> = devices
        .iter()
        .map(|d| {
            let (host, online) = (d.host.clone(), d.online);
            std::thread::spawn(move || online && runs_server(&host))
        })
        .collect();
    for (d, ask) in devices.iter_mut().zip(asks) {
        d.server = ask.join().unwrap_or(false);
    }
    devices.sort_by(|a, b| b.online.cmp(&a.online).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    devices
}

/// Run the `tailscale` command: on the PATH, or inside the Mac app.
fn tailscale(args: &[&str]) -> Option<std::process::Output> {
    ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
        .iter()
        .find_map(|cmd| std::process::Command::new(cmd).args(args).output().ok())
        .filter(|o| o.status.success())
}

/// Whether `host` answers on tapestry-server's port.
fn runs_server(host: &str) -> bool {
    use std::net::ToSocketAddrs;
    let Some(addr) = (host, crate::DEFAULT_PORT).to_socket_addrs().ok().and_then(|mut a| a.next()) else {
        return false;
    };
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(800)).is_ok()
}
