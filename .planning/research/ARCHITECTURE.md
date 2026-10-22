# Architecture Patterns

**Domain:** Obsidian-like spatial vault canvas, retrofitted into an existing Rust/egui desktop app (`apps/canvas`, crate `tapestry-canvas-app`)
**Researched:** 2026-10-21
**Overall confidence:** HIGH on integration seams and sequencing (read from the actual code at 5459d40); MEDIUM on nested-world camera math and the history/timestamp source (design, not yet prototyped); LOW-MEDIUM on provider parsing details (belongs to the STACK/phase-4 research)

Line references are to the tree at commit `5459d40` on `ws/core`. Other sessions share this tree, so re-grep before editing.

---

## 1. The headline findings

1. **The "host one tool full-window, Esc back" mechanism already exists.** `App.maximized: Option<Tab>` (main.rs:326) and the `if let Some(mut tab) = self.maximized.clone()` branch of `ui()` (main.rs:1589-1602) already draw a single `Tab` through `tab_ui` (main.rs:1689-1725) with an Esc/"back to the layout" exit guarded against terminals and editors (main.rs:1593-1595). Removing egui_dock is therefore mostly **deleting the `else if let Some(mut dock)` branch (main.rs:1603-1647) and its persistence**, not building a new hosting system. Do not rewrite `tab_ui` or the pane bodies.
2. **ide.rs should be left in place as the "Files" tool, mined for patterns, and not extended into the new canvas.** Its surface is one folder deep, fixed-size cards (`CARD` const, ide.rs:25), positions kept in synced app state not in files (`CARD_KEY`, ide.rs:2049), no nesting, and it is entangled with terminals, builds and servers (`Ide` has ~50 fields, ide.rs:122-212). Extract only three pure pieces (wikilink parser, card chrome, zoom math) and build the vault canvas as a new module beside it.
3. **Vault logic must be pure and headless; egui must be a thin view.** The repo's own precedent is `crates/canvas` (glam only, `tree-check` bin). Put the vault model, layout math, link grammar, index, proposal scoring, history and provider-response parsing in a new egui-free crate (`crates/vault`) so they are unit-testable with `cargo test -p`, which is the milestone's hard gate.
4. **One writer.** Today three code paths write the same `.md` files independently (`Notes::save` notes.rs:166, `Ide::editor` save ide.rs:1770, highlight `Notes::add` notes.rs:119). The vault canvas adds card drags (frontmatter), inline editing, anchor insertion, link creation and source-card creation. All of those must funnel through a single `VaultStore` writer or the frontmatter-preservation guarantee (D-04) cannot hold.
5. **Hidden couplings the shell swap will break if not handled** (details in section 6): `App::keyboard` (Space, digits, Delete, Cmd-Z hit the sim, main.rs:541-601), `run_clock`/`take_shot` assume the sim is always visible (main.rs:606, 1727), `Marks` pane keys are `format!("{tab:?}")` strings persisted in marks.jsonl (main.rs:1695), `ide.reveal_files`/`open_requests` are dock instructions (main.rs:1629-1650), and `synced["layout"]` serializes `DockState` (main.rs:261-267).
6. **Knowledge-tree replay needs data that does not exist yet.** Plain Markdown links carry no timestamps. Either start an append-only journal in Phase 1 (recommended) or replay will have to be reconstructed from mtimes/git later. The journal write path must exist before the first user-visible link is created.

---

## 2. Recommended Architecture

### System overview

```
                          apps/canvas  (tapestry-canvas-app, bin, egui)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ main.rs  App  (orchestrator only: owns state, routes Actions, runs frame)    │
 │                                                                              │
 │  shell.rs ───────────────┐   host: Option<Tab>   (None = vault canvas)       │
 │   ├ Palette (Cmd-K)      │   Esc stack, explorer window, top strip           │
 │   ├ Explorer (egui::Window)                                                  │
 │   └ Action enum ◄────────┘   (palette/explorer return Actions, never mutate) │
 │                                                                              │
 │  VIEWS (draw + input only)                                                   │
 │   space/ (vault canvas)   graph_view.rs (knowledge tree)   proposals_panel.rs│
 │   tab_ui() ─► existing tools, unchanged: sim canvas+brushes+timeline,        │
 │               rules, ide.files_ui, ide.terminals_ui, notes, ide.editor_ui    │
 │                                                                              │
 │  vault_host.rs  Vault handle: snapshot Arc, cmd Sender, status flags         │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │  WORKERS (std::thread + mpsc + ctx.request_repaint(), no async runtime)      │
 │   io worker        embed worker         research worker      proposal worker │
 │   scan/poll/write  chunk+vectorize      debounce→providers   score+dedupe    │
 └───────────────▲───────────────────────────────▲──────────────────────────────┘
                 │ uses                          │ uses
 ┌───────────────┴───────────────────────────────┴──────────────────────────────┐
 │ crates/vault  (tapestry-vault, NO egui, NO network, deps: glam/serde_json)   │
 │  frontmatter  blocks  links  layout(World, Camera)  index  store(cmds)       │
 │  journal/history  proposals(scoring)  graph_layout  providers::parse (pure)  │
 └──────────────────────────────────────────────────────────────────────────────┘
                 │ reads/writes
        <vault>/**/*.md   <vault>/.tapestry/{journal.jsonl,rejected.jsonl,research.json}
        ~/.local/state/tapestry/{shell.json,marks.jsonl,synced.json}   (local UI state)
        ~/.cache/tapestry/models/potion-base-8M   (existing embedder cache)
```

### Why a crate and not only modules

`crates/canvas` (3.7k lines, glam only, own `tests.rs`, `tree-check` bin) is the proven pattern: sim logic testable without a window. `apps/canvas` is a bin-only crate (Cargo.toml `[[bin]]`), tests there run but nothing is reusable or runnable headless. A `crates/vault` lets a `vault-check` bin round-trip a fixture Obsidian vault in CI-style `cargo test`. Workspace members are `crates/*` so adding it needs no root edit. If the roadmap insists on fewer crates, keep identical boundaries as `apps/canvas/src/vault/` with a hard rule "nothing under vault/ imports egui or ureq".

