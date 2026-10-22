# Phase 1: Vault model - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning
**Mode:** Orchestrator-written (discuss skipped via workflow.skip_discuss; decisions taken from the brief, Kaelen's answers and project research)

<domain>
## Phase Boundary

A vault of plain `.md` notes can be scanned, indexed, linked and written by a headless crate (`crates/vault`, no egui) without ever corrupting a note. Tapestry-originated note, link, and card events are recorded for growth replay; outside edits are detected by the watcher and fallback scan but their note contents are not copied into the journal. Requirements: VAULT-02..06, LINK-01..05. No UI in this phase (the app-side vault host and watcher reaction come in Phase 2).

</domain>

<decisions>
## Implementation Decisions

### Locked (Kaelen, 2026-10-21 — do not change, do not re-ask)
- **D-01:** egui_dock removed. Main view is one blank infinite 2D canvas. Obsidian-style explorer on the left: resizable by edge, closable, can be dragged off to float.
- **D-02:** Every existing tool keeps its functionality and opens full-window from a Cmd-K palette; Esc returns to the canvas.
- **D-03:** Vault = folder of plain `.md` files, Obsidian-compatible, no custom format. A folder is a graph; its notes are cards.
- **D-04:** Card `x`, `y`, `w`, `h` in each note's YAML frontmatter; written on drag/resize end, never per frame; unknown keys preserved.
- **D-05:** Top-level folders get deterministic regions from a stable hash (FNV-1a or similar, never `DefaultHasher`) of the normalized vault-relative path; subfolders nested inside the parent at smaller scale, zoom-to-fill; a moved folder's position stored as `world-x`, `world-y`, `world-scale` in `Folder/Folder.md` frontmatter (separate keys from the card's own `x/y/w/h`).
- **D-06:** Obsidian block refs: `^id` anchors; links `[[Note#^id|description]]`, `[[Folder/Note#^id|description]]` across graphs; plain `[[Note]]` keeps working.
- **D-07:** The user writes every connection description. The app may only propose; never writes description text.
- **D-08:** Silent research, no chat model: queries from keywords + Model2Vec embeddings (no LLM), debounced on topic shift, daily cap, visible "out of searches". Source cards placed near the prompting note and linked to it; research never edits the note being typed (provenance `found_from` on the source note + drawn edge; `^id` added to the prompting line only on keep/idle).
- **D-09:** Free search only: OpenAlex, arXiv, Wikipedia, Tavily only if `TAVILY_API_KEY` set, DuckDuckGo HTML fallback. `ureq`, background threads, never block UI.
- **D-10:** Knowledge tree: live whole-vault graph + growth replay scrubber.
- **D-11:** Open any folder as vault, remember last; default `world/vault/`.

### Defaults chosen by the orchestrator (logged in .context/HUMAN-QUESTIONS.md; treat as decided)
- Source cards are real `.md` notes with `source: auto`, `status: suggested`, provenance frontmatter, in a sources subfolder of the graph; never used as research input.
- New notes get `created:`; Tapestry-originated create, link, card, and legacy-estimate events append to `<vault>/.tapestry/journal.jsonl`. Outside file changes are detected but not snapshotted into the journal. Times for pre-existing notes are labeled estimated.
- Vault logic lives in a new egui-free crate `crates/vault`; app-side edits to `main.rs` kept small (shared with other sessions). Never rename `Tab` variants (marks keys use their Debug strings).
- Explorer docked left (`egui::Panel::left(..).resizable(true)`), closable, can float. Simulation tools (sim canvas + brushes + timeline + swarm) open as one composite view.
- Moving notes between folders is out of scope (v2).

### Run constraints
- Fully autonomous: no `blocking-human` checkpoints and no `checkpoint:human-verify` that waits. Visual checks are done by the agent (build, run, screenshot) and logged to `.context/HUMAN-QUESTIONS.md`.
- Shared worktree with other Claude sessions: stage and commit only your own paths with a pathspec commit (`git commit -m ... -- <paths>`); never `git add -A/./-u`, `git commit -a`, `git stash`, `git reset --hard`, `git clean`, `git checkout --`. Check `git diff --cached --name-only` before and `git show --stat HEAD` after every commit. Never commit `world/notes/*` you didn't create. Never push. Do not use `gsd_run query commit` (it commits the whole index, which holds another session's staged files).
- `cargo build` and `cargo test` for touched crates must pass at the end of every plan.

### Phase 1 specifics (Claude's discretion, guided by research)
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

</decisions>

<code_context>
## Existing Code Insights

- `crates/canvas` (package `tapestry-canvas`, depends only on glam) is the precedent for a pure crate with tests.
- `apps/canvas/src/ide.rs:86,1873,1889` parse `[[wikilinks]]` by filename only, dropping `#^id` and alias, ignoring code fences.
- `apps/canvas/src/notes.rs:20` `struct Note {name, source}`; three independent writers to `.md` today (notes.rs:119, notes.rs:166, ide.rs:1770) — the new store is the single writer going forward (app-side migration happens in Phase 2/3).
- See `.planning/research/ARCHITECTURE.md`, `STACK.md`, `PITFALLS.md` (pitfalls 1-10, 24, 26-29, 35-37 apply here).

</code_context>

<specifics>
## Specific Ideas

- Notes in `world/notes/*.md` (timestamp names, title = first line, no frontmatter) are real-world fixtures for the "no frontmatter" case — copy, don't modify them.
- The real-Obsidian open check is HUMAN-QUESTIONS #5 (non-blocking).

</specifics>

<deferred>
## Deferred Ideas

- Moving notes between folders with inbound link rewrite (v2).
- `Embedder: Clone + raw()` moves to Phase 4 where first used.

</deferred>
