# Pitfalls Research

**Domain:** Obsidian-compatible spatial research canvas, added to an existing Rust/egui (eframe 0.36, wgpu) app. The app writes plain-markdown vaults with YAML layout frontmatter, anchors links with Obsidian block refs, nests scaled sub-worlds, searches free APIs in the background, proposes connections from embeddings and citations, and replays vault growth.
**Researched:** 2026-10-21
**Confidence:** MEDIUM-HIGH. Provider limits and Obsidian syntax were checked against current official pages (tagged below). The egui and canvas-math items rest on the existing code plus domain knowledge. They are flagged where unverified.

Phase numbers: 1 vault model, 2 shell/explorer/palette, 3 graph editing + nested worlds, 4 silent research, 5 proposed connections, 6 knowledge tree.

## Where the existing code already sets traps

Checked in `apps/canvas/src`. These shape several pitfalls below.

- `main.rs:540-600` `keyboard()` handles Space (play/pause), Backspace/Delete (remove keyframe), digits 1-7 (brush select), arrows, Home and Cmd-Z globally. It is gated only by `egui_wants_keyboard_input()` and `ide.terminal_active()`. On a canvas full of editable note cards this gate is the only thing between typing "1" in a note and swapping brushes.
- Escape has at least six independent consumers: `main.rs:560`, `main.rs:933`, `main.rs:1593`, `notes.rs:267`, `ide.rs:1641`, `marks.rs:123`. All read `key_pressed(Escape)` in the same frame. One press can close the palette, stop a note edit and leave a full-window view at once.
- The "full-window view, Esc returns" mechanism already exists as `App.maximized` (`main.rs:1593`). Its Esc is gated by `!terminal_active() && !has_focus()`, so a terminal view cannot be left with Esc.
- `ide.rs:1889 wikilinks()` splits the link at `|` and `#` and discards everything after. It does not skip code spans or fences and does not parse `^id`. It cannot be reused for `[[Note#^id|desc]]`.
- `notes.rs` polls the notes folder every 0.5 s and reloads a note if it is "untouched since its last save". That is a stat storm on a large vault. It is also the only conflict logic, and it is not hash-based.
- `ureq` is already used with `http_status_as_error(false)` and `timeout_global` in `translate.rs:295`, with a worker thread plus `ctx.request_repaint()` (`translate.rs:244`). Follow this pattern for search.
- Terminals live in `Ide.terminals: Vec<Terminal>`, owned by the app and not by a dock tab. `Terminal` kills its child on `Drop` (`term.rs:570`) and learns its size only when drawn (`size: (0,0)` until drawn).
- `crates/canvas` uses glam f32. egui is f32 throughout.
- The repo is a shared worktree. `git status` already shows other sessions' staged `world/notes/*.md`.

---

## Critical Pitfalls

### Pitfall 1: Re-serializing frontmatter destroys the user's YAML

**What goes wrong:** The app parses frontmatter into a struct or map, updates `x/y/w/h`, and dumps it back. Comments, key order, quoting style, flow-style lists, blank lines and unknown-key formatting are lost or rewritten. Every drag produces a diff against the user's own properties, and Obsidian users see their frontmatter change.

**Why it happens:** `serde_yaml`-style round-trips are the path of least resistance. D-04 says "unknown keys preserved", which a map round-trip satisfies for values but not for formatting. `serde_yaml` is also archived/unmaintained (MEDIUM, from memory), so the choice of parser matters.

**How to avoid:**
- Treat the file as three byte regions: `frontmatter-raw`, `body-raw`, and delimiters.
- Parse frontmatter only to read values. Write by surgical line patch: find the top-level `x:`/`y:`/`w:`/`h:` lines and replace only their values (keep any trailing `# comment`). If a key is absent, insert a line just before the closing `---`.
- Never touch the body bytes on a layout write.
- Preserve BOM, CRLF vs LF, trailing newline and tab or space indentation.
- Fall back to full rewrite only when the frontmatter is structurally unparseable, and in that case refuse to write and surface a "can't place this card" state.
- Obsidian's own Properties editor rewrites the whole block and drops comments (declined bug, [forum thread](https://forum.obsidian.md/t/bug-using-the-properties-menu-deletes-yaml-comments-from-the-frontmatter/69048)). The app cannot be stricter than Obsidian, but it must never be the one that does it unprompted.

**Warning signs:** Golden-file test where a fixture note with comments, `tags:` as a block list, quoted strings and CRLF changes by more than the four layout lines. `git diff` on a vault after merely dragging shows extra changes.

**Phase to address:** 1. Make it an acceptance test with real Obsidian-authored fixtures (CRLF, comments, `aliases`, nested properties, `cssclasses`, dates, empty frontmatter, `---` used as a horizontal rule in the body).

---

### Pitfall 2: Loading or "normalizing" a vault writes to files the user never touched

**What goes wrong:** On open, the app adds frontmatter to every note so each has a position, or rewrites a note to add `^id` anchors. A 2,000-note vault turns into 2,000 modified files: git noise, iCloud/Dropbox conflict copies, Obsidian re-indexing, and other Claude sessions staging unrelated changes.

**Why it happens:** It is tempting to keep the model "always valid" by materializing defaults.

**How to avoid:** Reading is side-effect free. Unpositioned notes get a computed, deterministic placement held in an app-side cache, not written to disk. Write only on an explicit user act (drag end, resize end, keep a proposal, create a note). Existing `world/notes/*.md` have no frontmatter and must open unmodified. Add a test: open a fixture vault, assert zero mtimes changed.

**Warning signs:** Any `fs::write` reachable from the vault load path. `git status` non-empty after opening a vault.

**Phase to address:** 1 (model), verified again in 3.

---

### Pitfall 3: Two writers on one file (editor autosave vs layout write vs Obsidian)

**What goes wrong:** A note is open in the app's editor (`notes.rs` autosaves 0.4 s after typing). The user drags the same card. The layout writer patches frontmatter from a stale in-memory copy while the editor writes its buffer. Last writer wins and one edit is lost. The same race happens with Obsidian, git checkout, or Claude sessions editing files in the same folder.

**Why it happens:** Each feature owns its own "save" path and holds a full copy of the file text.

**How to avoid:**
- One `Vault` owner serializes every write. Edits are patches: `FrontmatterPatch` (layout) and `BodyEdit` (text). The editor buffer holds the body only.
- Every write is read-modify-write on fresh disk content: read the file, apply the patch to that, write atomically.
- Before applying, compare the file's content hash with the hash at last load or write. If the body changed externally while the editor is dirty, do not clobber. Keep the buffer, show "changed on disk", and let the user pick.
- Atomic write: temp file in the same directory, `fsync`, `rename`. Name the temp with a leading dot so Obsidian and sync tools ignore it, and clean up stale temps on startup.
- Writes that app logic generates inside a note body (inserting a `[[...]]` at the line that prompted research, adding `^id`) must go through the same `BodyEdit` path and be applied to the live buffer if the note is open.

**Warning signs:** Two code paths that both call `fs::write` on a note path. A test that drags a card while typing and checks both changes survived fails intermittently.

**Phase to address:** 1 (write API), 2 (editor integration), 4 (auto-inserted links).

---

### Pitfall 4: File watching loops and event storms