### Component boundaries

| Component | Responsibility | Owns | Talks to | Must NOT |
|-----------|----------------|------|----------|----------|
| `vault::frontmatter` | Split `---` block; read and **surgically patch** scalar keys (`x y w h created found_from source …`) by editing only matching lines; keep unknown keys, comments, order, CRLF, BOM | text transforms | store, index | Parse-and-reserialize YAML (loses comments and ordering) |
| `vault::blocks` | Find/allocate Obsidian `^id` anchors (line-end ` ^id`, or own line after a blank for multi-line blocks); id charset `[A-Za-z0-9-]`; unique per file | anchor table per note | links, store | Insert anchors for proposals (only on keep) |
| `vault::links` | Parse `[[T]]`, `[[T#H]]`, `[[T#^id\|desc]]`, `![[T]]`, skipping code fences/inline code; resolve a target to a note (Obsidian shortest-unique-name, then folder-qualified); render a link back to text | `Link{target, anchor, desc, span}` | index, ide (shared parser) | Duplicate the parser (ide.rs:1889 becomes a caller) |
| `vault::layout` | Pure geometry: `FolderPath`, deterministic top-level region from path hash, sub-world placement and scale, `Camera{focus,pan,zoom}`, `to_screen/from_screen`, re-origin on zoom threshold, LOD decision, `place_near(rect, occupied)` | no I/O | space view, research (placement), graph | Use f32 world coordinates across depths (use f64 local coords per folder) |
| `vault::index` | Immutable `VaultIndex` snapshot: notes by rel-path, `NoteMeta{title, folder, frontmatter rect, blocks, outlinks, chunks, created, mtime, body_hash}`, backlinks, folder tree, name→paths resolution table, `generation: u64` | the model | everything read-only | Hold file handles or do I/O |
| `vault::store` | The single writer: `enum VaultCmd` (CreateNote, SetRect, SetFolderPos, WriteBody, InsertAnchor, AddLink, CreateSource, DeleteNote, Rename) → atomic temp+rename writes, journal append, own-write echo suppression | `.md` mutations | io worker | Be called from two threads with different logic |
| `vault::journal` | Append-only `.tapestry/journal.jsonl` events `{t, kind, path/ids}` and a replay reducer to graph-at-time-t; backfill from `created`/mtime on first scan | history | store, graph | Be required for opening a vault (missing journal = backfill) |
| `vault::proposals` | Scoring: embedding similarity at chunk level, citation edges from source frontmatter, dedupe against existing links and `rejected` set; yields `Candidate{from_note, from_block_text, to_note, why, score}` | pure functions | proposal worker | Write descriptions (D-07) |
| `vault::graph_layout` | Deterministic incremental force layout seeded from path hash; folder clustering | positions | graph_view | Run per frame on the full graph |
| `vault::providers` (parse half) | Pure functions turning OpenAlex/arXiv/Wikipedia/Tavily/DDG response bodies into `Hit`; trait `Provider` lives here, HTTP impls in app | fixtures | research worker | Perform I/O (keeps fixtures testable) |
| `apps/canvas/src/vault_host.rs` | Owns the worker threads and channels; exposes `snapshot() -> Arc<VaultIndex>`, `send(VaultCmd)`, `status()` | threads | everything in the app | Reach into egui widgets |
| `apps/canvas/src/space/` | The infinite canvas view: camera input, card draw/hit-test/drag/resize/inline edit, edges with line anchors, sub-world LOD, link-drawing gesture | per-view UI state | `vault_host`, `cards.rs`, `shell` Actions | Write files directly |
| `apps/canvas/src/research.rs` | Research worker: topic-shift debounce, budget, provider chain with `ureq::Agent`, emits `ResearchEvent` | thread + budget file | `embed.rs` (cloned handle), `vault_host` | Edit the user's note body |
| `apps/canvas/src/proposals_panel.rs` | Candidate list UI with keep (reveals a description field) / turn down | UI state | `vault_host` | Reuse `swarm::proposals_ui` unmodified (it is typed to `tapestry_canvas::Proposal`, swarm.rs:297) |
| `apps/canvas/src/graph_view.rs` | Knowledge-tree view + scrubber | view state | `vault_host`, `vault::graph_layout`, `vault::journal` | Use the sim `Timeline` |
| `apps/canvas/src/shell.rs` | `host`, Esc layering, `Palette`, `Explorer`, top strip, `Action` enum, persisted `shell.json` | UI chrome state | `main.rs` (executes Actions) | Know about sim internals |
| `apps/canvas/src/cards.rs` | Extracted pure draw helpers from ide.rs (`card_frame` ide.rs:2026, `draw_card` chrome ide.rs:1909) parameterized by style | draw fns | space, ide | Hold state |
| `main.rs` (existing) | Sim canvas, brushes, rules, timeline bar, mimic swarm hookup, frame loop | existing | all | Gain vault logic |
| `ide.rs` (existing) | Files tool, terminals, editors | existing | `sync`, `server`, `term` | Be refactored beyond 3 extractions |

### Recommended file layout

```
crates/vault/                      NEW  tapestry-vault (glam, serde, serde_json)
  src/lib.rs
  src/{frontmatter,blocks,links,layout,index,store,journal,proposals,graph_layout}.rs
  src/providers/{mod,openalex,arxiv,wikipedia,tavily,ddg}.rs   (pure parse + trait + Hit)
  src/bin/vault-check.rs           headless: scan a folder, print stats, round-trip every note
  tests/fixtures/obsidian-sample/  hand-made notes: comments in frontmatter, lists, CRLF, ^ids, folder notes
apps/canvas/src/
  main.rs            (edit: mods, App fields, ui() body, delete dock branch)
  shell.rs           NEW  Shell{host,palette,explorer}, Action, persisted shell.json
  palette.rs         NEW  Palette, command registry, fuzzy match
  explorer.rs        NEW  tree from VaultIndex
  vault_host.rs      NEW  threads, channels, snapshot
  space/{mod,camera_input,cards,edges,link_gesture,subworld}.rs   NEW  vault canvas
  cards.rs           NEW  extracted chrome
  research.rs        NEW  worker + ureq providers + budget
  proposals_panel.rs NEW
  graph_view.rs      NEW
  embed.rs           (edit: Embedder becomes Clone; add raw 256-d + per-chunk API)
  ide.rs             (edit: import links parser; import cards.rs; nothing else)
  swarm.rs           (untouched)
  notes.rs           (untouched; legacy world/notes inbox)
```

