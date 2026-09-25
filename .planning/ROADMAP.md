# Roadmap: Tapestry

## Overview

Tapestry v1.0 builds a readable, living, branching world in dependency order. It starts with a headless deterministic kernel whose `.tree` journal is inspectable in a plain text editor and survives crashes and missing plugins. Next comes the versioned plugin host and SDK, proven early through a vertical-slice feasibility gate that settles the UI toolkit decision before broad UI investment. On that base it delivers branching history with deterministic replay, then the usable spatial notebook (notes, drawing, properties, passage-level provenance) as real bundled plugins exercising the public API. The deterministic rule engine then makes the world live — proximity, anger, gold, forces — before the conversational companion compiles natural language into that engine under user-editable guessing policies. Finally, companion memory and attention evidence make the system's learning about the user readable, editable, and branch-scoped.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Deterministic Core & Readable Format** - Transaction kernel, provenance-carrying world model, and the durable human-readable `.tree` journal (completed 2026-09-09)
- [ ] **Phase 2: Plugin Host, SDK & Feasibility Gate** - Versioned public plugin API, local dev loop, lifecycle safety, and the toolkit-deciding vertical slice
- [ ] **Phase 2.1: Passage Anchors, Threads & Complete Rich Editing** - Passage-level linking, thread center nodes, gradient-of-focus hover hierarchy, and complete formatting toolbar with universal editing (INSERTED)
- [ ] **Phase 2.2: Obsidian Bridge** - Agent MCP bridge, then a two-way Obsidian vault tree, on one shared command set with honest provenance for agent and observed edits (INSERTED)
- [ ] **Phase 2.3: Time Threads** - Live z-axis writing threads: one note and its history, per-letter timing, side-view read-back (INSERTED)
- [x] **Phase 2.4: Lock Model** - Allow unless locked: lock aspects replace the D-05 authorship gate for agent note commands (INSERTED) (completed 2026-09-16)
- [ ] **Phase 2.5: Agent Spatial Verbs** - Task-space `look` and `place` for agents: relations in, relations out, refused by `lock.layout` (INSERTED; depends on 2.4)
- [ ] **Phase 2.6: Placement Edges & Forest Tree** - An always-open Tapestry tree, the arrangement of trees as a forest tree with placement edges, and trees named by header digest (INSERTED; depends on 2.2)
- [ ] **Phase 3: Branching History & Deterministic Replay** - History navigation, fork-preserving branches, snapshots, and replay from recorded inputs
- [ ] **Phase 4: Spatial Notebook** - Bundled note, drawing, property, and provenance-display plugins delivering the usable spatial workspace
- [ ] **Phase 5: Deterministic Rule Engine** - Typed rule inputs/outputs, fixed-step simulation, forces, and explicit failure semantics
- [ ] **Phase 6: Conversational Companion & Guessing Policy** - Companion plugin turning conversation into connected, provenance-tracked, policy-governed world content
- [ ] **Phase 7: Companion Memory & Attention Evidence** - Readable, editable, branch-scoped profile memory and observation-vs-interpretation attention records

## Phase Details

### Phase 1: Deterministic Core & Readable Format

**Goal**: The world's content, relationships, changes, and history live in a durable `.tree` journal a person can read without Tapestry — and unknown plugin data stays readable and safe
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: TREE-01, TREE-02, TREE-03, TREE-04
**Success Criteria** (what must be TRUE):

  1. A person can open a saved `.tree` file in an ordinary text editor and identify node content, relationships, changes, authorship, and branch ancestry without running the application
  2. Saving and reopening a world reproduces the same node data with stable identifiers, and node types the core does not recognize display readable fallback values instead of disappearing or breaking the load
  3. After an interrupted write (simulated crash mid-save), reopening recovers the last complete committed history with no silent loss and no silent acceptance of partial changes
  4. Every recorded change carries a distinguishable domain event time, recorded/corrected time, and simulation tick, and a reader can tell the three apart in the journal

