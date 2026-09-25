---

kanban-plugin: board

---

## Start here

- [ ] **How to read this board**
	Each column is one feature, named `Plugin · Feature`. Each card is a big piece of that feature, sized to be one session. Sketch it first, then build it.
- [ ] **Plugins**
	Core = app host, not a plugin
	Ink = `plugins/data-drawing`
	Math = `plugins/mathspace`
	Notes = `plugins/tapestry-notes`
	Arrange = new
	Threads = `plugins/tapestry-threads`
	Workspace = `plugins/workspace-files`
	Vault = `plugins/obsidian-vault`
	Body = new, from `ws/hands-face-voice`
	Agents = MCP + chat panel
	History, Trust = core
	Design = Kaelen's lane, feeds every plugin
- [ ] **Tags**
	#decide = needs Kaelen before building
	Plugin tags (#ink, #math …) let you filter by plugin
- [ ] Design context: [[Design Review - One Canvas]] · live status: [[Feature Board]]


## Design · Visual language

- [ ] **Token pass**: route the 261 hard-coded colours in the renderer through `--tap-*` variables, so design changes land in one place #design
- [ ] **Type, colour, spacing, radius, shadow scales**: first pass in [[Spec - Notes, Lines and Motion]] §1 #design
- [ ] **One line weight**: pen-like, round caps, shared by outlines, selection, threads, wires #design
- [ ] **Light and dark themes** #design
- [ ] **Icon set**: chunky, Aseprite-ish but not retro; cursors and grab hand first (SVG) #design


## Design · Canvas objects

- [ ] **Note restyle**: pencil outline seeded by note id, fonted title + rule, red and blue corner dots (spec §4) #design #notes
- [ ] **Hover bloom and click selection**: bloom from the entry point, blue outline grows from the click (spec §4) #design
- [ ] **Hand-drawn line renderer**: wobble, width variation, grainy edges, constant screen weight (spec §2b) #design
- [ ] **Wavy loop lines**: travelling sine waves on selection outlines and connections (spec §2b) #design
- [ ] **Line tuning playground**: built as [Line Lab](https://claude.ai/artifact/7Z98pZQhW67Mm5haottzrf); Kaelen tunes, then copies the values into the spec #design
- [ ] **Red delete button**: dot → whitened button with ✕; nothing else grows (spec §4) #design #trust
- [ ] **Format bar**: `f` expands to `f i b u ✱` (✱ = more symbols); icons expand in place; per-letter formatting (spec §4) #design #notes
- [ ] **Note settings button**: right of `f`; flips the note to show its settings (spec §4) #design #notes
- [ ] **Value dots and wiring**: `● value` rows, drag between dots (spec §3, §8) #design #math
- [ ] **Rules with a code window**: natural language compiles to the expression that runs and gets recorded (spec §8) #design #math
- [ ] **Anatomy of a note**: remaining states: editing, locked, agent-owned #design
- [ ] **Semantic zoom**: constant line weight; note → circle → node dot, thresholds in note settings (spec §2a) #design
- [ ] **Ink and math on paper**: stroke rendering, graph lines, labels #design
- [ ] **Connections and threads**: line weights, arrowheads, labels #design
- [ ] **Frames and trees**: borders, headers, nesting #design


## Design · Motion and feedback

- [ ] **Motion engine**: render-only springs; nothing reaches the `.tree` (spec §7) #design
- [ ] **Bob curve as an editable note**: anyone can tune it in Tapestry (spec §7) #design
- [ ] **Entering a note**: shared-element lerp, title flies to its fullscreen place (spec §7) #design #notes
- [ ] **Rifling**: things drift from the cursor, text barely bobs (spec §7) #design
- [ ] **Move particles**: a few N++-style wind specks at starts and stops (spec §7) #design
- [ ] **Motion settings**: per-effect strength + off; respects reduce-motion; a fun settings button #design
- [ ] **Describe-a-brush**: type what you want, get a brush spec (spec §9) #design #ink #agents
- [ ] **Tool feedback**: cursors, hover previews, erase preview, drop targets #design
- [ ] **Agent presence**: how agent activity looks on the canvas #design


## Core · Tool host

- [ ] **Brief the running canvas window on tools**: it doesn't know about toolbars yet #core
- [ ] **ToolContribution API** in the SDK: icon, cursor, pointer handlers, options #core
- [ ] **Input router**: the active tool gets the pointer; pen vs mouse vs touch; hold-to-peek #core
- [ ] **Shared stage**: one GL layer under the DOM notes, driven by the canvas camera #core
- [ ] **Retire full-window surfaces** into focused views #core


## Core · Brush dock

- [ ] **Dock layout**: which edge, collapse, tablet sizing #core
- [ ] **Tool options popover**: size, colour, mode per tool #core
- [ ] **Shortcuts and quick switch**: keys, hold-to-peek, maybe a radial menu #core
- [ ] **Should the dock be a thing in the world?** (The World Contains Its Controls) #core #decide


## Ink · Pen

- [ ] **Move the pen onto the shared stage**: the fence and brushes leave the full-window surface #ink
- [ ] **Pressure, tilt, palm rejection** #ink
- [ ] **Latency budget on the main canvas**: re-measure with a real pen #ink
- [ ] **Feel presets and smoothing** #ink


## Ink · Eraser

- [ ] **Whole-stroke erase** #ink
- [ ] **Partial erase**: splitting strokes #ink
- [ ] **Erase as deletion**: locks, undo, provenance #ink
- [ ] **What can the eraser touch?** Ink only, or math shapes and notes too #ink #decide


## Ink · Stroke journal

- [ ] **Stroke record shape in `.tree`** (D1) #ink #decide
- [ ] **Grouping strokes into drawings** #ink
- [ ] **Replay and scrub strokes** #ink
- [ ] **Anchoring**: strokes stick to the note or shape they mark #ink


## Ink · Handwriting and shapes

- [ ] **Handwriting → text**: local recognition #ink
- [ ] **Ink gestures on text**: circle, underline, arrow → link #ink
- [ ] **Shape recognition**: rough circle → circle, arrow → connection #ink


## Math · Math tool

- [ ] **Expression box on the canvas** (D5) #math #decide
- [ ] **Parse to a shape node in the current space** #math
- [ ] **Inline detection in notes** (later) #math


## Math · Graphs and shapes

- [ ] **Plot functions on the canvas camera** #math
- [ ] **Implicit shapes** `f(x) = 0` #math
- [ ] **Parameters and sliders as nodes** #math
- [ ] **Styling**: line, fill, labels #math


## Math · Rules and physics

- [ ] **Rule nodes**: gravity, springs, selectors #math
- [ ] **Live regions**: the sim runs inside a frame (D2) #math #decide
- [ ] **Strokes as bodies**: ink that falls, swings, collides #math #ink
- [ ] **Determinism and replay on the canvas** #math


## Math · Spaces and views

- [ ] **Space notes**: dimension, metric, non-Euclidean #math
- [ ] **View notes**: N-D → page projection #math
- [ ] **Z-depth / 3D view of the canvas** #math


## Math · Procedural worlds

- [ ] **Generator as a note**: seed + rules text + version; the world is never stored, only regenerated #math
- [ ] **Position-hashed randomness**: any spot can be built on its own, in any order #math
- [ ] **Derived ids**: generated things get ids from seed + place, so edits can point at them #math #trust
- [ ] **Overrides**: store only what people or agents changed, keyed by derived id #math #trust
- [ ] **Coarse to fine loading**: touched things first, then coarse, then detail near the camera #math #design
- [ ] **Coarse sim off-screen** (Kaelen chose, 2026-09-24): low-detail sim while unobserved, then fill in detail on arrival #math
- [ ] **Generator versions**: pin them; bake touched regions before upgrading #math #trust


## Notes · Write tool

- [ ] **Click to place a note at the pointer** (D4) #notes #decide
- [ ] **Type anywhere**: start typing on empty canvas #notes
- [ ] **Note sizes, styles, templates** #notes


## Notes · Rich text

- [ ] **Fold the floating toolbar into the dock's Write options** #notes
- [ ] **Embeds**: ink, math, files inside a note #notes
- [ ] **Passage links polish** (from 2.1) #notes


## Arrange · Select and move

- [ ] **Select, multi-select, lasso over any kind of node** #arrange
- [ ] **Transform handles**: move, resize, rotate #arrange
- [ ] **Snapping and align guides** #arrange
- [ ] **Group into a frame** #arrange


## Arrange · Frames and navigation

- [ ] **Resizable folder frames** (2.6) #arrange
- [ ] **Moving between trees**: ids, edges, locks #arrange #decide
- [ ] **Forest bar and tree navigation** #arrange
- [ ] **Pan/zoom feel**: wheel behaviour #arrange #decide


## Connections · Links and knots

- [ ] **Connect tool**: drag from text or the blue dot to anything; flashes green on landing, rests blue #threads #design
- [ ] **Connection styles and labels** #threads
- [ ] **Drawn line → real connection** #threads #ink


## Threads · Time threads

- [ ] **Time threads as a dock tool** (2.3 built) #threads
- [ ] **Side view as a focused view** #threads
- [ ] **Per-stroke timing**: ink gets threads too #threads #ink


## Workspace · File windows

- [ ] **02.7-07**: resume or drop #workspace #decide
- [ ] **Watch for outside file changes** #workspace
- [ ] **Code and Markdown editors in windows** #workspace
- [ ] **Ink annotations on files** #workspace #ink


## Vault · Obsidian bridge

- [ ] **Content model** (02.2-08) #vault
- [ ] **Presentation** (02.2-09) #vault
- [ ] **Live sync** (02.2-10) #vault
- [ ] **Writing back to the vault** (02.2-11 to 13) #vault
- [ ] **HTTP MCP, cross-tree links, copies** (02.2-14 to 16) #vault


## Body · Hands

- [ ] **Gesture recognition**: pinch, grab, point #body
- [ ] **Gestures drive tools**: pinch zoom, grab move, air draw #body
- [ ] **Renderer or native tracking?** #body #decide
- [ ] **Privacy boundary for camera data** #body #decide


## Body · Voice

- [ ] **Merge voice-processing into hands-face-voice** #body
- [ ] **Command set**: tool names, undo, new note #body
- [ ] **Dictation into the Write tool** #body #notes
- [ ] **"Put that there"**: voice plus pointing #body


## Agents · In-app Claude

- [ ] **Chat panel polish** (2.7) #agents
- [ ] **Ask about a note or a region** #agents
- [ ] **Is the conversation recorded in the tree?** #agents #decide


## Agents · Agents on the canvas

- [ ] **MCP tools to draw, erase, and add math** #agents
- [ ] **Agent cursor and body** (Anchor Cursor) #agents
- [ ] **Should `look` return coordinates?** #agents #decide


## History · Undo and branches

- [ ] **One undo stack across every tool** #history
- [ ] **Branch and fork UI** (Phase 3) #history
- [ ] **Canvas-wide timeline scrubber** #history


## History · Sync and merge

- [ ] **Move merge and sync into scope**: REQUIREMENTS.md lists both as out of scope today #history #decide
- [ ] **Ids that can't collide**: two copies both make `n4`; device-scoped ids, a format one-way door #history #decide
- [ ] **Find the fork**: last shared commit digest #history
- [ ] **Merge commit**: two parents, both histories kept whole #history
- [ ] **Field-level auto-merge**: different notes or fields just combine; text merges by passage #history
- [ ] **Conflicts on the canvas**: both versions shown with who and when; picking one is a commit #history #design
- [ ] **Review by person and time**: accept or reject everything one person or agent did in a time range #history #design
- [ ] **Merging live and coarse-sim regions**: deterministic input order, or choose a side per region #history #math #decide
- [ ] **Prunes survive merges**: a pruned note must not come back from the other copy #history #trust
- [ ] **Shared folder layout**: one append-only journal per device, so file sync never conflicts #history #decide
- [ ] **Signed actors**: device keys, so "kaelen" in a commit can't be forged #history #trust


## Trust · Locks and provenance

- [ ] **Lock UI on any node, strokes included** #trust
- [ ] **Provenance badges for ink and shapes** #trust


## Trust · Deletion and pruning

- [ ] **Merge `ws/deletion` into mergin**: Phase 2.8 is planned (11 plans), with no code yet #trust
- [ ] **Prune core**: erase a note for good in one atomic, crash-proof rewrite (02.8-01 to 04) #trust
- [ ] **Prune rules**: preview, confirm, people vs agents, locks (02.8-05, 07) #trust
- [ ] **Prune everywhere it lives**: vault `.md`, copies, sidecars (02.8-06) #trust #vault
- [ ] **Prune UI**: dialog, history cuts, canvas scar, pruning shears (02.8-08, 09) #trust #design
- [ ] **Prune letters in time threads** (02.8-10, 11) #trust #threads
- [ ] **Pruning ink and math**: strokes and shapes weren't in 2.8's scope #trust #ink #math


## Trust · Data consolidation

- [ ] **What does "consolidation" cover?** Pick the cards below #trust #decide
- [x] [[Merge duplicate notes detect, combine, keep provenance of both trust]]
- [x] **Compact history**: snapshots so big `.tree` files open fast (ties into Phase 3) #trust #history
- [ ] **Merge trees**: fold one tree into another, ids and edges intact #trust #arrange
- [x] **One model for every source**: notes, vault files, workspace files and threads agree on what's the same thing #trust #vault
- [ ] **Cleanup views**: orphans, empty notes, stale placeholders #trust #design


## Trust · Size and compaction

- [ ] **Measure real sessions**: bytes per minute of pen-down, with a real pen #trust #ink
- [ ] **Stroke format built for size**: readable summary line + dense sample block; decide before Data Drawing Phase 2 freezes it #trust #ink #decide
- [ ] **Lossless packing**: delta + varint + compression for sample blocks #trust
- [ ] **Keyframes**: exact hashed world snapshots; replay starts from the latest one #trust #history
- [ ] **Diff keyframes**: one full keyframe, then only what changed since #trust #history
- [ ] **Compact settled-node format**: drop zero velocity, move per-stroke fields up; 88 B → ~12–16 B per node #trust #ink
- [ ] **Keep whichever is smaller**: raw inputs or the state they produced, per stroke or region #trust #decide
- [ ] **Tiered history**: recent = every input; older = keyframes only #trust #history #decide
- [ ] **Bake settled strokes**: keep the final shape, drop the raw samples #trust #ink #decide
- [ ] **Pruning in chaotic regions**: snapshot, then cut, instead of re-running history #trust #math
- [ ] **Size meter**: file size, and what's taking the space #trust #design




%% kanban:settings
```
{"kanban-plugin":"board","lane-width":280,"show-checkboxes":true,"tag-colors":[{"tagKey":"#design","color":"rgba(92, 184, 92, 1)","backgroundColor":"rgba(92, 184, 92, 0.15)"},{"tagKey":"#decide","color":"rgba(217, 83, 79, 1)","backgroundColor":"rgba(217, 83, 79, 0.15)"},{"tagKey":"#core","color":"rgba(240, 173, 78, 1)","backgroundColor":"rgba(240, 173, 78, 0.15)"},{"tagKey":"#ink","color":"rgba(91, 192, 222, 1)","backgroundColor":"rgba(91, 192, 222, 0.15)"},{"tagKey":"#math","color":"rgba(142, 108, 239, 1)","backgroundColor":"rgba(142, 108, 239, 0.15)"}]}
```
%%