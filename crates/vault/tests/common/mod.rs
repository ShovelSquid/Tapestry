#![allow(dead_code)]

use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// 2026-10-21T10:11:12 UTC.
pub const FIXED_MS: i64 = 1_792_577_472_000;

/// A fresh, empty folder under cargo's integration-test temp dir.
pub fn temp_dir(name: &str) -> PathBuf {
    let dir =
        PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}-{}", std::process::id()));
    if dir.exists() {
        fs::remove_dir_all(&dir).expect("clear old temp dir");
    }
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// A clock that always reads `FIXED_MS`.
pub fn fixed_clock() -> impl FnMut() -> i64 + Send + 'static {
    || FIXED_MS
}

/// True when no store temp file (`.tapestry-` in the name) is left anywhere
/// under `root`. Symlinks are not followed.
pub fn no_temp_files(root: &Path) -> bool {
    let Ok(entries) = fs::read_dir(root) else {
        return true;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().contains(".tapestry-") {
            return false;
        }
        if entry.file_type().is_ok_and(|t| t.is_dir()) && !no_temp_files(&entry.path()) {
            return false;
        }
    }
    true
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create fixture folder");
    for entry in fs::read_dir(from).expect("read fixture folder") {
        let entry = entry.expect("fixture entry");
        let dest = to.join(entry.file_name());
        if entry.file_type().expect("fixture type").is_dir() {
            copy_tree(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), dest).expect("copy fixture file");
        }
    }
}

pub fn temp_vault(name: &str) -> PathBuf {
    let root = temp_dir(name);
    copy_tree(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/obsidian-sample"),
        &root,
    );
    root
}

pub fn snapshot(root: &Path) -> BTreeMap<String, (bool, u64, Option<SystemTime>, u64)> {
    fn walk(
        root: &Path,
        dir: &Path,
        out: &mut BTreeMap<String, (bool, u64, Option<SystemTime>, u64)>,
    ) {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .expect("snapshot directory")
            .map(Result::unwrap)
            .collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let metadata = fs::symlink_metadata(&path).unwrap();
            let is_dir = metadata.file_type().is_dir();
            let hash = if metadata.file_type().is_file() {
                tapestry_vault::layout::fnv1a64(&fs::read(&path).unwrap())
            } else {
                0
            };
            out.insert(
                rel,
                (is_dir, metadata.len(), metadata.modified().ok(), hash),
            );
            if is_dir {
                walk(root, &path, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    let metadata = fs::symlink_metadata(root).unwrap();
    out.insert(
        String::new(),
        (true, metadata.len(), metadata.modified().ok(), 0),
    );
    walk(root, root, &mut out);
    out
}

pub fn add_test_time_entries(root: &Path) {
    fs::create_dir_all(root.join("Empty")).unwrap();
    for (dir, file) in [
        ("target", "t.md"),
        ("node_modules", "n.md"),
        ("__pycache__", "p.md"),
        (".trash", "t.md"),
        (".git", "HEAD.md"),
    ] {
        fs::create_dir_all(root.join(dir)).unwrap();
        fs::write(root.join(dir).join(file), "ignored").unwrap();
    }
    fs::write(root.join("UPPER.MD"), "upper").unwrap();
    fs::write(root.join("notes.txt"), "not a note").unwrap();
    fs::write(root.join("bin.md"), [0xff, 0xfe, 0x00]).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink("Welcome.md", root.join("link.md")).unwrap();
        symlink("Sub", root.join("linkdir")).unwrap();
        symlink(".", root.join("loop")).unwrap();
    }
}

pub struct ScriptedIds(VecDeque<String>);

impl ScriptedIds {
    pub fn new(ids: &[&str]) -> Self {
        Self(ids.iter().map(|id| (*id).to_owned()).collect())
    }
}

impl tapestry_vault::blocks::IdGen for ScriptedIds {
    fn next_id(&mut self) -> String {
        self.0
            .pop_front()
            .expect("ScriptedIds ran out of configured ids")
    }
}