**Plans**: 5/5 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Lock the .tree v1 format bundle (decision gate), stand up the rendering-independent kernel target + doctest runner, typed value/time/id primitives

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Tracer: create a node → durable @commit record → reopen → read back (contracts + single end-to-end path)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Full v1 op set, block text, strict reader rules; unknown plugin data readable and safe; stable ids
- [x] 01-04-PLAN.md — Durability: failure-injection sinks, truncation/bit-flip sweeps, lock, explicit repair with sidecar, byte-identical save-as

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — Three kinds of time, frozen golden example.tree, FORMAT.md human guide, cold-read check

### Phase 2: Plugin Host, SDK & Feasibility Gate

**Goal**: Developers can build, load, and safely fail plugins against a documented versioned public API — and the UI toolkit decision is settled by a working vertical slice (editable note, spatial interaction, independent plugin, command bridge, packaged app) before broad UI investment
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, PLUG-07
**Success Criteria** (what must be TRUE):

  1. A developer can follow the starter documentation to create a plugin, load it locally without modifying or rebuilding the core, and see its registered node schema, commands, and property/UI contributions working
  2. Bundled first-party feature plugins load through the same manifest, lifecycle, and public API as the starter third-party plugin — no private core hooks
  3. Disabling, unloading, or breaking a plugin releases its handlers, never prevents the base world from opening, and leaves its persisted content inspectable through the readable fallback
  4. A plugin with an unavailable API/schema/artifact version produces a clear compatibility result; recorded behavior is never silently substituted
  5. Every plugin-originated durable change passes through a validated, recorded core transaction, and a failed transaction leaves the prior state intact

**Plans**: 5/5 plans executed

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Tracer (layer 1): native addon + C++ kernel bridge + SDK types

**Wave 2**

- [x] 02-02-PLAN.md — Tracer (layer 2): Electron shell + renderer + note plugin + autosave + reopen

**Wave 3**

- [x] 02-03-PLAN.md — Spatial canvas: pan/zoom, drag, connections, hover controls

**Wave 4**

- [x] 02-04-PLAN.md — Plugin SDK contribution surface, lifecycle safety, third-party example

**Wave 5**

- [x] 02-05-PLAN.md — Deletion, undo, basic rich text, packaged app + feasibility evidence

**UI hint**: yes

### Phase 2.1: Passage Anchors, Threads & Complete Rich Editing

**Goal**: Passage-level linking, thread center nodes, gradient-of-focus hover hierarchy, and a complete formatting toolbar make connected thought legible at every scale — with universal editing across notes and thread centers
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: TBD
**Success Criteria** (what must be TRUE):

  1. A user can select text in a note, link it to another note or passage, and see the thread with both endpoints highlighted on hover
  2. Thread center nodes appear between endpoints, accept text, and behave as ordinary editable/connectable nodes
  3. Overlapping passages produce a gradient-of-focus hierarchy where the smallest passage at the pointer is strongest and enclosing passages are progressively weaker
  4. A complete floating formatting toolbar (bold, italic, headings, lists, color, alignment, font family) expands on hover with submenus that stay open while the pointer is inside
  5. The same editor behavior and formatting controls work identically across ordinary notes and text-bearing thread center nodes

**Plans**: TBD

- [x] 02.1-01-PLAN.md
- [x] 02.1-02-PLAN.md
- [x] 02.1-03-PLAN.md

**UI hint**: yes

### Phase 2.2: Obsidian Bridge (INSERTED)

**Goal**: Outside writers reach a Tapestry world through one shared set of note and connection commands. First, agents (Claude, ChatGPT, others) connect over an MCP bridge: each is distinctly attributed as `actor plugin agent.<name>`, and every note they create grows from an existing note. Then an Obsidian vault becomes its own tree that faithfully mirrors its Markdown files, edits from either Tapestry or Obsidian reach the files, observed edits carry honest provenance, and several trees share one space in separate frames.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: TBD
**Success Criteria** (what must be TRUE):

  Derived by plan-phase from `.planning/phases/02.2-obsidian-bridge/02.2-CONTEXT.md` (D-01..D-34, discussed with Kaelen 2026-09-15).

  1. An agent connected over MCP (Claude Code or any local MCP client over stdio, and ChatGPT or any other HTTP MCP client over the loopback Streamable HTTP transport, which ships disabled by default) can list trees, read and search notes, grow a new note that is created already connected to an existing note, change only notes it created, and connect any notes; agent commits read `actor plugin agent.<name>` and human commits read `actor human user.<name>`
  2. Adding an Obsidian vault creates `<vault>/<vault name>.tree` and a frame whose notes mirror each `.md` file's exact text, with folders as groups, `[[links]]` as connections labeled with their literal line, tags and frontmatter as properties, file notes and placeholders
  3. Changes made to the vault while Tapestry is open or closed are recorded, grouped per moment, as `obsidian.bridge` (author unknown) or as `agent.<name>` when the sign-in log proves it; renames keep the note, deletions cut its connections, and everything stays in history
  4. Edits, retitles, moves, new notes, connections and placeholder typing made in Tapestry reach the vault's files after a short pause; when a file changed first, the file wins and the Tapestry edit stays in history; undo writes files back
  5. Several trees share one space in non-overlapping frames that reopen where they were; connections between trees are recorded in both trees and cut in both when a note is deleted; dragging a note into another frame copies it, asking before any formatting would be lost

