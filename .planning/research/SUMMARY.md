# Project Research Summary

**Project:** Tapestry
**Domain:** Offline spatial knowledge workspace with deterministic replay, branching history, and a public plugin SDK
**Researched:** 2026-09-08
**Confidence:** MEDIUM

## Executive Summary

Tapestry is a "readable second brain": a local, offline-first spatial world where notes, drawings, typed properties, and natural-language rules coexist, with everything persisted in a human-readable `.tree` history that supports provenance, branching, and deterministic replay. Research across all four dimensions converges on one architectural conclusion: build a headless, deterministic world kernel (graph + ordered transactions + bounded primitive rule evaluator) behind a versioned plugin host, with every feature — note editing, drawing, timeline, rules, AI companion, attention capture — shipped as a plugin against the same public contract used by third parties. Event-sourcing, Git-style single-parent branching, and Temporal-style recorded-input replay are the proven precedents; none of them alone supplies Tapestry's semantics, so the `.tree` format, command protocol, and execution profile must be designed deliberately and early.

The recommended stack retains the existing C++20 kernel work (state, geometry, serialization lessons) and prototypes an Electron shell with a TypeScript/JavaScript plugin SDK as the preferred feasibility candidate, because the decisive uncertainty is extensible editing UI (IME-capable text, third-party panels/tools) — not language speed. This is explicitly a gated experiment: a throwaway vertical slice (editable note plugin, spatial interaction, independent plugin, command bridge, offline removal/replay, packaged app) decides between the web path, a Qt Quick native fallback, and the retained SDL/NanoVG baseline. Do not commit the toolkit before the gate.

The dominant risks are determinism leaks and semantic opacity: plugins keeping authoritative state outside recorded commands, replay depending on wall clock/render loop/live AI, version names mistaken for retained executable behavior, natural-language content acquiring execution authority, and provenance erased by ordinary text edits. Mitigation is structural, not incremental: all persistent mutation flows through the transaction kernel; AI output is recorded data (replay never re-queries a model); rules compile to a small typed IR with defined cycle/conflict/budget semantics; and every node/event has a readable baseline that survives plugin removal. These constraints must be enforced from the first phase — they cannot be retrofitted.

## Key Findings

### Recommended Stack

Keep C++20 for an independently testable state/replay kernel; prototype Electron + TS/JS plugins + web UI as the first feasibility candidate, with Qt Quick as the native fallback and SDL/NanoVG retained as the comparison baseline. Decision is deferred to a defined feasibility gate. (Details: STACK.md)

**Core technologies:**
- C++20 / CMake >=3.24: kernel (state, commands, provenance, branch/replay, `.tree` I/O) — verified in repo; extract a rendering-independent target
- Electron (version unpinned): desktop shell + isolated per-plugin web surfaces — best story for editable text and third-party UI; pin only after the gate
- TypeScript/JS ES modules + Vite: public SDK and plugin dev loop — familiar third-party authoring; SDK must not expose Electron APIs
- ProseMirror family (candidate): rich-note editing transactions/selection — evaluate through the text gate; verify current forge/releases first
- `.tree` codec (new, versioned): line-oriented strict-JSON transaction journal with canonical hashing (RFC 8259/8785) — design grammar before parser selection
- Deferred: QuickJS (custom evaluators), SQLite (rebuildable indexes only, never sole source of truth)

### Expected Features

**Must have (table stakes):** create/edit/move/connect notes; dependable text editing (IME, undo, clipboard, Unicode); drawing + typed properties; durable inspectable local `.tree` content; visible origin with accept/reject; easy local plugin authoring; content survives missing plugins.

**Should have (launch differentiators — user-stated, not optional):** nodes executing inspectable typed rules with visible effects; user placement coexisting with dynamic motion (pin/drag/pause precedence); deterministic time travel and branching that retains original futures; conversational companion plugin with connected capture; editable guessing-policy nodes; mixed-origin lineage at passage granularity; inspectable/correctable initial profile memory; hover occurrence/duration evidence recorded separately from sentiment.

**Defer (v2+):** broad social imports, mature behavioral mimic, multi-agent branch orchestration, universal media execution, marketplace, realtime collaboration, arbitrary prose-as-code, mandatory auto-layout, AI provider in core.

### Architecture Approach

One local application: feature plugins -> application shell/extension host/effect broker (validated protocol, no mutable world references) -> world kernel (graph + ordered transactions + primitive evaluator) -> readable `.tree` history -> replay + rebuildable derived projections. Three distinct structures (content graph, single-parent history tree, rule dependency graph) and three kinds of time (`domainTime`, `tick`, `recordedAt`, with `parent`+`sequence` as authoritative order). Single writer per world; plugins submit atomic command proposals against an expected cursor; committed operations are fully materialized so replay never re-invokes plugin handlers. Effect broker records live AI/network results and is disabled during replay.