**What goes wrong:** The app writes a note, the watcher sees the change and reloads it, the reload is treated as a user change, and it writes again, endlessly. Or the watcher floods on `.obsidian/workspace.json` (Obsidian rewrites it every few seconds), `.git/`, `target/` or temp files. Or atomic-save renames are missed because only `Modify` events are handled ([background](https://docs.rs/notify-debouncer-full/^0.3)).

**Why it happens:** The only existing mechanism is a 0.5 s directory poll. Replacing it with `notify` brings FSEvents batching, ambiguous event types and rename-based saves.

**How to avoid:**
- Record `(path, content hash)` for every write the app performs. Ignore an event whose current content hash matches. Reload is a pure read and must never trigger a write.
- Debounce events per path (200-500 ms) and use `notify-debouncer-full` or equivalent for rename stitching. Treat Create/Rename/Remove as "re-stat this path", not as typed events.
- Skip dot-directories (`.obsidian`, `.git`, `.trash`), `node_modules`, `target`, and files not ending in `.md`.
- Round layout values before writing (integers or 1 decimal) and skip the write if the rounded value equals the on-disk value. This prevents float-noise churn (`100.00001`) and no-op writes.
- Keep the app's own state (cameras, caches, dismissed proposals, seen-source set, daily counters, event log) outside the vault, or under a dot-folder that watchers ignore. Do not create `.obsidian`.

**Warning signs:** CPU stays above idle with the window untouched. mtime of an unchanged note advances. The write counter increases with no user input.

**Phase to address:** 1 (hash and suppress), 2 (watcher replaces poll).

---

### Pitfall 5: `x/y/w/h` mean two things (D-04 vs D-05)

**What goes wrong:** D-04 puts a card's position in its note's `x,y,w,h`. D-05 stores a moved folder's position in `Folder/Folder.md` frontmatter. `Folder/Folder.md` is also a note inside the folder, so it is a card in Folder's own graph, and its `x,y` already mean "my card position inside Folder". A moved folder and its own folder-note card overwrite each other, or the folder jumps when you drag its note.

**Why it happens:** The same key names carry two coordinate spaces: the parent world and the child world. The brief does not separate them.

**How to avoid:** Use distinct keys for the folder's placement in its parent, for example `world-x`, `world-y`, `world-scale`, while `x,y,w,h` stay "card inside my own graph". Decide up front whether `Folder.md` renders as a card in its own graph (it can, with `x,y`) and document both. Also define units: card coordinates are in the local world of the containing folder, not absolute.

**Warning signs:** Dragging a folder frame moves the folder-note card, or the reverse. A test that moves each independently fails.

**Phase to address:** 1 (schema), 3 (nested worlds).

---

### Pitfall 6: Deterministic folder placement is not actually deterministic or stable

**What goes wrong:**
- Using `std::hash::DefaultHasher` or `RandomState`. The algorithm is unspecified across Rust versions and `RandomState` is random per process. Folders land in different places per run or per toolchain.
- Hashing the absolute path. The vault opened from a different location relocates everything.
- Resolving collisions by insertion order. Adding folder `a` shifts the already-placed `b`.
- Renaming or moving a folder changes its path hash, so it teleports and takes its whole nested layout with it.
- Placing a subfolder in an "empty spot" computed from the parent's current cards. Move a card and the subfolder jumps.

**Why it happens:** "pseudo-random but deterministic" is easy to say and subtle to implement.

**How to avoid:**
- Hash a normalized vault-relative path (forward slashes, Unicode NFC) with an explicit algorithm (FNV-1a, xxHash or BLAKE3 with fixed seed). Never `DefaultHasher`.
- Map to a position inside a bounded region (see Pitfall 11). Handle collisions by rehash with a counter in sorted-path order, and keep regions much larger than the folder's footprint so collisions are rare.
- Subfolder placement within a parent comes from the hash and the parent's world size, not from sibling cards. If it overlaps a card, the user drags it, and the result is persisted via `world-x/world-y`.
- On rename or move through the app, write the old computed position to the folder note first so the folder stays put. Renames outside the app can't be caught, so accept the jump but keep it contained.
- Test: golden positions for fixture paths across runs.

**Warning signs:** Layout snapshot tests differ between runs. Opening the same vault from a copy moves folders.

**Phase to address:** 1 (placement function and tests), 3 (nested placement).

---

### Pitfall 7: Wrong assumptions about Obsidian block-ref syntax

**What goes wrong:** Generated `^id` anchors do not work in Obsidian: wrong characters, wrong position, or applied to the wrong unit.

**Facts (HIGH, [Obsidian help](https://obsidian.md/help/links)):**
- Block identifiers can only contain Latin letters, numbers and dashes. No underscores or Unicode.
- For a paragraph, the id goes at the end of the line after a space (`text ^abc123`).
- For structured blocks (lists, quotes, callouts, tables), the id goes on its own line with a blank line before and after it. For a list item it goes directly on that bullet.
- A block is a paragraph or list item, not a physical "line". A soft-wrapped paragraph spanning five lines is one block, and the id belongs on its last line.
- Link syntax is `[[Note#^id]]`, with alias `[[Note#^id|description]]`.
- File names or headings containing `# | ^ : %% [[ ]]` can break links. Avoid them.

**How to avoid:**
- Parse the body into blocks with real offsets (pulldown-cmark or equivalent) and map the user's "line" to its block. Insert the id at that block's correct end.
- Never insert inside fenced code, a table row, a heading line, frontmatter or an HTML comment. Apply the structured-block rule for tables, quotes and callouts.
- Reuse an existing `^id` on that block rather than adding a second.
- Generate short ids from `[a-z0-9]` (6 chars like Obsidian), check uniqueness within the file including user-made ids, and never regenerate an assigned id.
- If the user appends text after `^id` on the same line, the anchor breaks. Detect "id not at end of block" in the index and report the link as broken.
- Test the exact output strings for every block kind against fixtures, and open them in real Obsidian once (log to `.context/HUMAN-QUESTIONS.md`).

**Warning signs:** Link renders in the app but Obsidian shows "no matching block". `^id` appears in a code block, a heading or a table cell.

**Phase to address:** 1 (block parser and anchor writer), 3 (UI that picks the line).

---

### Pitfall 8: Link text parsing and writing breaks on real prose

**What goes wrong:**
- The user's description contains `]]`, `|`, `#`, `^`, a newline, or a backtick. The wikilink is cut short or mis-parsed.
- Inside a markdown table cell, `|` must be written `\|` or the table breaks.
- The parser matches `[[...]]` inside code spans, fenced code and `%% comments %%`.
- Embeds `![[...]]`, heading links `[[Note#Heading]]` and plain `[[Note]]` get conflated with block links.
- Existing `wikilinks()` throws away `#^id` and the alias.

**How to avoid:**
- Write a real link parser that returns `{target, subpath (heading | block), alias, span}` and skips code and comments. Keep the old `wikilinks()` behavior as a thin wrapper to not regress ide.rs.
- Sanitize or escape descriptions when writing: collapse newlines, replace `]]`, escape `|` in tables, reject empty (see Pitfall 22).
- Round-trip property test: random description, write it, parse it, get it back (or a documented normalized form).
- Keep `[[Note]]` and `[[Note#Heading]]` working and untouched.

**Warning signs:** A description with `|` renders differently in Obsidian than in the app. Links inside code fences appear in the graph.

**Phase to address:** 1.

---

### Pitfall 9: Cross-folder link resolution is ambiguous, and renames break links

**What goes wrong:**
- Two notes called `Notes.md` in different folders. `[[Notes#^id]]` resolves to one of them in Obsidian and possibly the other in the app.
- Obsidian's default link format is "shortest path when possible". App-written short links become ambiguous when a same-named note appears later.
- Source cards created from web titles collide on names, or contain characters that are illegal or break links (`/ \ : * ? " < > |` and `# ^ [ ] %%`).
- macOS filename byte limit is 255 UTF-8 bytes. Long paper titles overflow.
- Accented names in NFC vs NFD compare unequal even though they look identical.
- Obsidian updates inbound links when you rename inside Obsidian. When the app renames or moves a note or folder (explorer drag), nothing updates unless the app does it. Renames in Finder or git update nothing at all.

**How to avoid:**
- The app writes links with a vault-relative path (`[[Folder/Note#^id|desc]]`) whenever the basename is not unique in the vault, and always for cross-folder links. Resolve links with the same rules: exact path first, then unique basename, else "ambiguous" shown to the user.
- A filename sanitizer for generated notes: replace illegal characters, NFC-normalize, truncate by bytes with a short hash suffix, de-duplicate with `-2`, `-3`. Keep the original title in frontmatter `title:` so nothing is lost.
- Keep a block-id index (`id` to file). Because ids are random and unique, a link whose file is gone can heal by finding the id elsewhere. Cheap resilience to external renames.
- App-driven rename and move live in one module: compute inbound links from the index, preview, rewrite bodies through the Vault write path (Pitfall 3), and make it a single undoable batch.
- Show broken links visibly (dashed curve) instead of dropping them.

**Warning signs:** Link graph differs from Obsidian's graph on the same vault. Renaming a note in the explorer leaves dead curves.

**Phase to address:** 1 (resolver, sanitizer, index), 2 (explorer rename and move).

---

### Pitfall 10: Open-any-folder crawls the wrong tree

**What goes wrong:** D-11 lets the user open any folder. Pointing it at a repo or home directory walks `.git`, `target/`, `node_modules`, and symlink loops, on the UI thread. The author's own memory vault symlinks `.planning` and `.context`, which makes loops plausible. Non-UTF-8 or huge `.md` files make `read_to_string` fail or stall.

**How to avoid:** Scan in a background thread with progress. Do not follow symlinks by default (or use loop detection). Skip dot-directories and known heavy dirs. Cap file count and file size with a visible message. Treat unreadable and non-UTF-8 files as skipped, not fatal. Handle case-insensitive duplicates (`Note.md` vs `note.md`). Index incrementally by mtime plus hash.

**Warning signs:** The window freezes after choosing a folder. Memory spikes. A test pointing at the repo root hangs.

**Phase to address:** 1 (scanner), 2 (open and remember).

---

### Pitfall 11: f32 precision and the "infinite" world

**What goes wrong:** egui and glam are f32 (about 7 decimal digits). Placing top-level folder regions pseudo-randomly across a huge plane, and multiplying nested scales, pushes coordinates large enough that cards shimmer while panning, text jitters, strokes wobble, and hit tests miss by pixels. The failure appears only when you zoom deep into a far-away folder, which is exactly the feature's headline interaction.

**Why it happens:** One global world coordinate system plus one camera. Deep zoom means large scale times large offset.

**How to avoid:**
- Per-world local frames. Each folder is its own world with its own origin and camera, as ide.rs already does with per-folder cameras. A child's position is expressed in the parent's frame. Zooming into a child switches the active world and re-bases the camera, so scale and offset reset to near 1 and 0.
- Compose the transform chain (world path to screen) in f64 and convert only the final screen-space rects to f32. Use `glam::DVec2` for camera math.
- Bound the hashed region range (for example about +/-50,000 units, a design number to tune) and clamp the zoom range per level. Use zoom-to-fill hysteresis (Pitfall 15) so worlds do not flip back and forth.
- Test numerically: property test that screen-to-world-to-screen round-trips within 0.01 px at the maximum nesting depth. Do not rely on screenshots to catch jitter. A static screenshot cannot show shimmer.

**Warning signs:** Cards shimmer or text swims when panning far from the origin. Round-trip error grows with distance.

**Phase to address:** 3, with the camera and coordinate types decided in the first plan. Retrofitting after cards exist is expensive.

---

### Pitfall 12: Text at arbitrary scale

**What goes wrong:**
- Scaling font size continuously with zoom makes egui rasterize new glyph sizes into its atlas on nearly every zoom step: slow frames and atlas growth. Giant sizes (zoomed card text at 500 px) are slower still and may exceed texture limits (MEDIUM, unverified in 0.36).
- Scaling meshes with a layer transform avoids atlas churn but text turns blurry when zoomed in (the `egui::Scene` default zoom range is capped at 1:1 for this reason, [docs](https://doc.servo.org/egui/containers/struct.Scene.html)).
- Laying out and drawing the full body text of hundreds of cards when each is a few pixels tall wastes the frame.
- Text cursor, IME, popups and tooltips do not follow layer transforms (MEDIUM).

**How to avoid:**
- Level of detail by on-screen card size. Under about 6-8 px tall, draw a plain rect. Under about 40 px, draw the title only. Above that, draw body text, clipped.
- Quantize font sizes to a small set of steps and clamp to a range, then scale the rest. Cache galleys keyed by `(text hash, size bucket, wrap width)` rather than re-laying out each frame.
- Edit text only in the card under focus, laid out in true screen space at a readable size. Everything else is painted read-only.
- ide.rs already paints cards with a zoom factor `z` (`draw_card`). Extend that approach rather than switching to nested transformed `Ui`s.

**Warning signs:** Frame time rises when zooming. Memory of the font texture grows. Text is blurry at zoom above 1.

**Phase to address:** 3.

---

### Pitfall 13: Culling, clip rects and draw cost with nested worlds

**What goes wrong:**
- Every card, curve and sub-world drawn every frame. Each nested level multiplies cost.
- Culling by card rect only: a Bezier link whose endpoints are both offscreen but whose curve crosses the viewport vanishes, or edges to far-off cards are all drawn.
- Missing clip rects: a sub-world's content bleeds outside its frame onto neighbors, or a giant frame (a folder you are zoomed into) is tessellated as a huge rounded rectangle with stroke.
- Rects far larger than the screen with large corner radii create many tessellation segments.

**How to avoid:**
- Cull whole sub-worlds by their screen bounding box, and draw a sub-world below a minimum on-screen size (for example under 4 px) as a single dot or skip it. Cap recursion depth.
- Cull edges by the bounding box of their control points intersected with the viewport, not by endpoints.
- Clip every sub-world's painter to `frame_rect ∩ viewport` using `painter.with_clip_rect`.
- Clamp or clip shapes to the viewport before submitting. Skip the frame stroke when it is mostly offscreen.
- Budget: set a target (for example 2,000 visible cards at 60 fps) and measure with a synthetic vault.

**Warning signs:** Frame time scales with total notes, not visible notes. Content from one folder is visible inside another's frame.

**Phase to address:** 3 (and reused in 6).

---

### Pitfall 14: Hit testing and dragging under mixed scales

**What goes wrong:**
- Custom-painted cards need hand-written hit testing. The topmost card under the pointer must match draw order and the culled/LOD geometry. Overlapping cards pick the wrong one.
- Drag deltas not divided by the cumulative scale of the world the card lives in. Dragging a card inside a 0.2-scale sub-world moves it five times too far or too little.
- Grab offset stored in screen space, so the card jumps when zoom changes mid-drag.
- Widgets inside a layer transform may not hit-test the way the paint does (MEDIUM). Rerun's `zoom_pan_area` maps pointer to scene space via the inverse transform ([source](https://ref.rerun.io/docs/rust/stable/src/re_ui/zoom_pan_area.rs.html)).
- Dragging a card out of a sub-world into its parent implies a file move plus link rewrite.

**How to avoid:**
- One function `pick(screen_pos) -> Hit` that walks the same visible list in reverse draw order, used by hover, click, drag and context menu. Keep a z-order (raise on click).
- Store grab offset in the card's local world units (the existing `Drag { grab }` pattern), and convert pointer to local coordinates through the inverse chain each frame.
- Commit the frontmatter write only on drag end, and only if the position changed.
- Decide in the Phase 3 plan whether cross-world reparenting is in scope. If yes, route it through the rename-and-move module (Pitfall 9). If not, forbid it with a visible hint.

**Warning signs:** Card drifts from the cursor in nested worlds. Clicking selects a card behind another.

**Phase to address:** 3.

---

### Pitfall 15: Zoom-to-fill transitions flicker or lose state

**What goes wrong:** Switching the active world when a child fills the screen oscillates at the threshold (zoom in, switch, zoom out, switch). The camera of the parent is lost, so zooming back out lands somewhere else. Wheel over an editing card is ambiguous between scrolling the text and zooming the canvas.

**How to avoid:** Two thresholds (enter at fill, exit at a clearly smaller size) for hysteresis. Keep a camera per world in app state and restore on exit. Decide and document one input rule: wheel over a focused text editor scrolls text, Cmd/Ctrl-wheel or pinch zooms, empty space wheel pans or zooms (match the trackpad vs mouse behavior, noting this Mac is reached by streaming and sees mouse input only). Cap zoom limits at both ends.

**Warning signs:** Visible flip at a specific zoom level. Back-navigation lands in the wrong place.

**Phase to address:** 3.

---

### Pitfall 16: Removing egui_dock loses state and keyboard control

**What goes wrong:**
- Persisted eframe storage still holds the serialized `DockState<Tab>`. After the type is removed, deserialization fails or is silently ignored. Handle it deliberately, not by accident.
- Tools lose assumptions about their pane rect: the sim canvas, timeline, marks overlay (`marks.keep_clear`, "drawn over any pane"), and terminal size (`size (0,0)` until drawn, then a resize event per size change, SIGWINCH storms on a full-window view).
- Tools whose update runs inside their tab draw stop advancing while hidden: the sim tick, timeline playhead, mimic swarm, terminal repaints. "Hidden" now means "another view is full-window", which is a new state the dock never had.
- A terminal's child is killed on `Drop`. Keep `Ide.terminals` owned by the app, and make sure closing a view or an explorer entry does not drop the terminal.

**How to avoid:**
- Write a characterization checklist for every tool in D-02 (Canvas sim, Brushes, Rules, Timeline, Files/IDE, Terminals, editor tabs, highlight notes, marks) with an open-via-palette smoke test each, including a headless screenshot via `TAPESTRY_VIEW`.
- Stage the removal: introduce the new shell next to the dock and switch over behind a flag, then delete `egui_dock` and the `Tab` plumbing last, so `cargo build` and `cargo test` pass after every plan.
- Decide per tool whether it ticks while hidden. Terminals must keep draining output (the parser threads do) and need a size when reshown. Pump or pause the sim explicitly.
- Reset or version the persisted layout key.

**Warning signs:** A tool opens blank, at the wrong size, or paused. A terminal shows stale or garbled text after returning. Child shells vanish after closing a view.

**Phase to address:** 2.

---

### Pitfall 17: Cmd-K and Esc fight everything else

**What goes wrong:**
- One Esc press is seen by every handler (see list at the top), so it closes the palette, stops a note edit, exits a view and clears selection together.
- Cmd-K never reaches the palette when a terminal or text editor has focus, or the reverse: Cmd-K steals the terminal's keys (Cmd-K clears the screen in macOS terminals).
- A terminal view cannot be left with Esc (the existing `maximized` gate explicitly excludes it), so the user is trapped.
- Digits, Space, Backspace and arrows still switch brushes or delete keyframes while a note card is focused, or while the palette's search field has focus.
- `TextEdit` surrenders focus on Esc, so the palette sees `lost_focus`, not `key_pressed(Escape)`.

**How to avoid:**
- One input router at the top of `update()`, run once per frame, with a fixed priority: palette > terminal escape chord > text editing > full-window view > canvas selection. Use `ctx.input_mut(|i| i.consume_key(...))` so lower handlers do not see a consumed key. Delete the scattered Esc checks.
- Cmd-K is consumed globally, before widgets, even with a terminal focused. Give terminal views an explicit exit that is never forwarded to the PTY (Cmd-K then pick "back", or Cmd-Esc).
- Gate the old global shortcuts on "canvas has focus and nothing is editing". The palette's `TextEdit` calls `request_focus` on open and returns focus to the previous widget on close.
- Add an input-router unit test: given synthetic events and focus states, assert exactly one handler acts.

**Warning signs:** One Esc does two things. Typing "1" in a note changes the brush. You cannot get out of the terminal view with the keyboard.

**Phase to address:** 2.

---

### Pitfall 18: Blocking network calls, no timeouts, and silent repaint stalls

**What goes wrong:**
- `ureq` calls made in `update()` freeze the UI.
- A worker thread finishes but never calls `ctx.request_repaint()`. egui is reactive, so results do not appear until the mouse moves.
- `ureq` 3 treats 4xx/5xx as errors by default, so a 429 loses its body and `Retry-After`. Without `timeout_global` and connect timeouts a hung socket blocks a worker forever (MEDIUM; the project's `translate.rs` already sets both).
- One thread per request, unbounded, with stale queries still running after the user moved on.
- A captive portal or error page returns HTTP 200 HTML. JSON parse errors get treated as "no results" or panic.

**How to avoid:** One long-lived search worker with a bounded queue and a generation counter. A new query cancels or supersedes the old one, and stale replies are dropped on receipt. Build the agent once with `http_status_as_error(false)`, global and connect timeouts, and a body size limit. Handle status codes explicitly. Always `ctx.request_repaint()` after sending a result. Treat any parse failure as a provider failure, not an empty result. Follow the pattern in `translate.rs:244`.

**Warning signs:** UI hitches when a search starts. Results appear only after moving the mouse. Threads accumulate.

**Phase to address:** 4.

---

### Pitfall 19: Ignoring free-API limits and etiquette (verified Oct 2026)

**What goes wrong:** The app gets throttled or blocked, or burns a provider's whole free budget in minutes.

**Facts:**
- **OpenAlex (HIGH, [official docs](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication), page updated 2026-10-15):** keyless allows 10 requests per second, but there is a **daily budget of $0.10 without a key, about 100 search queries per day** ([example costs](https://help.openalex.org/access/example-costs)). Search costs $1 per 1,000, list+filter $0.10 per 1,000, and single-entity lookup by ID or DOI is free. A free key gives 10x the budget. Cursor paging needs a key. Exceeding limits returns 429. The current docs do not mention the old `mailto` polite pool, so do not depend on it, though adding `mailto=` is harmless.
- **arXiv (HIGH, [terms of use](https://info.arxiv.org/help/api/tou.html)):** at most one request every 3 seconds and one connection at a time, across all machines you control.
- **Wikipedia/Wikimedia (HIGH, [UA policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)):** a missing or generic User-Agent can be answered with 403 or blocked without notice. Use `Name/Version (contact) ureq/3`. Copying a browser UA is treated as suspicious.
- **Tavily (MEDIUM-HIGH, [credits](https://docs.tavily.com/guides/api-credits)):** 1,000 free credits per **month** (resets on the 1st), a basic search costs 1. The cap is monthly, not daily. Free-tier rate limit is not officially published.
- **DuckDuckGo HTML (MEDIUM, no official policy):** no API. Scraping `html.duckduckgo.com/html/` returns a soft-block (HTTP 202 / challenge page) when paced too fast, with no documented thresholds. Result links are wrapped in redirect URLs that need decoding.

**How to avoid:**
- Per-provider budget and pacing in a provider trait: `min_interval`, `max_per_day` or `per_month`, and `exhausted_until`. arXiv min interval 3 s with a single in-flight request. A 429 means "exhausted until next UTC midnight or Retry-After", not "retry soon".
- Prefer cheap OpenAlex calls: use singleton lookups (free) for citation expansion by DOI or OpenAlex ID, filter queries over search where possible, and reserve search for real topic shifts. Do not count "one query = one request": fan-out to four providers costs four requests, and the user-facing cap should be on provider requests as well as queries.
- A real User-Agent from config with a contact. If the user has not set a contact, do not invent an email. Use the project URL, and show a one-time hint.
- DuckDuckGo is last resort only, never retried in a loop, wrapped in a circuit breaker (open after N failures, exponential backoff with jitter), and labeled as lower trust.
- A mocked provider test harness (recorded fixtures) so tests never hit the network.

**Warning signs:** 403 from Wikipedia, 429 from OpenAlex, arXiv returning empty feeds, 202 from DuckDuckGo. Search counts jump after one sentence of typing.

**Phase to address:** 4. Re-verify limits at the start of the phase; they changed recently.

---

### Pitfall 20: Research feedback loop and canvas flooding

**What goes wrong:**
- Source cards the app creates are notes. If their text feeds query extraction, the app researches its own results and crawls forever.
- File-watcher reloads of external edits, note-open events, and app-inserted links trigger "topic shift" searches.
- Each query returns about 10 results times several providers, and each becomes a card. A pause in typing drops 30 cards on top of the note.
- The same paper arrives repeatedly from different providers, or again after a restart.
- Auto-created files pollute the vault (Obsidian index, git, sync) and cannot be told apart from the user's notes.

**How to avoid:**
- Only user-typed text in the focused editor triggers research. Mark generated notes with frontmatter such as `source: auto` plus `status: unreviewed`, and exclude `source: auto` notes from query extraction.
- Cap results per query (about 3-5 after ranking), apply a cap per note and per day, and drop results below an embedding-relevance threshold against the prompting paragraph.
- Dedupe across providers and history by DOI, arXiv id, OpenAlex id, URL canonical form and normalized title. Persist a seen-set and a dismissed-set outside the vault.
- Place new cards with a free-slot finder near the prompting note, never stacked, and as a compact "inbox" cluster the user can sweep.
- Put generated notes in a predictable subfolder so they are easy to ignore or delete, and consider adding a `.gitignore` entry for the default `world/vault/` auto output. In this shared tree, other sessions' `git commit` can sweep up files staged by the index (see `git status` today).
- Link back from the prompting block only after the card exists, through the Vault write path (Pitfall 3). Failing to write the backlink must not discard the card.

**Warning signs:** Card count climbs with no typing. The same source appears twice. Query log shows queries derived from `source: auto` text.

**Phase to address:** 4.

---

### Pitfall 21: Debounce fires on the wrong signal; daily cap is not durable; offline is not distinguished

**What goes wrong:**
- Debounce on "text changed" fires on every pause, not on topic shift (D-08). Editing a typo triggers a search.
- The daily cap lives in memory, so every restart resets it. Local date and UTC day boundaries disagree with provider resets. Failed attempts are not counted.
- Offline replays a queue of stale queries on reconnect, or retries forever. "Out of searches" and "offline" look the same, or search fails silently, which D-08 explicitly forbids.

**How to avoid:**
- Trigger only when all hold: user idle for 2-3 s, the changed paragraph has at least N new words of prose (not frontmatter, links, code), the min interval since last query has passed, and cosine between the paragraph embedding and the last queried embedding is below a threshold (topic shift).
- Persist counters (per provider, per day or month, with the provider's own reset rule) in app state outside the vault. Count attempts, not only successes.
- Distinguish states in the UI: `searching`, `offline`, `provider exhausted`, `out of searches (cap)`, `idle`. Drop queued queries older than a short TTL on reconnect.

**Warning signs:** Searches after fixing a typo. The cap resets on relaunch. No visible state when the network is down.

**Phase to address:** 4.

---

### Pitfall 22: Query extraction without an LLM is poorer than expected

**What goes wrong:**
- Stopword removal alone gives junk queries ("thing", "important", "like"). Long queries return nothing from arXiv, OpenAlex and DuckDuckGo.
- Model2Vec (`potion-base-8M`) produces embeddings that are good for similarity and clustering but cannot generate query text. Rare technical terms and names split into word pieces and embed poorly (MEDIUM). Very short inputs are noisy.
- Sending note text to third parties is a privacy leak. Queries go to OpenAlex, Wikipedia, Tavily and DuckDuckGo from the user's IP.

**How to avoid:**
- Extract candidate phrases (RAKE/YAKE-style n-grams, capitalized runs, terms in `[[links]]` and headings), then rank candidates by cosine to the paragraph's embedding (KeyBERT-style). Embed the candidates and the paragraph with the existing `embed.rs`. Send 3-6 terms.
- Weight by vault statistics: terms common across the vault are weak, rarer terms strong.
- Provide a per-note and per-folder opt-out (`research: false` in frontmatter) and a global off switch. Never send full text, only the extracted terms. Document what leaves the machine.
- Cache embeddings by content hash (outside the vault) so a large vault is not re-embedded every launch.
- Keep the extractor a pure function with fixture tests (paragraph in, ranked terms out). Judge quality on a hand-made set of 20 paragraphs before wiring the network.

**Warning signs:** Queries are single generic words or full sentences. Results are unrelated to the paragraph.

**Phase to address:** 4 (extractor), 5 (embedding reuse).

---

### Pitfall 23: Proposed connections that are noisy, forgotten, or write on their own

**What goes wrong:**
- Static-embedding similarity ranks almost everything in one domain as similar. The proposals list is dominated by boilerplate and near-duplicates.
- Proposals for already-linked pairs, or the same rejected pair, return every launch because "turn down" is not persisted.
- All-pairs similarity recomputed on every edit.
- Citations (OpenAlex `referenced_works`) have to match existing cards. Without stored DOI/OpenAlex ids in source-card frontmatter there is nothing to match.
- D-07 violation: "keep" writes a link with an empty or generated description, or inserts `^id` into notes before the user keeps anything.
- Note-level proposals do not say which block to anchor to, since links are block-level.

**How to avoid:**
- Rank by mutual top-k neighbors above a calibrated threshold (per vault), exclude existing links and self, and cap the number shown.
- Persist rejections keyed by the (source, target) identity outside the vault. A rejection is not a note change.
- Incremental similarity: recompute only the changed note's row. All-pairs is fine to a few thousand notes (n=5,000 at 256 dims is about 12.5M dot products), but do it off the UI thread.
- Store `doi`, `openalex`, `arxiv` ids in source-card frontmatter at creation so citation proposals can match. Cap citation fan-out.
- Keep flow: the user picks the anchor block and types the description. Insert `^id` and the link only at that moment, with non-empty description, through the Vault write path. If they decline to type one, fall back to a plain `[[Note]]` they explicitly choose, never an invented description.

**Warning signs:** Same proposal reappears after being turned down. Proposal count grows with vault size. Any code path where the app produces description text.

**Phase to address:** 5.

---

### Pitfall 24: Replay from file timestamps is unreliable

**What goes wrong:** The growth replay uses mtime. mtime changes on every edit (so "created" is wrong), and is reset by git checkout, clone, unzip, and cloud sync (everything looks created at once). Links have no timestamp at all, because a link is text inside a body. Birth time (macOS APFS) is reset by copies. Deleted notes vanish from history. The scrubber looks plausible on the dev machine and falls apart on any vault that came through git.

**How to avoid:**
- Write an append-only event log (JSON lines) outside or beside the vault as the app acts: `note_created`, `link_added`, `note_deleted`, with UTC timestamps. This is the authoritative history for anything the app did.
- Stamp `created:` (ISO-8601 UTC) in frontmatter when the app creates a note. Obsidian doesn't set this itself, but templates commonly do, so it is compatible.
- For notes and links from before the log: backfill with a precedence of frontmatter `created` > filesystem birth time > mtime, clamp to sane bounds, and mark them as "estimated" in the UI. Optionally, if the vault is a git repo, use `git log --diff-filter=A` as a better source, but treat git as optional and slow.
- For link time use the later of the two endpoint notes' creation times unless the log has the exact event.
- Scrub by event index (sorted, stable ordering with ties broken deterministically), not by wall-clock time, so ties and clock skew do not make the scrubber stutter.

**Warning signs:** After a fresh clone, everything appears at one instant. Replay order changes between runs.

**Phase to address:** 1 (stamp `created`, start the event log from the first write), 6 (replay).

---

### Pitfall 25: Force-directed graph burns CPU and rearranges on every change

**What goes wrong:**
- Naive O(n^2) repulsion per frame is fine at 500 nodes and unusable at several thousand (5,000 nodes means 25M pair interactions per frame).
- The simulation never settles, so egui repaints continuously: fan noise and battery drain.
- Any vault change re-seeds the layout and the whole graph explodes and reshuffles. Replay re-simulates from scratch per scrub position, so scrubbing is slow and non-reproducible.
- Reusing the canvas card `x,y` as graph positions overwrites the user's spatial layout with force-layout output.
- Edge count explodes on dense vaults, and every label is drawn.

**How to avoid:**
- Barnes-Hut (quadtree) or grid-based repulsion. Run the simulation on a worker thread or fixed time step, with an energy threshold that stops it and stops `request_repaint`.
- Warm start: keep previous positions, place new nodes near their neighbors or their folder cluster, pin settled nodes, and give the RNG a fixed seed.
- Graph positions are separate from canvas `x,y`. Cache them in app state.
- Replay: compute the final layout once, then reveal nodes and edges in event order at their final positions (optionally with a short settle). This is deterministic and scrubbable in both directions.
- Reuse the LOD from Pitfall 13: hide labels below a zoom, aggregate edges between clusters beyond a threshold, and cull by viewport.
- Build the link index incrementally in a background thread; update from watcher events instead of rescanning.

**Warning signs:** CPU at idle while the graph is open. Dragging a node makes distant nodes fly. Scrubbing back differs from scrubbing forward.

**Phase to address:** 6.

---

## Moderate Pitfalls

### Pitfall 26: Unpositioned notes stack at the origin
**What goes wrong:** Notes created in Obsidian or by other tools have no `x/y`. All land at (0,0) and overlap.
**Prevention:** Deterministic placement for unpositioned notes (spiral or hash-based grid near siblings), computed not written. Persist only when the user moves a card.
**Phase:** 1 (function), 3 (use).

### Pitfall 27: Hand-edited or malformed frontmatter
**What goes wrong:** The user is mid-edit in Obsidian and the YAML is invalid, or `x: "120"` is a string, or `x:` has a tab. The app overwrites or panics.
**Prevention:** Parse leniently (accept numeric strings), and if the block does not parse, treat it as opaque: show the card at its computed position, never write, and show a warning badge. Write numbers in canonical form.
**Phase:** 1.

### Pitfall 28: Generic key names collide, and `y` is a YAML 1.1 boolean
**What goes wrong:** `x`, `y`, `w`, `h` are generic, so they may already be used as user properties or by plugins. Strict YAML 1.1 parsers (not Obsidian) read an unquoted `y` as a boolean (MEDIUM).
**Prevention:** Do not overwrite a non-numeric existing `x/y/w/h` silently. Read with a YAML 1.2 core schema. Note the locked key names in the compatibility doc and consider honoring an optional prefix setting later.
**Phase:** 1.

### Pitfall 29: Frontmatter parser mistakes `---` in the body
**What goes wrong:** A horizontal rule `---` or a Setext heading treated as the closing delimiter, or an opening `---` that isn't on line 1 treated as frontmatter.
**Prevention:** Frontmatter exists only if line 1 is exactly `---`; the closing delimiter is the next line that is exactly `---` (or `...`). Fixture-test both.
**Phase:** 1.

### Pitfall 30: Layout writes burst on multi-select and group moves
**What goes wrong:** Dragging a selection or a folder writes dozens of files at once, triggering watchers, sync tools and git noise.
**Prevention:** Batch on drag end, skip unchanged values, and debounce the batch. Provide a single "layout write" function that reports how many files it changed (assert it in tests).
**Phase:** 3.

### Pitfall 31: Terminals hidden behind a full-window view
**What goes wrong:** On restore the PTY size is stale, a resize storm sends SIGWINCH per frame, or a zero-size resize hits the PTY.
**Prevention:** Send a resize only when the cell grid actually changes and both dimensions are at least 1. Keep terminals alive in `Ide`. Request a repaint when output arrives while hidden so the badge or title can update.
**Phase:** 2.

### Pitfall 32: Embedding pipeline stalls or repeats
**What goes wrong:** The vault is embedded on the UI thread at open, or re-embedded on every launch.
**Prevention:** Embed in the existing background thread (`embed.rs`), cache vectors by content hash on disk outside the vault, and re-embed only changed notes.
**Phase:** 4-5.

### Pitfall 33: Secrets and paths leak into the vault
**What goes wrong:** A `TAVILY_API_KEY` ends up in a URL, a log line, or a source card's `source:` field. Absolute local paths are written into notes.
**Prevention:** Send the key in a header only, never log request headers, store vault-relative paths only, and scrub provider URLs of query secrets before saving them to notes.
**Phase:** 4.

### Pitfall 34: Source cards drop provenance
**What goes wrong:** A card created from search has body text but no URL, provider, retrieved-at or ids, so it can't be cited, deduped, matched for citations or refreshed.
**Prevention:** Frontmatter on every source note: `title`, `url`, `doi`, `openalex`, `arxiv`, `provider`, `retrieved`, `source: auto`. Keep abstract text as the body and clearly mark that it is retrieved, not written by the user.
**Phase:** 4.

---

## Minor Pitfalls

### Pitfall 35: Case-insensitive filesystem collisions
`Note.md` vs `note.md`. Compare normalized names when creating, and refuse or suffix.

### Pitfall 36: Large or binary `.md` and BOM
Skip unreadable files, strip a BOM for parsing but preserve it on write.

### Pitfall 37: Unicode normalization in links
Normalize to NFC for index keys while preserving the original spelling in the written text.

### Pitfall 38: Mtime-polled reload of a big vault
Replace the 0.5 s directory poll with watcher events plus a slow fallback scan.

### Pitfall 39: Persisted per-world cameras go stale
A deleted or renamed folder leaves a camera entry. Key cameras by normalized path and prune on load.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Serialize frontmatter with a YAML library round-trip | Ten lines of code | Destroys comments and formatting, constant diffs | Never for layout writes. Acceptable only for files the app creates from scratch. |
| One global f32 world and camera | Reuses existing ide.rs math | Jitter far from origin, expensive to retrofit | Never for the nested-world model. |
| Scale fonts continuously with zoom | Looks right immediately | Atlas churn, slow zoom | Only with quantized sizes and a clamp. |
| `DefaultHasher` for folder placement | One line | Positions differ across runs and toolchains | Never. |
| Write auto-created source cards straight into the main vault | Matches D-08 literally | Vault pollution, git noise | Acceptable only with `source: auto` markers, a dedicated subfolder and gitignore. |
| In-memory dismissed set and daily counter | No persistence code | Cap resets, rejected proposals return | Never. |
| Rebuild the whole link index on any watcher event | Simple | Seconds-long stalls on large vaults | Only under about 500 notes, and behind a function boundary so it can be made incremental. |
| Keep the 0.5 s directory poll for the vault | No new dependency | Stat storm on big vaults | Acceptable during Phase 1 only. |
| Reuse canvas `x,y` for the knowledge tree layout | No extra state | Overwrites the user's spatial layout | Never. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Obsidian | Rewriting frontmatter and expecting it to survive an Obsidian edit unchanged | Surgical line patches, tolerate Obsidian's reformatting (block lists, requoting, dropped comments). |
| Obsidian | Writing under `.obsidian/` or leaving temp files visible | Never write there. Dot-prefixed temp files, cleaned up. |
| OpenAlex | Assuming unlimited keyless use or relying on `mailto` | Budget about 100 searches per day keyless, use free singleton lookups for citations, treat 429 as "exhausted until reset". |
| arXiv | Parallel or rapid requests | One in flight, at least 3 s apart, shared across the app. |
| Wikipedia | Default or browser User-Agent | `Name/Version (contact) ureq/3`. |
| Tavily | Treating the cap as daily | 1,000 credits per month, key in a header only, skip silently if the env var is unset. |
| DuckDuckGo | Retrying on soft-block, trusting parsed HTML structure | Circuit breaker, backoff with jitter, defensive parser, mark as low trust. |
| ureq | Blocking in `update()`, default error-on-4xx, no timeouts | Worker thread, `http_status_as_error(false)`, global and connect timeouts, `request_repaint`. |
| notify / FSEvents | Reacting to own writes, ignoring renames | Hash suppression, debouncer with rename stitching, ignore dot-dirs. |
| Model2Vec | Using embeddings to generate queries | Use for ranking candidates, topic-shift detection, result reranking and similarity only. |
| git / shared tree | Auto-generated files appear as untracked noise for other sessions | Ignore the auto-output path, commit only own paths, check `git show --stat HEAD`. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-frame text layout for all cards | Frame time scales with note count | LOD, cached galleys keyed by size bucket | Around 200-500 visible cards |
| O(n^2) force repulsion | Graph view stutters | Barnes-Hut, fixed step, stop when settled | Around 1,000-2,000 nodes |
| All-pairs embedding similarity on each edit | Typing lags | Incremental row update, background thread | Around 5,000+ notes |
| Whole-vault rescan per watcher event | Periodic stalls | Incremental index by path | Around 1,000+ notes |
| 0.5 s directory poll | Constant disk activity | Watcher plus slow fallback | Around 2,000+ files |
| Recursive nested world drawing with no depth or size cut-off | Frame time multiplies with depth | Skip below minimum on-screen size, cap depth | 3+ nesting levels with several sub-worlds each |
| Unbounded edge drawing | Graph is a hairball and slow | Viewport cull, aggregate cluster edges, hide labels | Around 5,000 edges |
| Always-repainting graph | High idle CPU | Stop repaint when energy is low | Immediately |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Sending note text to search providers | Private writing leaves the machine | Send extracted terms only, per-note and per-folder opt-out, global off switch, say what is sent |
| `TAVILY_API_KEY` in URLs, logs or notes | Key leak | Header only, never log, never persist |
| Following links or redirects from search results blindly | SSRF-like fetches, unexpected hosts | Fetch only provider API URLs. Treat result URLs as data and open only on user action. |
| Trusting provider text in note bodies | Markdown injection (fake `[[links]]`, huge content, frontmatter) | Escape or neutralize `[[`, strip leading `---`, cap length, keep it below the app's frontmatter. |
| Unsanitized provider titles as filenames | Path traversal (`../`), reserved characters | Sanitize, forbid separators and `..`, resolve inside the vault root and verify the final path is under it |
| Opening an arbitrary folder with symlinks | Escape the vault via symlink writes | Do not follow symlinks for writes, verify canonical path is within the vault root |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failures in research | User thinks nothing is happening | Visible state (searching, offline, exhausted, out of searches) per D-08 |
| Cards appear on top of what the user is writing | Disruptive | Place beside, not over, compact inbox cluster, no focus steal |
| Zoom jumps when switching worlds | Disorienting | Hysteresis, animate, restore cameras |
| No indication a note came from the app | User can't tell what they wrote | Marker in frontmatter and a visual tag on auto cards |
| Description prompt on keep is skippable by auto-fill | Breaks D-07 | Required user text, or explicit plain link |
| Esc does several things | Lost edits | Single prioritized router |
| Dragging a note across folders silently renames or rewrites | Surprise changes to many files | Preview and confirm, or disallow |
| Replay shows estimated times as exact | Misleading | Label estimated entries |

## "Looks Done But Isn't" Checklist

- [ ] **Frontmatter write:** often changes more than four lines. Verify by byte-diffing a fixture with comments, CRLF and unknown keys.
- [ ] **Open vault:** often touches files. Verify zero mtimes change after load.
- [ ] **Block refs:** work in the app but not in Obsidian. Verify each block kind (paragraph, list item, quote, callout, table) in real Obsidian and log it in `.context/HUMAN-QUESTIONS.md`.
- [ ] **Link parser:** misses code fences, `|` in tables, or aliases. Verify with a property test.
- [ ] **Folder placement:** differs between runs. Verify golden positions across two process runs and two toolchain-independent hashes.
- [ ] **Rename and move:** leaves dangling links. Verify inbound links update and the block-id index heals an external rename.
- [ ] **Nested worlds:** shimmer at depth. Verify numerically at max depth and far from origin.
- [ ] **Dock removal:** a tool loses state. Verify every D-02 tool via palette, including terminals alive after round trips and sim/timeline state.
- [ ] **Keyboard:** Esc and Cmd-K conflicts. Verify with the input-router test and a manual path out of the terminal view.
- [ ] **Search worker:** results wait for mouse movement. Verify `request_repaint` is called after every result.
- [ ] **Daily cap:** resets on relaunch. Verify the counter survives a restart.
- [ ] **Out-of-searches message:** is real in the UI, not only a log line.
- [ ] **No feedback loop:** auto cards do not trigger research. Verify with a test that feeds an auto note through the trigger path.
- [ ] **Offline:** no replay storm on reconnect. Verify with a simulated network failure.
- [ ] **Rejected proposals:** stay rejected after restart.
- [ ] **Replay:** same result on a fresh clone of the vault. Verify with a git-cloned copy.
- [ ] **Knowledge tree idle CPU:** near zero when settled.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Frontmatter mangled | MEDIUM | `git diff`/restore the vault, ship the surgical patcher, add the fixture test, re-run on the vault |
| Vault polluted with auto cards | LOW | Filter by `source: auto` and `status: unreviewed`, bulk delete from the subfolder |
| Dangling links after renames | MEDIUM | Rebuild index, heal via block-id search, offer a "repair links" command |
| Folder positions changed (hash algorithm change) | HIGH | Cannot be undone silently. Version the placement function and write explicit `world-x/world-y` for already-seen folders before changing it. Prevention is the only good answer here. |
| f32 jitter discovered late | HIGH | Requires per-world local frames. Retrofitting touches every draw and hit-test path. |
| Provider blocked or exhausted | LOW | Circuit breaker holds, fall through to the next provider, show the state |
| Watcher feedback loop | LOW | Add the write-hash suppression, kill the offending write path |
| Replay history wrong | MEDIUM | Start the event log, backfill with estimates, mark them |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Frontmatter destroyed | 1 | Byte-diff golden tests with Obsidian-style fixtures |
| 2 Load writes files | 1, 3 | Open-vault test asserts no mtime changes |
| 3 Two writers | 1, 2, 4 | Concurrent edit and drag test, atomic write, hash check |
| 4 Watch loops | 1, 2 | Idle CPU and write-count assertions, own-write suppression test |
| 5 `x/y/w/h` double meaning | 1, 3 | Schema doc plus independent folder-move and card-move tests |
| 6 Folder placement | 1, 3 | Golden positions, rename keeps position |
| 7 Block-ref syntax | 1, 3 | Exact-output fixtures per block kind, one real Obsidian check |
| 8 Link parse and write | 1 | Property test on descriptions, code-fence cases |
| 9 Resolution and rename | 1, 2 | Duplicate-basename fixtures, rename updates inbound links |
| 10 Open-any-folder crawl | 1, 2 | Background scan test on a tree with symlink loops |
| 11 f32 precision | 3 | Numeric round-trip at max depth and far offsets |
| 12 Text at scale | 3 | Frame-time and atlas-size measure while zooming |
| 13 Culling and clip | 3, 6 | Synthetic vault benchmark, clip bleed screenshot |
| 14 Hit testing and drag | 3 | Pick and drag tests at nested scale |
| 15 Zoom-to-fill flicker | 3 | Hysteresis test, camera restore test |
| 16 Dock removal | 2 | Per-tool smoke test, staged removal, build green each plan |
| 17 Cmd-K and Esc | 2 | Input-router unit test, terminal exit path |
| 18 Blocking network | 4 | Worker and queue test, repaint check |
| 19 API limits | 4 | Mock providers, pacing and 429 tests, re-verify limits |
| 20 Flooding and loops | 4 | Trigger exclusion test, dedupe and cap tests |
| 21 Debounce, cap, offline | 4 | Persisted counter test, topic-shift test, offline simulation |
| 22 Query extraction | 4 | Fixture paragraphs scored before network wiring |
| 23 Proposal noise and D-07 | 5 | Persisted rejects, no auto-description path |
| 24 Timestamps | 1, 6 | Fresh-clone replay test |
| 25 Force layout | 6 | Idle CPU, 2k-node benchmark, deterministic scrub |
| 26-39 | As listed above | Fixture or unit test per item |

## Research flags for the roadmap

- **Phase 3 needs deeper research or a spike first:** egui behavior for text, IME and hit testing under layer transforms versus fully custom painting; glyph-atlas behavior at large sizes in 0.36. These are unverified here.
- **Phase 4 needs a re-check at phase start:** provider limits, OpenAlex pricing (changed recently), whether `html.duckduckgo.com` is still reachable, Tavily free-tier rate limit.
- **Phase 1 should include a single real-Obsidian check** of block-ref output and frontmatter edits, logged for later review rather than blocking.
- Phases 2, 5 and 6 follow known patterns once the above are settled.

## Sources

- Obsidian links and block identifiers (HIGH): https://obsidian.md/help/links
- Obsidian rewrites frontmatter and drops comments, declined bug (MEDIUM-HIGH): https://forum.obsidian.md/t/bug-using-the-properties-menu-deletes-yaml-comments-from-the-frontmatter/69048 and https://forum.obsidian.md/t/yaml-properties-api-processfrontmatter-removes-alters-string-quotes-comments-types-formatting/65851/27
- OpenAlex limits and authentication, updated 2026-10-15 (HIGH): https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication
- OpenAlex example costs (HIGH): https://help.openalex.org/access/example-costs
- arXiv API terms of use (HIGH): https://info.arxiv.org/help/api/tou.html
- Wikimedia User-Agent policy (HIGH): https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
- Tavily credits (MEDIUM-HIGH): https://docs.tavily.com/guides/api-credits
- DuckDuckGo HTML scraping behavior, soft-block and backoff, community guidance only (LOW-MEDIUM): https://apiserpent.com/blog/scrape-duckduckgo-serp-for-free
- notify-debouncer-full rename handling (MEDIUM): https://docs.rs/notify-debouncer-full/^0.3
- egui `Scene` (zoom range, transform layer) (MEDIUM): https://doc.servo.org/egui/containers/struct.Scene.html
- Rerun zoom_pan_area, pointer-to-scene mapping (MEDIUM): https://ref.rerun.io/docs/rust/stable/src/re_ui/zoom_pan_area.rs.html
- Existing code reviewed: `apps/canvas/src/main.rs`, `ide.rs`, `notes.rs`, `term.rs`, `translate.rs`; `.planning/PROJECT.md`; `.context/canvas-research-brief.md`
- Items tagged MEDIUM or unverified (f32 jitter thresholds, glyph atlas limits, `serde_yaml` status, YAML 1.1 `y` handling) come from domain knowledge and should be confirmed by a spike in the phase that depends on them.

---
*Pitfalls research for: Obsidian-compatible spatial research canvas (Rust/egui)*
*Researched: 2026-10-21*
