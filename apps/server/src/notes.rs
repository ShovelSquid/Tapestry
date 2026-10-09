//! The app's notes, for every device: the `.md` files in `<world>/notes/`.
//!
//! The files stay the truth. The app on this machine reads them straight
//! from disk (and rereads them twice a second), so a note written on the
//! phone is in the app a moment later, and the other way round.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Serialize)]
pub struct Note {
    /// File name without `.md`.
    pub name: String,
    pub text: String,
    /// Unix time it was last written.
    pub at: f64,
}

/// A note's name is its file name: letters, digits, `-`, `_` and `.`, so it
/// can't step out of the folder.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

fn path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.md"))
}

/// Newest first (names are timestamps).
pub fn list(dir: &Path) -> Vec<Note> {
    let mut notes: Vec<Note> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .filter_map(|p| {
            let name = p.file_stem()?.to_str()?.to_owned();
            let text = std::fs::read_to_string(&p).ok()?;
            let at = p.metadata().ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
            Some(Note { name, text, at })
        })
        .collect();
    notes.sort_by(|a, b| b.name.cmp(&a.name));
    notes
}

/// Write a note. Left empty, it's deleted, as in the app.
pub fn write(dir: &Path, name: &str, text: &str) -> std::io::Result<()> {
    if text.trim().is_empty() {
        return match std::fs::remove_file(path(dir, name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{name}.md.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(tmp, path(dir, name))
}

/// A name for a new note: the time now, as the app names them.
pub fn new_name(dir: &Path) -> String {
    let stamp = stamp();
    (0..)
        .map(|n| if n == 0 { stamp.clone() } else { format!("{stamp}-{n}") })
        .find(|n| !path(dir, n).exists())
        .unwrap()
}

/// `YYYY-MM-DD-HHMM-SS` in UTC, the app's note names.
fn stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil(days);
    format!("{y:04}-{m:02}-{d:02}-{:02}{:02}-{:02}", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// Days since 1970-01-01 to (year, month, day), after Howard Hinnant.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}
