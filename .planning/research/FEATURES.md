# Feature Research

**Domain:** Spatial research / knowledge-graph note app (Obsidian vault + infinite canvas + silent source discovery)
**Researched:** 2026-10-21
**Confidence:** MEDIUM-HIGH. Obsidian Canvas, graph view, command palette, block refs and the JSON Canvas spec were checked against official docs (HIGH). OpenAlex limits were checked against official docs and a secondary report (MEDIUM). Heptabase, Research Rabbit, Litmaps and Connected Papers come from official wiki pages plus library guides (MEDIUM). Kinopio, Scrintal, Logseq and Obsidian file-explorer details come mostly from training knowledge, because the searches returned little (LOW-MEDIUM, marked inline).

Locked decisions respected throughout (do not revisit): no chat model (D-08), the user writes every description (D-07), layout lives in note frontmatter and not in `.canvas` JSON (D-04), links are `[[Note#^id|description]]` (D-06), search is free (D-09).

---

## How the reference products actually work (interaction facts that drive the requirements)

| Product | Interaction facts worth copying or avoiding | Confidence |
|---------|---------------------------------------------|------------|
| **Obsidian Canvas** | Double-click empty canvas = new text card. Right-click canvas > "Add note from vault". Dragging a note or folder from the explorer onto the canvas adds it (a folder adds all its files). Edges: hover a card's side until a filled circle appears, drag to another card. **Release on empty space = a new card is created at the end of the line.** Edges are directed by default (arrow at the target); direction is changeable (none / one-way / both). Edge label: double-click the line, type, Esc or click away to commit. Cmd+A, Shift+click multi-select, Alt+drag duplicates, Shift+drag constrains axis, Space while dragging turns snapping off, Space+drag or middle-drag pans, Cmd/Space+wheel zooms, Shift+1 zoom to fit, Shift+2 zoom to selection, Cmd+Z undo. Groups are labeled containers (double-click name to rename). "Narrow to heading / block" shows part of a note in a card. "Canvas: Jump to group" is a palette command. | HIGH (official help) |
| **JSON Canvas spec** (Obsidian's `.canvas`) | Node = id, x, y, width, height (integers), optional color; types text / file / link / group. Edge = fromNode, toNode, optional fromSide/toSide (top/right/bottom/left), fromEnd/toEnd (none/arrow), color, **label**. Nodes drawn in array order (later = on top). Edges attach to card sides, never to a line inside a note. | HIGH (spec) |
| **Obsidian graph view** | Filters: search term, tags, attachments, existing-files-only, orphans toggle. Groups: search-term > color. Display: arrows, text-fade threshold, node size, link thickness, **Animate = time-lapse of notes by creation time** (play only, no scrubber). Forces: center, repel, link force, link distance. Local graph with a depth slider. | HIGH (official help) |
| **Obsidian command palette** | Fuzzy match ("scf" finds "Save current file"). Recently used commands sit at the top, but once you type, shorter names outrank recents. Pinned commands. Per-command hotkeys. Users ask for aliases and query-history ranking (the Another Quick Switcher plugin does this). Quick switcher (notes) is a separate palette from the command palette. | HIGH (official help) |
| **Obsidian block refs** | Type `[[Note#^` and autocomplete lists blocks; picking one writes a random ID (`^dcf64c`) at the end of the target line. ID rules: letters, digits, dashes, a space before `^` at end of line, own line with blank lines around it for tables/lists. Known bugs: duplicate IDs in one file are possible; autocomplete can rewrite an existing ID when no space precedes the caret. Block refs are not standard Markdown and do not work outside Obsidian. | HIGH (changelog + forum) |
| **Obsidian file explorer** | Click opens; chevrons collapse folders; header buttons for new note, new folder, sort, collapse-all; right-click for rename / delete / duplicate / move; drag-and-drop to move; renaming or moving rewrites incoming links automatically; auto-reveal of the active file. | MEDIUM (training knowledge; docs page was unreachable) |
| **Heptabase** | Whiteboards are unlimited canvases; **cards live in a card library and one card can appear on several whiteboards**; whiteboards nest. Sections group objects (Cmd/Ctrl+G; titles stay readable zoomed out). Connections are arrows drawn with a Connect tool. `@` mentions cards; backlinks are block-level and shown in the card's info panel. Journal for fleeting capture. Docs recommend a two-layer board structure and splitting boards past roughly 100-150 cards because of lag (the lag figure is from a competitor's page, LOW). Official fundamentals page does not mention labels on arrows. | MEDIUM |
| **Research Rabbit** | You build a **Collection** of papers; the app recommends "Similar Work", "Earlier Work" (references) and "Later Work" (citing). Multi-select a subset of papers to scope recommendations to them. Network and timeline views; **collection papers are green dots, recommendations are blue dots** (distinct visual state for "yours" vs "suggested"). Algorithm is not published. | MEDIUM |
| **Litmaps** | Start from seed papers; the map plots by year (x) vs citations (y), node size = citations, and axes are switchable. "More like this" on a recommendation feeds the next round. **Monitor** re-runs a saved search on a schedule and notifies when new papers appear. Free tier caps input articles (about 20; figures vary by source). | MEDIUM |
| **Connected Papers** | One origin paper produces one graph of roughly 40 related papers. Layout distance = similarity (co-citation + bibliographic coupling); node size = citation count; color = year. "Prior works" (older, heavily cited by the graph) and "Derivative works" (newer, citing many of the graph) lists. A hard, small cap is the anti-flooding mechanism. | MEDIUM |
| **Kinopio** | Spaces of freeform cards; connections drawn by dragging from a card's connector dot; connection types carry a name and color (acts as an edge label); cards can link to other spaces. User requests on the forum: connection layering/reordering and attaching on both left and right sides of a card. | LOW-MEDIUM |
| **Logseq** | Block-level outliner with block references; graph view shows **pages, not blocks**, so line-level links do not appear as graph density (a recurring user complaint). Filters live next to linked references. | LOW-MEDIUM |
| **Scrintal** | Heptabase-like boards of cards with bidirectional links. Little verifiable detail found; do not rely on it as a reference. | LOW |

