# Roadmap: Tapestry Canvas — Research App

## Overview

`apps/canvas` already has the shell, simulation, swarm, spatial file view, terminals and Model2Vec embeddings. This
milestone turns it into a research app: a vault of plain Obsidian-compatible markdown notes shown as spatial graphs on
one infinite canvas. The work goes bottom-up. First a headless, egui-free vault core that can read and write notes
without ever damaging them (frontmatter layout, `^id` block anchors, described links, journal). Then the shell swap
(Cmd-K palette, explorer, one input router, egui_dock removed). Then the canvas itself, with line-anchored described
links and nested sub-worlds. On top of that sit silent research from free sources, proposed connections the user keeps
or turns down, and a knowledge tree that replays how the vault grew.

Granularity is `standard` (4-6 phases). The brief's six phases map cleanly onto the 38 v1 requirements, so they are kept.
Phase 3 is the heaviest; it is ordered as a camera/coordinate spike first, then card editing, then links, then nested
worlds, so it can be split at a plan boundary if needed without remapping any requirement.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Vault model** - Headless `crates/vault`: lossless frontmatter layout, `^id` blocks, described links, index, single writer, journal (completed 2026-10-22)
- [ ] **Phase 2: Shell** - One infinite canvas + explorer + Cmd-K palette hosting every existing tool; egui_dock removed; vault open/remember
- [ ] **Phase 3: Canvas & graph editing** - Pan/zoom, create/move/resize/edit cards, draw described connections, nested folder sub-worlds with zoom-to-fill
- [ ] **Phase 4: Silent research** - Free pluggable search driven by what you write, arriving as linked, suggested source cards
- [ ] **Phase 5: Proposed connections** - Citation and embedding-similarity proposals you keep (with your own description) or turn down
- [ ] **Phase 6: Knowledge tree** - Live whole-vault graph view with growth-replay scrubber, filters and local graph

## Phase Details

### Phase 1: Vault model

**Goal**: A vault of plain `.md` notes can be scanned, indexed, linked and written by a headless crate without corrupting notes; Tapestry-originated note, link, and card events are journaled for growth replay, while outside edits are detected by the watcher and fallback scan
**Depends on**: Nothing (first phase)
**Requirements**: VAULT-02, VAULT-03, VAULT-04, VAULT-05, VAULT-06, LINK-01, LINK-02, LINK-03, LINK-04, LINK-05
**Success Criteria** (what must be TRUE):

  1. Scanning a fixture vault treats every `.md` file as a note and every folder as a graph, skips `.obsidian/`, `.git/` and the app's hidden folder, does not follow symlinks, and changes zero bytes and zero mtimes on disk (`cargo test -p` on the vault crate)
  2. Writing a card layout (`x`, `y`, `w`, `h`, `created`, `world-x`, `world-y`, `world-scale`) into notes with comments, lists, unknown keys, CRLF line endings or no frontmatter leaves every other byte identical; a note whose frontmatter fails to parse is never rewritten; notes without layout get a computed placement that is not written
  3. The link parser returns correct byte spans for `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Note#^id]]` and `[[Folder/Note#^id|description]]` (including table-escaped `\|`, ignoring code spans and fences); the one link builder writes `[[Note#^id|description]]` and reuses an existing `^id`; `^id` generation follows Obsidian's rules (letters, digits, dashes; own line for tables, quotes, callouts)
  4. Links resolve across folders by Obsidian's rules (shortest unique path, folder-qualified when ambiguous), and the index answers source block to target note/block/description plus backlinks for a fixture vault
  5. Every write goes through one serialized atomic writer; a new note gets a `created:` stamp and each note/link/card event appends to the journal in the hidden folder; an outside edit to a fixture note (simulating Obsidian or git) is picked up by the watcher while the app's own writes are ignored; notes the app writes re-parse identically under an independent check of Obsidian's property, block-ref and alias grammar

**Plans**: 5/5 plans executed

Plans:

- [x] 01-01-PLAN.md — Tracer (scan → index → single Store writer → journal) + byte-exact frontmatter splice (VAULT-03, VAULT-04)
- [x] 01-02-PLAN.md — Wikilink parser, `^id` anchors, described-link builder; ide.rs `wikilinks()` delegates (LINK-01, LINK-02, LINK-03)
- [x] 01-03-PLAN.md — Read-only scan with skips/caps, computed placement, Obsidian link resolution + backlinks (VAULT-02, VAULT-03, LINK-04)
- [x] 01-04-PLAN.md — Hardened atomic writer, every vault command, journal events, own-write classification (VAULT-05, VAULT-06, LINK-02, LINK-03)
- [x] 01-05-PLAN.md — FSEvents watcher + fallback rescan, independent Obsidian grammar check, read-only vault-check (VAULT-06, LINK-05)