Naming warning: the existing `fn canvas` / `Tab::Canvas` is the **particle sim**. Call the new thing `space` in code and "canvas" only in user-facing text; label the old one "Sim" in the palette so grep, Debug strings and conversation do not collide. Keep the `Tab::Canvas` variant name though (see section 6, marks keys).

---

## 3. How ide.rs relates: extract, do not extend, do not replace

| Question | Answer | Evidence |
|----------|--------|----------|
| Extend ide.rs `surface()` into the vault canvas? | **No.** | Entries come from `read_dir` of one folder (`relist` ide.rs:698); fixed `CARD` size (ide.rs:25, rects at 1019); positions in `Synced` under `card:` keys (ide.rs:665-669, 2049); `go()` swaps the whole view per folder (ide.rs:615); zoom hard-clamped to 0.35..2.5 (`zoom_at`, ide.rs:1493) which cannot express nested worlds; terminals anchor to cards (`place_terminals` ide.rs:1173) |
| Replace it? | **No.** D-02 requires the Files tool to keep working (code folders, terminals follow, builds). | `Kind::Code`, `Build`, `engine_changed` ide.rs:72-120, 873 |
| What to extract | (1) `wikilinks()` ide.rs:1889 into `vault::links` (ide calls `vault::links::targets(text)`, same `target before | or #` behaviour, so link curves at ide.rs:1033-1049 are unchanged); (2) the card chrome in `card_frame` ide.rs:2026 / `draw_card` ide.rs:1909 into `cards.rs`; (3) `zoom_at` math (ide.rs:1491-1495) into the camera used by both | Smallest diff that removes duplication |
| What to copy as a *pattern* | Draw-order hit-testing "last card under pointer is on top" (ide.rs:979-985); `moved` accumulated during iteration then applied after (ide.rs:1094-1099); **persist on drag stop only** (`dropped`, ide.rs:1100-1102) which matches D-04; Bézier curve for links (ide.rs:1038-1046); culling `r.intersects(rect)` (ide.rs:1057); eased focus-grow animation (`focused`, ide.rs:1589); `pan_to` glide for reveal (ide.rs:200) | Proven interaction feel; reimplement against the new camera |
| What not to copy | Laying out up to 2000 preview lines per card per frame (`read_entry` preview, ide.rs:1872; `draw_card` layout, ide.rs:2003) | Does not scale to hundreds of cards and deep zoom; truncate by LOD |

The Files tool and the vault canvas will both be able to show the same `.md` files. Policy: the vault index re-reads on mtime change (reload-if-clean, the existing rule in notes.rs:99-106); the Files editor keeps its own `Buffer` (ide.rs:93). Accept last-writer-wins for the rare case both are open on one note; log it as a known edge, do not build a shared buffer registry in this milestone.

---

## 4. Re-hosting existing panes in the palette without breaking them (egui_dock removal path)

### Strangler sequence (each step keeps `cargo build/test -p tapestry-canvas -p tapestry-canvas-app` green)

1. **Add Cmd-K that sets `maximized`.** The host already works. This lands the palette with zero removal risk and proves Esc layering. (Today `maximized` is also set by tab double-click/context menu, main.rs:216-226.)
2. **Rename intent, not identifiers.** Keep `enum Tab` and its variant names (main.rs:153-162). `tab_ui` builds the marks pane key from `format!("{tab:?}")` (main.rs:1695) and the label from the lowercase debug string; marks.jsonl stores that key, so renaming `Canvas`→`Sim` orphans every saved mark. Add variants (`Space`, `Graph`) rather than renaming. Drop only the serde derive when `Panes` goes.
3. **Make the vault canvas the base layer**: `host: Option<Tab>`; `None` draws `Space`. Move the field from `maximized` to `shell.host` (or alias it) and keep `TAPESTRY_FILL=<tab>` working as the startup host (main.rs:398-404) since it is the existing screenshot entry point; add `TAPESTRY_VAULT=<dir>` and `TAPESTRY_TOOL` alias.
4. **Compose the Sim tool.** Brushes (main.rs:704), canvas (main.rs:1346) and timeline bar (main.rs:1080) are three dock panes that only make sense together. Host them as one full-window composite using plain panels: `Panel::left` brushes, `Panel::bottom` timeline, central = `self.canvas(ui)`; palette entries "Sim", "Brushes", "Timeline" all open that composite. `canvas()` already computes its own `sheet` rect from `ui.available_rect_before_wrap()` (main.rs:1347-1350) so it adapts to any container. Rules (`self.notes`), Files (`ide.files_ui`), Terminals (`ide.terminals_ui`), Notes (`notebook.ui`) and `Tab::File(path)` (`ide.editor_ui`) each become a full-window tool via the existing `tab_ui` arms (main.rs:1699-1724). **No pane body changes.**
5. **Translate dock instructions.** `ide.open_requests` ("own tab", ide.rs:1648) becomes `host = Tab::File(path)`. `ide.reveal_files` (set at ide.rs:1274, 1288, 1336, 1475, 1482 when a terminal opens or is followed) becomes `host = Tab::Files`; the code at main.rs:1648-1650 already does the inverse for maximized Terminals, so the precedent is in place.
6. **Delete**: `default_layout` (164), `Tabs`/`TabViewer` (175-235), `Panes` + `shared_tab/local_tab/forget_rects` (258-300), `take_panes`/`panes`/`save_layout` pane half/`take_synced` pane half (462-539), `LAYOUT_EVERY` use for panes, the dock branch of `ui()` (1603-1647), the `panes_travel_without_this_screen` test (1913-1943), the `egui_dock` dependency (Cargo.toml) and the `egui_dock` imports (main.rs:29-30). Keep `save_layout`'s non-pane work: `ide.remember_view()`, `ide.synced.write()`, window.json (main.rs:517-526). Leave the old `layout` key in `synced.json` alone (ignored; deleting it is a sync write).