Lessons: (1) Obsidian Canvas edges are card-to-card and keep labels in a separate JSON file, while this project wants line-to-line links with descriptions stored inside the markdown, which is a real differentiator and a real cost. (2) Every discovery tool keeps "yours" and "suggested" visually distinct and bounds the amount of suggestion. (3) Obsidian's graph "Animate" proves a replay is wanted but offers no scrubber.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Complexity: LOW (under a day), MEDIUM (a few days), HIGH (a week or more or high risk).

#### A. Vault model and Obsidian compatibility

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Plain `.md` files, folder = graph, frontmatter `x y w h` preserved round-trip with unknown keys | Core promise of "opens cleanly in Obsidian" (D-03/D-04) | MEDIUM | Use a lossless frontmatter edit (rewrite only the four keys, keep order/comments/unknown keys). Round-trip tests in Phase 1 are the guardrail. |
| Write layout only on drag/resize end; never per frame | Constraint; also avoids file-watcher storms in Obsidian | LOW | Debounce and coalesce; write atomically (temp file + rename). |
| Live reload when files change outside the app (Obsidian edits, git checkout) | Anyone with a vault open in two apps expects it | MEDIUM | File watcher (notify crate or poll). Ignore self-writes. Conflict rule: external change wins if card not mid-edit; otherwise prompt-free merge is out of scope, so keep a `.bak`. |
| Rename/move a note or folder rewrites incoming links | Obsidian does it by default; broken links after rename kill trust | MEDIUM-HIGH | Must handle `[[Note]]`, `[[Note#^id|d]]`, `[[Folder/Note...]]`, aliases. Needs a link index (shared with graph view). |
| Notes without layout (made in Obsidian) get a sensible card position without being written to | Vault will contain notes the app never placed | MEDIUM | Compute placement deterministically at load; persist only after the user moves the card. Prevents mutating files just by opening the vault. |
| Open any folder as a vault, remember last (D-11) | Obsidian-style | LOW | Settings file outside the vault; hidden dot-folder for app state inside it. |
| Undo/redo for card move, resize, create, delete, link edit | Obsidian Canvas has Cmd+Z; canvases without it feel dangerous | MEDIUM-HIGH | Because every operation is a file edit, undo must be an operation log, not a snapshot. Delete goes to a trash folder, never unlink. |

#### B. Canvas: cards

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Create a card: double-click empty canvas = new note card at the cursor, title field focused, saved as `.md` in the current graph's folder | Obsidian Canvas convention | LOW-MEDIUM | Unique default name ("Untitled", "Untitled 1"). Empty untouched cards should not leave junk files: create file on first non-empty edit or on blur with content. |
| Create a card from the explorer by dragging a note onto the canvas (moves view/card, no duplication) | Verified Obsidian behavior | LOW | In this app a note is always one card in its folder's graph, so drag = "place or fly to". |
| Drag to move, corner/edge handles to resize, min size, z-order on click | Basic | LOW | Persist on release only. |
| Multi-select (Shift+click, box select), move together, Delete, Cmd+A | Verified Obsidian shortcuts | MEDIUM | Delete = trash with undo, and warn when it has incoming links. |
| Snapping to neighbors, Space (or modifier) disables it, Shift constrains axis, Alt+drag duplicates | Verified Obsidian shortcuts | LOW-MEDIUM | Snapping is optional polish; axis-constrain and disable-snap are cheap. |
| Pan (Space+drag / middle-drag / two-finger scroll), zoom to cursor, zoom to fit, zoom to selection | Verified; mouse-only (no pen) environment per project notes | LOW | Cmd+scroll zoom vs scroll pan must be a deliberate choice; mouse users need wheel-zoom to be the default. |
| In-card markdown editing (plain text with syntax highlighting is enough), Esc leaves edit mode | Cards are notes | MEDIUM | egui `TextEdit` with a layouter. `[[` autocomplete is in section C. Rendered preview is not required. |
| Level-of-detail by zoom: far out shows title only (and a color), mid shows first lines, close shows the full editor | Heptabase titles of sections stay readable; any infinite canvas needs it | MEDIUM | Also required for performance past ~100 cards (Heptabase documents lag at that size). Skip text layout for off-screen and tiny cards. |
| Folder frames/labels drawn around a graph's region | Already exist in ide.rs; Heptabase sections equivalent | LOW | Reuse ide.rs. |

