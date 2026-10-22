# Phase 1: Vault model - Pattern Map

**Mapped:** 2026-10-21
**Files analyzed:** 25 (new crate files + 2 app-side edits)
**Analogs found:** 9 / 25 have a real in-repo analog; the rest follow RESEARCH.md Patterns 1-10 (no prior frontmatter, watcher, atomic-write or journal code exists)

All analog paths below are git-tracked (checked with `git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/vault/Cargo.toml` | config | n/a | `crates/canvas/Cargo.toml` | exact |
| `crates/vault/src/lib.rs` | module root / re-exports | n/a | `crates/canvas/src/lib.rs` | exact |
| `crates/vault/src/frontmatter.rs` | utility (pure) | transform | none (RESEARCH Pattern 1-2) | none |
| `crates/vault/src/links.rs` | utility (pure parser) | transform | `apps/canvas/src/ide.rs:1888-1903` `wikilinks()` | role-match (contract to preserve) |
| `crates/vault/src/blocks.rs` | utility (pure) | transform | none (RESEARCH Pattern 4) | none |
| `crates/vault/src/layout.rs` | utility (pure) | transform | `apps/canvas/src/ide.rs:25,66` (CARD size, GAP) | partial (constants only) |
| `crates/vault/src/scan.rs` | service (read-only) | file-I/O | `apps/canvas/src/ide.rs:68` SKIP + `read_entry` (~1840-1886) | role-match |
| `crates/vault/src/index.rs` | model | transform | `apps/canvas/src/ide.rs:1024-1037` (by-name lowercase map) | partial |
| `crates/vault/src/store.rs` | service (single writer) | file-I/O | `apps/canvas/src/notes.rs:119-125` (`add`, current writer) | partial (to be superseded) |
| `crates/vault/src/journal.rs` | service | file-I/O append | none (RESEARCH Pattern 9) | none |
| `crates/vault/src/watch.rs` | adapter | event-driven | `apps/canvas/src/embed.rs:44-66` (background thread + shared state) | partial |
| `crates/vault/src/time.rs` | utility | transform | `apps/canvas/src/notes.rs:297-328` (`stamp`, `civil`) | exact (copy) |
| `crates/vault/src/bin/vault-check.rs` (optional) | CLI | file-I/O read-only | `crates/canvas/src/bin/tree-check.rs` | exact |
| `crates/vault/tests/{frontmatter,links,blocks,index,scan,store,watch,grammar}.rs` | test | — | `crates/canvas/src/tests.rs` (inline-module style; no `tests/` dir exists yet) | role-match |
| `crates/vault/tests/fixtures/obsidian-sample/**` | fixture | — | `world/notes/*.md` (no-frontmatter real notes; copy, never modify) | exact for no-frontmatter case |
| `apps/canvas/Cargo.toml` (modify) | config | — | its own line 14 (`tapestry-canvas` path dep) | exact |
| `apps/canvas/src/ide.rs` (modify `wikilinks`) | caller | — | itself | exact |

## Pattern Assignments

### `crates/vault/Cargo.toml`
**Analog:** `crates/canvas/Cargo.toml` (lines 1-8)
```toml
[package]
name = "tapestry-canvas"
version = "0.1.0"
edition.workspace = true
license.workspace = true

[dependencies]
glam = "0.34.1"
```
Copy shape; name `tapestry-vault`; deps per RESEARCH "Installation" (yaml_serde 0.10.7, notify 8.2.0, notify-debouncer-full 0.7.0, serde 1.0.229 derive, serde_json 1.0.151; dev regex 1.13.1). Root `Cargo.toml` already globs `crates/*` — no root edit.

### `crates/vault/src/lib.rs`
**Analog:** `crates/canvas/src/lib.rs` (lines 1-33)
- Opens with a `//!` crate doc in plain prose explaining purpose and principles (state "no egui, no network").
- Private `mod x;` list, `#[cfg(test)] mod tests;` (lines 23-24), then flat `pub use module::{Types...};` re-exports (lines 26-33):
```rust
mod grid;
mod key;
...
#[cfg(test)]
mod tests;

pub use key::{Body, Brush, DT, KeyId, Keyframe, Sample, Stroke, TICKS_PER_SECOND, Tick};
pub use link::{Link, PROPOSE_AFTER, STRONG};
```
For vault: make `links` a `pub mod` (ide.rs calls `tapestry_vault::links::targets`); others may be private + re-exported.

### `crates/vault/src/links.rs`
**Analog / contract source:** `apps/canvas/src/ide.rs` lines 1888-1903
```rust
/// `[[Target]]`, `[[Target|shown]]`, `[[Target#heading]]` → `Target`.
fn wikilinks(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        rest = &rest[i + 2..];
        let Some(j) = rest.find("]]") else { break };
        let inner = &rest[..j];
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() && !out.iter().any(|t: &String| t == target) {
            out.push(target.to_owned());
        }
        rest = &rest[j + 2..];
    }
    out
}
```
`pub fn targets(text) -> Vec<String>` must keep: first-appearance order, exact-string dedup, trimmed, empties dropped, embeds included, folder prefix kept. Intended fixes (pin in tests): masked code/comments drop out; `[[Note\|a]]` → `Note` not `Note\`. Rest of parser (spans, mask, build_link) per RESEARCH Patterns 3 and 6.

### `apps/canvas/src/ide.rs` (modify)
Replace the body above with `tapestry_vault::links::targets(text)`. Sole caller `read_entry` (lines 1873-1877):
```rust
let links = if kind == Kind::Markdown {
    wikilinks(&text)
} else {
    Vec::new()
};
```
Consumer at lines 1024-1037 matches `target.to_lowercase()` against `stem(&e.name).to_lowercase()` — unchanged. No other edits to ide.rs this phase.

### `apps/canvas/Cargo.toml` (modify)
Copy line 14 form: `tapestry-canvas = { version = "0.1.0", path = "../../crates/canvas" }` → add `tapestry-vault = { version = "0.1.0", path = "../../crates/vault" }` under `[dependencies]` (line 11).

### `crates/vault/src/scan.rs`
**Analog:** `apps/canvas/src/ide.rs` line 68
```rust
/// Never listed: build output, version control, dependencies.
const SKIP: [&str; 4] = ["target", ".git", "node_modules", "__pycache__"];
```
Reuse those names plus "skip any name starting with `.`"; use `DirEntry::file_type()` (no symlink follow), sorted entries, no writes (RESEARCH Pattern 5, Pitfall 8).

### `crates/vault/src/index.rs`
**Analog (resolution idea):** `apps/canvas/src/ide.rs` lines 1026-1031 — lowercase-stem map:
```rust
let by_name: HashMap<String, usize> = self.entries.iter().enumerate()
    .map(|(i, e)| (stem(&e.name).to_lowercase(), i)).collect();
```
Generalize to `by_stem: HashMap<String, Vec<String>>` with ambiguity + tie-break (RESEARCH Pattern 6); use `BTreeMap` where order is observable.

### `crates/vault/src/layout.rs`
Constants to mirror: `apps/canvas/src/ide.rs:25` `const CARD: Vec2 = vec2(230.0, 150.0);` and line 66 `const GAP: Vec2 = vec2(30.0, 30.0);` — as plain `f64` (no glam). FNV-1a hand-rolled with golden vectors (RESEARCH Pattern 7).

### `crates/vault/src/time.rs`
**Analog:** `apps/canvas/src/notes.rs` lines 297-328 — copy verbatim:
```rust
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
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}
```
and the `stamp()` usage (`SystemTime::now().duration_since(UNIX_EPOCH)`, `secs.div_euclid(86_400)`), formatting `YYYY-MM-DDTHH:MM:SS` UTC instead.

### `crates/vault/src/store.rs`
**Current writer being superseded:** `apps/canvas/src/notes.rs:119-125` (`create_dir_all` + unique-name loop `(0..).map(|n| ...).find(|n| !self.path(n).exists())`). Reuse the unique-name idea for temp/new notes only; everything else (tmp + `create_new` + perms copy + `sync_all` + rename + dir fsync, own-write hash table, `&mut self` serialization, injected clock) follows RESEARCH Pattern 8. Do not migrate notes.rs/ide.rs writers this phase.

### `crates/vault/src/watch.rs`
**Analog:** `apps/canvas/src/embed.rs` lines 44-66 — `std::thread::spawn(move || { ... })` with cloned handles, errors logged via `eprintln!` rather than panicking:
```rust
let (status, ctx) = (self.status.clone(), ctx.clone());
std::thread::spawn(move || {
    let result = fetch().and_then(|dir| { ... });
    *status.lock().unwrap() = match result {
        Ok(model) => Status::Ready(Arc::new(model)),
        Err(e) => { eprintln!("..."); Status::Failed(e) }
    };
    ctx.request_repaint();
});
```
No egui `ctx` in the crate: deliver over `std::sync::mpsc::Sender` instead. Debouncer setup per RESEARCH Pattern 10 (`new_debouncer_opt::<_, RecommendedWatcher, NoCache>`, canonicalized root, debouncer kept alive in the struct).

### `crates/vault/src/journal.rs`, `frontmatter.rs`, `blocks.rs`
No analog. Use RESEARCH Patterns 9, 1-2, 4 respectively. Pure functions `&str -> Result<Option<String>, E>` (None = no-op).

### `crates/vault/src/bin/vault-check.rs` (optional)
**Analog:** `crates/canvas/src/bin/tree-check.rs` lines 1-25 — `//!` doc with a `text` usage block, `fn main() -> ExitCode`, args via `std::env::args().skip(1)`, `-h/--help`, exit 1 on problems; imports from the crate by its lib name (`use tapestry_canvas::{RuleNote, grammar};` → `use tapestry_vault::...`). Must be read-only.

### Tests `crates/vault/tests/*.rs`
**Analog:** `crates/canvas/src/tests.rs` (lines 1-30): `use crate::*;`, small helper fns building inputs, fixtures via `include_str!`. For vault:
- Pure unit tests may stay inline (`#[cfg(test)] mod tests`, as `crates/canvas/src/lib.rs:23-24`).
- Filesystem tests go in `tests/*.rs` (integration) using `env!("CARGO_TARGET_TMPDIR")/<test>-<pid>`, copying fixtures before mutating; `use tapestry_vault::...`.
- Byte-sensitive (CRLF/BOM/no trailing newline) cases as string literals, not fixture files.
- Symlinks created at test time with `std::os::unix::fs::symlink`, `#[cfg(unix)]`.

### Fixtures `crates/vault/tests/fixtures/obsidian-sample/`
Real no-frontmatter shape from `world/notes/*.md` (e.g. `2026-10-09-0726-15.md`: timestamp name, first line `# Heading`, plain prose). Copy tracked ones only; never modify or commit untracked `world/notes/*`. LF only.

## Shared Patterns

- **Doc style:** `//!` crate docs and `///` item docs in plain prose (canvas lib.rs, ide.rs, notes.rs).
- **Errors:** app code uses `Result<_, String>` + `eprintln!` (embed.rs); the vault crate should use small typed enums (`SpliceError`, `BlockError`, `LinkError`, `WriteError`) per RESEARCH, since callers branch on them.
- **No egui / no glam** in `crates/vault`; plain `f64` geometry.
- **Determinism:** sorted iteration (`BTreeMap`/sorted Vec), FNV not `DefaultHasher`, injected clock and `IdGen`.
- **Commits:** pathspec only; claim `crates/vault Cargo.lock` via `tools/claims/claim` before editing.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `crates/vault/src/frontmatter.rs` | utility | transform | No YAML/frontmatter handling exists in repo |
| `crates/vault/src/blocks.rs` | utility | transform | No `^id` logic exists |
| `crates/vault/src/journal.rs` | service | append-only file-I/O | No JSONL journal exists |
| `crates/vault/src/store.rs` (atomic part) | service | file-I/O | Existing writers use plain `fs::write`; no atomic rename |
| `crates/vault/tests/watch.rs`, `grammar.rs` | test | event-driven | No watcher or regex-check tests exist |

## Metadata

**Analog search scope:** `crates/canvas/**`, `apps/canvas/src/{ide,notes,embed}.rs`, `apps/canvas/Cargo.toml`, `world/notes/`
**Files scanned:** 9
**Pattern extraction date:** 2026-10-21