**Plans**: 7/16 plans executed

Plans:
**Wave 1**

- [x] 02.2-01-PLAN.md — Tracer: host-stamped actors (`user.<name>`, plugins bound to their id), first-run name prompt, vitest harness

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02.2-02-PLAN.md — Authorship from the journal (history index, tree identity, next ids) and provenance footers

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02.2-03-PLAN.md — Tracer: MCP stdio shim -> Unix socket -> shared note commands; create_note grown from a note as `agent.<name>`

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02.2-04-PLAN.md — Full agent tool set with own-notes-only edits, Agents panel, connect command, forest bar

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02.2-05-PLAN.md — Several trees in one space: tree-scoped IPC, frames, push-apart, settings restore

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 02.2-06-PLAN.md — Forest bar and tree lifecycle: Add tree, Tree options, unavailable trees, empty state, announcements

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 02.2-07-PLAN.md — Tracer: Obsidian vault mirror tree (House Party) with byte-exact note text, folders and catch-up

**Wave 8** *(blocked on Wave 7 completion)*

- [ ] 02.2-08-PLAN.md — Vault content model: links, tags, frontmatter, file notes, placeholders, add-vault dialog, reader's guide

**Wave 9** *(blocked on Wave 8 completion)*

- [ ] 02.2-09-PLAN.md — Vault presentation: folder groups, verbatim note view, placeholders, file notes, literal-line connections, tag filter

**Wave 10** *(blocked on Wave 9 completion)*

- [ ] 02.2-10-PLAN.md — Live vault sync: watcher, grouped moments, renames, deletions, sign-in log attribution

**Wave 11** *(blocked on Wave 10 completion)*

- [ ] 02.2-11-PLAN.md — Tapestry -> vault writes: debounced atomic edits, file wins, retitle as rename, delete to Trash, vault undo

**Wave 12** *(blocked on Wave 11 completion)*

- [ ] 02.2-12-PLAN.md — Vault structure writes: new notes in groups, moves between folders, link lines, placeholder typing

**Wave 13** *(blocked on Wave 12 completion)*

- [ ] 02.2-13-PLAN.md — Agents write to the source online and offline, sign-in log, world outbox

**Wave 14** *(blocked on Wave 13 completion)*

- [ ] 02.2-14-PLAN.md — Loopback Streamable HTTP transport so ChatGPT and other HTTP MCP clients can connect, disabled by default

**Wave 15** *(blocked on Wave 14 completion)*

- [ ] 02.2-15-PLAN.md — Cross-tree connections recorded in both trees, remote stubs, cuts and crash repair

**Wave 16** *(blocked on Wave 15 completion)*

- [ ] 02.2-16-PLAN.md — Copies between trees with grew-from connections and the never-silent Markdown loss dialog

**UI hint**: yes

### Phase 2.3: Time Threads (INSERTED)