### Behavior changes that need explicit handling

| Hidden coupling | Where | Handling |
|-----------------|-------|----------|
| Sim hotkeys fire globally: Space toggles play, 1-7 pick brushes, Delete removes the selected keyframe, Cmd-Z undoes the timeline | `App::keyboard` main.rs:541-601, called every frame at main.rs:1585 | Gate: call only when `host` is the Sim composite (or Timeline). Otherwise typing "1" or pressing Delete while on the vault canvas would edit the sim. |
| Sim advances every frame whether visible or not | `run_clock` main.rs:606-624 (requests repaint every frame while playing) | Skip `run_clock` when the Sim is not hosted; keep `reload_rules` (main.rs:1572-1575) and `reread_by_meaning` running |
| `TAPESTRY_SHOT` captures when `timeline.tick() >= at` | `take_shot` main.rs:1727-1735 | If host is not Sim, tick never advances and the screenshot hangs. Trigger by frame/time count when not on Sim, or force `run_clock` in shot mode. Screenshots are how the agent does visual checks (PROJECT.md Autonomy), so this is not optional. |
| Terminals must keep running and syncing while hidden | `ide.begin_frame` (main.rs:1579) runs every frame; PTY reader threads are independent of drawing (term.rs:152); `term_drawn/term_visible` already model "pane hidden" (ide.rs:178, 296) | Keep `begin_frame` unconditional. `follow()` (ide.rs:1228) only runs inside `files_ui`, so a terminal only drives the Files view while Files is hosted: acceptable. |
| Keyboard routing to terminals | `keyboard()` returns early when `terminal_active()` (main.rs:543); `term.take_input` consumes events (ide.rs:1666) | Intercept Cmd-K with `ctx.input_mut(|i| i.consume_key(COMMAND, K))` at the very top of `ui()` (or in `raw_input_hook`, main.rs:1563) **before** any pane, otherwise a focused terminal eats it |
| Esc has five owners today (mark brush, selected keyframe, rule editor, files focus, maximized) | main.rs:560, 1593, 927-940; ide.rs:1641 | Define one precedence in `shell.rs`: palette open → close palette; else text field focused / terminal active / `ide.has_focus()` → leave Esc to them (the guard at main.rs:1593-1595 verbatim); else if `host.is_some()` → `host = None`; else canvas-local (deselect, cancel link gesture). Note `Marks::intercept` already swallows Esc while "draw anywhere" is on (marks.rs ~L125). |
| Marks overlay needs panes registered per frame | `marks.pane(key, rect, label)` in `tab_ui` (main.rs:1695); `keep_clear` for UI that must stay clickable (main.rs:1588, 1658, 1697) | Call `marks.pane("Space", rect, "vault canvas")` from the vault view, and `keep_clear` the palette rect, explorer rect and top strip. Marks are stored as offsets from the pane's top-left (marks.rs Mark.points), so on an infinite canvas they will not follow pan/zoom: document as known, or disable `anywhere` drawing on Space. |
| Highlight "+" and green-select tab notes write via `notebook.add` | main.rs:1655-1665 | Leave as is this milestone (D-02: they keep working into `world/notes`). Optional later: route to `VaultCmd::CreateNote` in the current folder. |
| Persisted pane layout is synced across computers | `synced["layout"]` (main.rs:455, 514); `take_synced` (main.rs:530) | Replace with local `shell.json` (explorer rect/open, last vault path, last host). It is screen-specific so it should not sync. `sync.rs` `key_of/path_of` (sync.rs:171-178) are available if last-vault should travel; recommend not. |

### Explorer and palette specifics

- **Explorer**: build as an `egui::Window` (`.resizable(true).collapsible(false).open(&mut open)`) anchored left, rect persisted in `shell.json`. This satisfies D-01's "dragged, resized and closed" literally with no custom chrome. Fallback if the floating feel is wrong: `Panel::left(..).resizable(true)` (egui 0.36 `Panel` is already used at main.rs:1587) which loses "dragged". Flag D-01's wording for a one-line confirmation in the shell phase (record in `.context/HUMAN-QUESTIONS.md`, do not block).
- **Palette**: `Palette::ui(ctx, &VaultIndex, &Registry) -> Option<Action>`. `enum Action { OpenTool(Tab), GoToNote(NotePath), GoToFolder(FolderPath), NewNote, OpenVault(PathBuf), ToggleExplorer, Graph, … }`. It never mutates `App`; `main.rs` matches the returned Action. Notes in the index double as quick-switch results. Fuzzy match is a ~40-line subsequence scorer; no crate needed. Render as `egui::Area` at `Order::Foreground` (same approach as tabnote.rs `tab`, which uses `Area` + `Order::Foreground`).
- **Open any folder** (D-11): there is no `rfd`/native dialog dependency in Cargo.lock. Reuse the existing pattern: a path text field (`path_input`, ide.rs:130, 742) inside the palette command "Open vault…". Defer a native picker.

---

## 5. Vault canvas (`space/`) design

### Coordinates and nesting (the part most likely to go wrong)