#### C. Links: line-anchored, described, cross-graph

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `[[` autocomplete: type `[[`, search notes (fuzzy, across all folders), then `#^` lists target lines, then `|` starts the description | This is how Obsidian users make block links; the drag gesture is only a second path to the same text | MEDIUM | Both paths must write the identical string `[[Folder/Note#^id|description]]`. |
| Drag to connect: hover a line in a card, a handle appears at the card edge at that line's height; drag onto another card (whole-note link) or hover a specific line in the target (block link); **release on empty space creates a new card there and links to it** | Copies Obsidian Canvas's best gesture (verified) and extends it to lines | HIGH | Hit-testing lines inside two scrollable text widgets in egui is the hard part. Target highlight must show which line will be linked. |
| Immediately after the drop, focus an inline description field at the edge midpoint; Enter commits `|description`, Esc keeps the link undescribed (plain `[[Note#^id]]`) | Matches "double-click the line, type, Esc" labeling (verified); satisfies D-07 because the user types it | MEDIUM | An undescribed link is allowed but drawn differently (thinner/dashed) so unfinished links are visible. The app never fills the field. |
| Edit a description later: double-click the edge or its label; Esc/click-away commits | Verified Obsidian behavior | MEDIUM | Editing a label = rewriting the link text in the source file. Must find the link by (file, line, ^id) and not by character offset. |
| Delete an edge: select + Delete removes the link syntax but keeps the display text as plain text (non-destructive), with undo | Obsidian removes the line; destructive text loss in a note is worse here | MEDIUM | Needs a clear menu label ("Remove link"). |
| Stable `^id` created lazily: only when a line first becomes a link target; 6-char lowercase alphanumeric; reuse the existing ID if the line has one | Verified Obsidian format; avoids littering notes with unused IDs | MEDIUM | Collision check per file. Handle the "space before ^" rule and the block-on-own-line rule for lists/tables. Writes to the **target** file, which may be open elsewhere, so route through the same watcher/undo layer. |
| Edge drawn from the specific source line (follows text scroll; clamps to card edge when the line is scrolled out of view) to the target card/line | The whole point of line-anchored links | HIGH | Compute line y from the layouter galley. Reuse the Bezier curve style from ide.rs:1025-1045. |
| Label pill at the curve midpoint showing the description; truncated at mid zoom, hidden when far; full text on hover | Obsidian renders edge labels as text on the line | MEDIUM | Collision avoidance between labels is optional. |
| Cross-graph links render without crossing the whole world: when the target is in another folder region, draw to the near border of that folder frame with a stub showing "Folder/Note", and click flies there | Obsidian Canvas has no equivalent; unavoidable once folders are separate regions | HIGH | Also needs "back" navigation (see section F). |
| Backlinks: select a card and see incoming links (with their descriptions) | Obsidian, Logseq, Heptabase all expose this | MEDIUM | A small list in the card footer or sidebar section. Same index as rename-rewrite. |

#### D. Nested folders as sub-worlds

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Each subfolder appears inside its parent as a smaller scaled graph; zoom into it and it fills the screen | Locked (D-05) | HIGH | No mainstream reference has semantic zoom of this kind (Heptabase nests whiteboards as click-through). Needs a per-folder transform stack and f32 precision care at deep zoom. |
| Visible "where am I": breadcrumb of folder path, and a way up (Esc or breadcrumb click) | Any nested-space product (Heptabase sub-whiteboards, Kinopio spaces) has this | LOW-MEDIUM | |
| Zoom-to-enter threshold: crossing a size threshold switches interaction to the child graph; before that, the child is a non-editable thumbnail | Prevents mis-clicks into tiny cards | MEDIUM | |
| Explorer click on a folder flies the camera to it | Reuses the same camera animation as "jump to group" (verified palette command in Canvas) | LOW | |
| Deterministic folder placement from the path hash, with the user's move stored in `Folder/Folder.md` | Locked (D-05) | MEDIUM | New folders must not cause existing folders to move; collision-resolve by deterministic probing order, not by "first free spot". |

