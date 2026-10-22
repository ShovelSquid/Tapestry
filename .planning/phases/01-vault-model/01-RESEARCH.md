# Phase 1: Vault model - Research

**Researched:** 2026-10-21
**Domain:** Headless Rust crate for an Obsidian-compatible markdown vault: lossless frontmatter splicing, wikilink/block-ref grammar, link resolution and index, a single atomic writer, an event journal, and an FSEvents watcher
**Confidence:** HIGH for crate APIs, macOS file-system behaviour and workspace layout (read from source and tested live this session). MEDIUM for Obsidian grammar edge cases: the official help pages cover the basics, and the tie-break rules are inferred.

## Summary

This phase builds `crates/vault` (package `tapestry-vault`), a pure, egui-free crate following the `crates/canvas` precedent. The workspace already globs `crates/*` into members, so creating the crate needs no root `Cargo.toml` edit. The new dependencies are `yaml_serde` 0.10.7 (read only), `notify` 8.2.0 and `notify-debouncer-full` 0.7.0, plus `serde`/`serde_json`, which are already in the lock. All three new crates are in the local cargo registry, compile offline, have no build scripts, and pass the package legitimacy check. `regex` 1.13.1 is already in `Cargo.lock`, so it can serve as a dev-dependency for the independent grammar check without adding anything to the lock. `tempfile` is not cached and is not needed: integration tests use `env!("CARGO_TARGET_TMPDIR")`, verified working this session.

Six live probes this session changed the design in concrete ways:
1. **FSEvents reports canonical paths.** A watch on `/var/folders/...` delivered `/private/var/folders/...`, so the vault root must be canonicalised before `strip_prefix`.
2. **FSEvents replays recent history.** A file created about 1.5 s before `watch()` arrived as `Create(File)` + `Modify(Data(Content))` after the watch started, so event kinds cannot be trusted. Every event must mean "re-stat this path and compare content hash".
3. **Rename-replace (the atomic write) resets birth time, inode and permissions.** A file at mode 600 became 644. The writer must copy permissions onto the temp file. It must also journal the note's original birth time before the first rewrite of a pre-existing note, because after that the birth time is gone (this matters for Phase 6 "estimated" times).
4. **`File::sync_all()` on Apple platforms is `fcntl(F_FULLFSYNC)`** (read in std source). Directory fsync after the rename also works on APFS.
5. **yaml_serde uses the YAML 1.2 core schema.** `y`, `yes` and `off` stay strings, duplicate keys error, empty frontmatter parses to `Null`, and a tab-indented block errors. The "unparseable means never rewrite" rule can therefore rest on `from_str::<Value>` plus a "top level must be a mapping or null" check.
6. **The debouncer's default macOS file-ID cache walks the whole root with `follow_links(true)` when `watch()` is called.** That contradicts "symlinks are not followed" and is slow on big trees. Use `new_debouncer_opt` with `NoCache`.

