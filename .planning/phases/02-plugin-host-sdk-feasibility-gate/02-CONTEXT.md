# Phase 2: Plugin Host, SDK & Feasibility Gate - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a versioned public plugin API, a starter/local development loop, first-party/public API parity, lifecycle and compatibility safety, recorded transactions, and a working packaged UI feasibility slice to settle the toolkit. The user explicitly expanded the Phase 2 working app to include editing, passage/thread behavior, and rich-text formatting as documented in D-01 through D-26.

Planning must reconcile the expanded UI scope with ROADMAP.md and REQUIREMENTS.md, preserve all decisions below, and expose the added work rather than silently deferring it. No roadmap or requirement changes have yet been made. Full branching/history navigation remains Phase 3; undo/redo for the editing interactions below is required here.

### Design Ethos

All research and planning decisions for this phase — including plugin contribution surface shape, and version/compatibility contracts — must adhere to these governing principles drawn from the user's discussions:

1. **Readability over cleverness.** Plugin behavior, primitives, and state must be visible and understandable. Generated helpers may remove repetition but must not conceal the system's primitives.
2. **Content deletion vs structure deletion are distinct.** Clearing content preserves containers and connections; deleting structure removes containers and cuts attached connections. This principle applies everywhere.
3. **User control.** The user can edit, inspect, and understand everything. No silent guesses, no hidden state, no behavior that can't be traced.
4. **Core independence.** The kernel, journal, and world must function without any plugin loaded. Plugins extend; they never become prerequisites.
5. **Public API parity.** First-party plugins use the same documented API as third-party plugins. No private hooks.
</domain>

<decisions>
## Implementation Decisions

### Persistent spatial editing
- **D-01:** Phase 2 must let a user create a .tree file, add an arbitrary user-chosen number of notes and connections (five is only an example, not a limit), arrange/edit them, close, and reopen the same content, positions, relationships, and linked structures correctly.
- **D-02:** Save changes automatically as the user works, including text while typing. Saving must not depend on Enter, blur, or completing an edit. Show a small save-state indicator beside the file name. Exact debounce/durability timing and failure presentation remain implementation questions; never imply unsaved text was saved.
- **D-03:** Reopen the last file automatically on launch. Missing/unavailable last-file behavior remains unresolved.
- **D-04:** Double-click empty canvas to create a note and type immediately. Enter inserts a newline. Escape or clicking outside ends editing without discarding text. Creation/editing is keyboard-first with minimal chrome.
- **D-05:** Carry forward the brief's nearly full-window 2D canvas, pan/zoom/select, small file/save indicator, contextual inspector, and direct connections without ordinary-link modal dialogs. Coordinates carry user-authored meaning; trees, cycles, clusters, and isolated notes are valid. The brief suggests search/history/settings placement and a compact tool strip; precise layout is not yet designed.

### Hover, selection, and colorful controls
- **D-06:** Small bubbly round controls of different colors surround a note's edge; include a connection handle and red delete control. Reveal controls on hover or selection, keeping unrelated notes quiet. Icons/labels complement color. Controls remain reachable while moving from the note to its bubbles.
- **D-07:** Hover reveals extra controls without moving the caret or losing the existing text selection. Clicking text moves the caret; clicking a control uses/preserves the selection needed for its action. Hover focus and text-editing focus are distinct.
- **D-08:** Clicking the border selects the whole note. Dragging edges/corners resizes it; text reflows while passage anchors and threads survive. Clicking text edits it. Gesture thresholds and exact resize/selection hit regions are implementation details still to resolve.

### Passage anchors and threads
- **D-09:** Connections support whole-note to whole-note, passage to whole-note, and passage to passage. A selected passage is a persistent source, not merely a temporary way to create a note-level link.
- **D-10:** For passage-to-note linking, select source text, hover the destination, and use its connection control without losing the source. For passage-to-passage linking, select source text and click its connect bubble to hold the source; select destination text and click its connect bubble to finish. Escape cancels only the unfinished connection and preserves text. Direct dragging from a connection handle to another note is also desired.
- **D-11:** A passage acts like persistent text brackets. Edits inside its boundaries, including newly inserted text within the selection, remain linked. Deleting all enclosed text leaves an empty point anchor; it does not remove the thread. Explicitly deleting the bracket structure removes it and cuts all attached threads. Exact boundary-insertion affinity is not specified and needs a consistent implementation contract.
- **D-12:** One passage can carry multiple threads. Linked passages may nest and may overlap partially; do not restrict the model to disjoint ranges or a simple nested tree.
- **D-13:** Hovering or clicking a thread highlights both endpoints: the source passage/note and destination passage/note. Linked text otherwise has subtle highlighting. Brackets become visible when the passage or its thread is hovered over or selected.
- **D-14:** Hover highlighting is a hierarchy, not a single winner: all passages overlapping the pointer region highlight; the smallest passage is strongest; successively larger enclosing passages are progressively weaker; even the outermost affected passage is stronger than unrelated text. Moving the pointer updates this gradient of focus. Short passages must remain readable. The accepted discussion also gives shorter passages stronger emphasis in partial overlaps; equal-length/tie behavior is unresolved.
- **D-15:** Clicking in overlapping linked text provides a way to choose which passage/thread to highlight, follow, or edit. The user refined the initial small-chooser suggestion by requiring the hover hierarchy in D-14; exact chooser presentation is not finalized. Clicking ordinary text must still allow caret placement.

