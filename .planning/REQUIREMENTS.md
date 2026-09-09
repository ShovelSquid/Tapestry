# Requirements: Tapestry

**Defined:** 2026-09-08
**Milestone:** v1.0 — Readable, living, branching world
**Core Value:** Your world of thoughts must remain readable and under your control—in its spatial interface, its editable relationships and behavior, and its files and branching history.

## Scope and Delivery Boundary

These requirements translate the project conversation into the first usable milestone under the user's approved autonomous workflow. The milestone includes a minimal core and bundled feature plugins. A feature being a plugin does not defer it: notes, drawings, timeline views, behavior authoring, the companion, and initial evidence/profile tools remain part of the first experience. Every requirement below is pending implementation and verification.

The first phase must prove an actual plugin-authored interaction and readable save/reopen path. UI toolkit, exact file grammar, plugin runtime, and deterministic numeric profile are constrained research decisions resolved during phase planning and the initial feasibility work; the old prototype's stack is not an immutable requirement.

## v1 Requirements

### Plugin foundation

- [ ] **PLUG-01**: Developer can create and locally load a plugin from a documented starter without modifying or rebuilding the core.
- [ ] **PLUG-02**: Developer can register node schemas, commands and property/UI contributions through a versioned public API.
- [ ] **PLUG-03**: Bundled feature plugins use the same public API and lifecycle as third-party plugins.
- [ ] **PLUG-04**: User can enable or disable a plugin and still inspect its persisted content through a readable fallback.
- [ ] **PLUG-05**: User receives a clear compatibility result when a plugin/API/schema version is unavailable; no silent behavior substitution occurs.
- [ ] **PLUG-06**: Plugin-originated durable changes pass through validated, recorded core transactions; failed transactions leave the prior state intact.
- [ ] **PLUG-07**: A failing or unloaded plugin releases its handlers and cannot prevent the base world from being opened.

### Spatial notebook

- [ ] **NOTE-01**: User can create a text node, edit its title/body, save it and reopen the same content.
- [ ] **NOTE-02**: User can select, copy, paste and compose text through normal keyboard and input-method interactions.
- [ ] **NOTE-03**: User can create and remove labeled connections between nodes and follow those relationships.
- [ ] **NOTE-04**: User can pan, zoom, find a node by its text and bring it into a readable view.
- [ ] **NOTE-05**: User can move any node and choose whether it is pinned or responds to movement rules.
- [ ] **NOTE-06**: User can remove a node and recover its prior state through recorded history.
- [ ] **NOTE-07**: User can read and edit structured properties including numbers, text and references through a generic inspector.

### Readable persistence

- [ ] **TREE-01**: User can inspect a .tree file in an ordinary text editor and identify node content, relationships, changes, authorship and branch ancestry.
- [ ] **TREE-02**: User can save and reopen extensible node data with stable identifiers and readable fallback values for unknown plugin types.
- [ ] **TREE-03**: User can recover the last complete committed history after an interrupted write without silently losing or accepting partial changes.
- [ ] **TREE-04**: User can distinguish when an event happened, when it was recorded or corrected, and the simulation tick at which a change applies.

### History and replay

- [ ] **HIST-01**: User can inspect an ordered history of accepted changes and navigate to an earlier state.
- [ ] **HIST-02**: User can edit an earlier state to create a new branch while retaining the original future.
- [ ] **HIST-03**: User can name/select branches and see their parent/fork relationship.
- [ ] **HIST-04**: User can replay a saved branch to the same verified core state within the declared engine/numeric compatibility envelope.
- [ ] **HIST-05**: Replay consumes recorded AI/external outcomes and declared randomness without calling a live model or external service.
- [ ] **HIST-06**: User can load from an optional compatible snapshot or replay from history and obtain the same state.
- [ ] **HIST-07**: User can edit an event date or note contents without erasing its earlier values or changing historical recording order.
- [ ] **HIST-08**: Continuous positions and other simulated values can be regenerated from recorded inputs and rules without a position entry for every frame.

### Interacting nodes

- [ ] **RULE-01**: User can connect a rule's typed inputs and outputs to properties on other nodes and inspect the resulting dependency.
- [ ] **RULE-02**: User can run, pause and advance a world using a fixed-step engine and observe reproducible property/motion changes.
- [ ] **RULE-03**: Changing content, position or a connected property causes dependent rules to update as specified.
- [ ] **RULE-04**: User can configure proximity-to-chips to affect a character's anger, with the relevant values visible and editable.
- [ ] **RULE-05**: User can author a second independent example affecting a quantity such as gold and a movement/force example without changes to the core.
- [ ] **RULE-06**: User can inspect executable rule meaning, units and parameters and correct them before or after use through recorded edits.
- [ ] **RULE-07**: Missing definitions, incompatible values, cycles, conflicting writes and exceeded execution bounds have explicit deterministic handling visible to the user.
- [ ] **RULE-08**: User can understand when pinning, direct dragging and layout/force rules control a node; dragging does not silently change its event date.

### Drawing and readable presentation