**Planning notes**: Pure Rust, no egui. New crate follows the `crates/canvas` precedent. `ide::wikilinks` (ide.rs:1889) should delegate to the new parser. Watcher is `notify` + `notify-debouncer-full` plus a slow fallback scan; the app-side reaction to watcher events is wired in Phase 2. The real-Obsidian open check is logged to `.context/HUMAN-QUESTIONS.md` (#5), never blocking.

### Phase 2: Shell

**Goal**: The app opens on one infinite canvas showing the vault with an Obsidian-style explorer and a Cmd-K palette, every existing tool still works full-window, and egui_dock is gone
**Depends on**: Phase 1
**Requirements**: VAULT-01, SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06
**Success Criteria** (what must be TRUE):

  1. Launching the app shows a single infinite canvas of the vault with no dock panes; `egui_dock` is absent from Cargo.toml and source; the vault defaults to `world/vault/` (created if missing), any folder can be opened as a vault, and the last one is reopened after restart (headless state test plus screenshot)
  2. The explorer lists folders (graphs) and notes on the left, can be resized by its edge, closed and reopened, and dragged off to float; selecting a note or folder in the explorer or palette moves the camera to it
  3. Cmd-K opens a fuzzy palette listing every tool, note, folder and command, and opens even while a terminal card has focus
  4. Simulation (sim canvas + brushes + timeline + swarm), Rules, Files, Terminals, Notes and editor tabs each open full-window from the palette and pass a per-tool smoke checklist; highlight notes, tab notes and marks still work; screenshots (`TAPESTRY_VIEW`) can be captured from any view, not only while the sim is shown; terminals stay alive while hidden
  5. Esc returns from a tool to the canvas through one input router with a defined precedence (covered by a precedence test); the terminal exit chord is never sent to the PTY; sim shortcuts (Space, digits, Delete, Cmd-Z) fire only while the sim is shown

**Plans**: 1/4 plans executed
Plans:

- [x] 02-01-PLAN.md — Tracer: open the selected vault off-frame and render its initial graph snapshot
- [ ] 02-02-PLAN.md — Add explorer, folder selection, fuzzy palette, and shared graph navigation
- [ ] 02-03-PLAN.md — Route every existing tool full-window through one focus-aware shell router
- [ ] 02-04-PLAN.md — Decouple screenshots and simulation timing, then remove dock persistence

**UI hint**: yes
**Planning notes**: Strangler path: `App.maximized` and `tab_ui` already host one tool full-window, so Cmd-K mostly sets it; remove the dock last and keep build/test green after every plan. Never rename `Tab` variants (mark pane keys are `format!("{tab:?}")`). Decouple `take_shot` from the sim tick and skip `run_clock` when the sim is hidden. The canvas here is a read-only stub with a minimal camera; Phase 3 replaces it with the spike-designed camera. Keep `main.rs` integration edits small and additive; isolate shell, input, and serialized vault-host behavior in app modules while coordinating shared-worktree edits.

### Phase 3: Canvas & graph editing

**Goal**: Users can build a graph on the infinite canvas: create, move, resize and edit note cards, draw described connections from a line to any note in any folder, and zoom into nested folders that fill the screen as full canvases
**Depends on**: Phase 2
**Requirements**: CANV-01, CANV-02, CANV-03, CANV-04, CANV-05, CANV-06, CANV-07, CANV-08, CANV-09
**Success Criteria** (what must be TRUE):

  1. The user can pan and zoom smoothly and card text stays crisp at every zoom level; camera/coordinate transforms and hit-testing round-trip numerically (world to screen to world, one shared `pick()`) at the deepest nesting depth supported
  2. Double-clicking empty canvas creates a `.md` note in that folder; the user can move, resize and edit cards, with text typed inside the card saved to the file; layout is written to frontmatter only on release (a test counts writes: zero per frame, none for a no-op drag); undo and redo cover create, move, resize, connect, edit description and remove
  3. Dragging from a line of one note to another note (including one in another folder/graph) and typing a description writes `[[Note#^id|description]]` on that line through the shared link builder; the connection is drawn as a curve from the source line to the target card with the description as a label; the description can be edited and the connection removed (link syntax removed, text kept); typing `[[` offers autocomplete that inserts through the same builder
  4. Each top-level folder occupies its own world region derived from a stable hash of its vault-relative path (same path gives the same place across runs and machines), and moving a folder region stores `world-x/world-y` in `Folder/Folder.md`
  5. Subfolders appear inside their parent as smaller graphs in an empty spot, and zooming into one fills the screen with it as a full canvas with no visible float jitter at any nesting depth (numeric re-parenting tests plus screenshots at depths 1, 2 and 3)

**Plans**: TBD
**UI hint**: yes
**Planning notes**: Open with a camera/coordinate spike before any card UI: per-folder f64 frames, hysteresis on re-parenting, painter-based cards with font size scaled by zoom, LOD, galley cache, and a check of egui text/IME/hit-test under transforms and galley line y (needed for line-anchored edges). Natural internal order is canvas core (camera, cards, edit, undo), then connections, then folder regions and nested sub-worlds. Do not use `egui::Scene` (text blurs on zoom). Marks do not follow pan/zoom: disable draw-anywhere on the canvas or document it.

### Phase 4: Silent research

**Goal**: While the user writes, the app quietly finds sources on free providers and brings them in as suggested, linked source cards, without ever blocking the UI, spending money or flooding the canvas
**Depends on**: Phase 3
**Requirements**: RSRCH-01, RSRCH-02, RSRCH-03, RSRCH-04, RSRCH-05, RSRCH-06
**Success Criteria** (what must be TRUE):

  1. Typing in a note derives queries from keywords plus Model2Vec embeddings (no LLM) and fires a search only after an idle pause when the topic has shifted; a fixture-driven test shows a topic change triggers one search and continued writing on the same topic triggers none
  2. OpenAlex, arXiv, Wikipedia and DuckDuckGo parse correctly from recorded fixtures behind one provider trait, and Tavily is used only when `TAVILY_API_KEY` is set; requests pace to each provider's limits and send a descriptive User-Agent; a blocked or exhausted provider falls through to the next and nothing ever costs money
  3. Results arrive as source note cards (title, URL, abstract/extract, provenance: query, provider, time, prompting note) placed in empty space near the prompting note, drawn linked to it, marked suggested until kept; research never edits the note being typed in, never researches its own source cards, and never re-adds a dismissed or already-present source
  4. A status chip shows searching, idle, offline, provider exhausted or out of searches; the user can pause research and set a daily cap, and the cap and counters survive a restart
  5. Network runs on background threads with a 24 h disk cache; a stalled or slow mock server causes no UI frame stall, and a repeated query is served from cache with no network call

**Plans**: TBD
**UI hint**: yes
**Planning notes**: Re-verify provider limits (OpenAlex credits, arXiv 1 req / 3 s, Wikipedia User-Agent, DDG 202 challenge) at phase start; default cap about 30 triggers/day. Source cards are real `.md` notes (`source: auto`, `status: suggested`, `found_from`) in a sources subfolder per graph; the `^id` goes on the prompting line only on keep or idle, never mid-keystroke. `Embedder` needs `Clone` and a `raw()` 256-d accessor (the existing `vector()` is a lossy 128-d swarm projection). Live-provider smoke runs are done by the agent and logged to `.context/HUMAN-QUESTIONS.md`, not gated on a person.

### Phase 5: Proposed connections

**Goal**: The app proposes connections between notes from citations and embedding similarity, and the user keeps them by writing the description or turns them down for good
**Depends on**: Phase 4
**Requirements**: PROP-01, PROP-02, PROP-03
**Success Criteria** (what must be TRUE):

  1. Given a fixture vault, the app proposes connections between notes from embedding similarity (mutual top-k above a calibrated threshold) and between source cards from citations (`referenced_works`), shown in a proposals panel
  2. Keeping a proposal asks for a description and only then inserts the `^id` anchor and the `[[Note#^id|description]]` link through the shared builder; an empty description cannot be confirmed, and nothing is written to any note without a user-typed description
  3. Turning a proposal down persists it (hidden-folder ledger) so it is not proposed again after a restart, and the number of live proposals is capped so they cannot flood the canvas

**Plans**: TBD
**UI hint**: yes
**Planning notes**: Vault proposals are separate from the sim swarm proposals (`swarm::proposals_ui` is sim-typed). Chunk embeddings are cached by content hash. Citation proposals cost no extra provider budget since `referenced_works` arrives with search results.

### Phase 6: Knowledge tree

**Goal**: Users can open a live graph of the whole vault and scrub a timeline to replay how it grew
**Depends on**: Phase 5
**Requirements**: TREE-01, TREE-02, TREE-03
**Success Criteria** (what must be TRUE):

  1. The graph view shows notes as nodes, links as edges and folders as clusters, and updates live when a note or link is added to the vault (by the app or by an outside edit in a test); the layout is deterministic for a fixed vault and stops repainting once settled
  2. Scrubbing the timeline replays vault growth from the journal and `created:` times; a given scrub position always renders the same graph, and times estimated for older notes are labeled as estimated
  3. The user can filter the graph by folders, sources, proposals and orphans and open a local graph around one note; clicking a node flies the canvas to that note

**Plans**: TBD
**UI hint**: yes
**Planning notes**: Barnes-Hut layout seeded by the path hash, with graph positions kept separate from canvas `x,y`. Reachable from Cmd-K and the explorer. Never trust file mtime for replay (git checkout resets it); use the journal and `created:`.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Vault model | 5/5 | Complete    | 2026-10-22 |
| 2. Shell | 1/4 | In Progress|  |
| 3. Canvas & graph editing | 0/TBD | Not started | - |
| 4. Silent research | 0/TBD | Not started | - |
| 5. Proposed connections | 0/TBD | Not started | - |
| 6. Knowledge tree | 0/TBD | Not started | - |
