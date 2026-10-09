//! What the app keeps the same on every computer: its panes, each folder's
//! camera, where cards sit, the pins. The app syncs it with every server it
//! knows; for each key, the latest change wins.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    /// When it was changed, in milliseconds since 1970.
    pub at: u64,
    pub value: serde_json::Value,
}

pub type Map = BTreeMap<String, Entry>;

pub fn load(file: &Path) -> Map {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(file: &Path, map: &Map) {
    let tmp = file.with_extension("json.tmp");
    if let Ok(text) = serde_json::to_string(map)
        && std::fs::write(&tmp, text).is_ok()
    {
        let _ = std::fs::rename(&tmp, file);
    }
}

/// Take whatever in `from` is newer. Whether anything was.
pub fn merge(into: &mut Map, from: Map) -> bool {
    let mut changed = false;
    for (key, e) in from {
        if into.get(&key).is_none_or(|have| e.at > have.at) {
            into.insert(key, e);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(at: u64, v: i64) -> Entry {
        Entry { at, value: v.into() }
    }

    #[test]
    fn newer_wins() {
        let mut have: Map = [("a".into(), entry(5, 1)), ("b".into(), entry(5, 1))].into();
        let from: Map = [("a".into(), entry(9, 2)), ("b".into(), entry(3, 2)), ("c".into(), entry(1, 2))].into();
        assert!(merge(&mut have, from));
        assert_eq!(have["a"].value, 2);
        assert_eq!(have["b"].value, 1);
        assert_eq!(have["c"].value, 2);
        assert!(!merge(&mut have, [("a".into(), entry(9, 3))].into()));
    }
}
