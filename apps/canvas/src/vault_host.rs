//! Serialized owner of the selected vault, its Store, watcher, and read model.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use eframe::egui;
use tapestry_vault::index::VaultIndex;
use tapestry_vault::scan;
use tapestry_vault::{Change, Store, Watch, WatchMsg};

const COMMAND_CAPACITY: usize = 8;
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultStatus {
    Loading,
    Ready,
    Error(String),
}

#[derive(Clone)]
pub struct VaultSnapshot {
    pub root: PathBuf,
    pub index: Arc<VaultIndex>,
}

#[derive(Clone)]
pub struct VaultView {
    pub status: VaultStatus,
    pub snapshot: Option<VaultSnapshot>,
}

enum Command {
    SelectRoot {
        path: PathBuf,
        create_if_missing: bool,
    },
    Rescan,
}

/// The UI only sends bounded commands and clones completed immutable snapshots.
/// All filesystem, Store, Watch, and index work belongs to the worker thread.
pub struct VaultHost {
    commands: SyncSender<Command>,
    published: Arc<Mutex<VaultView>>,
    #[cfg(test)]
    watch_messages: mpsc::Sender<WatchMsg>,
}

impl VaultHost {
    pub fn start(default_root: PathBuf, ctx: egui::Context) -> Self {
        let (selected_root, create_if_missing) = remembered_root()
            .map(|path| (path, false))
            .unwrap_or((default_root, true));
        Self::start_with(
            selected_root,
            create_if_missing,
            Duration::from_secs(60),
            ctx,
        )
    }

    fn start_with(
        root: PathBuf,
        create_if_missing: bool,
        fallback_interval: Duration,
        ctx: egui::Context,
    ) -> Self {
        let (command_tx, command_rx) = mpsc::sync_channel(COMMAND_CAPACITY);
        let (watch_tx, watch_rx) = mpsc::channel();
        #[cfg(test)]
        let watch_messages = watch_tx.clone();
        let published = Arc::new(Mutex::new(VaultView {
            status: VaultStatus::Loading,
            snapshot: None,
        }));
        let worker_published = Arc::clone(&published);
        thread::Builder::new()
            .name("tapestry-vault".into())
            .spawn(move || {
                run_worker(
                    root,
                    create_if_missing,
                    command_rx,
                    watch_tx,
                    watch_rx,
                    worker_published,
                    fallback_interval,
                    ctx,
                )
            })
            .expect("vault worker thread must start");
        Self {
            commands: command_tx,
            published,
            #[cfg(test)]
            watch_messages,
        }
    }

    pub fn view(&self) -> VaultView {
        self.published
            .lock()
            .map(|view| view.clone())
            .unwrap_or(VaultView {
                status: VaultStatus::Error("Vault worker state is unavailable.".into()),
                snapshot: None,
            })
    }

    /// A full command queue returns immediately so an egui frame never waits.
    pub fn select_root(&self, path: PathBuf) -> Result<(), PathBuf> {
        self.commands
            .try_send(Command::SelectRoot {
                path: path.clone(),
                create_if_missing: false,
            })
            .map_err(|_| path)
    }

    pub fn request_rescan(&self) -> bool {
        self.commands.try_send(Command::Rescan).is_ok()
    }

    #[cfg(test)]
    fn inject_watch_message(&self, message: WatchMsg) {
        self.watch_messages.send(message).unwrap();
    }
}