**Major components:**
1. World model — generic nodes/edges/typed properties/provenance; no feature-specific classes
2. Transaction kernel — sole mutation entry point; validation, ordering, atomic commit
3. History store + `.tree` journal — immutable records, branches, durable append, verified snapshots
4. Primitive rule evaluator — typed bounded IR, fixed ticks, stable ordering, budgets, simultaneous-update semantics
5. Application shell / plugin host / effect broker — loading, view containers, fallback inspector, capability-gated effects
6. Feature plugins + derived projections — editors, timeline, layout, companion; indexes rebuildable, never authoritative

### Critical Pitfalls

1. **Plugins keep authoritative state outside recorded commands** — require atomic core-recorded commands for all world changes; same path for first- and third-party code; test disable-and-inspect
2. **Replay depends on live clock/render loop/AI/execution order** — fixed steps, stable ordering, recorded external outcomes; replay never re-queries a model; separate domain time from tick from recordedAt
3. **Version names/snapshots mistaken for retained behavior** — record artifact identity/hash and replay mode; missing behavior yields explicit unavailable state, never silent substitution
4. **Natural-language content acquires execution authority** — content is data; rules compile to validated typed IR through policy-gated core commands (OWASP prompt-injection boundary)
5. **Text edits/acceptance erase provenance** — durable content revisions with anchor mapping; acceptance is a separate recorded review action; undo includes provenance
6. **Unbounded/nondeterministic rule interactions** — defined cycle rejection, reducer-based write conflicts, deterministic work budgets, atomic-or-recorded-failure effects

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Kernel and readable format foundation
**Rationale:** Every durable feature depends on the transaction/history/provenance contract; it cannot be retrofitted.
**Delivers:** Generic graph model, ordered transactions, provenance at property/revision granularity, versioned `.tree` journal with strict parsing, durability/recovery, fallback inspector for unknown plugin data.
**Addresses:** Durable inspectable content; content survives missing plugins.
**Avoids:** Pitfalls 1, 4 (hidden state, opaque files); startup coupling.

### Phase 2: Plugin host, SDK, and feasibility gate
**Rationale:** The stack decision (Electron vs Qt vs native baseline) hinges on demonstrated text editing and third-party SDK viability; deciding late risks a rewrite.
**Delivers:** Plugin manifest/contract (host API version vs data schema vs execution artifact identity), local dev/reload loop, starter examples, and the vertical-slice gate (editable note, spatial interaction, independent plugin, command bridge, offline removal, packaged app) with measured budgets.
**Uses:** Electron + TS SDK candidate vs retained baseline.
**Avoids:** Pitfall 1; untested-abstraction API risk.

### Phase 3: Branching history and deterministic replay
**Rationale:** Replay/fork semantics must be proven before rules and companion generate history that depends on them.
**Delivers:** Single-parent branches, history cursor with interior ticks, fork-without-erasing-original-future, snapshots bound to prefix+execution profile, replay hash fixtures, missing/mismatched-plugin diagnostics.
**Implements:** History store + execution-profile identity.
**Avoids:** Pitfalls 2, 3.

### Phase 4: Spatial editing plugins (notes, drawing, properties, placement)
**Rationale:** First real exercise of the public contract with usable features; validates editor/provenance model before AI-generated text exists.
**Delivers:** Note editor with IME/undo/provenance anchoring, freehand strokes, typed property controls, connections, pin/drag semantics, timeline navigation (dates vs history cursor distinction).
**Addresses:** All table stakes; provenance review actions.
**Avoids:** Pitfall 5; layout-fights-editing; date-edit-vs-history-rewrite confusion.

### Phase 5: Deterministic rule execution
**Rationale:** Bounded typed evaluator must exist and be verified before natural-language compilation targets it.
**Delivers:** Typed IR (values/reads/arithmetic/spatial/reductions/outputs/scheduling), fixed-tick simultaneous updates, cycle rejection, reducer conflict policy, budgets with deterministic failure, advance(ticks) recording, pin/move/proximity/gold examples.
**Avoids:** Pitfalls 2, 6.

### Phase 6: Companion, rule authoring, and policy
**Rationale:** AI depends on stable command, rule, and provenance contracts; it cannot repair ambiguity beneath it.
**Delivers:** Companion plugin via effect broker (recorded requests/interpretations), prose-to-IR compilation with unresolved-reference workflow, editable guessing-policy nodes, mixed-origin accept/reject, adversarial-content boundary tests.
**Avoids:** Pitfalls 4, 5.