#### E. Explorer sidebar

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Tree of folders and notes, chevrons, expand state remembered | Obsidian-style (D-01) | LOW-MEDIUM | |
| Click note = fly to its card and select it; click folder = fly to its region; double-click or Enter = start editing | Replaces Obsidian's "open in tab" | LOW | |
| Header buttons: new note, new folder, sort (name, modified, created), collapse all | Obsidian | LOW | |
| Right-click menu: new note here, new folder here, rename, delete (to trash), duplicate, copy path, reveal on canvas | Obsidian | MEDIUM | |
| Inline rename (F2 or Enter on selection), Esc cancels | Obsidian | LOW | Rename triggers link rewrite (section A). |
| Drag in the tree to move a note between folders (= move between graphs), drag out onto the canvas to place | Obsidian + verified Canvas drag | MEDIUM | Moving between folders changes which graph and region the card belongs to; frontmatter x/y should be kept but clamped into the destination region. |
| Highlight the card currently selected on canvas in the tree (auto-reveal) | Obsidian | LOW | |
| Drag-resize the width, toggle with a hotkey, close with an X; state remembered | Locked (D-01) | LOW | |
| Filter box or `Cmd-F` in the tree | Large vaults | LOW | Fuzzy match on names; do not build full-text search here. |

#### F. Cmd-K command palette

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cmd-K opens a centered overlay, input focused, fuzzy-ranked list, arrow keys + Enter, Esc closes | Universal | LOW-MEDIUM | |
| One list for **commands and notes** (Linear/Raycast style), with a type badge; optional `>` prefix to restrict to commands | Obsidian splits quick switcher and command palette; one palette is simpler for a single-window app | MEDIUM | Ranking: exact/prefix beats fuzzy; recents shown on empty query; once typing, do not let recents outrank clearly better matches (Obsidian's documented annoyance). |
| Every existing tool listed as a command (Canvas sim, Brushes, Rules, Timeline, Files/IDE, Terminals, editor tabs, highlight notes, marks, Knowledge tree) opening full-window; Esc returns to the canvas, with a visible "Esc to return" hint | Locked (D-02) | MEDIUM | The hint matters: with no dock, the only way back is Esc. |
| Show hotkeys next to commands; commands that need a selection are hidden or dimmed when there is none | Standard | LOW | |
| Canvas navigation commands: jump to folder, jump to card, zoom to fit, back/forward | Verified "Jump to group" precedent | LOW | |
| Palette state is keyboard-only reachable even while a card is in edit mode (Cmd-K must not be swallowed by the text widget) | Typical egui focus bug | LOW | Handle at the app level before widgets. |

#### G. Knowledge-graph view (knowledge tree)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Nodes = notes, edges = links, folder membership as color and/or soft cluster hull | Locked (D-10); Obsidian "groups" color precedent | MEDIUM | Edges aggregate to note level; show description on hover. |
| Force-directed layout that updates live as notes and links change, without resetting positions | Obsidian does this | MEDIUM-HIGH | Incremental simulation; run off the UI thread or cap per-frame cost. |
| Pan/zoom, hover highlights neighbors, click node flies to its card on the canvas, drag node, pause simulation | Obsidian behaviors | MEDIUM | |
| Controls (keep to a small set): search/filter, show/hide orphans, show/hide source cards, show/hide proposed edges, node size by degree, label fade by zoom, link arrows toggle | Obsidian's verified controls minus the force sliders | MEDIUM | Defer exposed force sliders; ship good defaults. |
| Local graph: selected note + N hops, depth slider | Verified Obsidian feature, heavily used | MEDIUM | Cheap once the link index exists. |
| Distinct look for **your notes** vs **source cards** vs **proposed (not yet kept) links** | Research Rabbit green/blue, Litmaps white nodes | LOW | |

#### H. Silent research

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Background worker; network never touches the UI thread; failures surface in a quiet status chip, never a modal | Constraint | MEDIUM | Channel to the UI; one in-flight request per provider. |
| Query derivation from the text being written, no LLM: keywords (TF-IDF or RAKE-style over note text) plus Model2Vec embedding of the recent passage | Locked (D-08) | MEDIUM | Use the paragraph or last N lines around the cursor, not the whole note. |
| **Debounce on idle AND topic shift:** fire only after typing pauses (a few seconds) and only if the embedding of the current passage is far enough from the last queried passage | Locked (D-08); this is the main anti-flood control | MEDIUM | Threshold is a tuning knob; log (query, distance) for tuning. |
| User-settable daily cap, counter visible, "out of searches" shown when exhausted, per-provider backoff on 429 | Locked (D-08) | LOW-MEDIUM | See rate-limit note below. |
| Source card content: title, authors, year, venue, abstract excerpt, URL/DOI, provider badge, cited-by count when known | Every discovery tool shows at least title/authors/year/citations | MEDIUM | OpenAlex returns abstracts as an inverted index and needs reconstruction. |
| Placement near the prompting card without overlap, in a stable fan/ring, never on top of user cards | Cards that land on user work feel hostile | MEDIUM | Reuse the empty-spot search needed for folder placement. |
| Distinct "suggested" state for source cards (dashed border, muted color, small badge) vs "kept" | Green vs blue dots (Research Rabbit) | LOW | |
| Keep / Dismiss on each source card. Keep = becomes a normal note (state change in frontmatter). Dismiss = removed and remembered so it never returns | Anti-flood: dismissals must stick | MEDIUM | Store the ledger in a hidden dot-folder (not in note frontmatter, so Obsidian shows nothing odd). |
| Dedupe across providers and across runs by DOI, then normalized title | Same paper from OpenAlex and arXiv | LOW-MEDIUM | |
| Provenance on every source card: the query that found it, the provider, the prompting note, the time | Silent means unexplained; users need to be able to ask "why is this here" | LOW | Hover or footer text; stored in the source card's frontmatter. |
| Pause/resume toggle for research | Any silent automation needs an off switch | LOW | |

#### I. Proposed connections

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Proposals drawn as faint dashed edges with Keep and Turn down controls, reusing the swarm proposals UI pattern | Locked (D-07); existing code at swarm.rs `proposals_ui` | MEDIUM | |
| **Keep opens the description field; the app writes nothing until the user types one** (Enter commits, Esc leaves the proposal pending) | Locked (D-07) | MEDIUM | |
| Turn down is remembered (ledger) and never re-proposed; a "show turned-down" toggle to restore | Smart Connections-style tools get annoying when rejected items return | LOW-MEDIUM | |
| Never propose a link that already exists, a self-link, or a duplicate pair in the other direction | Basic hygiene | LOW | |
| Cap the number of pending proposals shown (for example 5 per selected card, global max visible), ranked by score | Anti-flood | LOW | |
| Citation-derived proposals first (OpenAlex `referenced_works`) between cards already in the vault; embedding-similarity proposals second | Citation links are high precision and deterministic; similarity is noisy | MEDIUM | Show the reason on hover ("cites", "cited by", "similar 0.71"). |

---

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Line-anchored described links stored in plain markdown** (`[[Note#^id|description]]`) rendered as canvas edges | Obsidian Canvas edges are card-to-card and live in a separate `.canvas` file; Heptabase arrows are proprietary; Logseq block refs do not show in its graph. Here the edge and the sentence that caused it are the same thing, and it survives in Obsidian | HIGH | The core differentiator; build it with the most tests. |
| **Silent, writing-driven source discovery** | Research Rabbit, Litmaps, Connected Papers all start from a seed paper you add. This starts from what you write, with no prompt box | HIGH | Quality of query derivation decides whether this is magic or noise. |
| **Embedding-reranked results**: score each candidate's title+abstract against the passage with the existing Model2Vec model and drop weak ones before showing | No extra cost, no LLM, strongly reduces junk; falls out of embed.rs | MEDIUM | Biggest lever for "feels relevant". |
| Citation-aware proposals linking source cards to each other and to your notes | Research Rabbit's earlier/later work, but scoped to your vault and turned into editable links | MEDIUM-HIGH | Needs a cheap local citation graph: store each source's `referenced_works` IDs in frontmatter. |
| Nested folders as zoomable sub-worlds with per-folder cameras | Spatial memory of a whole vault in one world; unique among the references | HIGH | Also the highest rendering risk. |
| Knowledge tree **replay with a scrubber** (play, pause, speed, drag to any date) | Obsidian's Animate is play-only | MEDIUM-HIGH | See event-log dependency below. |
| Cross-graph links that read as a real edge between sub-worlds | Obsidian has no spatial notion of cross-folder links | HIGH | |
| "Found for this line" provenance edge from a source card back to the prompting line | Makes discovery explainable and spatial | MEDIUM | Anchor is created lazily (see Pitfalls note below). |
| Timeline strip on the research chip: when searches ran, how many cards were kept vs dismissed | Lets the user tune the daily cap with evidence | LOW-MEDIUM | Could ride on the same event log as replay. |
| All existing tools (cellular sim, mimic swarm, terminals) one Cmd-K away | None of the references have them | LOW (already built; cost is the host shell) | |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Chat panel / LLM answers about sources | Every research app now has one | Out of scope (D-08); adds cost and a dependency | Silent cards, user reads and writes |
| App-written link descriptions or auto-"summaries" of sources | Saves typing | Violates D-07; the description is the thinking | Proposals with a reason tag ("cites") and an empty field for the user |
| Auto-accepting proposals or auto-writing links | Faster graph growth | Every link in the vault must be a user decision; also silently edits the user's text | Keep/Turn down only |
| Writing into the note the user is currently typing in (inserting source links or `^id`s mid-edit) | "Link from the line that prompted it" | Cursor jumps, undo history corruption, Obsidian sync conflicts | Store provenance in the source card's frontmatter; create the `^id` on the prompting line only when the user keeps the card, and never while that note is focused for typing |
| Obsidian `.canvas` JSON as layout | Obsidian-native canvas compatibility | Rejected (D-04); two sources of truth | Frontmatter `x y w h` |
| Per-frame or autosave-on-every-keystroke frontmatter writes | "Live" feel | Constraint; file-watcher loops and Obsidian re-indexing | Write on drag/resize end |
| Automatic force-layout of canvas cards | Neat graph for free | A card's position is the user's meaning; reflowing moves things they placed | Auto-layout only in the knowledge tree; canvas gets only placement of new/unplaced cards |
| Flooding: dozens of source cards per trigger, or every keystroke triggering search | "More results = more value" | Observed pattern: Connected Papers caps near 40 nodes, Litmaps free tier caps inputs, Research Rabbit scopes by selection. Unbounded drops bury the user's own notes | Per-trigger cap (3-5), daily cap, idle+topic-shift debounce, persistent dismiss ledger, pending-suggestion cap |
| Paid APIs / per-search billing | Better results | Locked (D-09) | Free providers + optional Tavily key |
| Plugin system, themes marketplace, sync, publish, collaboration, mobile | Obsidian parity | Years of work, none serves "build a mental model of a subject" | Keep the vault portable: Obsidian can handle those |
| Rich WYSIWYG markdown editor | Prettier cards | Large, fragile in egui | Syntax-highlighted plain text, optional light preview later |
| Tag taxonomy, properties UI, Dataview-style queries | Obsidian power-user features | Structure comes from folders + described links | Folders and links only; frontmatter editable as text |
| Scraping DuckDuckGo as a primary source | Free general web | Fragile HTML, may block, ToS gray | Last-resort fallback only (D-09), clearly labeled low confidence in the card |
| Force sliders (center / repel / link distance) in v1 graph view | Obsidian has them | Tuning UI nobody needs when defaults are good | Fixed good defaults; expose later |
| Showing every block of every note as a graph node (Logseq-style) | Fine-grained | Hairball; Logseq users complain the graph is unreadable or blank | Note-level nodes; line-level detail on the canvas |
| PDF reader / web clipper / Zotero sync | Common research needs | Separate products | Source card links out via URL/DOI; revisit after the milestone |

---

## Feature Dependencies

```
Vault model (md + frontmatter round-trip + link parser/index)
    ├──requires──> Lossless frontmatter edit, atomic writes, file watcher
    ├──enables──> Rename/move rewrites links
    ├──enables──> Backlinks, graph view, local graph
    └──enables──> Described link parse/write [[Note#^id|description]]

Lazy ^id creation ──requires──> write to TARGET file ──requires──> watcher + undo log

Infinite canvas + explorer + Cmd-K (Phase 2)
    ├──requires──> Vault model
    └──enables──> every later interaction (fly-to, jump-to, back/forward)

Card create/move/resize (Phase 3)
    └──requires──> Canvas shell + frontmatter writer

Drag-to-connect ──requires──> line hit-testing in cards ──requires──> card text layout (galleys)
Drag-to-connect ──enhances──> [[ autocomplete  (same output string; build the string builder once)
Cross-graph links ──requires──> Nested folder regions + folder frames
Nested sub-worlds ──requires──> Deterministic folder placement + per-folder camera + LOD

Silent research (Phase 4)
    ├──requires──> Vault model (source cards are notes) + placement ("empty spot" finder)
    ├──requires──> Provider trait + background worker + daily cap store
    ├──requires──> embed.rs (query derivation + reranking)
    └──requires──> Dismiss ledger + dedupe store (hidden dot-folder)

Proposed connections (Phase 5)
    ├──requires──> Link index + source cards with referenced_works stored
    ├──requires──> Description field UI from drag-to-connect
    └──enhances──> Silent research (citation edges between arrived sources)

Knowledge tree live view (Phase 6) ──requires──> Link index
Growth replay ──requires──> note `created` timestamps + a link/arrival EVENT LOG recorded from Phase 3 onward
    (links carry no timestamp in markdown; file mtimes are unreliable after git checkout or copy)

Rename-rewrite ──conflicts──> doing link edits as raw text offsets (always address links by file+line+^id)
Auto-layout of cards ──conflicts──> user-meaningful positions (D-04 frontmatter)
Writing into the focused note ──conflicts──> user typing (so research never edits it live)
```

### Dependency Notes

- **Growth replay needs data from before Phase 6.** Markdown links have no timestamps. Start an append-only event log (link added/removed/described, note created, source arrived/kept/dismissed) in a hidden dot-folder when Phase 3 ships, plus `created:` in frontmatter for every new note. Without it, Phase 6 can only replay note creation dates. This is the single most important cross-phase dependency found.
- **Link index is shared infrastructure.** Backlinks, rename-rewrite, graph view, proposal de-duplication and cross-folder resolution all need one parsed index of `[[...]]` with (source file, source line, target file, target ^id, description). Build it in Phase 1 and test it hard.
- **One link-string builder.** Drag-to-connect, `[[` autocomplete, and Keep-on-proposal all end in the same markdown. Centralize it so the three paths cannot diverge.
- **Empty-spot finder is used three times** (folder regions, nested sub-worlds, source card placement). Write it once in the vault/placement module.
- **Source cards are ordinary notes** with extra frontmatter (`source: openalex`, `doi`, `status: suggested|kept`, `found_by`, `referenced_works`), so they open in Obsidian and appear in the explorer. Do not invent a second store for them.

---

## MVP Definition

### Launch With (v1) — maps onto the six-phase plan in the brief

- [ ] Vault model: md + frontmatter layout round-trip, folders as graphs, `^id` anchors, described links incl. cross-folder, link index, rename-rewrite (Phase 1)
- [ ] Shell: infinite canvas, explorer (tree, click-to-fly, new/rename/delete/move, resize/close), Cmd-K palette with commands + notes hosting every old tool full-window, vault open/remember (Phase 2)
- [ ] Card create/move/resize/select/delete with undo; drag-to-connect with inline description; `[[` autocomplete; edge labels; nested folders with zoom-to-fill; cross-graph link stubs; **start the event log** (Phase 3)
- [ ] Silent research: provider trait, OpenAlex + arXiv + Wikipedia, worker, idle+topic debounce, per-trigger cap, daily cap and "out of searches" chip, embedding rerank, dedupe, suggested-state cards with Keep/Dismiss and provenance (Phase 4)
- [ ] Proposed connections: citation first, similarity second, Keep (type description) / Turn down with memory, capped (Phase 5)
- [ ] Knowledge tree: live graph with filters, orphans toggle, local graph, fly-to-card, distinct node kinds; replay scrubber (Phase 6)

### Add After Validation (v1.x)

- [ ] Tavily and DuckDuckGo providers wired behind the trait (trait ships in Phase 4, extra providers can follow) — add when OpenAlex/arXiv/Wikipedia prove thin for the user's topics
- [ ] Groups/sections inside a graph (Heptabase sections, Obsidian groups) — add if cards pile up
- [ ] Narrow-to-heading/block card views (Obsidian Canvas precedent)
- [ ] Palette aliases and query-history ranking
- [ ] Optional OpenAlex API key setting (a free key raises the daily budget tenfold; see Pitfalls)
- [ ] Graph view force sliders; time-lapse export

### Future Consideration (v2+)

- [ ] Local-model source summaries via Ollama (explicitly deferred in PROJECT.md)
- [ ] Monitor-style recurring searches (Litmaps) that run while the app is closed
- [ ] Card appearing in several graphs (Heptabase card library model) — conflicts with "a note lives in one folder"
- [ ] PDF/web clipping, Zotero import

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Frontmatter round-trip, link index, `^id` | HIGH | MEDIUM | P1 |
| Rename/move rewrites links | HIGH | MEDIUM-HIGH | P1 |
| Canvas shell: pan/zoom/fit, explorer, Cmd-K | HIGH | MEDIUM | P1 |
| Create/move/resize cards, undo | HIGH | MEDIUM-HIGH | P1 |
| Drag-to-connect from a line + inline description | HIGH | HIGH | P1 |
| `[[` autocomplete with `#^` and `|` | HIGH | MEDIUM | P1 |
| Nested sub-worlds with zoom-to-fill | MEDIUM-HIGH | HIGH | P1 (locked) |
| Cross-graph link stubs | MEDIUM | HIGH | P1 (locked) |
| Silent research core (worker, debounce, cap, cards) | HIGH | HIGH | P1 |
| Embedding rerank + dedupe + dismiss ledger | HIGH | MEDIUM | P1 (without them the feature floods) |
| Provenance + pause toggle + status chip | MEDIUM-HIGH | LOW | P1 |
| Citation proposals | MEDIUM-HIGH | MEDIUM | P1 |
| Similarity proposals | MEDIUM | MEDIUM | P1 |
| Live graph view + filters + local graph | MEDIUM-HIGH | MEDIUM-HIGH | P1 |
| Replay scrubber | MEDIUM | MEDIUM | P2 (depends on the event log existing) |
| External-change watcher | MEDIUM-HIGH | MEDIUM | P1 for Obsidian coexistence |
| Backlinks list | MEDIUM | MEDIUM | P2 |
| Sections/groups | MEDIUM | MEDIUM | P3 |
| Palette aliases, force sliders | LOW | LOW-MEDIUM | P3 |

**Priority key:** P1 must have for launch; P2 should have; P3 nice to have.

---

## Competitor Feature Analysis

| Feature | Obsidian (+Canvas) | Heptabase / Kinopio | Research Rabbit / Litmaps / Connected Papers | Our Approach |
|---------|--------------------|---------------------|----------------------------------------------|--------------|
| Card creation | Double-click; drag from explorer; drag edge to empty space | Toolbar tools; `@` mention | n/a (papers added to collections) | Double-click and edge-to-empty-space both create a real `.md` note |
| Edge | Card side to card side, optional label, in `.canvas` JSON | Arrow (Heptabase), typed/colored connection (Kinopio) | Citation lines / similarity distance | Source **line** to target line or note, description inside the markdown |
| Nested spaces | Folders only in the explorer; canvases embed canvases poorly | Nested whiteboards (click through) / space links | n/a | Scaled sub-worlds, zoom to enter |
| Discovery | Plugins only | None native | Seeded by chosen papers; user pulls | Pushed silently from writing, bounded and dismissable |
| Anti-flood | n/a | n/a | Small graph cap (~40), seed scoping, free-tier limits, manual "add" | Idle+topic-shift debounce, per-trigger and daily caps, persistent dismiss ledger, embedding rerank, pending cap |
| "Yours" vs "suggested" | n/a | n/a | Green vs blue dots; white recommendation nodes | Dashed/muted suggested cards and edges |
| Command palette | Cmd-P commands + Cmd-O notes, fuzzy, recents, pinned | Quick find | n/a | One Cmd-K for commands and notes |
| Graph view | Filters, groups, display, 4 forces, local depth, Animate time-lapse | Not a core feature | Network + timeline | Live graph, local graph, orphan/source/proposal toggles, scrubbable replay |
| Replay | Animate (play only, by creation time) | n/a | n/a | Scrubber over an event log |

---

## Sources

- JSON Canvas 1.0 spec: https://jsoncanvas.org/spec/1.0/ (HIGH)
- Obsidian Canvas help: https://obsidian.md/help/plugins/canvas (HIGH)
- Obsidian Graph view help: https://obsidian.md/help/plugins/graph (HIGH)
- Obsidian Command palette help: https://obsidian.md/help/plugins/command-palette (HIGH)
- Obsidian v0.9.5 changelog (block references): https://obsidian.md/changelog/2020-10-19-desktop-v0.9.5/ and forum thread https://forum.obsidian.md/t/block-reference-id-generation-question/7669 (HIGH/MEDIUM)
- Heptabase wiki, Fundamental Elements: https://wiki.heptabase.com/fundamental-elements ; Sections: https://wiki.heptabase.com/section (MEDIUM)
- ResearchRabbit guides: https://library.hkust.edu.hk/sc/researchrabbit/ , https://researchrabbit.notion.site/c33b4a61e453431482015e27e8af40d5 (MEDIUM)
- Litmaps features: https://www.litmaps.com/features ; HKUST guide https://library.hkust.edu.hk/sc/litmaps/ (MEDIUM)
- Connected Papers guides: https://nesslabs.com/connected-papers , https://libguides.hkust.edu.hk/citation-chaining/connected-papers (MEDIUM)
- Kinopio forum, connection suggestions: https://forum.kinopio.club/t/connection-suggestions/194 (LOW)
- OpenAlex authentication and pricing: https://help.openalex.org/api-reference/authentication.md (MEDIUM; numbers from secondary reports differ, see Pitfalls)
- Logseq forum threads on graph view (page-level only): https://discuss.logseq.com/t/confusion-about-the-graph-view-whats-the-point-of-it-if-you-rely-on-blocks-and-journals/28136 (LOW)
- Obsidian file explorer, Scrintal specifics: training knowledge, not verified (LOW)

---
*Feature research for: spatial research / knowledge-graph note app*
*Researched: 2026-10-21*

## Facts that change phase plans (for the roadmap)

1. **OpenAlex is not unlimited-free.** It works without a key, but the free allowance is small (official docs: roughly $0.10/day keyless vs $1/day with a free key; list calls about $0.0001, search about $0.001, so on the order of 100 searches/day keyless, 10x with a key; a secondary source quotes about 1,000 credits/day keyless, and the numbers have changed before). Make the daily cap default well under that, cache results on disk, honor 429s with backoff, and add an optional `OPENALEX_API_KEY` setting. Re-check the figures at Phase 4 start. arXiv's published etiquette (roughly one request per 3 seconds) and a Wikipedia `User-Agent` requirement are from training knowledge and should be re-verified then.
2. **Replay needs an event log started by Phase 3**, not Phase 6 (see Dependency Notes).
3. **The research worker must not edit the note being typed in.** The brief says source cards are "linked from the line that prompted them"; implement that link as frontmatter provenance on the source card, and create the `^id` on the prompting line lazily when the user keeps the card.
4. **Unplaced notes and moved notes need placement rules** (compute at load, persist only on user move), otherwise merely opening an Obsidian-made vault rewrites its files.
