#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

/// 2026-10-21T10:11:12 UTC.
pub const FIXED_MS: i64 = 1_792_577_472_000;

/// A fresh, empty folder under cargo's integration-test temp dir.
pub fn temp_dir(name: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}-{}", std::process::id()));
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
    let Ok(entries) = fs::read_dir(root) else { return true };
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