Obsidian's official help confirms these rules: block ids use only Latin letters, digits and dashes; ` ^id` goes at the end of a paragraph's line or directly on a list bullet; for structured blocks (quotes, callouts, tables) the id goes on its own line with a blank line before and after; a `|` inside a table needs a `\` before it; folder paths are vault-root-relative with forward slashes; dates are `2020-08-21`; date-times are `2020-08-21T10:30:00`. Obsidian does not document how it breaks ties between duplicate basenames. The recommended resolver therefore emits a folder-qualified link whenever a basename is ambiguous, so links the app writes are never ambiguous at write time.

**Primary recommendation:** Build `tapestry-vault` as pure `&str -> struct/Option<String>` functions (frontmatter, blocks, links, layout, index) with one effectful `Store` (atomic write, own-write hash table, journal) and a thin `Watch` adapter. Every write goes through `Store`. Test byte-exactness with inline literals for CRLF and BOM, and with readable fixture files for Obsidian-style notes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Frontmatter read and splice | `tapestry-vault::frontmatter` (pure) | `Store` applies it to fresh disk bytes | Pure text transform; testable byte for byte |
| Wikilink parse, mask, build | `tapestry-vault::links` (pure) | `apps/canvas/src/ide.rs` calls it | One parser for the app; ide.rs becomes a caller |
| `^id` find and insert | `tapestry-vault::blocks` (pure) | `Store` (InsertAnchor) | Pure block segmentation; write via the store |
| Link resolution, index, backlinks | `tapestry-vault::index` (pure over scanned data) | — | Immutable snapshot consumed by the UI in Phase 2 |
| Scan (walk the vault) | `tapestry-vault::scan` (read-only I/O) | App io worker thread in Phase 2 | Read-only; must change zero bytes and zero mtimes |
| Placement and stable hash | `tapestry-vault::layout` (pure) | Phase 3 canvas | Computed, never written |
| Atomic writes, own-write suppression | `tapestry-vault::store` (the only writer) | — | The single serialized writer (VAULT-06) |
| Event journal | `tapestry-vault::journal` (append-only, used only by Store) | Phase 6 replay reducer | Records history from the first write |
| File watching | `tapestry-vault::watch` (thin adapter over notify) | Phase 2 `vault_host` reacts | The OS edge; the classification logic is pure and lives in Store |
| UI | none this phase | Phase 2 | No egui in the crate |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Locked (Kaelen, 2026-10-21 — do not change, do not re-ask)
- **D-01** egui_dock removed. Main view is one blank infinite 2D canvas. Obsidian-style explorer on the left: resizable by edge, closable, can be dragged off to float.
- **D-02** Every existing tool keeps its functionality and opens full-window from a Cmd-K palette; Esc returns to the canvas.
- **D-03** Vault = folder of plain `.md` files, Obsidian-compatible, no custom format. A folder is a graph; its notes are cards.
- **D-04** Card `x`, `y`, `w`, `h` in each note's YAML frontmatter; written on drag/resize end, never per frame; unknown keys preserved.
- **D-05** Top-level folders get deterministic regions from a stable hash (FNV-1a or similar, never `DefaultHasher`) of the normalized vault-relative path; subfolders nested inside the parent at smaller scale, zoom-to-fill; a moved folder's position stored as `world-x`, `world-y`, `world-scale` in `Folder/Folder.md` frontmatter (separate keys from the card's own `x/y/w/h`).
- **D-06** Obsidian block refs: `^id` anchors; links `[[Note#^id|description]]`, `[[Folder/Note#^id|description]]` across graphs; plain `[[Note]]` keeps working.
- **D-07** The user writes every connection description. The app may only propose; never writes description text.
- **D-08** Silent research, no chat model: queries from keywords + Model2Vec embeddings (no LLM), debounced on topic shift, daily cap, visible "out of searches". Source cards placed near the prompting note and linked to it; research never edits the note being typed (provenance `found_from` on the source note + drawn edge; `^id` added to the prompting line only on keep/idle).
- **D-09** Free search only: OpenAlex, arXiv, Wikipedia, Tavily only if `TAVILY_API_KEY` set, DuckDuckGo HTML fallback. `ureq`, background threads, never block UI.
- **D-10** Knowledge tree: live whole-vault graph + growth replay scrubber.
- **D-11** Open any folder as vault, remember last; default `world/vault/`.

#### Defaults chosen by the orchestrator (logged in .context/HUMAN-QUESTIONS.md; treat as decided)
- Source cards are real `.md` notes with `source: auto`, `status: suggested`, provenance frontmatter, in a sources subfolder of the graph; never used as research input.
- New notes get `created:`; vault events append to `<vault>/.tapestry/journal.jsonl`. Times for pre-existing notes labeled estimated.
- Vault logic lives in a new egui-free crate `crates/vault`; app-side edits to `main.rs` kept small (shared with other sessions). Never rename `Tab` variants (marks keys use their Debug strings).
- Explorer docked left (`egui::Panel::left(..).resizable(true)`), closable, can float. Simulation tools (sim canvas + brushes + timeline + swarm) open as one composite view.
- Moving notes between folders is out of scope (v2).

#### Run constraints
- Fully autonomous: no `blocking-human` checkpoints and no `checkpoint:human-verify` that waits. Visual checks are done by the agent (build, run, screenshot) and logged to `.context/HUMAN-QUESTIONS.md`.
- Shared worktree with other Claude sessions: stage and commit only your own paths with a pathspec commit (`git commit -m ... -- <paths>`); never `git add -A/./-u`, `git commit -a`, `git stash`, `git reset --hard`, `git clean`, `git checkout --`. Check `git diff --cached --name-only` before and `git show --stat HEAD` after every commit. Never commit `world/notes/*` you didn't create. Never push. Do not use `gsd_run query commit` (it commits the whole index, which holds another session's staged files).
- `cargo build` and `cargo test` for touched crates must pass at the end of every plan.

### Claude's Discretion

#### Phase 1 specifics (Claude's discretion, guided by research)
- Crate `crates/vault` (package `tapestry-vault`), added to the workspace. Modules roughly: `frontmatter`, `blocks`, `links`, `layout` (placement + stable hash), `index`, `store` (single serialized atomic writer, own-write suppression by content hash), `journal`, `scan`, `watch`.
- Frontmatter: read with `yaml_serde` 0.10.7; write by splicing only app-owned keys (`x`, `y`, `w`, `h`, `created`, `world-x`, `world-y`, `world-scale`) as text lines; every other byte identical (comments, lists, CRLF, BOM, unknown keys); unparseable frontmatter → never rewrite; files without frontmatter get a new block prepended only when a layout write is requested.
- Link scanner and writer hand-rolled (not pulldown-cmark): `[[target#subpath|alias]]` with byte spans, `\|` inside tables, code spans and fences masked, embeds `![[...]]` recognised but not treated as described links.
- Block ids: Obsidian rules — `[A-Za-z0-9-]+`; appended as ` ^id` to the last line of a paragraph/list item; on its own line (blank lines around) after tables, quotes, callouts. Reuse an existing id. Generate short random ids (e.g. 6 chars base36) checked unique within the note.
- Resolution: Obsidian's — exact path if folder-qualified, else basename; if ambiguous, shortest path / folder-qualified required. Writer emits folder-qualified target only when the basename is ambiguous.
- Placement: notes without `x/y` get a computed placement (grid/spiral in empty space) that is NOT written; a shared empty-spot finder (used later by folder regions, sub-worlds and source cards).
- Journal: `<vault>/.tapestry/journal.jsonl`, append-only JSON lines `{t, kind, ...}`.
- Watcher: `notify` 8.2.0 + `notify-debouncer-full` 0.7.0, plus slow fallback rescan; ignore `.obsidian/`, `.git/`, `.tapestry/`; suppress events matching the hash of the app's own last write.
- Scanning must change zero bytes and zero mtimes (test it).
- `apps/canvas/src/ide.rs` `wikilinks()` (~L1889) delegates to the new parser — the only app-side edit this phase.
- Test fixtures under `crates/vault/tests/fixtures/` modelled on real Obsidian notes; an independent grammar check (regex-level) re-parses written notes.

#### Specific Ideas
- Notes in `world/notes/*.md` (timestamp names, title = first line, no frontmatter) are real-world fixtures for the "no frontmatter" case — copy, don't modify them.
- The real-Obsidian open check is HUMAN-QUESTIONS #5 (non-blocking).

### Deferred Ideas (OUT OF SCOPE)
- Moving notes between folders with inbound link rewrite (v2).
- `Embedder: Clone + raw()` moves to Phase 4 where first used.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VAULT-02 | Every `.md` file is a note; every folder is a graph; `.obsidian/`, `.git/`, app hidden folder ignored; symlinks not followed | Scan rules (Pattern 5); `DirEntry::file_type()` does not traverse symlinks; skip dot-entries; zero-mtime test (Validation) |
| VAULT-03 | Position/size read from frontmatter `x y w h`; unpositioned notes get computed, unwritten placement | Frontmatter read rules (Pattern 1), lenient numeric parse, `place_free()` spiral (Pattern 7) |
| VAULT-04 | Layout writes splice only app-owned keys, other bytes identical; unparseable frontmatter never rewritten | Splice algorithm (Pattern 2); yaml_serde probe results; CRLF/BOM/no-frontmatter rules |
| VAULT-05 | `created:` on app-created notes; vault events appended to journal in hidden folder | Journal format (Pattern 9); Obsidian date-time format; birth time captured before the first rewrite |
| VAULT-06 | One serialized atomic writer; watcher picks up outside edits, ignores own writes | Atomic write recipe (Pattern 8); own-write hash table; FSEvents probe; `NoCache` debouncer; fallback rescan |
| LINK-01 | Parser for `[[Note]]`, alias, heading, `^id`, folder path, with byte spans, code masked, `\|` | Scanner algorithm (Pattern 3); masks; ide.rs delegation keeps behaviour |
| LINK-02 | Stable `^id` per Obsidian rules; reuse existing | Block segmentation and placement table (Pattern 4); id generator |
| LINK-03 | One builder writes `[[Note#^id\|description]]` | `build_link()` (Pattern 6); description validation; table escaping |
| LINK-04 | Resolution across folders (shortest unique, qualified when ambiguous); index with backlinks | Resolver order (Pattern 6); index structures |
| LINK-05 | Files written by the app open cleanly in Obsidian | Independent regex grammar check; Obsidian property formats; HUMAN-QUESTIONS #5 logged, non-blocking |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- No `./CLAUDE.md` or `./.claude/CLAUDE.md` exists. `world/CLAUDE.md` governs world content only. `.claude/skills/` holds `orchestrate` and `tree-rules`; neither applies to this phase. [VERIFIED: ls of repo root and .claude/skills]
- The project constraints that do apply come from CONTEXT.md and PROJECT.md (copied above): pathspec commits only, never `world/notes/*`, `cargo build` and `cargo test` green for touched crates after every plan, no blocking human checkpoints.
- **Claims system:** `tools/claims/claim` hooks enforce file claims. Session `core-b7` (this milestone's orchestrator) holds `whole apps/canvas` and `whole .planning`. The `ide.rs` edit therefore sits inside the orchestrator's own claim. `crates/vault/**` and `Cargo.lock` are unclaimed, so the executor should run `python3 tools/claims/claim add crates/vault Cargo.lock --lock whole -m "..."` (or `--lock parts`) before editing. [VERIFIED: `claim list` output this session]
- **`Cargo.lock` is shared.** Adding the crate changes it. Commit it with the plan's own paths and check `git diff --cached --name-only` first.

## Standard Stack

### Core (crates/vault/Cargo.toml)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yaml_serde` | 0.10.7 | Read frontmatter into `Value` (order-preserving `Mapping`) | Official YAML-org fork of deprecated `serde_yaml`. YAML 1.2 core schema verified (`y`/`yes`/`off` stay strings). [VERIFIED: local registry source + probe] |
| `notify` | 8.2.0 | FSEvents (macOS), inotify (Linux) watcher | Matched pair with debouncer-full 0.7. Default feature `macos_fsevent`. [VERIFIED: registry Cargo.toml] |
| `notify-debouncer-full` | 0.7.0 | Debounce bursts, deliver over `std::sync::mpsc::Sender<DebounceEventResult>` | Implements `DebounceEventHandler` for mpsc `Sender`; re-exports `notify`. [VERIFIED: src/lib.rs:149-157] |
| `serde` | 1.0.229 (`derive`) | Journal event types | Already in `Cargo.lock` [VERIFIED: Cargo.lock] |
| `serde_json` | 1.0.151 | Journal JSONL | Already in `Cargo.lock` [VERIFIED: Cargo.lock] |

### Dev-dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `regex` | 1.13.1 | Independent grammar check that re-parses written notes, without reusing the crate's scanner | Already in `Cargo.lock`, so it adds no new crate [VERIFIED: Cargo.lock] |

**Not needed:** `tempfile` (not in the registry cache; use `env!("CARGO_TARGET_TMPDIR")` in `tests/*.rs`), `walkdir` (use `std::fs::read_dir` recursively for explicit symlink control), `rand`/`nanoid` (ids from xorshift seeded by `RandomState` + time + counter), `chrono`/`time` (Hinnant `civil()` already exists at `apps/canvas/src/notes.rs:317-328`; copy it), `unicode-normalization` (defer NFC; see Open Questions), `glam` (Phase 1 geometry is plain `f64`).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `new_debouncer` (`RecommendedCache` = `FileIdMap` on macOS) | `new_debouncer_opt::<_, RecommendedWatcher, NoCache>` | **Use NoCache.** `FileIdMap::add_path` runs `WalkDir::new(path).follow_links(true)` over the whole root when `watch()` is called [VERIFIED: file_id_map.rs:39-53]. That follows symlinks (against VAULT-02) and costs O(tree). Its only benefit is rename stitching, which is not needed because every event is a re-stat. |
| line splice | `saphyr` (span-preserving) | Only if the line splice proves brittle. Not needed. |
| hand-rolled scanner | `pulldown-cmark` 0.13.5 wikilinks | Rejected by project research (alias fragments, `\|` bug, no `^id`). |

**Installation (crates/vault/Cargo.toml):**
```toml
[package]
name = "tapestry-vault"
version = "0.1.0"
edition.workspace = true
license.workspace = true

[dependencies]
yaml_serde = "0.10.7"
notify = "8.2.0"
notify-debouncer-full = "0.7.0"
serde = { version = "1.0.229", features = ["derive"] }
serde_json = "1.0.151"

[dev-dependencies]
regex = "1.13.1"
```
And in `apps/canvas/Cargo.toml` (a one-line addition, needed for the ide.rs delegation):
```toml
tapestry-vault = { version = "0.1.0", path = "../../crates/vault" }
```
The `edition.workspace`/`license.workspace` form matches `crates/canvas/Cargo.toml:1-5` [VERIFIED: crates/canvas/Cargo.toml:1-8, quoted: `name = "tapestry-canvas"`, `edition.workspace = true`, `license.workspace = true`, `glam = "0.34.1"`]. Workspace `members = ["crates/*", "apps/*"]`, `edition = "2024"`, `resolver = "3"` [VERIFIED: Cargo.toml:1-7]. No root edit is required.

**Version verification:** `cargo run --offline` built a probe crate with exactly these three versions on 2026-10-21, using `rustc 1.99.0 (b940084d7 2026-09-28)`. Transitive deps: indexmap 2.14.2, libyaml-rs 0.3.0, ryu, itoa, fsevent-sys 4.1.0, notify-types 2.1.0, file-id 0.2.3, walkdir 2.5.0, bitflags, libc, log. [VERIFIED: cargo tree --offline]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| notify | crates.io | ~12 yrs (2014-12) | ~3.6M/wk | github.com/notify-rs/notify | OK | Approved |
| notify-debouncer-full | crates.io | ~3.4 yrs (2023-05) | ~440k/wk | github.com/notify-rs/notify | OK | Approved |
| yaml_serde | crates.io | ~9 mo (2026-01) | ~240k/wk | github.com/yaml/yaml-serde | OK | Approved |
| regex (dev) | crates.io | already in Cargo.lock | — | rust-lang/regex | (existing dep) | Approved |

No `build.rs` in yaml_serde, libyaml-rs, notify, notify-debouncer-full, notify-types, fsevent-sys, file-id or walkdir (checked in the registry sources). [VERIFIED: gsd-tools package-legitimacy check --ecosystem crates; registry inspection]

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                 (Phase 2 app thread owns these; Phase 1 tests drive them directly)
 disk <vault>/**/*.md
    │  read-only walk (no symlinks, skip dot-entries)
    ▼
 scan::scan(root) ──► Vec<ScannedNote{rel, bytes/text, mtime, birth, size}> + skipped[]
    │  per note, pure:
    ├─► frontmatter::split(text) ─► Frontmatter{Absent | Parsed(map, region) | Invalid(reason)}
    │        └─► layout fields x,y,w,h,created,world-* (lenient numeric)
    ├─► links::mask(text) ─► excluded byte ranges (frontmatter, fences, code spans, %% %%, <!-- -->)
    ├─► links::parse(text) ─► Vec<Link{span, embed, target, subpath, alias, escaped_pipe}>
    └─► blocks::segment(text) ─► Vec<Block{kind, lines, id?}>
    ▼
 index::VaultIndex::build(notes) ─► notes, folders, by_basename, block ids,
       resolve(link, source) ─► Resolved | Ambiguous{pick, candidates} | Unresolved
       outlinks (source note + block → target note + block + description), backlinks
       placement: layout::place_free() for notes lacking x/y (computed, NOT written)

 UI intent (Phase 3) / tests ─► VaultCmd ─► Store (single owner, serialized)
       read fresh bytes ─► pure transform (splice_layout / insert_anchor / insert_link / new_note)
       ─► None? skip (no-op) ─► atomic_write(tmp+fsync+rename+dir fsync, perms copied)
       ─► own_writes[rel] = fnv(bytes) ─► journal.append({t, kind, ...})

 notify FSEvents ─► debouncer(300ms, NoCache) ─► mpsc<DebounceEventResult>
       ─► watch::paths(events, canonical_root) (drop dot-paths, non-.md files; dirs ⇒ rescan)
       ─► Store::classify(rel): read bytes, h = fnv(bytes)
             h == own_writes[rel] → OwnEcho (ignore)
             h == known[rel]      → Unchanged (FSEvents replay/touch)
             missing              → Removed
             else                 → External(rel)  ──► Phase 2: re-index that note
       need_rescan() / Err / every 60 s ─► fallback rescan (stat diff) ─► same classify
```

### Recommended Project Structure
```
crates/vault/
├── Cargo.toml
├── src/
│   ├── lib.rs           # pub mods + re-exports; crate doc states "no egui, no network"
│   ├── frontmatter.rs   # split, read layout, splice_layout, ensure_created, line-ending detect
│   ├── links.rs         # mask, parse, Link, build_link, validate_description, targets() (ide shim)
│   ├── blocks.rs        # segment, find_id, insert_anchor, IdGen, is_valid_id
│   ├── layout.rs        # fnv1a64, normalize_rel, stable_point, Rect, place_free
│   ├── scan.rs          # read-only walk, ScannedNote, Skipped{reason}
│   ├── index.rs         # VaultIndex, NoteMeta, Resolution, backlinks, resolve
│   ├── store.rs         # Store, VaultCmd, atomic_write, own-write table, classify
│   ├── journal.rs       # Event enum (serde tag), append, read (tolerant)
│   ├── watch.rs         # Watch::start(root, Sender<Vec<PathBuf>>) over notify; rel-path filter
│   ├── time.rs          # civil() copy, iso_utc(ms), parse_created()
│   └── bin/vault-check.rs   # optional: scan a folder, print stats, round-trip check (read-only)
└── tests/
    ├── fixtures/obsidian-sample/   # readable .md fixtures (LF only; see Pitfall 9)
    ├── frontmatter.rs   # byte-exact golden tests
    ├── links.rs         # spans, masks, ide-compat
    ├── blocks.rs
    ├── index.rs         # resolution + backlinks on fixture vault
    ├── scan.rs          # zero bytes / zero mtimes, symlinks, dot dirs
    ├── store.rs         # atomic write, perms, journal, created, conflicts
    ├── watch.rs         # live FSEvents: external picked up, own ignored
    └── grammar.rs       # independent regex check of everything the store wrote
```
Unit tests that need no filesystem can stay inline (`#[cfg(test)] mod tests` as in `crates/canvas/src/lib.rs:23-24`). Filesystem tests go in `tests/*.rs` because `CARGO_TARGET_TMPDIR` is only set for integration tests and benches. [VERIFIED: probe used `env!("CARGO_TARGET_TMPDIR")` in tests/watch.rs]

### Pattern 1: Frontmatter detection and reading
**What:** The frontmatter is the byte region between an opening line that is exactly `---` **at byte 0** (after an optional UTF-8 BOM `EF BB BF`) and the next line that is exactly `---`. Trailing spaces or tabs on the delimiter line are tolerated. Line endings are `\n` or `\r\n`.
- No opening `---` on line 1 → `Absent` (a later `---` is a horizontal rule or setext heading, PITFALLS #29).
- Opening found but no closing `---` → `Invalid(Unterminated)` → never write.
- Closing `...` → treat as `Invalid(DotsTerminator)` → never write. Obsidian's help documents only `---` [CITED: obsidian.md/help/properties, "Type `---` at the very beginning of a file."]. Accepting `...` risks the app and Obsidian disagreeing about where the body starts.
- Inner YAML: `yaml_serde::from_str::<Value>(inner)`. `Ok(Mapping)` → `Parsed`. `Ok(Null)` (empty or comment-only) → `Parsed(empty)`. Any other top-level kind (scalar, sequence) → `Invalid(NotMapping)`. `Err` (duplicate key, tab indent, `a: b: c`) → `Invalid(Yaml(msg))`. [VERIFIED: probe: dup keys → `ERR duplicate entry with key "x"`; tab → `ERR found character that cannot start any token`; `title: a: b` → `ERR mapping values are not allowed`; empty → `Null`; `just text` → `String`]
- Layout read is lenient: `Number` → f64; `String` that parses as a finite f64 (`x: "120"`) → f64 [VERIFIED: probe `x: "120"` → `String("120")`]. `.inf`/`NaN` → ignore (treat as absent) [VERIFIED: `.inf` parses as `Number(.inf)`]. `Null` (`x:`) → absent. `x` present but non-numeric (`x: left`, a list) → `Conflict` (the card uses computed placement, and the app never overwrites that key; PITFALLS #28).

### Pattern 2: Lossless splice of app-owned keys
**What:** `splice_layout(text: &str, set: &LayoutPatch) -> Result<Option<String>, SpliceError>`. `None` means no change (skip the write, keep the mtime).

Algorithm:
1. Detect BOM and the line ending: use the ending of the opening delimiter line if frontmatter exists, else the file's first line ending, else `\n`.
2. **Absent** → build `---{le}x: 120{le}y: 40{le}w: 230{le}h: 150{le}---{le}`, insert it after the BOM (if any) and before byte 0 of the original content. Leave the body byte-identical, including a missing trailing newline.
3. **Invalid** → `Err(SpliceError::Unparseable)`; never write.
4. **Parsed** → for each app-owned key in a fixed order (`x, y, w, h, world-x, world-y, world-scale`; `created` only via `ensure_created`):
   - Find top-level lines (column 0, not `#`, not inside a block scalar) matching `^KEY[ \t]*:` where the key is a plain unquoted scalar.
   - Exactly one such line whose value is a plain scalar on the same line → replace **only the value bytes**. Keep the bytes before the value, any trailing ` # comment`, and the line ending.
   - The key is in the parsed mapping but no spliceable line exists (quoted key, flow mapping `{x: 1}`, value on the following lines, JSON-style frontmatter) → `Err(SpliceError::KeyNotSpliceable(key))`. Never guess.
   - The parsed value is non-numeric (Conflict) → `Err(SpliceError::Conflict(key))`.
   - The key is absent → collect it for insertion.
   - Insert the missing keys as new lines immediately before the closing `---`, in fixed order, using the detected line ending.
5. Value formatting: round to 1 decimal. Print integers without `.0` (`120`, `-12.5`). Rust `{}` on f64 never uses exponent notation. Reject non-finite values.
6. No-op: if every rounded new value equals the on-disk value and nothing is inserted → `Ok(None)`.
7. `ensure_created(text, iso) -> Result<Option<String>, _>`: insert `created: <iso>` only if absent. **Never overwrite an existing `created`.**

Key names `world-x`, `world-y`, `world-scale` parse fine with yaml_serde [VERIFIED: probe `world-x: 10` → `"world-x": Number(10)`]. Obsidian property types are vault-wide, so keep these keys flat numbers [CITED: obsidian.md/help/properties, "Once a property type is assigned to a property name, all properties with that name across your vault will use the same type."].

### Pattern 3: Link scanner (LINK-01)
**What:** `parse(text) -> Vec<Link>` with `Link { span: Range<usize> /* whole, incl. '!' */, embed: bool, target: Range, subpath: Option<Subpath{kind: Heading|Block, range}>, alias: Option<Range>, escaped_pipe: bool }`. All ranges are byte offsets into the original `text`.

1. **Mask first** (`mask(text) -> Vec<Range<usize>>`, sorted, non-overlapping):
   - the frontmatter region (frontmatter links are a separate concern; Obsidian indexes quoted property links like `found_from: "[[Note]]"`, which Phase 4 needs, so expose `frontmatter_links()` separately or defer it);
   - fenced code blocks: a line with ≤3 spaces of indent and then ≥3 backticks or ≥3 tildes; closed by a line of the same character with length ≥ the opener and only whitespace after; an unclosed fence runs to EOF. Fences inside a blockquote (`> ````) also count. [CITED: obsidian.md/help/syntax, "enclose it with three or more backticks or three or more tildes"];
   - inline code spans: a backtick run of length n closed by the next run of exactly n, within the same paragraph (an unmatched run is literal);
   - Obsidian comments `%% ... %%` (inline and multi-line) [CITED: obsidian.md/help/syntax, "A block comment starts when a line begins with `%%`, and ends at the next `%%`."] and HTML comments `<!-- ... -->`.
   - Do **not** mask 4-space-indented code. In Obsidian notes it collides with nested lists, so false positives would hide real links (assumption A3).
2. Scan for `[[` outside the mask. If preceded by `!` → `embed = true` and the span starts at `!`.
3. Closing `]]` must sit on the same line. If another `[[` appears first, restart from the inner `[[`. No `]]` on the line → not a link.
4. Inner text: split target/alias at the **first** `|`. If the byte before that `|` is `\`, then `escaped_pipe = true` and the `\` is excluded from the target. [CITED: obsidian.md/help/advanced-syntax, "If you want to use [[aliases]] ... in your table, you need to add a `\` before the vertical bar."]
5. Target: split at the first `#`. Path = before it (may be empty for same-note links `[[#^id]]`). A subpath beginning with `^` → `Block(id)`; otherwise `Heading` (which may contain further `#` for nested headings) [CITED: obsidian.md/help/links, "You can add multiple hash symbols for each subheading."].
6. Trim spaces around the target and alias ranges. Keep the raw spans for rewriting.

**ide.rs delegation (keeps behaviour):** the current function [VERIFIED: apps/canvas/src/ide.rs:1888-1903]:
```rust
/// `[[Target]]`, `[[Target|shown]]`, `[[Target#heading]]` → `Target`.
fn wikilinks(text: &str) -> Vec<String> {
    ...
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() && !out.iter().any(|t: &String| t == target) {
            out.push(target.to_owned());
        }
```
Its only caller is `read_entry` at `ide.rs:1873-1877` (`let links = if kind == Kind::Markdown { wikilinks(&text) } else { Vec::new() };`). The result is stored in `Entry.links` (`ide.rs:86-87`) and consumed at `ide.rs:1031-1035`, which matches `target.to_lowercase()` against `stem(&e.name).to_lowercase()` of entries in the **same folder**. [VERIFIED: ide.rs:1026-1037] No other file references `wikilinks` [VERIFIED: grep apps crates]. Contract to keep: **ordered by first appearance, deduplicated by exact string, trimmed, empty dropped, embeds included, target only (no `#...`, no alias, folder prefix kept as written).** Provide `tapestry_vault::links::targets(text) -> Vec<String>` with exactly this contract and make `wikilinks` a one-line call:
```rust
fn wikilinks(text: &str) -> Vec<String> {
    tapestry_vault::links::targets(text)
}
```
Intended behaviour changes, both fixes: links inside code fences, code spans or comments disappear, and `[[Note\|alias]]` yields `Note` instead of `Note\`. Pin both with unit tests in the vault crate (ide.rs has no tests module).

### Pattern 4: Blocks and `^id` anchors (LINK-02)
**Segmentation** (`segment(text) -> Vec<Block>`, outside frontmatter and fences):
| Kind | Detection | Where the id goes | Source |
|------|-----------|-------------------|--------|
| Paragraph | consecutive non-blank lines not matching other kinds | append ` ^id` to the **last line** of the paragraph | [CITED: obsidian.md/help/links, "place a blank space followed by a caret `^` and the block identifier at the end of the line"] |
| List item | line starting (after indent) with `-`, `*`, `+`, `1.`/`1)` + space, or a task `- [ ]`; plus its lazy/indented continuation lines up to the next item, blank line or nested item | append ` ^id` to the item's own last text line (before nested children) | [CITED: obsidian.md/help/links, "the block identifier can be placed directly on a bullet point"] |
| Quote / callout | lines starting with `>` (a callout is `> [!type]`) | own line after the block: `{le}^id{le}` with a blank line before and after | [CITED: obsidian.md/help/links, "the block identifier should be on a separate line, with a blank line before and after"] |
| Table | a header row with `\|`, then a delimiter row `\|---\|`, then rows | own line after the table, blank line before and after | same |
| Heading `#..` | ATX heading | **refuse** (`BlockError::Heading`); callers link with `#Heading` instead | PITFALLS #7 |
| Fence, frontmatter, HR, HTML comment, blank | — | **refuse** | PITFALLS #7 |

- **Existing id:** a block whose last line matches `\s\^([A-Za-z0-9-]+)\s*$`, or a structured block followed by an id-only line `^([A-Za-z0-9-]+)\s*$`, already has an id → return it with no edit.
- **Id validity:** `^[A-Za-z0-9-]+$` [CITED: obsidian.md/help/links, "Block identifiers can only consist of Latin letters, numbers, and dashes."].
- **Generation:** 6 characters of `[a-z0-9]`. Must be unique within the note (case-insensitive compare against all existing ids, including user-made ones). Retry on collision. Use an injectable `IdGen` trait so tests are deterministic. The production seed is `RandomState::new().build_hasher().finish() ^ nanos ^ counter` fed to xorshift64*.
- **API:** `insert_anchor(text, line: usize, gen) -> Result<Anchor{ id, edit: Option<Edit{range, insert}> }, BlockError>`. Store applies it to fresh disk text. Phase 3 can apply the same `Edit` to a live buffer.
- If the user later types after ` ^id` on the same line, the id is no longer at the end. The index must report that block as having no id, and the link becomes broken (PITFALLS #7).

### Pattern 5: Scan (VAULT-02)
- Use recursive `std::fs::read_dir` from the root. For each entry use `entry.file_type()`, which does **not** traverse symlinks [CITED: doc.rust-lang.org/std/fs/struct.DirEntry.html#method.file_type]. Skip symlinks (file or dir) entirely: not a note, never written.
- Skip any entry whose name starts with `.` (covers `.obsidian`, `.git`, `.tapestry`, `.trash` and the store's temp files). Also skip `target`, `node_modules`, `__pycache__`, matching ide.rs's `SKIP` [VERIFIED: ide.rs:68, `const SKIP: [&str; 4] = ["target", ".git", "node_modules", "__pycache__"];`].
- A note is a regular file with extension `md` (ASCII case-insensitive, assumption A5). Every directory reached is a graph, including empty ones.
- Read with `std::fs::read`. Non-UTF-8 content or size > 5 MB → a note with a `Skipped` status (listed, no parse, never written). Non-UTF-8 *names* → recorded in `skipped`, excluded.
- Caps: stop at 50k entries with a visible `truncated` flag (PITFALLS #10). Sort entries for determinism.
- Record `mtime` and `birth` (`Metadata::created()` works on APFS [VERIFIED: probe]) per note for later "estimated" times.
- **Must not create `.tapestry/`, a journal, or temp-file cleanup.** Those belong to `Store::open`.

### Pattern 6: Resolution, link builder, index (LINK-03, LINK-04)
**Normalise** a link path: trim, `\` → `/`, strip a leading `/`, strip a trailing `.md` (ASCII case-insensitive). Comparison key = `to_lowercase()`. Obsidian link matching is case-insensitive (assumption A4; ide.rs already lowercases). Resolve `./`/`../` relative to the source folder.

**Resolve(link_path, source_rel)** in this order:
1. Exact vault-relative match: `key + ".md"` equals a note's lowercased rel path → `Resolved`.
2. The path contains `/`: notes whose lowercased rel path ends with `"/" + key + ".md"` → unique → `Resolved`; several → step 4.
3. No `/`: notes whose lowercased file stem equals the key → unique → `Resolved`; several → step 4.
4. Tie-break (Obsidian's exact rule is undocumented, assumption A2): the candidate in the source note's folder, then the fewest path components, then the shortest string, then lexicographic. Return `Ambiguous{ pick, candidates }` so the UI can show it.
5. None → `Unresolved` (a broken link; Obsidian would create the note on click).

**Builder** `build_link(target_rel, target_block: Option<&str>, description: &str, index, in_table: bool) -> Result<String, LinkError>`:
- Path text = target rel path without `.md`, reduced to the basename when that basename is unique in the index; otherwise the full vault-relative path (Obsidian's "shortest path when possible" [CITED: forum.obsidian.md/t/settings-new-link-format-what-is-shortest-path-when-possible/6748]). Folder paths start at the vault root with forward slashes [CITED: obsidian.md/help/links].
- Reject target path characters `# | ^ : %% [[ ]]` [CITED: obsidian.md/help/links, "A string which contains the following characters may not work as a link: `# | ^ : %% [[ ]]`."].
- Description (D-07: user-typed): trim and collapse internal whitespace and newlines to single spaces. Empty → `Err(EmptyDescription)`. Containing `[[`, `]]`, `|`, `` ` `` or `%%` → `Err(ForbiddenInDescription(..))`. Never silently rewrite user words beyond whitespace.
- Output: `[[{path}#^{id}|{desc}]]` or `[[{path}|{desc}]]`. In a table row, use `\|`.
- Every builder output must round-trip through `parse()` to the same target, subpath and alias (property test over generated descriptions).

**Index (`VaultIndex`)**: `generation: u64`; `notes: BTreeMap<String /*rel*/, NoteMeta{ title, folder, rect: Option<Rect>, layout_status, created, mtime, birth, blocks: Vec<BlockInfo{id, line, kind}>, frontmatter: FmStatus, body_hash }>`; `folders: BTreeMap<String, FolderMeta{ world: Option<(x,y,scale)> }>`, read from `Folder/Folder.md`; `by_stem: HashMap<String, Vec<String>>`; `block_owner: HashMap<String /*id lower*/, Vec<String>>` (for healing later); `links: Vec<LinkRec{ source, source_line, source_block: Option<String>, embed, target: Resolution, target_block: Option<String>, heading: Option<String>, description: Option<String>, span }>`; `outlinks: HashMap<String, Vec<usize>>`, `backlinks: HashMap<String, Vec<usize>>`. Use `BTreeMap` or sorted `Vec`s wherever iteration order is observable (tests, replay, placement). `source_block` = the id of the block that contains the link span, else `None` plus the line number.

### Pattern 7: Layout — stable hash and free-spot placement
- `fnv1a64(bytes)`: offset basis `0xcbf29ce484222325`, prime `0x100000001b3`, `hash ^= byte; hash = hash.wrapping_mul(prime)`. Golden values: `fnv1a("") = 0xcbf29ce484222325`, `fnv1a("a") = 0xaf63dc4c8601ec8c` [VERIFIED: ~/.cargo/registry fnv-1.0.7/lib.rs:95,115-124,163-164]. Hand-roll it (6 lines) and pin these vectors in a test.
- `normalize_rel`: forward slashes, no leading `./` or trailing `/`, case kept (the hash input must be stable). NFC is deferred (Open Question 2).
- `stable_point(rel, salt)` maps the hash to a point. Phase 1 only provides the function plus golden tests. D-05's region geometry is Phase 3.
- `place_free(occupied: &[Rect], size: (f64,f64), anchor: (f64,f64), gap) -> Rect`: square spiral over a grid with cell = size + gap, starting at the anchor; return the first cell that intersects no occupied rect. Unpositioned notes are placed **in sorted rel-path order**, each placed rect added to `occupied`. This is deterministic but recomputed per scan (see Pitfall 7). Default card size 230×150 matches the Files tool [VERIFIED: ide.rs:25, `const CARD: Vec2 = vec2(230.0, 150.0);`].

### Pattern 8: The single atomic writer (VAULT-06)
`Store::open(root)`: canonicalise the root; create `.tapestry/` lazily on the first journal write; remove stale temps matching exactly `.*.tapestry-*.tmp`. Apply each `VaultCmd` serially (`&mut self`; Phase 2 owns it on one io thread):
1. `symlink_metadata(path)`: if it is a symlink → `Err(WriteError::Symlink)`; keep `permissions()` if the file exists.
2. Read **fresh** bytes from disk and apply the pure transform. `None` → return `Unchanged`, with no write and no journal entry.
3. For body edits (anchor, link insert), compare against an optional `base_hash`. A mismatch → `Err(Conflict)` (PITFALLS #3). Layout splices are key-based and safe on fresh content, so they apply anyway.
4. Temp file `dir/.{name}.tapestry-{pid}-{n}.tmp` via `OpenOptions::new().write(true).create_new(true)`; `write_all`; `set_permissions(orig)`; `sync_all()` (on Apple this is `fcntl(F_FULLFSYNC)` [VERIFIED: rust std library/std/src/sys/fs/unix.rs:1264-1271]).
5. `fs::rename(tmp, path)`, then `File::open(dir)?.sync_all()` [VERIFIED: probe, dir `sync_all` → `Ok(())`]. On any error, `remove_file(tmp)`.
6. `own_writes.insert(rel, fnv1a64(&bytes))`; `known.insert(rel, same)`; append to the journal.
7. **Before the first rewrite of a pre-existing note that lacks `created`:** append `{"kind":"note_estimated","path":..,"created":<birth or mtime ms>,"from":"birth"}`. The rename destroys birth time [VERIFIED: probe: birth `Jan 1 2020` → `Oct 21 2026` after `mv`, inode 37755973 → 37755974, perms `-rw-------` → `-rw-r--r--`].

`VaultCmd` (Phase 1): `CreateNote{rel, body}` (adds `created`), `SetLayout{rel, patch}`, `SetFolderWorld{folder, x, y, scale}` (writes `Folder/Folder.md`, creating it if missing), `InsertAnchor{rel, line, base_hash}`, `AddLink{source_rel, line, target_rel, target_line: Option, description}` (calls InsertAnchor on the target, then inserts the built link at the end of the source line, or before an existing ` ^id`), `RemoveLink{rel, span, base_hash}` (replaces the link with its alias, or with its target text when there is no alias), `Journal(JournalEvent)` (card kept or dismissed).

### Pattern 9: Journal (VAULT-05)
- Path `<root>/.tapestry/journal.jsonl`. Open with `OpenOptions::new().create(true).append(true)`. Each event is serialised as one line with `\n` and written with a single `write_all`, then `sync_data()`.
- Shape: `{"t": <unix ms i64>, "kind": "...", ...}` via `#[derive(Serialize, Deserialize)] #[serde(tag = "kind", rename_all = "snake_case")] enum Event { NoteCreated{path}, NoteEstimated{path, created, from}, LinkAdded{path, line, block, target, target_block, description}, LinkRemoved{..}, CardKept{path}, CardDismissed{path}, LayoutSet{path} /* optional */ }` wrapped in `struct Entry { t: i64, #[serde(flatten)] event: Event }`.
- The reader skips malformed lines (a torn tail after a crash) and never fails vault open.
- Inject the clock (`fn now_ms() -> i64`) into `Store` so tests are deterministic.
- `created:` value: `YYYY-MM-DDTHH:MM:SS`, Obsidian's documented date-and-time format [CITED: obsidian.md/help/properties, `time: 2020-08-21T10:30:00`], written in **UTC without a suffix** (assumption A1). Build it with `civil()` copied from `apps/canvas/src/notes.rs:317-328` [VERIFIED: Read, `fn civil(days: i64) -> (i64, u32, u32)` "after Howard Hinnant"].

### Pattern 10: Watcher adapter
```rust
// Source: notify-debouncer-full 0.7.0 src/lib.rs:639-645, 719-731; src/cache.rs:41-62 (local registry)
use notify_debouncer_full::{new_debouncer_opt, notify::{RecommendedWatcher, RecursiveMode, Config}, NoCache, DebounceEventResult};
let root = root.canonicalize()?;                         // FSEvents reports /private/var/... paths
let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
let mut deb = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
    Duration::from_millis(300), None, tx, NoCache::new(), Config::default())?;
deb.watch(&root, RecursiveMode::Recursive)?;             // keep `deb` alive; Drop stops it
// consumer: for each Ok(events): for e in events { if e.need_rescan() { full_rescan() } for p in &e.paths { rel = p.strip_prefix(&root) ... } }
```
- Filter: drop paths with any component starting with `.` (journal, temp files, `.obsidian`) and non-`.md` files. A directory path (create, remove, rename) → rescan that subtree.
- Ignore `event.kind`. FSEvents replays history: a probe file created before `watch()` arrived as `Create(File)` + `Modify(Data(Content))` [VERIFIED: probe output]. An atomic rename shows up as `Modify(Name(Any))` on both the temp and destination paths, with no From/To pairing [VERIFIED: probe].
- Fallback: a full stat rescan (mtime and size, then hash on change) every 60 s, on `need_rescan()`, and on `Err(errors)`.

### Anti-Patterns to Avoid
- **Re-serialising YAML** (`to_string(&value)`) for any user-owned file: drops comments and reflows lists. Only `CreateNote` may emit fresh YAML, and even there use the same line format.
- **Trusting `EventKind`** on macOS: kinds are coalesced historical flags. Always re-stat and hash.
- **`new_debouncer(...)` with the default cache:** walks the tree following symlinks.
- **Writing during scan** (creating `.tapestry`, cleaning temps, adding `^id`): breaks the zero-mtime criterion and PITFALLS #2.
- **`std::hash::DefaultHasher`/`RandomState` for placement:** not stable across runs. Use the hand-rolled FNV. `RandomState` is fine as an id-generator seed only.
- **Committing CRLF/BOM fixture files:** see Pitfall 9.
- **Stale offsets:** applying a byte-range edit computed from an older read. Always recompute on fresh bytes inside `Store`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing (validity, numeric types) | a custom YAML parser | `yaml_serde::from_str::<Value>` | Edge cases: tabs, duplicate keys, flow maps, block scalars. Only the *splice* is hand-rolled. |
| FS event delivery and debounce | a raw FSEvents binding or polling loop | `notify` + `notify-debouncer-full` (NoCache) | Run-loop thread, coalescing, cross-platform |
| Durable fsync on macOS | `libc::fcntl(F_FULLFSYNC)` | `File::sync_all()` | std already does F_FULLFSYNC on Apple |
| Atomic replace | copy + truncate | `fs::rename` in the same directory | Atomic on APFS; a truncating write can leave a half-written file that Obsidian reads |
| Journal encoding | manual JSON strings | `serde_json` + `#[serde(tag)]` | Escaping user descriptions correctly |

**Key insight:** the parts that *must* be hand-rolled (frontmatter splice, wikilink scanner, block segmentation) are exactly the parts where libraries normalise text. Keep the hand-rolled code as pure functions returning byte edits, and let the libraries handle validity checks and OS I/O.

## Common Pitfalls

### Pitfall 1: Non-canonical vault root
**What goes wrong:** `strip_prefix(root)` fails for every event, so external edits are silently ignored.
**Why it happens:** FSEvents reports real paths. `/var` → `/private/var` [VERIFIED: probe]. The user's `~/Tree` vault also contains symlinks.
**How to avoid:** `root.canonicalize()` once in `Watch::start` and `Store::open`. Store rel paths everywhere.
**Warning signs:** the watcher test passes under `CARGO_TARGET_TMPDIR` (already canonical) but fails under `std::env::temp_dir()`. Test both.

### Pitfall 2: Own writes echo back as external edits
**What goes wrong:** a drag writes the file, the watcher reports it, the app reloads, and an editor buffer gets clobbered or a write loop starts.
**How to avoid:** `own_writes[rel] = hash` set **before** the rename returns. Classification compares the *current content hash*, never the event kind or mtime. Keep only the last hash per path: if two quick writes happen, the event for the first is read after the second, the content equals the latest own hash, and it is ignored.
**Warning signs:** the live test sees an `External` for a path only the store wrote.

### Pitfall 3: Rename-replace side effects
**What goes wrong:** permissions reset to umask, birth time is lost, symlinked notes are replaced by regular files, hard links break.
**How to avoid:** copy permissions, refuse symlinks, journal birth time before the first rewrite. Accept hard-link breakage (rare; note it in the doc comment).

### Pitfall 4: Frontmatter that parses but cannot be spliced
**What goes wrong:** `{x: 1, y: 2}` flow style, `"x": 1`, `x:\n  10`, or JSON frontmatter. A naive line regex inserts a duplicate `x:`, the YAML becomes invalid (duplicate key), and Obsidian shows a property error.
**How to avoid:** cross-check the parsed mapping against the spliceable lines (Pattern 2, step 4). After every splice, re-parse the result with yaml_serde and assert the app keys hold the intended values and every other key is unchanged (`Value` equality on the non-app keys). If not, return an error instead of writing.

### Pitfall 5: Masking order and backticks in descriptions
**What goes wrong:** a description containing a backtick pairs with a later backtick on the line, the masker treats the link as code, and the link vanishes from the index.
**How to avoid:** forbid `` ` `` (and `|`, `[[`, `]]`, `%%`) in descriptions at build time. The round-trip property test catches the regressions.

### Pitfall 6: Anchors in the wrong place
**What goes wrong:** ` ^id` appended to a table row, a quote line or a heading; or to the first line of a soft-wrapped paragraph.
**How to avoid:** the segmentation table in Pattern 4. Golden tests give the exact output string for each block kind. The independent regex check asserts every id is either at a paragraph/list end or alone on its line with blank lines around it.

### Pitfall 7: Computed placement jumps
**What goes wrong:** card B (unpositioned) moves when the user moves card A, because occupancy changed.
**How to avoid in Phase 1:** document that `place_free` is a pure function of (positioned rects, sorted unpositioned list). Phase 3 should cache computed placements per session. Flagged for the Phase 3 planner, not solved here.

### Pitfall 8: The scan touches the disk
**How to avoid:** the scan module has no write calls. The test snapshots `(rel path, len, mtime, fnv(bytes))` for every file **and directory** (including the root) before and after `scan()`, and asserts that `.tapestry` does not exist afterwards.

### Pitfall 9: Git or editors normalise fixture bytes
**What goes wrong:** CRLF, BOM or no-trailing-newline fixture files get altered by an editor or a future `.gitattributes`. The tests then pass for the wrong reason.
**How to avoid:** keep byte-sensitive cases as Rust string literals (`"---\r\nx: 1\r\n---\r\nbody"`, `"\u{FEFF}---\n..."`). Readable Obsidian-style fixtures are LF files under `tests/fixtures/obsidian-sample/`. Integration tests **copy** fixtures into `CARGO_TARGET_TMPDIR/<test>-<pid>` before mutating. Never write into `tests/fixtures`. No `.gitattributes` exists and `core.autocrlf` is unset [VERIFIED: git config].

### Pitfall 10: Symlink fixtures in the repo
**What goes wrong:** a committed symlink loop trips other tools (the Files tool, ripgrep, the Obsidian vault at `~/Tree` that symlinks `.planning`).
**How to avoid:** create symlinks (a file link, a directory link and a loop) at test time inside the temp copy with `std::os::unix::fs::symlink`. Gate with `#[cfg(unix)]`.

### Pitfall 11: Flaky live-watcher test
**What goes wrong:** FSEvents latency, replayed history, or the debouncer tick makes assertions racy.
**How to avoid:** keep classification pure and unit-tested (Store::classify given bytes). In the live test, sleep about 500 ms after `watch()`, perform the own write through Store and an external write through `std::fs::write`, then drain with `recv_timeout` until a 10 s deadline or until the external path is seen. Assert: the external path is classified `External` at least once, the own path is never `External`, and nothing in `.tapestry` is reported. The probe saw events about 210 ms after the writes with a 200 ms timeout [VERIFIED: probe].

## Code Examples

### Splice target outputs (golden expectations)
```text
in : "---\r\ntitle: A # keep\r\ntags:\r\n  - a\r\nx: 10\r\n---\r\nBody\r\n"
set: x=12.5, y=40
out: "---\r\ntitle: A # keep\r\ntags:\r\n  - a\r\nx: 12.5\r\ny: 40\r\n---\r\nBody\r\n"

in : "# Heading\nI think about a note\n"            (world/notes style, no frontmatter)
set: x=0,y=0,w=230,h=150
out: "---\nx: 0\ny: 0\nw: 230\nh: 150\n---\n# Heading\nI think about a note\n"

in : "---\nx: [1, 2\n---\nbody"                     (invalid YAML)
out: Err(Unparseable)                                (file untouched)
```

### Anchor outputs
```text
paragraph  : "line one\nline two\n"          + anchor → "line one\nline two ^k3x9a1\n"
list item  : "- alpha\n- beta\n" (line 1)    + anchor → "- alpha\n- beta ^k3x9a1\n"
quote      : "> quoted\n> more\nnext\n"      + anchor → "> quoted\n> more\n\n^k3x9a1\n\nnext\n"
table      : "| a | b |\n|---|---|\n| 1 | 2 |\n" + anchor → "...| 1 | 2 |\n\n^k3x9a1\n"
existing   : "text ^abc\n"                    → id "abc", no edit
heading    : "# Title\n"                      → Err(Heading)
```

### Builder outputs
```text
build_link("Topic/Note.md", Some("k3x9a1"), "why it matters", unique)    → "[[Note#^k3x9a1|why it matters]]"
build_link("Topic/Note.md", Some("k3x9a1"), "why", ambiguous basename)   → "[[Topic/Note#^k3x9a1|why]]"
in table row                                                            → "[[Note#^k3x9a1\|why]]"
description "a | b"                                                     → Err(ForbiddenInDescription('|'))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `serde_yaml` 0.9 | `yaml_serde` 0.10.x (YAML org fork) | serde_yaml deprecated 2024-03 | Same API |
| `notify-debouncer-full` `.watcher()`/`.cache()` accessors | `Debouncer::watch/unwatch/configure` directly | 0.4+ (deprecated stubs remain in 0.7) | Call `deb.watch(..)`; `deb.watcher()` returns `()` [VERIFIED: lib.rs:571-575] |
| ide.rs `wikilinks()` (no masking) | `tapestry_vault::links::targets()` | this phase | Code-fence links no longer drawn in the Files tool |

**Deprecated/outdated:** `notify` 9.0.0-rc.x is a release candidate; do not use it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Obsidian accepts `created: 2026-10-21T10:11:12` (UTC, no suffix) as a Date & time property; the display will be off by the local UTC offset | Pattern 9 | Low: shown as text or with the wrong hour. The journal holds exact ms. Log in HUMAN-QUESTIONS #5. |
| A2 | Obsidian's tie-break for duplicate basenames is not documented; the app's order (same folder, then fewest components, then shortest, then lexicographic) may differ | Pattern 6 | Low: the app writes qualified links when ambiguous; only hand-written ambiguous links can disagree |
| A3 | Obsidian does not render links inside `%% %%` or HTML comments; the app masks them and does not mask 4-space indented code | Pattern 3 | Low: Obsidian's graph may still count comment links (forum reports vary) |
| A4 | Obsidian link resolution is case-insensitive | Pattern 6 | Low: matches ide.rs's existing lowercasing |
| A5 | `.MD` (uppercase extension) counts as a note | Pattern 5 | Very low |
| A6 | For a list item with continuation lines, Obsidian expects ` ^id` on the item's last text line | Pattern 4 | Medium: verify in the real Obsidian check (#5) |
| A7 | Splitting at the first `\|` matches Obsidian for `[[a\|b\|c]]` | Pattern 3 | Low: the builder forbids `\|` in descriptions |
| A8 | Obsidian ignores dot-prefixed files and folders (`.tapestry`, temp files), so they never appear in its UI | Pattern 8 | Low |

## Open Questions (RESOLVED)

1. **Should `created` be local time with an offset?**
   - What we know: Obsidian documents only the naive `2020-08-21T10:30:00` form. Forum reports say `+HH:MM` displays correctly but `Z` and `+HHMM` are flaky.
   - Recommendation: naive UTC now, logged. Revisit only if Kaelen cares how it displays.
   - RESOLVED: naive UTC via `iso_utc` (plan 01-01); logged as HUMAN-QUESTIONS #12 and assumption A1 (plan 01-05).
2. **NFC normalisation of link keys** (PITFALLS #37).
   - What we know: `unicode-normalization` is not in the lock or the registry cache. APFS preserves name bytes.
   - Recommendation: route all key-making through one `fn key(&str) -> String` (lowercase) so NFC can be added later. Do not add the dependency in Phase 1.
   - RESOLVED: every link key goes through `index::key()` (plan 01-03); NFC deferred.
3. **Should `.tapestry/` be git-ignored or committed?** Deferred to Phase 6 per ARCHITECTURE. The store must not write a `.gitignore` there in Phase 1.
   - RESOLVED: deferred to Phase 6; no Phase 1 plan writes a `.gitignore`.
4. **Links in frontmatter properties** (`found_from: "[[Note]]"`). Needed by Phase 4. Recommendation: Phase 1's index records them as `LinkRec{ in_frontmatter: true }` only if cheap; otherwise defer to Phase 4.
   - RESOLVED: deferred to Phase 4; `links::mask()` excludes frontmatter from the link scan (plan 01-02).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| rustc / cargo | everything | ✓ | 1.99.0 / 1.99.0 | — |
| yaml_serde, notify, notify-debouncer-full sources | vault crate | ✓ (local registry, builds `--offline`) | 0.10.7 / 8.2.0 / 0.7.0 | — |
| regex | dev-dep | ✓ (in Cargo.lock) | 1.13.1 | — |
| FSEvents (macOS) | watch test | ✓ (APFS, Darwin 25.6) | — | Fallback rescan path is tested without FSEvents |
| tempfile | — | ✗ (not cached) | — | `env!("CARGO_TARGET_TMPDIR")` (verified) |
| Obsidian app | LINK-05 real check | not probed | — | Regex grammar check now; real check logged as HUMAN-QUESTIONS #5 |
| Disk | builds | ✓ (~44 GB free, 96% used) | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | built-in `cargo test` (libtest); no extra harness |
| Config file | none (crate `Cargo.toml` only) |
| Quick run command | `cargo test -p tapestry-vault -q` |
| Full suite command | `cargo test -p tapestry-vault -p tapestry-canvas -p tapestry-canvas-app -q && cargo build -p tapestry-canvas-app` |
| Baseline | `cargo test -p tapestry-canvas -p tapestry-canvas-app -q` green on 2026-10-21: canvas 21 passed; app 18 passed, 2 ignored; about 5 s warm [VERIFIED: run this session] |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAULT-02 | dot dirs, `target` and symlinks skipped; every `.md` is a note, every dir a graph; zero bytes and zero mtimes changed (files + dirs); no `.tapestry` created | integration | `cargo test -p tapestry-vault --test scan` | ❌ Wave 0 |
| VAULT-03 | x/y/w/h read (numbers, numeric strings); absent → computed placement, deterministic, non-overlapping, and nothing written | unit + integration | `cargo test -p tapestry-vault frontmatter::` / `--test index` | ❌ |
| VAULT-04 | golden byte-exact splice: comments, block lists, unknown keys, CRLF, BOM, empty fm, no fm, no trailing newline, `---` HR in body; invalid YAML, dup keys, flow map, quoted key, non-numeric `x` → Err and file untouched; no-op → None | unit (literals) + integration | `cargo test -p tapestry-vault --test frontmatter` | ❌ |
| VAULT-05 | CreateNote adds `created:` (naive ISO); each cmd appends one JSONL line with the expected kind; `note_estimated` before the first rewrite of a pre-existing note; reader skips a torn last line | integration | `cargo test -p tapestry-vault --test store` | ❌ |
| VAULT-06 | atomic write keeps perms (600 stays 600), refuses symlinks, leaves no temp files; classify: own echo ignored, unchanged ignored, external detected; live FSEvents: external edit seen, own write never External; fallback rescan detects an external edit with no watcher | unit + integration (live) | `cargo test -p tapestry-vault --test store --test watch` | ❌ |
| LINK-01 | spans for the 5 forms + embed + same-note `[[#^id]]`; `\|` in a table; masked: fences (``` and ~~~, unclosed), inline code, `%%`, `<!-- -->`; `targets()` matches the old ide contract (order, dedupe, trim) except the intended fixes | unit | `cargo test -p tapestry-vault --test links` | ❌ |
| LINK-02 | exact output per block kind; existing id reused; heading, fence and frontmatter refused; generated ids match `^[a-z0-9]{6}$` and are unique within the note (seeded collision test) | unit | `cargo test -p tapestry-vault --test blocks` | ❌ |
| LINK-03 | builder output strings (unique vs ambiguous basename, table escape); description validation; round trip build→parse over about 200 generated descriptions; AddLink writes the target anchor and source link through Store | unit + integration | `cargo test -p tapestry-vault --test links --test store` | ❌ |
| LINK-04 | fixture vault with duplicate `Notes.md` in two folders: qualified link resolves exactly, bare link → Ambiguous with the same-folder pick; case-insensitive; `.md` suffix tolerated; unresolved; backlinks and source block → target block + description | integration | `cargo test -p tapestry-vault --test index` | ❌ |
| LINK-05 | every file written in the store tests re-parses under the independent `regex` grammar (frontmatter delimiters; yaml_serde parses; app keys are numbers; every `^id` matches `[A-Za-z0-9-]+` at block end or alone with blank lines around; every `[[...]]` matches `^\[\[[^\[\]|#^]+(#\^?[^\[\]|]+)?(\\?\|[^\[\]]+)?\]\]$`) | integration | `cargo test -p tapestry-vault --test grammar` | ❌ |
| (ide) | the app still builds with `wikilinks` delegating | build | `cargo build -p tapestry-canvas-app && cargo test -p tapestry-canvas-app -q` | ✅ existing |

### Sampling Rate
- **Per task commit:** `cargo test -p tapestry-vault -q` (target under 10 s; the live watch test is the slowest, under about 3 s typical)
- **Per plan end:** full suite command above (CONTEXT: build and test for touched crates must pass)
- **Phase gate:** full suite green, plus a `vault-check` run (if built) over a temp copy of the fixture vault, reporting zero modifications

### Wave 0 Gaps
- [ ] `crates/vault/Cargo.toml`, `src/lib.rs` (crate scaffold; the workspace glob picks it up)
- [ ] `crates/vault/tests/fixtures/obsidian-sample/` with: `Welcome.md` (frontmatter with `tags` list, `aliases`, `cssclasses`, comment, date), `Topic/Notes.md` + `Other/Notes.md` (duplicate basename), `Topic/Topic.md` (folder note with `world-x/world-y/world-scale`), `Links.md` (every link form, table with `\|`, links in a fence, a code span and `%% %%`), `Blocks.md` (paragraph, list, quote, callout, table, existing `^ids`), `Broken.md` (invalid YAML), `.obsidian/workspace.json`, `Sub/Deep/Leaf.md`, copies of `world/notes/2026-10-09-0726-15.md` and `2026-10-09-0822-48.md` (the only two committed in HEAD [VERIFIED: git ls-tree HEAD world/notes]) under `no-frontmatter/`
- [ ] `crates/vault/tests/common/mod.rs`: `fn temp_vault(name) -> PathBuf` (copy fixtures into `CARGO_TARGET_TMPDIR/{name}-{pid}`), `fn snapshot(root) -> BTreeMap<rel, (len, mtime, hash)>`, a fixed clock and seeded IdGen
- [ ] No framework install needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | partial (file-system scope) | All writes confined to the canonical vault root; reject rel paths with `..` components or absolute paths in `VaultCmd`; refuse symlinks |
| V5 Input Validation | yes | yaml_serde for YAML validity; description/target validation in the builder; size caps on read (5 MB) and entry caps on scan |
| V6 Cryptography | no | FNV-1a is for change detection and placement only, never security |
| V12 Files and Resources | yes | Atomic writes, no symlink following, no path traversal, temp files created with `create_new` (no clobber or race on existing names) |

### Known Threat Patterns for a local file-vault crate

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via a crafted link or command (`../../.ssh/x.md`) | Tampering | Normalise; reject `..`/absolute paths; `canonicalize(parent).starts_with(root)` before every write |
| Symlink swap (a note replaced by a symlink to an outside file) | Tampering / Elevation | `symlink_metadata` check right before the write; the scan never follows symlinks |
| Temp-file clobber or predictable name race | Tampering | `create_new(true)`; pid + counter in the name; cleanup restricted to the exact pattern |
| YAML bombs or huge files (alias expansion, multi-MB frontmatter) | DoS | 5 MB file cap; frontmatter region cap (e.g. 64 KB) before calling yaml_serde |
| Journal injection via descriptions containing newlines | Tampering | serde_json escaping; one `write_all` per line |
| Data loss from a concurrent external edit | Tampering (integrity) | Fresh read-modify-write; `base_hash` conflict check for body edits |

## Sources

### Primary (HIGH confidence)
- Local cargo registry sources: `notify-debouncer-full-0.7.0/src/{lib.rs,cache.rs,file_id_map.rs}`, `notify-8.2.0/src/{lib.rs,config.rs,fsevent.rs,poll.rs}` and `Cargo.toml`, `notify-types-2.1.0/src/debouncer_full.rs`, `yaml_serde-0.10.7/src/lib.rs` and `Cargo.toml`, `fnv-1.0.7/lib.rs`: APIs, defaults, FileIdMap symlink walk, FSEvents canonical paths
- Rust std source `library/std/src/sys/fs/unix.rs:1264-1319`: F_FULLFSYNC on Apple
- Live probes this session (scratch crate, `--offline`): yaml_serde edge cases, FSEvents event paths, kinds and latency, rename-replace birth time, inode and permission effects, directory fsync, `CARGO_TARGET_TMPDIR`
- Repo files read: `Cargo.toml`, `crates/canvas/Cargo.toml`, `crates/canvas/src/lib.rs`, `apps/canvas/Cargo.toml`, `apps/canvas/src/ide.rs` (25, 68, 81-89, 1026-1037, 1868-1907), `apps/canvas/src/notes.rs:301-328`, `Cargo.lock`, `.planning/*`, `tools/claims/claim`
- gsd-tools package-legitimacy check (crates): notify, notify-debouncer-full, yaml_serde all OK

### Secondary (MEDIUM confidence)
- https://obsidian.md/help/links: block id charset and placement, block link syntax, display text, folder paths, characters that break links
- https://obsidian.md/help/properties: YAML at top, `---`, types, number, date and date-time formats, vault-wide types
- https://obsidian.md/help/advanced-syntax: `\|` for aliases in tables
- https://obsidian.md/help/syntax: comments `%%`, fenced code, escaping, horizontal rules
- https://doc.rust-lang.org/cargo/reference/environment-variables.html: `CARGO_TARGET_TMPDIR` (behaviour confirmed by probe)

### Tertiary (LOW confidence)
- [Settings: New link format, shortest path when possible](https://forum.obsidian.md/t/settings-new-link-format-what-is-shortest-path-when-possible/6748) and [New link format differences](https://forum.obsidian.md/t/new-link-format-differences-and-use-cases/5413): shortest-path semantics
- [getFirstLinkpathDest API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/getFirstLinkpathDest), [How to get full paths from link text](https://forum.obsidian.md/t/how-to-get-full-paths-from-link-text/75146): tie-break undocumented
- [ISO 8601 support thread](https://forum.obsidian.md/t/obsidian-still-appears-to-not-fully-support-iso-8601-datetime-standard/114211), [+hhmm offset bug](https://forum.obsidian.md/t/datetime-offset-in-hhmm-format-got-recognized-as-milliseconds/92613): datetime offset quirks

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Built offline, sources read, legitimacy OK.
- Architecture: HIGH. Follows the existing crate precedent and project ARCHITECTURE.md; I/O behaviour verified live.
- Obsidian grammar: MEDIUM. Core rules come from the official help; list continuation, tie-break and datetime display are assumptions A1-A8 and are covered by HUMAN-QUESTIONS #5.
- Pitfalls: HIGH for file-system and watcher items (probed); MEDIUM for grammar items.

**Research date:** 2026-10-21
**Valid until:** 2026-11-20 (stable crates; re-check if `notify` 9 goes stable)

## Suggested plan split (for the planner; sequential, parallelization is off)
1. **Scaffold + frontmatter**: crate, `time.rs`, `frontmatter.rs`, literal golden tests, fixtures dir (VAULT-03 read, VAULT-04)
2. **Links + blocks + ide delegation**: `links.rs`, `blocks.rs`, `targets()`, the ide.rs one-liner, the `apps/canvas/Cargo.toml` dependency line (LINK-01, LINK-02, LINK-03 text level)
3. **Scan + index + layout**: `scan.rs`, `index.rs`, `layout.rs`, zero-mtime test, resolution and backlink tests (VAULT-02, VAULT-03 placement, LINK-04)
4. **Store + journal + watch + grammar check**: `store.rs`, `journal.rs`, `watch.rs`, live and fallback watcher tests, `grammar.rs`, optional `vault-check` bin, HUMAN-QUESTIONS #5 entry updated with the exact files to open in Obsidian (VAULT-05, VAULT-06, LINK-03 end to end, LINK-05)