### Text-bearing thread-center nodes
- **D-16:** Threads have center nodes that can hold text about the thread. These are ordinary editable/connectable nodes: they can connect to other notes or passages themselves and support the same editor and passage semantics.
- **D-17:** A thread-center node stays automatically between its endpoints until manually dragged. After dragging it keeps the user's chosen position. Exact geometry/routing and resetting automatic placement remain implementation questions.
- **D-18:** An empty thread-center node appears on thread hover/selection; once it has text it remains visible. Clearing it returns to empty-structure semantics without cutting the thread.
- **D-19:** Deleting a thread-center node's content preserves the node/thread. Deleting its structure cuts the represented thread and its attached connections while preserving the other endpoint notes/passages. Recursive cases where threads attach to other thread nodes need a precise implementation contract that preserves unaffected content.

### Consistent deletion and undo
- **D-20:** Universal rule: content may be empty; deleting its container removes its connections. Clearing note text preserves the note, its empty passage anchors, and attached threads. Deleting the note removes its structure and cuts attached threads, preserving notes at other ends. Deleting a bracket shared by multiple threads cuts all of those threads.
- **D-21:** A red delete bubble deletes the note structure. Selecting the whole note and using Delete/Backspace also deletes it. With an active text caret/selection, those keys edit text only. Avoid accidental whole-note deletion while typing.
- **D-22:** Undo restores a deleted note/structure, text, anchors, and threads together. The brief requires undo/redo for every user-visible mutation through event history. Undo/redo must coexist with autosave; do not erase historical evidence to implement it. Full branch navigation remains later phase work.

### Universal rich-text editing
- **D-23:** Provide bold, italic, headings, lists, text color, alignment, and font family selection. Exact font catalog, size controls, and formatting serialization were not decided.
- **D-24:** A compact floating formatting toolbar sits near selected text. It expands on hover into more options; hovering those options reveals further options. Controls are also available while typing without a text selection. Interacting with formatting preserves the text selection.
- **D-25:** Toolbar/submenus remain open while the pointer is anywhere inside them, including moving between levels. Collapse only after a short delay on leaving. Exact delay and geometry are not specified.
- **D-26:** The same formatting controls and editor behavior are universal across ordinary notes and text-bearing thread-center nodes, including passage linking.

### Teachable plugin authoring and local loading
- **D-27:** Plugin projects must teach the system through visible, understandable primitives. Helpers and generated files may remove repetition, but essential behavior must not be hidden behind framework boilerplate. — **Reversibility:** one-way — establishes the API philosophy; changing it later would break every existing plugin's mental model and documentation.
- **D-28:** Each plugin has a readable manifest and a clear main composition file that describes the plugin's pieces and how they fit together. Individual modules should be only as divided or as large as their responsibilities require.
- **D-29:** Reloading changed plugin code is explicit by default. Developers can opt into automatic reload while actively developing.
- **D-30:** Local installation follows the Minecraft-mods mental model: place a plugin folder or package in Tapestry's `plugins` directory, then launch Tapestry with it discovered and enabled. Development tools may automate this mechanism but must not obscure it.

### Trust, recorded effects, and failure containment
- **D-31:** Choosing and installing a plugin is the user's trust decision; routine per-capability or per-action permission prompts are not required. Regardless of that trust, the host must enforce that plugins cannot delete or rewrite earlier `.tree` journal records.
- **D-32:** A plugin's source and release history may live in GitHub. The world records plugin installation, enablement, disablement, identity, or version as a new journal event when that fact affects how the tree is regenerated. Plugin-originated durable effects still pass through attributed, validated, atomic core transactions.
- **D-33:** A missing or broken plugin never prevents a world from opening. Tapestry opens the world with that plugin inactive, preserves the complete recorded history, and exposes its persisted content through a generic readable fallback. Behavior supplied by the missing plugin simply does not run; for example, a project that used a physics plugin remains openable without physics installed.
- **D-34:** If a plugin crashes or hangs during a session, notify the user immediately that it stopped working and that Tapestry is attempting a restart. Attempt one automatic restart. If that fails, disable only that plugin and show an error notification with **Restart** and **Dismiss** actions. Release its handlers and leave any unfinished durable transaction unapplied so the prior world state remains intact.
- **D-35:** Disabled plugin content remains editable through a generic fallback editor. Custom commands, editors, themes, or other UI may disappear, but underlying nodes, properties, connections, plugin/version information, and recorded events remain readable and editable. Losing a theme or UI plugin must never hide or strand its data.

### Research/planning-resolved mechanics
The following areas were not discussed because the user considers the design ethos and existing decisions sufficient to guide implementation. Research and planning agents must resolve these within the constraints of the design ethos, the locked decisions D-01 through D-35, and requirements PLUG-01 through PLUG-07:

