# Roadmap: Tapestry

## Overview

Tapestry v1.0 builds a readable, living, branching world in dependency order. It starts with a headless deterministic kernel whose `.tree` journal is inspectable in a plain text editor and survives crashes and missing plugins. Next comes the versioned plugin host and SDK, proven early through a vertical-slice feasibility gate that settles the UI toolkit decision before broad UI investment. On that base it delivers branching history with deterministic replay, then the usable spatial notebook (notes, drawing, properties, passage-level provenance) as real bundled plugins exercising the public API. The deterministic rule engine then makes the world live — proximity, anger, gold, forces — before the conversational companion compiles natural language into that engine under user-editable guessing policies. Finally, companion memory and attention evidence make the system's learning about the user readable, editable, and branch-scoped.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Deterministic Core & Readable Format** - Transaction kernel, provenance-carrying world model, and the durable human-readable `.tree` journal
- [ ] **Phase 2: Plugin Host, SDK & Feasibility Gate** - Versioned public plugin API, local dev loop, lifecycle safety, and the toolkit-deciding vertical slice
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

**Plans**: 4/5 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Lock the .tree v1 format bundle (decision gate), stand up the rendering-independent kernel target + doctest runner, typed value/time/id primitives

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Tracer: create a node → durable @commit record → reopen → read back (contracts + single end-to-end path)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Full v1 op set, block text, strict reader rules; unknown plugin data readable and safe; stable ids
- [x] 01-04-PLAN.md — Durability: failure-injection sinks, truncation/bit-flip sweeps, lock, explicit repair with sidecar, byte-identical save-as

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-05-PLAN.md — Three kinds of time, frozen golden example.tree, FORMAT.md human guide, cold-read check

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

**Plans**: TBD
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
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Deterministic Core & Readable Format | 4/5 | In Progress|  |
| 2. Plugin Host, SDK & Feasibility Gate | 0/TBD | Not started | - |
| 3. Branching History & Deterministic Replay | 0/TBD | Not started | - |
| 4. Spatial Notebook | 0/TBD | Not started | - |
| 5. Deterministic Rule Engine | 0/TBD | Not started | - |
| 6. Conversational Companion & Guessing Policy | 0/TBD | Not started | - |
| 7. Companion Memory & Attention Evidence | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-08 — 58/58 v1 requirements mapped across 7 phases*