**Goal**: A thread is a single note with its full history, optionally shared by a user and an agent. It is written live along the z-axis in the note typer (a dot every 1/60 s, each letter placed at the moment it was typed) and read back in a left-to-right side view, where dashes mark where writing timed out and timed back in
**Mode:** mvp
**Depends on**: Phase 2.2
**Requirements**: none owned — exercises TREE-01/02/04, HIST-01/08, PROV-01/03, NOTE-02, DRAW-03/04 and PLUG-03/04/06 through integration (all already owned by Phases 1-4)
**Success Criteria** (what must be TRUE):

  1. User can create a thread, write in the note typer, and watch the live z-axis line gain dots and letters at display rate, with the pause slowdown and a time-out dash — holding 60 fps at the 8 h / 78k-letter reference load, with IME composition and paste landing correctly (D-09..D-14)
  2. Closing and reopening the world redraws the same line from saved keystrokes and sessions alone, with no stored dots, and a person can read the typed text, deletions and timings in the `.tree` file without Tapestry; with the threads plugin disabled the thread still opens and shows its latest document text (D-01..D-06)
  3. In the side view, user can zoom from the whole thread down to single dots, fly to session notes, scrub by date, and click any point to see the document as it was then — every navigation path reachable by keyboard, with gravity an aid and never the only route (D-07, D-08, D-15..D-19)
  4. An agent writing into a shared thread appears as its own coloured strand, cannot delete or rewrite a single letter the user wrote (the refusal committing nothing), and its text can be pulled apart for display (D-20..D-25)
  5. No `thread-center` / `thread-arm` occurrences remain in tracked source under `app/`, `plugins/` or `sdk/`; 2.1's feature works as `knot` / `knot-tie` (D-26)
  6. Each thread stores its own readable frame — `origin.x/y/z`, `direction.x/y/z` and `roll` — and both the live and side views derive their camera from it rather than a hardcoded axis (D-27)

**Plans**: 9 plans in 8 waves

Plans:
**Wave 1**

- [ ] 02.3-01-PLAN.md — Rename 2.1's centre note and its edges to knot / knot-tie, with exact type matching (D-26)

**Wave 2** *(blocked on Wave 1)*

- [ ] 02.3-02-PLAN.md — Tracer: type into a thread, commit readable `thread.log` records, reopen and redraw from them alone (D-01, D-02, D-06 one-way, D-27)

**Wave 3** *(blocked on Wave 2)*

- [ ] 02.3-03-PLAN.md — Publish the grammar in FORMAT.md, threads.md and the golden fixture; replay to any moment; no-plugin fallback (D-06, D-08, PLUG-04)
- [ ] 02.3-04-PLAN.md — Live z-axis view: stage, procedural ribbon, MSDF glyphs, pause slowdown, distance fade, camera from the stored frame (D-09..D-14, D-19, D-27)

**Wave 4** *(blocked on Wave 3)*

- [ ] 02.3-05-PLAN.md — Nothing erased: LetterIndex, the full cause vocabulary, ghosts and markers on the line (D-02..D-05)

**Wave 5** *(blocked on Wave 4)*

- [ ] 02.3-06-PLAN.md — Sessions, time-outs, per-thread settings, the canvas bridge and the session list (D-07, D-10, D-13)

**Wave 6** *(blocked on Wave 5)*

- [ ] 02.3-07-PLAN.md — Side view read-back: zoom, pan, fly-to, gravity, date scrubber, document at any moment (D-08, D-15..D-19)

**Wave 7** *(blocked on Wave 6)*

- [ ] 02.3-08-PLAN.md — Agents in threads: MCP thread tools, the per-letter D-22 rule, strands, underlays, drag-apart (D-20..D-24)

**Wave 8** *(blocked on Wave 7)*

- [ ] 02.3-09-PLAN.md — Vault threads: `.md` keeps only current text, timings live in the vault tree, Obsidian edits arrive as observed clusters (D-25)

**UI hint**: yes

### Phase 2.4: Lock Model (INSERTED)