- **Plugin contribution surface:** How plugins register node schemas, commands, property views, and UI panels. The public API shape that a developer sees when building a feature. Must follow D-27 (visible primitives), D-28 (manifest + composition file), and PLUG-02 (versioned public API for schemas, commands, property/UI contributions).
- **Compatibility and recorded history:** Version contracts for plugin APIs and schemas. What happens when a plugin version is unavailable. Recorded outcomes vs executable replay. Must follow PLUG-05 (clear compatibility result, no silent substitution), PLUG-06 (validated recorded transactions, failed transaction leaves prior state intact), and D-32 (version changes recorded as journal events).

### Claude's Discretion
No blanket delegation of unresolved product decisions was given. Exact implementation, tooling, serialization of rich text/anchors, palette, timings, and layout remain research/planning work constrained by the decisions above. Existing core/plugin invariants remain in force; this discussion did not choose a UI toolkit or plugin runtime.
</decisions>

<canonical_refs>
## Canonical References

Downstream agents MUST read these before planning or implementing:

### User-supplied design brief
- `.planning/phases/02-plugin-host-sdk-feasibility-gate/02-BASE-UI-BRIEF.md` — durable readable extraction of the user-supplied brief, including all cognitive primitives, sample toolset, and deferred vision.
- `.context/attachments/zc6QvP/Tapestry_Base_UI_Brief.docx` — original user attachment, workspace-local and gitignored; use the extraction if unavailable.

### Project foundation
- `.planning/PROJECT.md` — product vision and foundational plugin/readability/control constraints.
- `.planning/REQUIREMENTS.md` — PLUG-01 through PLUG-07 and notebook/history requirements; phase mapping predates this discussion's expanded UI scope.
- `.planning/ROADMAP.md` — phase boundaries and toolkit feasibility gate; requires reconciliation during planning.
- `.planning/STATE.md` — prior decisions, including the locked .tree format and independent C++ kernel.

### Phase 1 deliverables
- `tapestry/docs/tree/FORMAT.md` and `tapestry/docs/tree/example.tree` — existing readable persistence contract; the brief's permissive JSON suggestion does not override it.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tapestry/kernel/Kernel.hpp`: Proposal/submit transaction path, read-only world access via `world()`, create/open/repair/saveAs lifecycle. Plugin durable mutations must pass through the existing `submit()` boundary.
- `tapestry/kernel/World.hpp`: Node/edge model with typed ops (CreateNode, SetProperty, CreateEdge, etc.), sequential id assignment, tick counter. Stores opaque node types and typed properties without feature classes.
- `tapestry/kernel/Ops.hpp`: Already admits `plugin` actors and tokenized version-bearing type names.
- `tapestry/core/Camera.hpp`: Prototype pan/zoom, screen/world coordinate mapping, centering/framing; view state is independent of replay.
- `tapestry/kernel/journal/Journal.hpp`: Durable append with SHA-256 chain, torn-tail detection and repair, verified-prefix model.

### Established Patterns
- Single-writer, proposal-submit, scratch-copy-then-swap for atomicity. All mutations go through `Kernel::submit()`.
- Unknown plugin data is already supported in the .tree format (Phase 1 work) — readable fallback values survive round-trip.
- Separate headless `tapestry_kernel` CMake target and kernel tests; old SDL/OpenGL/NanoVG stack is gated behind `TAPESTRY_BUILD_RENDER`.
- C++20 kernel with doctest v2.5.3 for testing.

### Integration Points
- Plugin commands must produce `Proposal` structs submitted through `Kernel::submit()`.
- The .tree codec already handles unknown op types and extension fields readably.
- The render stack is build-gated and not assumed as the UI solution — the feasibility gate will determine the toolkit.
</code_context>

<specifics>
## Specific Ideas

User language: "text brackets []"; selection text "gobbled up" by the cursor; "bubbly buttons" of different colors; a "gradient of focus" refined into progressively weaker highlights for successively larger passages. Threads themselves carry thoughts through ordinary center nodes. Content deletion and structure deletion are intentionally distinct everywhere. Local plugins should feel like adding mods to Minecraft: put them in the plugins folder and run Tapestry. Plugin structure should read as an explanation of how its pieces fit together, not as generated boilerplate.
</specifics>

<deferred>
## Deferred Ideas

- A user-facing Tapestry plugin updater may automate plugin distribution updates in a future phase. Phase 2 only locks the underlying explicit install/reload behavior; updater design and distribution policy remain later work.
- Full branching/history navigation (Phase 3), companion/semantic AI, simulations, Mimics, and the brief's explicitly deferred 3D, distributed compute, complex cryptography/federation, continuous AV perception, rigid automatic ontologies, NPC training, and polished multiplayer.
- The brief's primitive AI toolset is future-facing guidance, not authorization to build an AI integration in Phase 2.

Do not defer passage links, overlap/highlight hierarchy, thread-center nodes, autosave, or the agreed universal editing controls: the user explicitly requested these in the Phase 2 working app. Reconcile scheduling transparently during planning.
</deferred>

---

*Phase: 02-plugin-host-sdk-feasibility-gate*
*Context gathered: 2026-09-09*
