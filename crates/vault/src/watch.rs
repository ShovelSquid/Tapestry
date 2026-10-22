//! Filesystem event adapter. Phase 2 owns the receiver on its I/O thread:
//! Changed paths go to `Store::classify`; Rescan messages and periodic
//! `FALLBACK_RESCAN` ticks go to `Store::rescan`.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::Sender;
use std::time::Duration;

use notify_debouncer_full::notify::{self, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, NoCache, new_debouncer_opt};

use crate::scan::{is_ignored_name, is_note_name};

pub const DEBOUNCE: Duration = Duration::from_millis(300);
pub const FALLBACK_RESCAN: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchMsg {
    Changed(Vec<String>),
    Rescan,
    Error(String),
}

pub struct Watch {
    root: PathBuf,
    _debouncer: Debouncer<RecommendedWatcher, NoCache>,
}

impl Watch {
    pub fn start(root: &Path, tx: Sender<WatchMsg>) -> Result<Watch, notify::Error> {
        let root = root.canonicalize().map_err(notify::Error::from)?;
        let handler_root = root.clone();
        let mut debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
            DEBOUNCE,
            None,
            move |result| {
                for message in route(&handler_root, result) {
                    let _ = tx.send(message);
                }
            },
            NoCache::new(),
            notify::Config::default(),
        )?;
        debouncer.watch(&root, RecursiveMode::Recursive)?;
        Ok(Watch {
            root,
            _debouncer: debouncer,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Converts a path beneath `root` to a vault-relative Markdown path.
pub fn rel_md(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return None;
        };
        let name = name.to_str()?;
        if is_ignored_name(name) {
            return None;
        }
        parts.push(name);
    }
    let file = *parts.last()?;
    if !is_note_name(file) {
        return None;
    }
    Some(parts.join("/"))
}

/// Routes debounced event paths. Event kinds are not trusted for change identity.
pub fn route(root: &Path, result: DebounceEventResult) -> Vec<WatchMsg> {
    match result {
        Err(errors) => vec![
            WatchMsg::Error(
                errors
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; "),
            ),
            WatchMsg::Rescan,
        ],
        Ok(events) => {
            let mut rescan = false;
            let mut changed = BTreeSet::new();
            for event in events {
                if event.need_rescan() {
                    rescan = true;
                }
                for path in &event.paths {
                    if let Some(rel) = rel_md(root, path) {
                        changed.insert(rel);
                    } else if should_rescan_path(root, path) {
                        rescan = true;
                    }
                }
            }
            let mut out = Vec::new();
            if rescan {
                out.push(WatchMsg::Rescan);
            }
            if !changed.is_empty() {
                out.push(WatchMsg::Changed(changed.into_iter().collect()));
            }
            out
        }
    }
}

fn should_rescan_path(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return false;
        };
        let Some(name) = name.to_str() else {
            return false;
        };
        if is_ignored_name(name) {
            return false;
        }
    }
    path.is_dir() || (!path.exists() && path.extension().is_none())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_md_filters_non_notes_and_hidden_paths() {
        let root = Path::new("/r");
        assert_eq!(rel_md(root, Path::new("/r/a/b.md")), Some("a/b.md".into()));
        assert_eq!(rel_md(root, Path::new("/r/A.MD")), Some("A.MD".into()));
        for path in [
            "/r/.obsidian/x.md",
            "/r/.tapestry/journal.jsonl",
            "/r/a/.b.md.tapestry-1-2.tmp",
            "/r/target/x.md",
            "/r/node_modules/n.md",
            "/r/a/b.txt",
            "/elsewhere/x.md",
        ] {
            assert_eq!(rel_md(root, Path::new(path)), None, "{path}");
        }
    }
}