- [ ] **DRAW-01**: User can create and remove drawing strokes in world space alongside notes and retain them through save, replay and branching.
- [ ] **DRAW-02**: User can associate a drawing with a node or related content.
- [ ] **DRAW-03**: User can navigate dense or zoomed-out content and return to legible editable text without losing spatial orientation.
- [ ] **DRAW-04**: User can operate essential editing, inspection and history controls without depending solely on hover or color.

### Origin and review

- [ ] **PROV-01**: User can distinguish explicit user content from generated content at the relevant text passage/property level.
- [ ] **PROV-02**: User can accept or reject generated content while its generated origin remains permanently identifiable in history.
- [ ] **PROV-03**: Editing mixed-origin content preserves attribution for unaffected content and records the authorship of new edits.
- [ ] **PROV-04**: User can inspect the source interaction or rule/input evidence behind a generated claim or state change.

### Conversational companion plugin

- [ ] **AI-01**: User can converse with a companion and revisit the stored conversation in the world.
- [ ] **AI-02**: Companion can automatically turn an input into connected person/event/concept nodes and meaningful spatial placement, subject to the user's guessing and placement policies.
- [ ] **AI-03**: User can enrich existing entities through follow-up conversation and resolve uncertain identity matches without forced duplication.
- [ ] **AI-04**: Companion surfaces a conflicting world fact/rule and asks for clarification according to policy.
- [ ] **AI-05**: User can edit guessing policies as nodes, choosing when to ask, propose or fill in content.
- [ ] **AI-06**: An unknown concept such as chips becomes an unresolved definition node, with completion governed by the guessing policy.
- [ ] **AI-07**: User can express a natural-language function and receive an inspectable executable interpretation or a clear clarification/unsupported result.
- [ ] **AI-08**: Companion can request a missing character response or scenario detail and apply the user's answer with provenance.
- [ ] **AI-09**: User can keep editing the world and replaying recorded behavior when the companion or its provider is unavailable.

### Editable companion memory

- [ ] **MEM-01**: User can inspect and edit readable profile memory containing language examples, preferences and corrections linked to their source interactions.
- [ ] **MEM-02**: Profile distinguishes explicit statements from inferred traits and does not silently override explicit corrections with inferred preferences.
- [ ] **MEM-03**: User can preview policy-permitted language suggestions informed by profile evidence and accept/reject them with generated origin retained.
- [ ] **MEM-04**: Profile use and updates have a documented branch scope so inspecting or editing another branch does not silently change the selected branch.

### Attention evidence plugin

- [ ] **ATTN-01**: User can inspect recorded hover occurrences and duration with node/content and branch/view context.
- [ ] **ATTN-02**: Attention observations remain separate from positive/negative interpretations and explicit acceptance/rejection.
- [ ] **ATTN-03**: Any attention-based change to profile or world behavior is an explicit recorded inference reproducible without re-reading live cursor activity.

## v2 Requirements

Retained product vision, scheduled after the first core-and-plugins milestone.

### External Inputs

- **IMPORT-01**: User can import material from Instagram, Reddit, TikTok, LinkedIn, and other applications through separately installable adapters.
- **IMPORT-02**: Imported material can enrich people, interests, relationships, and events with source provenance and editable interpretations.
- **MEDIA-01**: Developers can add richer file/media viewers and executable document adapters beyond the initial text, structured-property, and drawing plugins.

### AI Work and Mature Personalization

- **HARNESS-01**: User can delegate different AI agents to different development branches and inspect their work spatially.
- **HARNESS-02**: Agents can use readable saved memory and branch context as the starting point for later work.
- **MIMIC-01**: User can opt into a more capable personal mimic after its fidelity and correction behavior have been evaluated.
- **MIMIC-02**: User can explicitly transfer or share learned profile material between worlds/branches under a visible policy.

## Out of Scope

| Feature / promise | Reason |
|-------------------|--------|
| Running AI or external services again to reconstruct historical decisions | Would produce a new interpretation instead of reproducing the recorded past. |
| Storing every simulation frame as a complete world snapshot | Contradicts input-based replay; optional snapshots are caches, not the authoritative history. |
| Unrestricted arbitrary plugin code with a blanket deterministic guarantee | The execution profile must constrain behavior; compatible custom evaluators may be needed for exact replay. |
| Automatic historical branch merging | Branch creation and preservation are core; merge/conflict semantics are a later design. |
| Multiplayer editing, hosted sync, accounts, public plugin marketplace | Not necessary to prove the requested local core; local plugin installation is in scope. |
| Immediate compatibility with every old .tapestry file or a mandated full rewrite | Neither was requested; reuse/migration is decided from evidence during phase planning. |
| Treating hover duration as proof of liking something | Attention observations and inferred sentiment are distinct data. |
| Claiming universal cross-platform/version replay before verifying it | Initial guarantees are bounded by an explicit, tested numeric and engine profile. |

## Acceptance Scenarios

