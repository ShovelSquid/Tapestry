# Feature Research

**Project:** Tapestry
**Domain:** Spatial second brain with executable rules, branching history, and feature plugins
**Researched:** 2026-09-08
**Confidence:** MEDIUM for ecosystem conclusions and proposed implementation scope; user-stated requirements are directly grounded in [PROJECT.md](../PROJECT.md).

## Scope and Evidence

The initial release is a usable world with editing, behavior, history, and a conversational companion. It is not satisfied by a backend or canvas-only demonstration. All feature systems, including AI, ship as plugins; core storage, commands, provenance, and deterministic execution support them. Bundled plugins use the public contract.

**U** below means user-stated scope from PROJECT.md. **R** means a research recommendation for making that scope usable; recommendations do not silently become new product requirements. Complexity is relative implementation effort, not a delivery estimate. Source-backed ecosystem claims and design inferences are MEDIUM confidence, following the research confidence seam (`websearch --verified`).

## Feature Landscape

### Table Stakes

| Feature | Why Expected | Complexity | Scope and Notes |
|---------|--------------|------------|-----------------|
| Create, edit, move, and connect notes | Basic spatial knowledge work; Canvas demonstrates connected text cards and manual arrangement | HIGH | U: spatial editing and relationships. R: selection, pan/zoom, fit-to-content, discoverable creation. [Obsidian Canvas](https://obsidian.md/help/plugins/canvas) |
| Dependable text editing | Notes must support actual writing, corrections, clipboard, and selection | HIGH | U: editable notes. R: keyboard navigation, undo/redo, IME/composition, Unicode, and paste are foundational; test OS input behavior. [MDN beforeinput](https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event) |
| Drawing and structured properties | The user explicitly wants notes, drawings, anger, gold, dates, position, and velocity in one world | HIGH | U: launch capability. R: begin with editable freehand strokes and typed property controls, without a full illustration suite |
| Durable, inspectable local content | Readability is the product's core value | HIGH | U: `.tree` contains readable content, relationships, origin, and changes; binary attachments need readable references/descriptions. [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) is a baseline example of an explicit graph format, not Tapestry's history specification |
| Visible origin and review actions | Users must understand what they supplied versus what was inferred | HIGH | U: mixed-origin passages, accept/reject, original origin retained. R: text labels/icons plus color, keyboard-accessible detail. [W3C color guidance](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) |
| Easy local plugin authoring | This is a foundational user requirement | HIGH | U: manifest, documented public extension points, starter examples, load locally without core rebuild. R: a node/property interaction example and a tool example, with actionable errors. [Obsidian sample SDK](https://github.com/obsidianmd/obsidian-sample-plugin) |
| Content survives a missing plugin | A plugin must not become the sole interpreter of a user's knowledge | HIGH | U: readable baseline, schema/version, origin, relationships survive uninstall. R: fallback inspector and explicit unavailable-behavior status |

### Differentiators Required for Tapestry's First Release

These distinguish the requested product but remain launch requirements; they are not optional because competitors frame them as advanced.

| Feature | Value Proposition | Complexity | Scope and Notes |
|---------|-------------------|------------|-----------------|
| Nodes execute inspectable rules | Thoughts become behavior affecting connected properties and space | HIGH | U: natural-language rules become explicit inputs/outputs, including forces; unknown definitions and unsupported instructions have a visible resolution path |
| User placement coexists with dynamic motion | A living world retains intentional organization | HIGH | U: every node movable, fixed/dynamic behavior, visible effects. R: explicit pin state, pause control, and clear drag-versus-force precedence |
| Deterministic time travel and branching | Users change the past while retaining the original future | HIGH | U: replay from recorded inputs/outcomes, branch on past edits, optional snapshots. R: named branch navigation and visible current branch/time |
| Conversational companion plugin | Natural conversation enriches people, events, concepts, notes, and rules | HIGH | U: rapport, connected capture, discrepancy/missing-detail questions. R: show proposed effects and evidence in context, preserve unresolved items |
| Editable guessing-policy nodes | The user controls asking, suggesting, and permitted automatic filling | HIGH | U: policy represented as editable nodes. R: define policy scope and precedence before multiple interacting policies |
| Mixed-origin knowledge with durable lineage | Acceptance can increase trust without rewriting authorship | HIGH | U: explicit/generated distinction and passage-level review. R: persistent origin references independent of editor styling; revision relationships are a useful model. [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) |
| Inspectable initial profile memory | Companion personalization remains correctable | HIGH | U: readable/editable language evidence, corrections, preferences, and inferred beliefs. R: evidence links, explicit versus inferred status, and superseding corrections |
| Hover occurrence and duration evidence | Attention observations can inform later interpretations | MEDIUM | U: record each hover occurrence and duration as metadata. R: define enter/exit, lost-focus, overlap, and interrupted-session semantics; keep observations separate from sentiment and acceptance |

### Anti-Features and Explicit Deferrals

| Feature | Why Tempting | Why Avoid Now | Alternative |
|---------|--------------|---------------|-------------|
| Arbitrary prose evaluated directly as code | Appears to make every idea executable | Ambiguity, unsafe authority, and unreplayable model interpretation | Compile a supported, validated behavior proposal; record the executable form and decisions |
| Mandatory automatic layout | Makes an impressive moving demo | Can destroy user placement and make text difficult to edit | Explicit automatic-placement policy, pinning, and user-controlled dynamic motion |
| Hover automatically means approval | Produces effortless preference signals | Attention does not identify agreement or sentiment | Preserve observation; request or infer separately under guessing policy |
| AI provider built into core | Simplifies one initial integration | Contradicts the plugin boundary and makes offline replay fragile | Companion/provider adapters remain plugins |
| Broad social adapters and universal media execution | Expands capture sources | User explicitly deferred breadth before the local world works | Add adapters against stable content/provenance contracts later |
| Mature mimic and multi-AI branch orchestration | Attractive long-term demonstrations | User explicitly deferred these until memory and branching foundations work | Deliver inspectable initial profile memory and deterministic branches now |
| Marketplace, realtime collaboration, full database app | Competitor parity or ecosystem ambition | Not established user scope; creates distribution/sync/query work | Local plugin install, one-user world, extensible properties |

## Feature Dependencies

```text
Public plugin contract + generic command/data model
  -> bundled note/drawing/property tools + external-author starter examples
Readable history + provenance + deterministic execution/version contract
  -> replay + branch creation + timeline plugin
Editable properties + connections + controlled spatial motion
  -> bounded rule execution + visible interacting effects
Provenance + atomic command proposals + guessing-policy semantics
  -> natural-language companion + validated rule interpretation
Review/correction evidence + branch/memory scope
  -> initial editable profile memory
Hover occurrence/duration capture
  -> separate, evidence-backed attention interpretation later
```

History/provenance primitives must precede durable feature mutations. The public API should be exercised with a real editor and a behavior plugin early, so it does not become an untested abstraction. Companion output depends on stable command and rule contracts; it cannot repair an ambiguous runtime contract. Timeline presentation is a plugin, but history order and branch identity belong to the core. [Temporal's replay/versioning model](https://docs.temporal.io/workflow-definition) supports the separation of recorded nondeterministic inputs from replay logic; adopting Temporal itself is not implied.

## MVP Definition

### Launch With

- [ ] Minimal core and versioned plugin contract, local development/install loop, useful errors, and first-party API parity.
- [ ] Spatial notes, editable drawings and properties, connections, user placement, pin/dynamic behavior, and visible rules affecting one another.
- [ ] Readable `.tree` history with provenance, deterministic replay, editable event dates, timeline navigation, and retained original futures on branching.
- [ ] Natural-language companion plugin that creates connected knowledge, resolves ambiguity/conflicts, and follows editable guessing-policy nodes.
- [ ] Explicit/inferred passage provenance and accept/reject actions that preserve original authorship.
- [ ] Initial readable/editable profile evidence, corrections and inferred beliefs; hover events and duration captured separately from inferred attitude.
- [ ] Recovery with feature plugins disabled, understandable missing-version behavior, and core operation without a live AI provider.

### Add After Validation

R: richer rule operators, editor formatting, drawing tools, advanced profile inference, and profiling-driven navigation improvements. Expand only after the full first-release loop above passes; this does not defer basic drawing, rules, companion, or memory.

### Future Consideration

U: broad social imports, mature behavioral mimic, multi-agent branch orchestration, and comprehensive external file execution. No timing or quality claims are supported yet.

## Prioritization and Reference Products

| Capability Group | User Value | Cost | Priority |
|------------------|------------|------|----------|
| Plugin/data/history foundation and recovery | HIGH | HIGH | P1: prerequisites for every durable feature |
| Spatial editor, interacting rules, timeline, companion, provenance | HIGH | HIGH | P1: launch is incomplete without this vertical workflow |
| Initial profile evidence and hover capture | HIGH | MEDIUM–HIGH | P1: narrow inspectable foundations |
| Advanced authoring polish and deeper learning | MEDIUM | HIGH | P2: evidence-driven expansion |
| Social breadth, mature mimic, multi-AI orchestration | Future | HIGH | P3: explicit deferrals |

| Reference | Verified Capability | Lesson for Tapestry |
|-----------|---------------------|---------------------|
| [Obsidian Canvas](https://obsidian.md/help/plugins/canvas) | Text/file cards, connections, grouping, spatial arrangement | Use as a familiarity baseline; do not add every attachment type to launch |
| [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) | Explicit IDs, node content/type/geometry, and edges | Specify readable relationships; Tapestry still needs a separate history/replay contract |
| [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin) | Typed API, sample commands/settings/events, manifest, development build loop | Make the smallest useful extension easy to write; independently enforce Tapestry's recorded-mutation contract |

## Sources and Remaining Questions

Primary sources were checked on 2026-09-08; JSON Canvas 1.0 is dated 2024-03-11, and PROV-DM is the stable 2013 Recommendation. Current product/help pages were used without inferring undocumented competitor limitations. Additional implementation references: [ProseMirror transaction/mapping guide](https://prosemirror.net/docs/guide/) and [W3C hover/focus guidance](https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus).

Phase design must settle supported rule vocabulary, rule conflicts/units/cycles, profile branch scope, fine-grained text revision semantics, hover boundaries, missing-plugin execution guarantees, and the minimum drawing toolset. Ecosystem research does not establish a mature mimic's achievable quality or a universal cross-platform replay guarantee.