/// Load a local-only vault choice. The simulation's `--world` path is not read
/// here and cannot affect this default.
fn remembered_root() -> Option<PathBuf> {
    let path = crate::ide::state_dir()?.join("vault.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("root")?.as_str().map(PathBuf::from)
}

fn remember_root(root: &Path) {
    let text = serde_json::json!({ "root": root.to_string_lossy() }).to_string();
    crate::ide::save_state("vault.json", &text);
}

struct ActiveVault {
    root: PathBuf,
    store: Store,
    _watch: Watch,
}

fn change_requires_refresh(change: Change) -> bool {
    matches!(change, Change::External | Change::Removed)
}

fn classify_changed_paths(store: &mut Store, paths: &[String]) -> bool {
    let mut external = false;
    for path in paths {
        external |= change_requires_refresh(store.classify(path));
    }
    external
}

fn run_worker(
    initial_root: PathBuf,
    create_initial_if_missing: bool,
    commands: Receiver<Command>,
    watch_tx: mpsc::Sender<WatchMsg>,
    watch_rx: Receiver<WatchMsg>,
    published: Arc<Mutex<VaultView>>,
    fallback_interval: Duration,
    ctx: egui::Context,
) {
    let mut active = open_vault(&initial_root, create_initial_if_missing, &watch_tx)
        .map(|(active, snapshot)| {
            remember_root(&active.root);
            publish(&published, VaultStatus::Ready, Some(snapshot));
            ctx.request_repaint();
            active
        })
        .map_err(|error| {
            publish(&published, VaultStatus::Error(error), None);
            ctx.request_repaint();
        })
        .ok();
    let mut last_rescan = Instant::now();

    loop {
        match commands.recv_timeout(POLL_INTERVAL) {
            Ok(Command::SelectRoot {
                path,
                create_if_missing,
            }) => {
                // Open the replacement first and swap only when it opened:
                // a failed switch leaves the current vault, its Store, and
                // its watcher live, so the snapshot still on screen keeps
                // refreshing. Both watchers live on this thread, so the swap
                // is as serialized as dropping first.
                match open_vault(&path, create_if_missing, &watch_tx) {
                    Ok((replacement, snapshot)) => {
                        // Dropping the old ActiveVault drops its watcher.
                        active = Some(replacement);
                        // Paths the old watcher queued belong to the old root.
                        while watch_rx.try_recv().is_ok() {}
                        if let Some(active) = active.as_ref() {
                            remember_root(&active.root);
                        }
                        publish(&published, VaultStatus::Ready, Some(snapshot));
                        ctx.request_repaint();
                    }
                    Err(error) => {
                        publish_error_keep_snapshot(&published, error);
                        ctx.request_repaint();
                    }
                }
                last_rescan = Instant::now();
            }
            Ok(Command::Rescan) => {
                if let Some(active) = active.as_mut() {
                    let before = snapshot_generation(&published);
                    refresh_if_changed(active, &published);
                    if snapshot_generation(&published) != before {
                        ctx.request_repaint();
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        let mut rescan = false;
        let mut changed_paths = Vec::new();
        loop {
            match watch_rx.try_recv() {
                Ok(WatchMsg::Changed(paths)) => changed_paths.extend(paths),
                Ok(WatchMsg::Rescan | WatchMsg::Error(_)) => rescan = true,
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
            }
        }
        if let Some(active) = active.as_mut() {
            let external = classify_changed_paths(&mut active.store, &changed_paths);
            if external {
                // Classification already updated Store's known hash; rescan
                // now only advances its stat baseline, while this known
                // external change triggers the immutable snapshot rebuild.
                let _ = active.store.rescan();
                match build_snapshot(&active.root) {
                    Ok(snapshot) => publish(&published, VaultStatus::Ready, Some(snapshot)),
                    Err(error) => publish_error_keep_snapshot(&published, error),
                }
                ctx.request_repaint();
                last_rescan = Instant::now();
            } else if rescan || last_rescan.elapsed() >= fallback_interval {
                let before = snapshot_generation(&published);
                refresh_if_changed(active, &published);
                if snapshot_generation(&published) != before {
                    ctx.request_repaint();
                }
                last_rescan = Instant::now();
            }
        }
    }
}

fn open_vault(
    path: &Path,
    create_if_missing: bool,
    watch_tx: &mpsc::Sender<WatchMsg>,
) -> Result<(ActiveVault, VaultSnapshot), String> {
    if create_if_missing {
        std::fs::create_dir_all(path).map_err(|error| {
            format!("Could not create vault folder {}: {error}", path.display())
        })?;
    }
    let root = path
        .canonicalize()
        .map_err(|error| format!("Could not open vault folder {}: {error}", path.display()))?;
    let store = Store::open(&root)
        .map_err(|error| format!("Could not open vault folder {}: {error}", root.display()))?;
    let watch = Watch::start(&root, watch_tx.clone())
        .map_err(|error| format!("Could not watch vault folder {}: {error}", root.display()))?;
    let mut active = ActiveVault {
        root,
        store,
        _watch: watch,
    };
    let scan = scan::scan(&active.root).map_err(|error| {
        format!(
            "Could not read vault folder {}: {error}",
            active.root.display()
        )
    })?;
    active.store.seed_known(&scan);
    let snapshot = VaultSnapshot {
        root: scan.root.clone(),
        index: Arc::new(VaultIndex::build(&scan)),
    };
    Ok((active, snapshot))
}

fn build_snapshot(root: &Path) -> Result<VaultSnapshot, String> {
    let scan = scan::scan(root)
        .map_err(|error| format!("Could not read vault folder {}: {error}", root.display()))?;
    Ok(VaultSnapshot {
        root: scan.root.clone(),
        index: Arc::new(VaultIndex::build(&scan)),
    })
}

fn refresh_if_changed(active: &mut ActiveVault, published: &Arc<Mutex<VaultView>>) {
    let changed = match active.store.rescan() {
        Ok(changes) => changes
            .iter()
            .any(|(_, change)| matches!(change, Change::External | Change::Removed)),
        Err(error) => {
            publish_error_keep_snapshot(
                published,
                format!(
                    "Could not rescan vault folder {}: {error}",
                    active.root.display()
                ),
            );
            return;
        }
    };
    if changed {
        match build_snapshot(&active.root) {
            Ok(snapshot) => publish(published, VaultStatus::Ready, Some(snapshot)),
            Err(error) => publish_error_keep_snapshot(published, error),
        }
    }
}

fn publish(
    published: &Arc<Mutex<VaultView>>,
    status: VaultStatus,
    snapshot: Option<VaultSnapshot>,
) {
    if let Ok(mut current) = published.lock() {
        current.status = status;
        if snapshot.is_some() {
            current.snapshot = snapshot;
        }
    }
}

fn publish_error_keep_snapshot(published: &Arc<Mutex<VaultView>>, error: String) {
    if let Ok(mut current) = published.lock() {
        current.status = VaultStatus::Error(error);
    }
}

fn snapshot_generation(published: &Arc<Mutex<VaultView>>) -> Option<u64> {
    published
        .lock()
        .ok()?
        .snapshot
        .as_ref()
        .map(|snapshot| Arc::as_ptr(&snapshot.index) as usize as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tapestry-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn wait_for(host: &VaultHost, mut ready: impl FnMut(&VaultView) -> bool) -> VaultView {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let view = host.view();
            if ready(&view) {
                return view;
            }
            assert!(
                Instant::now() < deadline,
                "vault worker did not reach state: {:?}",
                view.status
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn shell_boot_to_snapshot() {
        let root = temp_root("shell-boot");
        let _ = std::fs::remove_dir_all(&root);
        let host = VaultHost::start_with(
            root.clone(),
            true,
            Duration::from_secs(60),
            egui::Context::default(),
        );
        let view = wait_for(&host, |view| matches!(view.status, VaultStatus::Ready));
        let snapshot = view.snapshot.expect("ready host publishes a snapshot");
        assert_eq!(snapshot.root, root.canonicalize().unwrap());
        assert!(snapshot.index.notes.is_empty());
        drop(host);
        thread::sleep(POLL_INTERVAL + Duration::from_millis(20));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn own_write_hash_classification_does_not_request_refresh() {
        let root = temp_root("own-echo");
        std::fs::create_dir_all(&root).unwrap();
        let mut store = Store::open(&root).unwrap();
        store
            .apply(tapestry_vault::VaultCmd::CreateNote {
                rel: "own.md".into(),
                body: "Written by this app.\n".into(),
            })
            .unwrap();

        assert_eq!(store.classify("own.md"), Change::OwnEcho);
        assert!(!classify_changed_paths(&mut store, &["own.md".into()]));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_change_and_removal_publish_fresh_snapshots() {
        let root = temp_root("external-refresh");
        std::fs::create_dir_all(&root).unwrap();
        let note = root.join("note.md");
        std::fs::write(&note, "before\n").unwrap();
        let host = VaultHost::start_with(
            root.clone(),
            false,
            Duration::from_secs(60),
            egui::Context::default(),
        );
        let initial = wait_for(&host, |view| matches!(view.status, VaultStatus::Ready));
        let first = initial.snapshot.unwrap();
        assert!(first.index.notes.contains_key("note.md"));

        std::fs::write(&note, "after\n").unwrap();
        assert!(host.request_rescan());
        let updated = wait_for(&host, |view| {
            view.snapshot
                .as_ref()
                .is_some_and(|snapshot| !Arc::ptr_eq(&snapshot.index, &first.index))
        });
        let second = updated.snapshot.unwrap();
        assert_ne!(
            second.index.notes["note.md"].hash,
            first.index.notes["note.md"].hash
        );

        std::fs::remove_file(&note).unwrap();
        assert!(host.request_rescan());
        let removed = wait_for(&host, |view| {
            view.snapshot
                .as_ref()
                .is_some_and(|snapshot| !snapshot.index.notes.contains_key("note.md"))
        });
        assert!(
            !removed
                .snapshot
                .unwrap()
                .index
                .notes
                .contains_key("note.md")
        );
        drop(host);
        thread::sleep(POLL_INTERVAL + Duration::from_millis(20));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_root_switch_keeps_last_snapshot_and_does_not_create_folder() {
        let root = temp_root("switch-source");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("keep.md"), "still here\n").unwrap();
        let host = VaultHost::start_with(
            root.clone(),
            false,
            Duration::from_secs(60),
            egui::Context::default(),
        );
        let ready = wait_for(&host, |view| matches!(view.status, VaultStatus::Ready));
        let original = ready.snapshot.unwrap();

        let invalid = temp_root("missing-vault");
        assert!(host.select_root(invalid.clone()).is_ok());
        let failed = wait_for(&host, |view| matches!(view.status, VaultStatus::Error(_)));
        let retained = failed.snapshot.unwrap();
        assert!(Arc::ptr_eq(&retained.index, &original.index));
        assert_eq!(retained.root, original.root);
        assert!(
            !invalid.exists(),
            "opening a selected folder must not create it"
        );

        drop(host);
        thread::sleep(POLL_INTERVAL + Duration::from_millis(20));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_root_switch_keeps_the_original_vault_refreshing() {
        let root = temp_root("switch-still-live");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("keep.md"), "still here\n").unwrap();
        let host = VaultHost::start_with(
            root.clone(),
            false,
            Duration::from_secs(60),
            egui::Context::default(),
        );
        wait_for(&host, |view| matches!(view.status, VaultStatus::Ready));

        assert!(host.select_root(temp_root("missing-vault-live")).is_ok());
        wait_for(&host, |view| matches!(view.status, VaultStatus::Error(_)));

        // The vault still on screen keeps its Store: an outside change to
        // it shows up in a later snapshot.
        std::fs::write(root.join("arrived.md"), "after the failed switch\n").unwrap();
        assert!(host.request_rescan());
        let refreshed = wait_for(&host, |view| {
            view.snapshot
                .as_ref()
                .is_some_and(|snapshot| snapshot.index.notes.contains_key("arrived.md"))
        });
        assert!(refreshed.snapshot.unwrap().index.notes.contains_key("keep.md"));

        drop(host);
        thread::sleep(POLL_INTERVAL + Duration::from_millis(20));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn periodic_fallback_rescan_publishes_external_changes() {
        let root = temp_root("fallback-refresh");
        std::fs::create_dir_all(&root).unwrap();
        let host = VaultHost::start_with(
            root.clone(),
            false,
            Duration::from_millis(30),
            egui::Context::default(),
        );
        wait_for(&host, |view| matches!(view.status, VaultStatus::Ready));
        let note = root.join("fallback.md");
        std::fs::write(&note, "arrived outside\n").unwrap();
        let refreshed = wait_for(&host, |view| {
            view.snapshot
                .as_ref()
                .is_some_and(|snapshot| snapshot.index.notes.contains_key("fallback.md"))
        });
        assert!(
            refreshed
                .snapshot
                .unwrap()
                .index
                .notes
                .contains_key("fallback.md")
        );
        drop(host);
        thread::sleep(POLL_INTERVAL + Duration::from_millis(20));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn watcher_message_refreshes_through_the_worker_store() {
        let root = temp_root("watch-message");
        std::fs::create_dir_all(&root).unwrap();
        let note = root.join("changed.md");
        std::fs::write(&note, "initial\n").unwrap();
        let host = VaultHost::start_with(
            root.clone(),
            false,
            Duration::from_secs(60),
            egui::Context::default(),
        );
        let initial = wait_for(&host, |view| matches!(view.status, VaultStatus::Ready));
        let original = initial.snapshot.unwrap();

        std::fs::write(&note, "changed externally\n").unwrap();
        host.inject_watch_message(WatchMsg::Changed(vec!["changed.md".into()]));
        let refreshed = wait_for(&host, |view| {
            view.snapshot.as_ref().is_some_and(|snapshot| {
                !Arc::ptr_eq(&snapshot.index, &original.index)
                    && snapshot.index.notes["changed.md"].hash
                        != original.index.notes["changed.md"].hash
            })
        });
        assert!(
            refreshed
                .snapshot
                .unwrap()
                .index
                .notes
                .contains_key("changed.md")
        );

        drop(host);
        thread::sleep(POLL_INTERVAL + Duration::from_millis(20));
        std::fs::remove_dir_all(root).unwrap();
    }
}
