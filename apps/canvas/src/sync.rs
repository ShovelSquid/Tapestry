//! What stays the same on every computer: the panes, each folder's camera,
//! where cards sit, the pins. Kept in `synced.json` in the state folder, and
//! synced with every tapestry-server the app knows (`/api/shared`), off the
//! UI thread. For each key, the latest change wins.
//!
//! Paths are kept so they mean the same place on another computer: inside
//! this repository as `@tapestry/…`, inside home as `~/…`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use eframe::egui;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::server::Server;

#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    /// When it was changed, in milliseconds since 1970.
    pub at: u64,
    pub value: Value,
}

pub type Map = BTreeMap<String, Entry>;

/// How often each server is asked what changed.
const EVERY: Duration = Duration::from_secs(3);

pub struct Synced {
    map: Arc<Mutex<Map>>,
    /// Keys a server changed, for the app to take up.
    arrived: Arc<Mutex<Vec<String>>>,
    /// Counts every change, to write the file only after one.
    revision: Arc<AtomicU64>,
    written: u64,
    started: bool,
}

impl Synced {
    pub fn load() -> Self {
        let map = crate::ide::state_dir()
            .and_then(|d| std::fs::read_to_string(d.join("synced.json")).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Self {
            map: Arc::new(Mutex::new(map)),
            arrived: Arc::default(),
            revision: Arc::default(),
            written: 0,
            started: false,
        }
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.map.lock().unwrap().get(key).map(|e| e.value.clone())
    }

    /// Every key starting with `prefix`, without it.
    pub fn with_prefix(&self, prefix: &str) -> Vec<(String, Value)> {
        self.map
            .lock()
            .unwrap()
            .range(prefix.to_owned()..)
            .take_while(|(k, _)| k.starts_with(prefix))
            .map(|(k, e)| (k[prefix.len()..].to_owned(), e.value.clone()))
            .collect()
    }

    /// Change a value, if it's different.
    pub fn set(&self, key: &str, value: Value) {
        let mut map = self.map.lock().unwrap();
        if map.get(key).is_some_and(|e| e.value == value) {
            return;
        }
        map.insert(key.to_owned(), Entry { at: now_ms(), value });
        self.revision.fetch_add(1, Ordering::Relaxed);
    }

    /// Keep a value from before syncing, unless there's one already. It
    /// counts as older than anything a server has.
    pub fn seed(&self, key: &str, value: Value) {
        let mut map = self.map.lock().unwrap();
        if !map.contains_key(key) {
            map.insert(key.to_owned(), Entry { at: 0, value });
            self.revision.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// The keys servers changed since last asked.
    pub fn take_arrived(&self) -> Vec<String> {
        std::mem::take(&mut *self.arrived.lock().unwrap())
    }

    /// Write `synced.json` if anything changed.
    pub fn write(&mut self) {
        let revision = self.revision.load(Ordering::Relaxed);
        if revision == self.written {
            return;
        }
        let Ok(text) = serde_json::to_string(&*self.map.lock().unwrap()) else { return };
        crate::ide::save_state("synced.json", &text);
        self.written = revision;
    }

    /// Keep in step with each server in `servers`, as they're found.
    pub fn start(&mut self, servers: Arc<Mutex<Vec<Arc<Server>>>>, ctx: &egui::Context) {
        if std::mem::replace(&mut self.started, true) {
            return;
        }
        let (map, arrived, revision, ctx) =
            (self.map.clone(), self.arrived.clone(), self.revision.clone(), ctx.clone());
        std::thread::spawn(move || loop {
            let known: Vec<Arc<Server>> = servers.lock().unwrap().clone();
            for s in known {
                // A server from before syncing doesn't answer; skip it.
                let Some(theirs) = s.shared() else { continue };
                let (came, send) = exchange(&mut map.lock().unwrap(), &theirs);
                if !came.is_empty() {
                    revision.fetch_add(1, Ordering::Relaxed);
                    arrived.lock().unwrap().extend(came);
                    ctx.request_repaint();
                }
                if !send.is_empty() {
                    s.send_shared(&send);
                }
            }
            std::thread::sleep(EVERY);
        });
    }
}

/// Take what's newer in `theirs` into `ours`. The keys taken, and what
/// `theirs` should take from us.
fn exchange(ours: &mut Map, theirs: &Map) -> (Vec<String>, Map) {
    let mut came = Vec::new();
    for (k, e) in theirs {
        if ours.get(k).is_none_or(|have| e.at > have.at) {
            ours.insert(k.clone(), e.clone());
            came.push(k.clone());
        }
    }
    let send = ours
        .iter()
        .filter(|(k, e)| theirs.get(*k).is_none_or(|t| e.at > t.at))
        .map(|(k, e)| (k.clone(), e.clone()))
        .collect();
    (came, send)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// This repository, on whatever computer the app runs.
fn repo() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    dir.canonicalize().unwrap_or(dir)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// A path as another computer would find it.
pub fn key_of(path: &Path) -> String {
    shared_name(path, &repo(), home().as_deref())
}

/// The path a key names on this computer.
pub fn path_of(key: &str) -> PathBuf {
    local_path(key, &repo(), home().as_deref())
}

fn shared_name(path: &Path, repo: &Path, home: Option<&Path>) -> String {
    let join = |base: &str, rest: &Path| {
        if rest.as_os_str().is_empty() {
            base.to_owned()
        } else {
            format!("{base}/{}", rest.display())
        }
    };
    if let Ok(rest) = path.strip_prefix(repo) {
        return join("@tapestry", rest);
    }
    if let Some(home) = home
        && let Ok(rest) = path.strip_prefix(home)
    {
        return join("~", rest);
    }
    path.display().to_string()
}

fn local_path(key: &str, repo: &Path, home: Option<&Path>) -> PathBuf {
    let under = |base: &Path, rest: &str| {
        let rest = rest.trim_start_matches('/');
        if rest.is_empty() { base.to_path_buf() } else { base.join(rest) }
    };
    if let Some(rest) = key.strip_prefix("@tapestry") {
        return under(repo, rest);
    }
    if let Some(home) = home
        && let Some(rest) = key.strip_prefix('~')
    {
        return under(home, rest);
    }
    PathBuf::from(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_travel_between_computers() {
        let mac = (Path::new("/Users/k/Tapestry"), Some(Path::new("/Users/k")));
        let linux = (Path::new("/home/k/src/tapestry"), Some(Path::new("/home/k")));
        for (from, to) in [
            ("/Users/k/Tapestry/apps/canvas", "/home/k/src/tapestry/apps/canvas"),
            ("/Users/k/Tapestry", "/home/k/src/tapestry"),
            ("/Users/k/Tree/Home.md", "/home/k/Tree/Home.md"),
            ("/Users/k", "/home/k"),
            ("/etc/hosts", "/etc/hosts"),
        ] {
            let key = shared_name(Path::new(from), mac.0, mac.1);
            assert_eq!(local_path(&key, linux.0, linux.1), Path::new(to), "{key}");
        }
    }

    #[test]
    fn exchange_goes_both_ways() {
        let e = |at: u64, v: i64| Entry { at, value: v.into() };
        let mut ours: Map = [("a".into(), e(5, 1)), ("b".into(), e(9, 1))].into();
        let theirs: Map = [("a".into(), e(7, 2)), ("b".into(), e(3, 2)), ("c".into(), e(1, 2))].into();
        let (came, send) = exchange(&mut ours, &theirs);
        assert_eq!(came, ["a", "c"]);
        assert_eq!(send.keys().collect::<Vec<_>>(), ["b"]);
        assert_eq!(ours["a"].value, 2);
    }
}