**Goal**: Agents may change any note that is not locked against them. A lock, not authorship, decides who may write: every note not created by an agent (a person's, an Obsidian vault note, another plugin's) starts with its text and deletion locked, agent notes start open, and an explicit lock on a note can close it, open it, or name who else may write
**Depends on**: Phase 2.2 (the agent note commands and D-05 gate this phase replaces)
**Requirements**: none owned — applies the project's Control constraint ("users can edit … guessing policies") to agent writes; no v1 requirement ID covers permissions yet
**Design**: `~/Tapestry Tales/Connections/Spec - Locks and Rank.md`, `~/Tapestry Tales/Connections/Plan - Lock Model Implementation.md`. Supersedes 02.2 D-05 (Kaelen, 2026-09-16); collides with 02.3 D-22, recorded only
**Success Criteria** (what must be TRUE):

  1. An agent is refused when it updates, renames or deletes a note that no agent created (a person's, the Obsidian bridge's, another plugin's), and a refusal writes nothing to the `.tree` file
  2. An agent may update another agent's note unless that note is locked; the switch for this default is one named constant
  3. An explicit `lock.text` or `lock.delete` on a note refuses every actor except its owner and anyone on its `.allow` list, and the literal `open` unlocks a default lock; locking text leaves deletion unaffected and vice versa
  4. Whether non-agent notes start delete-locked is one named constant, and every refusal names the aspect and the lock's owner

**Follow-ups** (later slices, not this phase): rank auto-lock when a person sets rank (needs a per-property last writer in the history index); a `setLock` command so only an owner can remove a lock (needs Decision Register #19, the `lock.*` naming, a one-way door); thread and tree scopes, and the Tapestry scope once Phase 2.6 creates the Tapestry tree
**Plans**: 2/2 plans executed

Plans:
**Wave 1**

- [x] 02.4-01-PLAN.md — Tracer: lock resolver (`locks.ts`, both PENDING constants, fail-closed values) wired into update_note, then rename→text / delete→delete through one gate; authorship gate retired; policy tests rewritten test-first

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02.4-02-PLAN.md — `lock.<aspect>.allow` test-first; bridge/plugin-creator, non-agent, deleted-note, ungated-path and undone-lock coverage; lock rule stated in MCP tool text; phase gate

### Phase 2.5: Agent Spatial Verbs (INSERTED)

**Goal**: Agents can perceive where notes are and say where notes go, in task space: `look` returns relations rather than coordinates, `place` takes a relation rather than a position, and the host resolves one into the other — so an agent can move its own body through a tree, and a lock on layout finally has a verb to refuse
**Mode:** mvp
**Depends on**: Phase 2.4 (lock model — `lock.layout`, built on `ws/notifications-rank`)
**Requirements**: none owned — exercises PROV-01/03, TREE-01/02 and PLUG-03 through integration
**Design source**: `~/Tapestry Tales/Connections/Spec - Agent Spatial Verbs.md` (Decision Register #8, #10, #11, #12); split from the anchor-cursor phase pending #22
**Success Criteria** (what must be TRUE):

  1. An agent calling `look(tree, from, [toward], [limit])` receives its neighbours in the same tree nearest-first — each with `note`, `space`, `relation` (`near`, `beyond`, `overlapping`, `contains`, `contained-by`), `order` and `guess` — and receives coordinates **only** for placements it may write, which before Phase 2.4 is none; there is no hard ceiling on `limit` (spec §2.1, §3; #10, #11; D-14)
  2. An agent calling `place(tree, note, where)` with `{ near }` or `{ beyond, from }` — ids only, `.strict()` — moves the note; `create_note` accepts the same optional `where`, and without it behaves exactly as today; `{ on }` is deferred to the placement-edges phase (spec §4; D-11)
  3. A note placed `near` its `grew-from` parent is written with the resolved position and `pinned false` and is drawn beside that parent wherever it moves, until a person drags it (`pinned true`); every other placement is fixed; a note with no `pinned` key never moves on its own; closing, reopening and replaying reproduce the stored positions without consulting any model (D-01..D-08)
  4. Every refusal returns `{ ok: false, error }` naming what was wrong, and commits nothing: an unknown or unplaced anchor, a note placed relative to itself, and a placement held by `lock.layout` — whose message names the lock's owner. An agent cannot move a user-made note by default, because its layout starts locked (spec §5; #8)
  5. No new kernel verb or value type is added; placements remain node properties (`position.x/y`), and nothing starts the frozen migration onto placement edges (spec §6, §7)
  6. `facing` is **not** in this phase; D-27's `direction` stays unwritten by agents until the anchor-cursor phase (#12)

**Plans:** 5/5 plans complete (waves 1–5; Phase 2.4 with `lock.layout` merged 2026-09-24)

Plans:

**Wave 1**

- [x] 02.5-01-PLAN.md — Build addon and bundle, baseline; tracer: `look` end to end over MCP with the pure placement module (D-12, D-14, D-18)

**Wave 2** *(blocked on Wave 1)*

- [x] 02.5-02-PLAN.md — Placement resolver: `near` with collision steps, `beyond`, follower display positions; `look` reads drawn positions (D-05..D-10)

**Wave 3** *(blocked on Wave 2)*

- [x] 02.5-03-PLAN.md — Renderer: followers drawn beside their `grew-from` parent; a person's drag or left/top resize pins them (D-01..D-03, D-05, D-16)

**Wave 4** *(blocked on Wave 3 and on Phase 2.4 being merged — starts with a blocking checkpoint)*

- [x] 02.5-04-PLAN.md — `place` tool under `lock.layout`; refusals commit nothing; a person's `pinned true` is never touched (D-04, D-11..D-13, D-15, D-17, D-19)

**Wave 5** *(blocked on Wave 4)*

- [x] 02.5-05-PLAN.md — `create_note` optional `where` beside the unchanged default path; phase gate (SC2, SC5, SC6)

**UI hint**: no

### Phase 2.6: Placement Edges & Forest Tree (INSERTED)

**Goal**: The arrangement of your trees stops being an unrecorded preference: it lives in a forest tree, referenced from one always-open Tapestry tree, where every frame is a placement edge and every member is named by its header digest — so arranging trees gets an actor, undo, history and branches like any other edit
**Mode:** mvp
**Depends on**: Phase 2.2 (tree registry, `settings.json` trees, D-15 frames, T-02.2-32 unavailable members)
**Requirements**: none owned — exercises TREE and PROV requirements through integration
**Design source**: `~/Tapestry Tales/Connections/Spec - Placement Edges.md` §1–§5 and `Decision Packet - Tree Identity and the Forest.md` (Decision Register #2 shape C, #4, #5 A, #6, #7, #13 B; one-way doors #17, #18)
**Success Criteria** (what must be TRUE):

  1. Launching Tapestry opens one always-open Tapestry tree, and `settings.json` holds a pointer to it; the migration is non-destructive — the old `trees` entries stay readable and the settings `version` is bumped — so the previous app state can be recovered (#2 C, #18)
  2. The arrangement of open trees lives in a forest tree the Tapestry tree references; moving a frame writes a commit with an actor, and undo, close-and-reopen and replay reproduce the arrangement without reading frame positions from `settings.json` (#5 A)
  3. Each frame is a `placement` edge in the forest tree carrying `origin.*` and, where set, `size.*`; no kernel verb or value type is added, and nothing in the space model refuses a kind of thing from being placed (#6, #7)
  4. Members are named by header digest with a `path.hint`: a moved or renamed `.tree` that is found again keeps its frame; two paths with one digest are one member; a tree unreadable since it was added keeps an in-memory `path:` id until its first successful open, and a `path:` id is never written to disk as an identity (#13 B)
  5. A member that will not open still renders as its frame with its status and the kernel's reason, as 2.2 ships it (T-02.2-32)
  6. Note positions are untouched: `position.x/y` stay node properties and D-27's thread frame is not moved — that migration is a later phase after 2.3 (#4)
  7. No code writes the Tapestry-tree or forest-tree record shape, or migrates `settings.json`, until Kaelen has approved the exact type strings, keys and labels and the migration at a blocking checkpoint (#17, #18)

**Plans:** 9/10 plans executed (4 gap-closure plans added 2026-09-24)

Plans:
**Wave 1**

- [x] 02.6-01-PLAN.md — Groundwork that writes no record: settings passthrough (tracer), pure drop-batch and Ctrl+Z routing helpers, registry seams (D-08, D-10, D-11)

**Wave 2** *(blocked on Wave 1)*

- [x] 02.6-02-PLAN.md — BLOCKING CHECKPOINT for #17/#18 (record shape, migration, Ctrl+Z reach, new wording), then tracer at the service level: first launch imports into the forest, a drop is one signed commit, a second launch restores from the forest (D-01..D-07, D-10, D-11, D-13, D-14)

**Wave 3** *(blocked on Wave 2)*

- [x] 02.6-03-PLAN.md — The app launches into the forest: startup/shutdown wiring, `trees:list`, `trees:moveFrames`, preload, types and the Canvas drop (tracer); launch cases E, G, H write nothing and open no member (D-10, D-11, D-14)

**Wave 4** *(blocked on Wave 3)*

- [x] 02.6-04-PLAN.md — Membership and identity: open/create/close/vault-add recorded in the forest; a tree is its digest (moved files, copies, impostors, duplicates, reserved files) (D-01..D-03, D-12)

**Wave 5** *(blocked on Wave 4)*

- [x] 02.6-05-PLAN.md — Ctrl+Z after a drag as a compensating commit (tracer), and system-signed automatic fit; `trees:setFrame` removed (D-08, D-09, D-11, D-12)

**Wave 6** *(blocked on Wave 5)*

- [x] 02.6-06-PLAN.md — Remaining launch cases (B, C, F, I, J) with in-window notices (tracer), reader's guide `docs/tree/forest.md`, legacy settings writers removed, phase gate and Kaelen's check on copied data (D-05..D-07, D-10, D-14)

**Gap closure, Wave 1** *(from 02.6-VERIFICATION.md gaps and 02.6-REVIEW.md; disjoint files)*

- [x] 02.6-07-PLAN.md — Gap 1 / CR-01 (SC-1): settings.json read as missing | unreadable | ok; no writer overwrites an unreadable file; cases A, B and C return setup-failed before creating anything
- [x] 02.6-08-PLAN.md — Gaps 2+3 / CR-02, WR-01 (SC-4, SC-5): `adopt()` ends the path's `path:` record; `removeMember` never deletes a shared stand-in; unavailable members keyed by recorded digest, so one path cannot hide another member
- [x] 02.6-09-PLAN.md — Renderer warnings WR-03, WR-04, WR-05: close refusals shown, growth pushes do not arm frame undo, fits shown only when committed

**Gap closure, Wave 2** *(blocked on 02.6-08: shares space-service.ts and membership.test.ts)*

- [ ] 02.6-10-PLAN.md — WR-02 (T-2.6-24): `openWithRollback` closes every entry a failed add introduced that the forest does not hold

**UI hint**: yes

### Phase 3: Branching History & Deterministic Replay

**Goal**: Users can move through history, edit the past without losing the original future, and replay any branch to the same verified state from recorded inputs alone
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: HIST-01, HIST-02, HIST-03, HIST-04, HIST-05, HIST-06, HIST-07, HIST-08
**Success Criteria** (what must be TRUE):

  1. User can inspect an ordered history of accepted changes and step to an earlier state
  2. Editing an earlier state creates a new branch while the original future remains selectable and unchanged, and the user can name branches and see their parent/fork relationships
  3. Replaying a saved branch reproduces the same verified core state within the declared engine/numeric compatibility envelope, consuming recorded AI/external outcomes and declared randomness without calling any live model or service
  4. Loading from a compatible snapshot and replaying the same history from scratch produce the same state
  5. Editing an event date or note contents preserves earlier values and historical recording order, and continuous positions regenerate from recorded inputs and rules without a stored position for every frame

**Plans**: TBD

### Phase 4: Spatial Notebook

**Goal**: Users can create, edit, connect, arrange, and draw in a legible spatial world through bundled plugins — with user-versus-generated origin visible and preserved at the passage level
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: NOTE-01, NOTE-02, NOTE-03, NOTE-04, NOTE-05, NOTE-06, NOTE-07, DRAW-01, DRAW-02, DRAW-03, DRAW-04, PROV-01, PROV-02, PROV-03
**Success Criteria** (what must be TRUE):

  1. User can create a text node, edit its title and body with dependable text input (selection, copy/paste, undo, input methods), save, and reopen the same content
  2. User can create, label, remove, and follow connections between nodes; pan, zoom, and find a node by its text to bring it into a readable view; move or pin any node; and remove a node then recover its prior state through recorded history
  3. User can read and edit structured properties (numbers, text, references) through a generic inspector, and can create drawing strokes in world space, associate them with nodes, and retain them through save, replay, and branching
  4. User can navigate dense or zoomed-out content and return to legible editable text without losing spatial orientation, and can operate essential editing, inspection, and history controls without depending solely on hover or color
  5. Explicit user content and generated content are distinguishable at the passage/property level; accepting or rejecting generated content is recorded without erasing its origin; and editing mixed-origin content preserves attribution for unaffected spans while recording the authorship of new edits

**Plans**: TBD
**UI hint**: yes

### Phase 5: Deterministic Rule Engine

**Goal**: Rule nodes visibly and reproducibly drive properties and motion in a fixed-step world, with typed inputs/outputs, editable meaning, and explicit deterministic failure handling
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: RULE-01, RULE-02, RULE-03, RULE-04, RULE-05, RULE-06, RULE-07, RULE-08
**Success Criteria** (what must be TRUE):

  1. User can connect a rule's typed inputs and outputs to properties on other nodes and inspect the resulting dependency
  2. User can run, pause, and advance the world on a fixed-step engine with reproducible property and motion changes, and changing content, position, or a connected property causes dependent rules to update as specified
  3. Proximity-to-chips visibly affects a character's anger with the relevant values editable, and a second independent gold example plus a movement/force example work without any change to the core
  4. User can inspect a rule's executable meaning, units, and parameters and correct them before or after use through recorded edits
  5. Missing definitions, incompatible values, cycles, conflicting writes, and exceeded execution bounds each produce explicit deterministic handling visible to the user, and the user can tell whether pinning, direct dragging, or movement rules currently control a node — dragging never silently changes its event date

**Plans**: TBD

### Phase 6: Conversational Companion & Guessing Policy

**Goal**: A companion plugin turns natural conversation into connected, provenance-tracked world content and executable interpretations, governed by user-editable guessing policies — and the world keeps working without it
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08, AI-09, PROV-04
**Success Criteria** (what must be TRUE):

  1. User can converse with the companion through its conversational interface, revisit the stored conversation in the world, and see an input like "Met Sam at dinner; loves architecture" become connected person/event/concept nodes with meaningful placement, subject to the active guessing and placement policies
  2. Follow-up conversation enriches existing entities, and uncertain identity matches are resolved with the user rather than forcing duplicates
  3. The companion surfaces conflicting facts or rules and asks according to policy, turns an unknown concept such as "chips" into an unresolved definition node completed per policy, and requests missing character responses or scenario details then applies the user's answer with provenance
  4. Guessing policies are editable nodes controlling when to ask, propose, or fill, and a natural-language function yields an inspectable executable interpretation or a clear clarification/unsupported result — never a silent guess
  5. Editing and replay continue to work when the companion or its provider is unavailable, and the source interaction or rule/input evidence behind any generated claim or state change is inspectable

**Plans**: TBD
**UI hint**: yes

### Phase 7: Companion Memory & Attention Evidence

**Goal**: What the system learns about the user is readable, editable, evidence-linked, and branch-scoped — and attention observations stay distinct from interpretations
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, ATTN-01, ATTN-02, ATTN-03
**Success Criteria** (what must be TRUE):

  1. User can inspect and edit readable profile memory containing language examples, preferences, and corrections, each linked to its source interactions
  2. The profile distinguishes explicit statements from inferred traits, and an inferred preference never silently overrides an explicit correction
  3. User can preview policy-permitted language suggestions informed by profile evidence and accept or reject them with generated origin retained
  4. User can inspect recorded hover occurrences and durations with node/content and branch context, kept separate from positive/negative interpretation and from explicit acceptance or rejection
  5. Profile use and updates follow a documented branch scope — inspecting or editing another branch does not silently change the selected branch — and any attention-based change to profile or world behavior is an explicit recorded inference reproducible without re-reading live cursor activity

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 2.1 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Deterministic Core & Readable Format | 5/5 | Complete    | 2026-09-09 |
| 2. Plugin Host, SDK & Feasibility Gate | 5/5 | In Progress|  |
| 2.1. Passage Anchors, Threads & Complete Rich Editing | 3/3 | In Progress|  |
| 3. Branching History & Deterministic Replay | 0/TBD | Not started | - |
| 4. Spatial Notebook | 0/TBD | Not started | - |
| 5. Deterministic Rule Engine | 0/TBD | Not started | - |
| 6. Conversational Companion & Guessing Policy | 0/TBD | Not started | - |
| 7. Companion Memory & Attention Evidence | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-08 — 58/58 v1 requirements mapped across 7 phases*
