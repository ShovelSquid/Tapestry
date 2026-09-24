# Pitfalls Research

**Project:** Tapestry
**Domain:** Plugin-extensible spatial knowledge, deterministic rules, branching history, and companion memory
**Researched:** 2026-09-08
**Confidence:** MEDIUM. Primary documentation supports the mechanisms; prevention choices are Tapestry-specific design recommendations, not proven implementation results.

## Critical Pitfalls

### 1. Plugins keep authoritative state outside the recorded world

**What goes wrong:** Notes, force accumulators, AI memory, or plugin preferences affect future behavior but disappear on replay, uninstall, or another machine.
**Why it happens:** A convenient plugin-local cache becomes durable state, or first-party features bypass the public API.
**How to avoid:** Require atomic core-recorded commands for world changes. Distinguish disposable UI/cache state from persisted behavior inputs, including plugin settings that affect results. Give plugin data readable fields, schema identity, origin, and generic relationship references. Test the same extension path for first- and third-party code.
**Warning signs:** Reload changes results; a plugin needs a private database to explain a node; default settings alter old branches.
**Phase to address:** Minimal core and SDK, then each bundled feature. Obsidian's [sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) is a useful authoring reference, but its event/interval examples do not establish Tapestry's deterministic contract. [Temporal's workflow contract](https://docs.temporal.io/workflow-definition) illustrates recording external inputs.

### 2. Replay depends on the live clock, render loop, AI, or execution order

**What goes wrong:** An old branch changes when the window refreshes at another rate, a model answers differently, or plugins enumerate nodes in a new order.
**Why it happens:** Simulation time, event dates, history order, wall-clock time, random inputs, and asynchronous completion are conflated.
**How to avoid:** Define fixed simulation steps, stable ordering and numeric semantics, deterministic random inputs, and recorded external outcomes. Persist AI interpretation and resulting validated commands; never request the same answer again during replay. Separate when an event occurred from when it was recorded or corrected. Document the exact supported replay environment.
**Warning signs:** Replay needs a network key; headless and graphical runs differ; changing frame rate changes anger/velocity; multiple same-time writes have no defined winner.
**Phase to address:** History/execution foundation before force and companion plugins. [Temporal determinism](https://docs.temporal.io/workflow-definition) explicitly treats local time/randomness and code changes as replay hazards; [replay testing guidance](https://docs.temporal.io/develop/safe-deployments) recommends replaying existing histories against changes.

### 3. Version names and snapshots are mistaken for retained executable behavior

**What goes wrong:** The history names plugin v1, but only incompatible v2 is available. A snapshot opens the final picture while intermediate simulation states cannot be reconstructed.
**Why it happens:** Saving a version string or a checkpoint is assumed to preserve all computation. Migrations silently reinterpret historical commands.
**How to avoid:** Record artifact identity/hash, schemas, API/engine compatibility, and replay mode. Decide which events contain sufficient core-understandable outcomes and which require retained executable artifacts. Missing behavior must produce an explicit unavailable state, never substitute current code. Snapshots bind to branch prefix and engine/plugin identities. Preserve old history during migration.
**Warning signs:** A plugin update changes an existing branch hash; replay works only from the newest snapshot; uninstall makes history unreadable.
**Phase to address:** `.tree`/plugin version contract and branching. [Temporal safe deployments](https://docs.temporal.io/develop/safe-deployments) motivates compatibility checks; artifact retention and fallback behavior remain Tapestry design decisions. **Readability without the engine or plugin does not guarantee execution without missing code.**

### 4. Readable files are technically text but semantically opaque

**What goes wrong:** `.tree` contains UUIDs, opaque plugin payloads, compressed blobs, or machine-only deltas that cannot explain the user's thoughts or changes.
**Why it happens:** Serialization convenience is treated as a human-readable format; plugin custom rendering becomes the only explanation.
**How to avoid:** Specify a readable baseline for every node and event: content/description, stable identity, meaningful relationships, source, schema/version, and understandable change records. Include a small complete example and a format guide. Preserve unknown fields on round-trip. Treat binary attachments as referenced assets with readable metadata. Verify with a plain text editor and no application running.
**Warning signs:** An independent reader cannot identify who said something or which branch changed it; removing a plugin hides all meaning.
**Phase to address:** Format and SDK foundation. [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) demonstrates explicit content, geometry, and edge fields; it does not supply Tapestry's branching history semantics.

### 5. Natural-language content acquires execution authority

**What goes wrong:** Quoted notes or imported text rewrite guessing policies, arbitrary model output executes, or an ambiguous rule silently becomes a precise world law.
**Why it happens:** Content, user commands, policy authority, and executable representations share one undifferentiated prompt path.
**How to avoid:** Keep source text as data. Compile supported rule intent into a typed, bounded representation with explicit inputs, outputs, references, and units. Validate proposals through core commands and current policy; an ordinary content node cannot grant capabilities or change policy. Preserve unresolved definitions and ask/propose according to policy. Store interpretation, model/source metadata, and review state.
**Warning signs:** A note saying to disregard rules changes the active policy; a JSON-shaped response bypasses semantic validation; unsupported prose reports successful execution.
**Phase to address:** Rule authoring and companion integration. [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) documents indirect instructions through external content and recommends constrained authority plus deterministic validation; prompt wording alone is not the boundary.

### 6. Interacting rules have no bounded, deterministic failure behavior

**What goes wrong:** Two rules recursively trigger each other, conflicting writes depend on scheduling, or proximity forces explode into non-finite values and freeze the editor.
**Why it happens:** A single-rule demo is generalized without semantics for cycles, units, missing inputs, resource usage, or competing outputs.
**How to avoid:** Specify evaluation phases, conflict resolution, fixed-point/iteration policy, numeric limits, and deterministic per-step work budgets. Validate references and units; expose disabled/unresolved/error states. Commit effects atomically or record a defined failure, and keep recovery controls outside plugin execution. Use a bounded supported operator set initially.
**Warning signs:** A cyclic graph stalls; invalid values propagate; timeouts leave half-updated nodes; different machine speed changes committed effects.
**Phase to address:** Deterministic rule/force execution before natural-language compilation. [Wasmtime interruption documentation](https://docs.wasmtime.dev/examples-interrupting-wasm.html) distinguishes deterministic fuel interruption from timing-dependent epochs; this supports the budget distinction without selecting Wasmtime as the stack.

### 7. Text edits and acceptance erase or misattribute provenance

**What goes wrong:** Inserting text shifts origin ranges; pasted/generated passages inherit human authorship; accepting a suggestion removes its source; undo restores content without its review state.
**Why it happens:** Provenance is only a color or stale offset pair, and edit history is disconnected from origin/revision records.
**How to avoid:** Persist content identities/revisions and source references; transform anchors with edits and define split/merge/paste/deletion behavior. Distinguish original author, subsequent editor, and reviewer. Acceptance is a separate recorded review action. Make undo/redo and branching include corresponding provenance changes. Use decorations only as a projection of durable metadata.
**Warning signs:** Editing one sentence recolors its neighbor; replacing generated words still reports the old source; UI and `.tree` disagree.
**Phase to address:** Note editor and provenance before companion-generated text. [ProseMirror mapping](https://prosemirror.net/docs/guide/) supplies an editing mechanism, not a full provenance model; [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) distinguishes attribution and derivation/revision.

### 8. Learning turns weak evidence or alternate futures into user beliefs

**What goes wrong:** A long hover counts as approval, inferred claims are reused as supporting evidence for themselves, or a fantasy branch changes the companion's real-world profile.
**Why it happens:** Observations, sentiment inference, explicit corrections, and accepted conclusions are collapsed into mutable profile text shared by every branch.
**How to avoid:** Store hover occurrence/duration as observations with node/revision and branch context. Record inferences separately with evidence references and inference version; retain explicit corrections as stronger evidence. Recommend branch-local derived memory initially, with explicit promotion of selected preferences if shared memory is later introduced. Profile edits must supersede old conclusions visibly.
**Warning signs:** The companion cannot cite primary evidence for a preference; reprocessing its own summary strengthens a claim; exploring an alternate future changes another branch's interpretation.
**Phase to address:** Initial profile memory and attention capture. Grounded in the user's [explicit provenance/attention requirements](../PROJECT.md), with [PROV-DM derivation](https://www.w3.org/TR/prov-dm/) as a modeling reference. This is a design-risk inference; no source establishes hover as sentiment or mature mimic quality.

## Moderate and Minor Pitfalls

| Pitfall | What Goes Wrong | Prevention and Capability Phase |
|---------|-----------------|---------------------------------|
| Automatic layout fights editing | Notes move during selection or typing; dragging silently rewrites dates | Separate position/event date; define pin/drag/force precedence and pause/resume in spatial editing |
| Provenance depends only on color or hover | Origin and review controls become inaccessible or undiscoverable | Text/icon alternatives, keyboard focus and persistent detail; apply [W3C color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) and [hover/focus](https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus) guidance in UI/provenance work |
| Text is drawn but not a capable editor | IME, clipboard, selection, spellcheck, or Unicode corrupt text or history | Use mature text input infrastructure; exercise composition and non-cancelable input paths described by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event) in the first note plugin |
| Plugin activation blocks startup | A throwing/hanging bundled plugin makes the world impossible to open | Isolate activation, bound startup work, report failure, expose disable/retry and generic reader before optional features load |
| Hover capture becomes frame logging | Pointer movement floods storage while incomplete sessions produce false duration | Record semantic occurrence boundaries and duration, batch durable writes, define blur/shutdown cases; never silently sample away requested occurrences |
| Missing attachments remove context | Files remain referenced but neither source nor meaning survives relocation | Stable readable references/descriptions; visible unresolved-asset state and recovery action in persistence/editing |
| View culling changes physics | Off-screen nodes stop participating and replay depends on camera position | Cull drawing independently from world execution; optimize rule dependency/spatial queries without changing semantics |
| Event-date edits masquerade as history rewrites | Timeline resorting overwrites the original sequence of corrections | Keep domain date, simulation tick, command order, and branch identity distinct in history/timeline design |

## Technical Debt and Recovery

| Shortcut | Acceptable Boundary | Recovery if It Escapes |
|----------|---------------------|------------------------|
| Small deterministic rule vocabulary | Appropriate launch scope if unsupported rules remain explicit | Add versioned operators, retain old semantics and replay fixtures |
| Trusted local plugins during development | Only with an explicit execution model; does not excuse hidden state or hangs | Disable plugin, open readable world, restore compatible artifact; preserve history |
| Rebuilding snapshots or indexes | Safe only when authoritative history and required behavior remain intact | Rebuild from verified history; never replace it with a guessed reconstruction |
| Branch-local initial profile memory | Recommended until shared-memory semantics are specified | Add explicit promotion/retraction records instead of merging derived beliefs blindly |
| UI-only provenance prototype | Disposable sketch only | Replace with persisted lineage before real companion-generated content is retained |

## Pitfall-to-Phase Mapping and Verification

| Capability Phase | Main Risks | Meaningful Verification |
|------------------|------------|-------------------------|
| Core/plugin SDK and readable format | Hidden state, opaque files, startup coupling | Build/load a small external-style plugin without core changes; disable it and still inspect its data |
| History, branches, compatibility | Nondeterminism, missing versions, invalid snapshots | Replay recorded fixtures offline; compare intermediate and final states; edit past and retain original future; exercise missing/mismatched plugin |
| Spatial notes/drawing/properties | Forced motion, broken editing, disconnected undo | Type with IME, paste, undo, draw/edit, pin/drag under forces; verify date/position separation and saved edits |
| Rule/force interactions | Cycles, conflicting writes, unbounded work | Run two interacting rules, cyclic/undefined cases and budget exhaustion; verify deterministic failure and responsive recovery |
| Provenance and companion | Authority confusion, origin loss, ambiguous compilation | Edit mixed-origin spans, accept/reject/undo, process adversarial quoted text, and resolve an undefined concept under each supported policy |
| Profile evidence and attention | Feedback drift, cross-branch leakage, mistaken approval | Record repeated hover sessions without changing acceptance; revise a preference; fork memory and trace every inference to evidence |

## Sources and Research Limits

All primary URLs above were checked on 2026-09-08. Sources include current Obsidian, Temporal, ProseMirror, MDN, Wasmtime and W3C documentation, plus OWASP's 2025 prompt-injection guidance. They support failure mechanisms; they do not validate a Tapestry implementation. PROV-DM is the 2013 Recommendation and JSON Canvas 1.0 is dated 2024-03-11.

Deeper phase research is required for the rule numeric/runtime contract, plugin artifact retention, text lineage model, branch-local versus shared memory, and hover session semantics. Scale thresholds should come from representative local worlds and measured budgets, not invented user-count targets. Universal cross-hardware replay and mature behavioral imitation remain unproven.