- **Folder-local coordinates, f64.** A note's frontmatter `x,y,w,h` are in *its folder's* local space. A folder's own origin in its parent is a separate value, so moving a folder rewrites only `Folder/Folder.md` (D-05) and never every child note.
- **Top-level regions**: a fixed-size plot per top-level folder on a large lattice. Cell = `hash(path) mod LATTICE²`, on collision rehash with a counter in lexicographic path order. The position depends only on the path (plus collisions among siblings), so adding an unrelated folder normally moves nothing. Unit-test: stable under insertion, deterministic across runs and machines (use an explicit hash such as FNV-1a or the repo's `splitmix`, embed.rs:134, never `DefaultHasher`, which is not stable across releases).
- **Sub-worlds**: child local space is the parent's space scaled by `SUB_SCALE` (e.g. 0.25 per level). Its spot in the parent is `hash(subpath)` into a reserved band of the parent's space (so it does not depend on where cards currently are, which would make it jump as cards are added). Document that cards must not be created inside a sub-world rect (UI refuses/nudges on create and drag-drop). If moved by the user, `x,y` go into `Sub/Sub.md`.
- **Camera = `{focus: FolderPath, pan: DVec2, zoom: f64}`** expressed in the focus folder's local space. Zoom-to-fill (D-05) = when a child frame covers more than ~85% of the viewport, `normalize()` re-parents the camera into the child (and back up when zoomed out past a threshold). This keeps all numbers bounded at any depth, avoids f32 jitter, and makes "a whole canvas at a smaller world scale" literally true. Property tests: `from_screen(to_screen(p)) == p` across every re-origin; zoom in then out returns the original camera.
- **Folder note**: `Folder/Folder.md` is the frame's header note (title, description, position). Exclude it from the card set, include it in link resolution and the graph.

### Rendering

- Painter-based cards with fonts scaled by zoom, as ide.rs does (`title(17.0 * z)`, ide.rs:1951), not `egui::Scene`: egui 0.36's own docs say text goes blurry when zoomed in (scene.rs:110, egui issue 4813) and Scene's default zoom range tops out at 1.0.
- Inline editing: only the one card being edited is a real `egui::TextEdit`, put in a child `Ui` at the card's screen rect with the font size multiplied by zoom (follow the `crate::edit::keys(ui, id, &mut text, comment)` call pattern, edit.rs:21, as notes.rs:232 and ide.rs:1757 do). Autosave on pause using the existing `AUTOSAVE = 0.4` rule (notes.rs:17, 285-290), writes via `VaultCmd::WriteBody`.
- **LOD ladder**: (a) tiny → dot + folder cluster, (b) small → title only, (c) normal → title + first N chars, (d) zoomed → full body with line anchors. Sub-worlds render contents only when their frame is larger than a threshold, clipped with `painter.with_clip_rect(frame)`.
- **Line-anchored edges**: an edge's source Y is the screen Y of the anchored line inside the card's galley (`galley.pos_from_cursor`/row rects), falling back to the card's edge at low LOD. This needs the card body laid out at LOD (c)/(d) only. Quantize font sizes to ~0.5 pt steps while zooming to avoid thrashing the glyph atlas.
- **Edge kinds**: `Written` (solid, has description label), `FoundBy` (dashed, derived from the source note's `found_from` frontmatter), `Proposed` (ghost). Cross-folder edges draw from the card to the target's position transformed through both folders' transforms.

### Write rules (D-04)

- Position/size: `SetRect{path,x,y,w,h}` emitted on `drag_stopped()` / resize end only (the ide.rs `dropped` pattern, ide.rs:1100). Per-frame drag updates a transient in-memory override in `space`, not the index.
- A no-op write (values equal after rounding to 1 decimal) is skipped, so merely clicking a card never dirties the file or bumps mtime (important for Obsidian sync and for git-diff hygiene).
- `store` patches only lines for `x y w h` (and appends them if absent), leaving every other byte intact. Fixture-test with comments, nested lists, `tags:` arrays, CRLF, no frontmatter, empty frontmatter, and a frontmatter that Obsidian wrote with quoted values.

---

## 6. Data flow

### Read path (disk → pixels)

```
disk *.md ─(io worker: walk + mtime/size poll ~1s, no `notify` dep in lockfile)─►
  parse frontmatter + blocks + links per changed file ─► build new VaultIndex (Arc<NoteMeta> reuse) ─►
  publish: *snapshot.lock() = Arc::new(index) ; generation += 1 ; ctx.request_repaint()
UI each frame: let idx = vault.snapshot();  (Arc clone, O(1))
  explorer / palette / space / graph read idx; redraw caches keyed on idx.generation
```

The repo already uses this thread + `Arc<Mutex<_>>` + `ctx.request_repaint()` shape (embed.rs:44-66, ide.rs `watch_servers`/`servers` ide.rs:157), and polls at 0.5 s (main.rs:1572, notes.rs:19). Follow it; do not add tokio.

### Write path (UI → disk)

```
UI gesture ─► VaultCmd ─► vault_host.send() ─► io worker (store):
   atomic write (tmp + rename) ─► journal.append(event) ─► record (path, hash) as "own write" ─►
   apply to a new snapshot immediately (optimistic) ─► next poll sees same hash, skips
```

Own-write tracking prevents the poll from treating the app's own save as an external edit, which would reload open card editors and fight the typist. For an open editor, reuse notes.rs's rule: take disk content only if the editor is clean (notes.rs:99-106; main.rs:1047-1053 same rule for rules).

### Embeddings

```
index change (body_hash differs) ─► embed worker ─► chunk note into paragraphs (blank-line split, keep line ranges)
  ─► Embedder::raw(text) -> Vec<f32> (256-d) ─► store in `Arc<RwLock<HashMap<(NotePath, chunk_hash), Vec<f32>>>>`
```

Required changes to `embed.rs`: make `Embedder` `Clone` (it is only `Arc<Mutex<Status>>`, embed.rs:34-36) so worker threads can hold a handle; add `raw(&self, text) -> Option<Vec<f32>>` returning the model's native 256-d vector. The existing `vector()` (embed.rs:102-108) returns the **128-d random-projection** (`project`, embed.rs:113; `N = 128`, mind.rs:17) built for the swarm and loses fidelity, so proposals should not use it. When the model is not ready or failed, fall back to `tapestry_canvas::note_vector` (the app already does this at main.rs:667-670) and tag the vector kind so the two never get compared. The mimic swarm keeps using `vector()` via `read_texts` (main.rs:662); change only its *source* from `notebook.all()` to `(rel_path, title, text)` tuples from the index (the signature already takes tuples). Use vault-relative path as the mimic's note name so identical titles in two folders do not collide.

### Research (D-08, D-09)

```
UI edit of note N ─► Edited{path, text, caret_block, t} (latest-wins channel)
research worker loop (recv_timeout):
   idle >= DEBOUNCE ─► topic = keywords(active paragraph) + embedding
   cosine(topic, last_searched_topic) < SHIFT ─► query
   budget.check() ─► if exhausted: status = OutOfSearches (shown in UI), stop
   provider chain: OpenAlex → arXiv → Wikipedia → Tavily(if key) → DuckDuckGo   (fallback on RateLimited/Exhausted/Network)
   ─► Hit{title, url, abstract, authors, year, ids, cited_ids}
   ─► ResearchEvent::Found{hit, origin:(note, block)} over mpsc ─► UI thread ─► VaultCmd::CreateSource
```

- Results come back to the **UI thread / single store**, not written from the worker, so there is exactly one writer.
- `CreateSource` writes a normal `.md` note placed with `layout::place_near(origin_card_rect, occupied)` with frontmatter such as `source: openalex`, `url:`, `openalex: W…`, `cites: [W…]`, `found_from: "[[Note#^id]]"`, `x/y/w/h`.
- **Linked from the line that prompted them (D-08) without editing the user's body**: the connection is stored on the *source* note (`found_from`) and drawn as a `FoundBy` edge; the user's text is never touched by the worker, which avoids edit races while typing and respects D-07 (no app-written descriptions). To make it a real described link the user promotes it through the same keep flow as proposals. Confirm this reading of D-08 in the research phase.
- Budget (`daily cap`, per-provider counters) persists in `<vault>/.tapestry/research.json` (or the local state dir if the vault must stay clean); surfaced as `ResearchStatus::{Idle, Searching, OutOfSearches{resets_at}}`.
- HTTP: `ureq` 3 agent with explicit timeouts, pattern at server.rs:107 (`fn agent`) and `apps/dungeon/src/ai.rs`. OpenAlex wants a `mailto` polite-pool parameter; arXiv returns Atom **XML** and DuckDuckGo returns **HTML**, and neither a XML nor HTML parser is in Cargo.lock (only `walkdir`, `time`); decide in STACK whether to add `quick-xml`/`scraper` or write tiny extractors against fixtures.

### Proposals (D-07)

```
index generation / new embeddings / new source notes ─► proposal worker:
   embedding: for each changed chunk, nearest chunks in other notes, above THRESH, not already linked either way,
              not in rejected set ─► Candidate{from_note, from_chunk(line range), to_note, why:"both say …", score}
   citations: source note S1 `cites` contains id of source note S2 present in vault ─► Candidate(S1→S2) ; and note→source via found_from chain
   ─► Arc<Vec<Candidate>> published with generation ─► proposals_panel
User: "keep" ─► description field appears (required, non-empty, typed by user)
      ─► VaultCmd::InsertAnchor (if the from-line has no ^id) + VaultCmd::AddLink{from_note, anchor, to, desc}
      "no"  ─► append `.tapestry/rejected.jsonl` (pair + chunk hash) so it never returns
```

- Never insert an anchor or touch a file for an unaccepted proposal.
- Keep this **separate from the swarm's proposals**: those live inside the sim `Timeline` as `Body::Verdict` keyframes (timeline.rs:287, mimic.rs:229-277), are keyed by note name, and are replayed deterministically. The vault's decisions live in the vault (`rejected.jsonl` plus real links). `swarm::proposals_ui` (swarm.rs:297) is hard-typed to `tapestry_canvas::Proposal` and a `texts` map, and has no description field; write `proposals_panel.rs` with the same look and leave swarm.rs untouched. Optional follow-up: pull the shared row drawing into a helper.
- O(n²) chunk comparison is fine to a few thousand chunks on a worker (256-d dot products); beyond that, restrict to changed chunks against all (O(n) per edit). No ANN index in this milestone.

### Timeline / history / knowledge tree (D-10)

```
store events (create note, add link, create source, keep) ─► .tapestry/journal.jsonl (append-only)
first open of a vault with no journal ─► backfill: note created = frontmatter `created` else file birth/mtime; links get their note's time
index diff of external edits (Obsidian, git) ─► journal event at first-seen time
graph_view: events ─► reducer(t) = {nodes, edges} ; layout computed ONCE on the full graph (deterministic, seeded by path hash)
  scrubber t ─► show nodes/edges with t_event <= t (positions fixed, so growth does not jitter) ; live mode = t = now, follows index generation
```

- This mirrors the repo's own principle, "store inputs only; state is replay" (crates/canvas/src/lib.rs header), but do **not** reuse `tapestry_canvas::Timeline` (sim-specific `Body` enum, tick-based, key.rs). The scrubber *widget* idea (timeline_bar main.rs:1080-1344) is coupled to `App` fields (`self.timeline`, `self.drag`, `self.selected`), so write a small standalone scrubber in `graph_view.rs`.
- Journal location: `<vault>/.tapestry/` is a dot folder, which Obsidian hides and ide.rs skips (`name.starts_with('.')`, ide.rs:708). It should be git-ignored by default or committed deliberately; decide in phase 6 planning.

---

## 7. Patterns to follow

### Pattern 1: Views return intents; `App` executes them
**What:** `Palette`, `Explorer`, `Space`, `ProposalsPanel` take `&VaultIndex` (read-only) and return `Vec<Intent>`/`Option<Action>`; `main.rs` is the only place that turns intents into `VaultCmd`s or host changes.
**When:** every new UI module. Matches how `swarm::proposals_ui` returns `Option<(a, b, keep)>` and `App::canvas` applies it (main.rs:1517, 1556).
```rust
// shell.rs
pub enum Action { OpenTool(Tab), GoToNote(NotePath), GoToFolder(FolderPath), NewNote, OpenVault(PathBuf), ToggleExplorer, ShowGraph }
pub fn palette_ui(ctx: &egui::Context, st: &mut Palette, idx: &VaultIndex) -> Option<Action>;
```

### Pattern 2: Immutable snapshot + generation counter
**What:** workers publish `Arc<VaultIndex>`; the UI clones the Arc once per frame and caches derived data (layouts, LOD lists, galleys) by `generation`.
**When:** anything read by both UI and workers.

### Pattern 3: Pure core, effectful shell
**What:** every decision (where does this folder live, which anchor id, what changes in this file, which candidate pairs) is a pure function in `tapestry-vault` taking and returning plain data; effectful code only moves bytes. Test the core with fixtures; test the shell with `TAPESTRY_SHOT`.

### Pattern 4: Surgical text patching for user-owned files
**What:** edit the exact lines you own and copy the rest byte-for-byte. Return `Option<String>` (None = no change) so callers can skip identical writes.

### Pattern 5: Debounced, latest-wins channels for typing-driven work
**What:** the research worker consumes only the newest `Edited` message (`try_iter().last()`), then waits out the debounce window, so a fast typist cannot queue searches.

---

## 8. Anti-patterns to avoid

### Anti-pattern 1: Parse-and-reserialize YAML
**Why bad:** loses comments, key order and quoting; violates "unknown keys preserved" and makes Obsidian users' files churn. No YAML crate is in Cargo.lock anyway.
**Instead:** line-based patching of known keys; if a real parse is needed to *read* exotic values, use a tolerant reader, never for writing.

### Anti-pattern 2: Writing per frame or on every pointer move
**Why bad:** thrashes mtime, triggers Obsidian sync and git noise, and violates D-04 and the performance constraint.
**Instead:** `drag_stopped()` only; skip no-op writes; autosave only after the 0.4 s pause.

### Anti-pattern 3: Worker threads writing vault files
**Why bad:** two writers race with the typist and with each other; the "own write" echo logic cannot be centralized.
**Instead:** workers send events back; only `store` writes.

### Anti-pattern 4: Mutating the user's note body from background research
**Why bad:** edits land under the cursor, break undo, and imply app-authored link text (D-07).
**Instead:** store provenance on the new source note (`found_from`) and render it as an edge.

### Anti-pattern 5: Extending `Ide` or `App` with vault state
**Why bad:** `Ide` already has ~50 fields and `App` ~35; main.rs is 1.9k lines and shared with other sessions, so every extra edit multiplies merge conflicts.
**Instead:** new files, one field per subsystem on `App` (`shell`, `vault`, `space`, `research`, `graph`), minimal edits to main.rs (mod lines, fields, the `ui()` body).

### Anti-pattern 6: Single global f32 world with a clamped zoom for nested worlds
**Why bad:** depth × scale compounds, precision collapses, and "zoom into a folder fills the screen" becomes impossible to keep stable.
**Instead:** per-folder local f64 coordinates with camera re-parenting (section 5).

### Anti-pattern 7: Using `egui::Scene` for the infinite canvas
**Why bad:** blurry text at zoom-in (scene.rs:110), zoom range capped by default, and no hook for LOD or nested re-origin.
**Instead:** custom camera + painter, as ide.rs does.

### Anti-pattern 8: Reusing `Embedder::vector()` for similarity
**Why bad:** it is a lossy 128-d random projection tuned for swarm behavior (embed.rs:12-13, 113-127).
**Instead:** add `raw()`, keep `vector()` for the swarm.

---

## 9. Scalability considerations

| Concern | ~100 notes | ~2k notes | ~20k notes |
|---------|-----------|-----------|------------|
| Scan + parse | whole scan each poll is fine | stat-only poll, re-parse changed files | persistent index cache keyed by mtime (defer) |
| Card draw | all visible | cull by rect + LOD ladder; truncate bodies | LOD to dots/clusters; sub-world contents only if frame is large |
| Proposals | brute force chunk pairs | changed-chunks × all | needs ANN or folder-scoped candidate sets (out of scope) |
| Graph view | live force layout OK | layout once + incremental on change, cluster by folder | precomputed positions, edges LOD, hide labels |
| Embeddings | compute on demand | cache by chunk hash in memory | persist to `~/.cache/tapestry/` |
| Repaint | event-driven + 0.5 s tick (main.rs:1577) | same | same; avoid per-frame full-index work |

---

## 10. Suggested build order (dependency-driven)

Aligned with the brief's six phases, with the architecture-driven adjustments in bold.

| # | Phase | Build (in order inside the phase) | Depends on | Why this position |
|---|-------|-----------------------------------|-----------|-------------------|
| 1 | **Vault model** (`crates/vault`) | `frontmatter` (patch) → `blocks` → `links` (and make `ide::wikilinks` call it) → `layout` (hash regions, Camera, re-origin, tests) → `index` (scan) → `store` + atomic writes → **`journal` append (start recording now)** → `vault-check` bin + Obsidian-style fixtures. Also `Embedder: Clone + raw()` | nothing | Everything else reads this. Headless and test-only, so zero conflict with other sessions editing main.rs. Journal must start here or Phase 6 has nothing to replay. |
| 2 | **Shell** | Palette + Cmd-K via `maximized` (**step 1 of the strangler, section 4**) → `Shell`/Esc precedence → keyboard/run_clock/take_shot gating → Sim composite → explorer window → vault open/remember (`shell.json`) → base `Space` stub that draws index cards read-only → delete dock, `Panes`, `egui_dock` dep | 1 (index for explorer/palette) | Ships the visible product shape early, keeps every tool reachable (D-02) at each commit |
| 3 | **Graph editing** | cards draw/hit/drag → `SetRect` on drag end → inline edit + autosave → create note → resize → link gesture + description field + `AddLink`/`InsertAnchor` → edges with line anchors → **nested sub-worlds + camera re-parenting + LOD** → cross-folder links → folder move (`Folder.md`) | 1, 2 | Largest phase. **Prototype the nested camera early** (first plan of the phase, behind a test), because it is the only place a late failure forces a rewrite of card drawing. |
| 4 | **Silent research** | provider trait + pure parsers against recorded fixtures → budget → worker + debounce/topic-shift → `CreateSource` + placement → `FoundBy` edges → status UI ("out of searches") | 1, 3 (placement, edges), `embed.raw` | Needs the canvas to show results, but the provider layer can start in parallel with phase 3 since it is pure |
| 5 | **Proposals** | chunk embeddings → candidate scoring → rejected store → panel with keep+description → citation edges (needs source notes with `cites` from phase 4) | 1, 3; citation half needs 4 | **Embedding-similarity half only needs 1 and 3, so it can ship before phase 4** if time presses. |
| 6 | **Knowledge tree** | graph_layout → live view over index generations → journal reducer → scrubber/replay | 1 (journal), 3 | Last because it is read-only over everything else; if the journal was started in phase 1 it already has history to show |

**Shared-tree sequencing notes:** edits to `main.rs` happen in phase 2 (large) and as small hookups later; claim `apps/canvas/src/main.rs` and `ide.rs` with `tools/claims/claim` for the duration of phase 2 and again for the ide.rs extraction in phase 1. New files carry no collision risk. Per PROJECT.md, commit with pathspecs and never touch `world/notes/*` (the working tree currently shows other sessions' notes staged and untracked there).

---

## 11. Integration points (quick index)

| Existing symbol | Location | Touch |
|-----------------|----------|-------|
| `enum Tab` | main.rs:152-162 | add `Space`, `Graph`; keep names; drop serde derive after `Panes` removed |
| `default_layout`, `Tabs`, `Panes`, `shared_tab`, `local_tab`, `forget_rects` | main.rs:164-300 | delete |
| `App.dock`, `App.maximized`, `App.panes_kept` | main.rs:324-326, 374 | replace by `shell` |
| `App::new` | main.rs:382-450 | add `vault`, `shell`; keep `TAPESTRY_FILL` mapping at 398-404 |
| `reopen`, `take_panes`, `panes`, `save_layout`, `take_synced` | main.rs:453-539 | delete pane halves, keep ide/window halves |
| `keyboard` | main.rs:541-601 | gate by host |
| `run_clock` | main.rs:606-624 | skip when Sim not hosted |
| `read_notes`, `read_texts`, `reread_by_meaning` | main.rs:654-702 | feed from index tuples |
| `canvas()` sim | main.rs:1346-1559 | untouched; hosted inside Sim composite |
| `ui()` | main.rs:1568-1681 | rewrite body: host or Space, shell chrome, overlays unchanged (1652-1668) |
| `tab_ui` | main.rs:1689-1725 | keep; add arms for `Space`, `Graph` |
| `take_shot` | main.rs:1727-1755 | decouple from sim tick |
| `Ide::wikilinks` | ide.rs:1889 | replace body with call into `vault::links` |
| `card_frame`, `draw_card` | ide.rs:2026, 1909 | move chrome to `cards.rs` |
| `Ide::zoom_at` | ide.rs:1491 | share math |
| `ide.open_requests`, `ide.reveal_files` | ide.rs:149, 202 | consumed by `Shell` instead of the dock |
| `Embedder` | embed.rs:34-109 | `Clone`, add `raw()` |
| `Notes` | notes.rs:55 | unchanged (legacy inbox + highlight target) |
| `proposals_ui` | swarm.rs:297 | untouched; new panel for the vault |
| `Marks::pane/keep_clear` | marks.rs:265, 270 | register Space pane, keep palette/explorer clear |
| `Synced` | sync.rs:33 | no new keys required; do not put vault layout here (D-04 says frontmatter) |

---

## 12. Open questions and phase-research flags

- **Phase 1:** Obsidian edge cases (block ids on list items and multi-line blocks, `[[Folder/Note#^id|desc]]` resolution when names are not unique, frontmatter written by Obsidian's Properties UI) need a short spike against a real Obsidian vault; the layout hash-collision rule needs a decision. *Likely needs targeted research.*
- **Phase 2:** D-01 wording ("dragged, resized and closed") = floating window vs docked panel; Sim composite as one tool vs separate Brushes/Timeline entries. Both low-risk, decide and log.
- **Phase 3:** Nested camera re-origin, LOD thresholds and line-anchor positions from galleys: *prototype first, needs deeper research/spike.* Whether moving a note across folders should rewrite inbound links (recommend deferring moves and keeping links name-based, since Obsidian resolves by shortest unique name).
- **Phase 4:** Free-tier limits and request shapes for OpenAlex/arXiv/Wikipedia/Tavily/DDG, XML/HTML parsing choice, and the exact reading of "linked from the line that prompted them". *Needs phase-specific research.*
- **Phase 5:** Similarity thresholds and chunking quality with potion-base-8M on real research notes (the existing `#[ignore]` model tests in embed.rs:175-241 are the template for measuring this).
- **Phase 6:** Journal vs git-derived history, and whether `.tapestry/` is committed.
- **Known accepted limitation:** a note open in both the Files editor and a card editor is last-writer-wins.

## Sources

- Source read directly (HIGH): `apps/canvas/src/{main,ide,notes,swarm,embed,marks,highlight,tabnote,sync,edit}.rs`, `crates/canvas/src/{lib,timeline,mimic,mind,text}.rs`, `apps/canvas/Cargo.toml`, root `Cargo.toml`, `Cargo.lock` (dependency presence), `.planning/PROJECT.md`, `.context/canvas-research-brief.md`.
- egui 0.36.2 source in the local cargo registry, `containers/scene.rs` (text blur on zoom, issue emilk/egui#4813) (HIGH).
- Design inference, not yet validated by prototype (MEDIUM): nested-camera re-parenting, journal-based replay, single-writer store, `egui::Window` explorer.
- Not verified against live docs (LOW until phase research): provider API limits and response formats for OpenAlex, arXiv, Wikipedia, Tavily, DuckDuckGo.