### Phase 7: Profile memory and attention evidence
**Rationale:** Depends on provenance, branching, and review evidence from all prior phases.
**Delivers:** Branch-local inspectable profile (evidence links, explicit-vs-inferred, superseding corrections), hover occurrence/duration capture with defined session semantics, separation of observation from sentiment.
**Avoids:** Evidence drift, cross-branch leakage, hover-as-approval (PITFALLS.md #8).

### Phase Ordering Rationale

- Matches the dependency chain in FEATURES.md and ARCHITECTURE.md capability order: history/provenance primitives before durable mutations; typed evaluator before NL compilation; stable contracts before companion.
- The feasibility gate is deliberately early (Phase 2) so the toolkit decision precedes broad UI investment, while Phase 1 work (kernel, format) is toolkit-independent.
- A thin usable spatial slice exercises the plugin contract early rather than perfecting history infrastructure in isolation; Phases 2-4 interleave real editing with the API.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** `.tree` framing/readability validation with real notes; canonical hashing of unknown extension fields; durability failure-injection design
- **Phase 2:** Electron version pinning, per-plugin isolation/origin design, ProseMirror forge/release verification, packaging cost measurement
- **Phase 5:** Numeric semantics (fixed-scale ranges, rounding), tick interval, CEL-subset vs custom IR decision
- **Phase 6:** Prompt-injection boundary testing, policy precedence semantics, AI provider adapter contract

Phases with standard patterns (skip research-phase):
- **Phase 3:** Git/Temporal precedents well-documented; mostly disciplined application
- **Phase 4:** Established editor/canvas patterns once the toolkit gate resolves
- **Phase 7:** Design-decision-heavy but small surface; PROV-DM modeling reference suffices

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Electron preference is an engineering inference gated on a feasibility slice; no version pins; ProseMirror forge migration unverified |
| Features | MEDIUM | User scope directly grounded in PROJECT.md (high); ecosystem comparisons and complexity estimates are MEDIUM |
| Architecture | MEDIUM | Patterns backed by strong precedents (event sourcing, Temporal, Git, Box2D, JCS); Tapestry-specific contracts unprototyped |
| Pitfalls | MEDIUM | Failure mechanisms source-backed; preventions are design recommendations, not proven implementations |

**Overall confidence:** MEDIUM

### Gaps to Address

- Toolkit decision (Electron vs Qt vs native): resolve via Phase 2 feasibility gate with pre-set budgets; do not decide from benchmarks or prototype appearance
- `.tree` readability of long escaped text and final framing: validate with real notes before freezing syntax
- Rule numeric contract (ranges, rounding, tick interval) and custom-evaluator isolation/determinism: targeted spikes in Phase 5; gate custom evaluators behind them
- Branch-local vs shared companion memory, hover session boundaries, drag sampling during simulation: settle in phase-level design
- No source establishes universal cross-platform replay or mature-mimic quality — scope promises accordingly (declared execution envelope, explicit deferral)

## Sources

### Primary (HIGH confidence)
- Local repo evidence: tapestry/CMakeLists.txt, core/World.hpp, core/Document.hpp, app/main.cpp, tapestry/tests/
- Official docs checked 2026-09-08: Electron process model/security, Qt Quick TextEdit/accessibility/security model, Tauri 2 architecture/sidecar/capabilities, QuickJS manual, Vite, Temporal workflow-definition/safe-deployments, VS Code manifest/contribution points, Figma manifest, Obsidian Canvas/sample plugin, MDN beforeinput, Wasmtime interruption, CEL overview, SQLite atomic commit
- Stable specifications: RFC 8259, RFC 8785, RFC 7464, W3C PROV-DM (2013), WCAG 2.1/2.2 guidance, JSON Canvas 1.0 (2024)

### Secondary (MEDIUM confidence)
- Fowler, Event Sourcing (2005) — replay boundary for external effects
- Box2D determinism analysis (2024) — ordering/compiler/math limits on reproducibility
- OWASP LLM01 prompt injection (2025) — constrained authority + deterministic validation
- Git internals — object/commit identity model for branching

### Tertiary (LOW confidence)
- ProseMirror current releases/forge location — archived GitHub source only; verify before installing
- Comparative shell costs (Electron vs Qt vs Tauri) — project-specific inference, not measured

---
*Research completed: 2026-09-08*
*Ready for roadmap: yes*