1. **Readable notebook:** create Sam, a dinner event, and an architecture concept using bundled plugins; edit text and values, connect/move nodes, add a drawing, save and reopen. Open the .tree file as text and locate the content, links and origin.
2. **Living world:** connect chips proximity to Sam's anger; change distance and observe the defined effect. Demonstrate an unrelated gold rule and a movement/force rule without editing the core. Pin a node, adjust a property, pause and resume simulation, then replay the same inputs to the same declared state.
3. **Preserved futures:** revisit an earlier tick, change a rule or event, and continue on a new branch. The original branch remains selectable and unchanged. Replay with and without compatible snapshots produces matching states.
4. **Conversational stewardship:** describe a new event, enrich Sam through follow-up conversation, introduce a conflicting rule, and encounter an unknown concept. The companion creates/updates connected nodes, asks or proposes according to policy, and exposes executable interpretations rather than hiding assumptions.
5. **Origin and learning:** inspect a mixed-origin passage, accept part of a generated suggestion and reject another, edit it, and retain the source distinction. Inspect profile evidence and hover records; an inferred preference is not relabeled as a user's statement. Branch switching does not silently contaminate profile state.
6. **Independent plugin:** follow the starter documentation to register a new node property and interaction, load it without rebuilding the core, save its data, unload it, and still read that data. Invalid commands or failed plugins cannot silently mutate history or replace recorded behavior.

## Definition of Done

- Every v1 requirement is mapped to exactly one roadmap phase and verified through that phase's acceptance evidence.
- The shipped experience includes real bundled plugins using the public API, readable .tree examples/format documentation, plugin authoring documentation, and a declared replay compatibility profile.
- Replay, branch preservation, snapshot equivalence, interrupted writes, plugin lifecycle/compatibility, rule limits, and mixed-origin edits have meaningful automated checks.
- Text input, drawing, spatial legibility, keyboard access, provenance presentation, and timeline navigation have user-facing validation; passing core tests alone is insufficient.
- Companion behavior is evaluated against explicit scenarios for contradiction, ambiguity, unknown concepts, policy enforcement, provenance, and replay without live AI.
- Research recommendations still requiring a prototype are recorded as such; no unperformed experiment is reported as a proven guarantee.

## Traceability

Populated during roadmap creation. Each v1 requirement has one owning phase; later phases may exercise it through integration without duplicating ownership.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLUG-01 | To be assigned | Pending |
| PLUG-02 | To be assigned | Pending |
| PLUG-03 | To be assigned | Pending |
| PLUG-04 | To be assigned | Pending |
| PLUG-05 | To be assigned | Pending |
| PLUG-06 | To be assigned | Pending |
| PLUG-07 | To be assigned | Pending |
| NOTE-01 | To be assigned | Pending |
| NOTE-02 | To be assigned | Pending |
| NOTE-03 | To be assigned | Pending |
| NOTE-04 | To be assigned | Pending |
| NOTE-05 | To be assigned | Pending |
| NOTE-06 | To be assigned | Pending |
| NOTE-07 | To be assigned | Pending |
| TREE-01 | To be assigned | Pending |
| TREE-02 | To be assigned | Pending |
| TREE-03 | To be assigned | Pending |
| TREE-04 | To be assigned | Pending |
| HIST-01 | To be assigned | Pending |
| HIST-02 | To be assigned | Pending |
| HIST-03 | To be assigned | Pending |
| HIST-04 | To be assigned | Pending |
| HIST-05 | To be assigned | Pending |
| HIST-06 | To be assigned | Pending |
| HIST-07 | To be assigned | Pending |
| HIST-08 | To be assigned | Pending |
| RULE-01 | To be assigned | Pending |
| RULE-02 | To be assigned | Pending |
| RULE-03 | To be assigned | Pending |
| RULE-04 | To be assigned | Pending |
| RULE-05 | To be assigned | Pending |
| RULE-06 | To be assigned | Pending |
| RULE-07 | To be assigned | Pending |
| RULE-08 | To be assigned | Pending |
| DRAW-01 | To be assigned | Pending |
| DRAW-02 | To be assigned | Pending |
| DRAW-03 | To be assigned | Pending |
| DRAW-04 | To be assigned | Pending |
| PROV-01 | To be assigned | Pending |
| PROV-02 | To be assigned | Pending |
| PROV-03 | To be assigned | Pending |
| PROV-04 | To be assigned | Pending |
| AI-01 | To be assigned | Pending |
| AI-02 | To be assigned | Pending |
| AI-03 | To be assigned | Pending |
| AI-04 | To be assigned | Pending |
| AI-05 | To be assigned | Pending |
| AI-06 | To be assigned | Pending |
| AI-07 | To be assigned | Pending |
| AI-08 | To be assigned | Pending |
| AI-09 | To be assigned | Pending |
| MEM-01 | To be assigned | Pending |
| MEM-02 | To be assigned | Pending |
| MEM-03 | To be assigned | Pending |
| MEM-04 | To be assigned | Pending |
| ATTN-01 | To be assigned | Pending |
| ATTN-02 | To be assigned | Pending |
| ATTN-03 | To be assigned | Pending |

**Coverage:**
- v1 requirements: 58 total
- Mapped to phases: 0
- Unmapped: 58 (roadmap creation in progress)

---
*Requirements defined: 2026-09-08*
*Last updated: 2026-09-08 after user-scoped requirements synthesis; awaiting roadmap mapping*

