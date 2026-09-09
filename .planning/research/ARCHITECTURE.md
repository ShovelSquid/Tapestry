# Architecture Research

**Project:** Tapestry
**Domain:** Extensible spatial knowledge world with executable rules and branching history
**Researched:** 2026-09-08 (project local date)
**Confidence:** MEDIUM — returned by `classify-confidence --provider websearch --verified`; applies to findings and recommendations below.
**Status:** Provisional design guidance, not a selected stack or proven implementation. Source-backed patterns are distinguished from proposed Tapestry contracts.

## Recommended Architecture

Build one local application with a headless, deterministic world kernel and a versioned plugin host. Avoid a distributed event platform for the initial local product. Event sourcing offers temporal reconstruction, but external responses and outbound effects require an explicit replay boundary. [Fowler, Event Sourcing](https://www.martinfowler.com/eaaDev/EventSourcing.html)

```text
First-party and third-party feature plugins
  notes | drawing | spatial tools | timeline | rules | companion | imports
                          │ declarative views, queries, command proposals
                          ▼
Minimal application shell / extension host / effect broker
                          │ validated protocol; no mutable world references
                          ▼
World kernel: graph + ordered transactions + primitive rule evaluator
                          │ committed inputs and materialized outcomes
                          ▼
Readable .tree history → replay → derived graph and indexes
         └───────────── verified snapshots accelerate replay
```

### Component Boundaries

| Component | Owns | Boundary |
|-----------|------|----------|
| World model | Stable node/edge IDs, typed properties, readable bodies, provenance references | No note-, character-, or social-specific classes |
| Transaction kernel | Validation, preconditions, ordering, atomic command groups, committed cursor | Only persistent mutation entry point |
| History store | Format versions, immutable records, branches, durability, snapshot validation | No UI or provider dependency |
| Primitive evaluator | Typed expressions, fixed steps, schedules, deterministic reduction, budgets | Pure inputs; no network, wall clock, hidden state, or ambient randomness |
| Application shell | Plugin loading, minimal view containers, input routing, generic fallback inspector | Rendering mechanism is host infrastructure; spatial tools and feature policy are plugins |
| Feature plugins | Content editors, timeline view, layout/force strategies, rule authoring, companion, integrations | Same public contract for bundled and external plugins |
| Effect broker | Authorized live AI/network/file interactions, result recording, request identities | Disabled for historical replay; unavailable to primitive evaluation |
| Derived projections | Spatial index, search, timeline sorting, attention summaries | Rebuildable from authoritative data; never a second source of truth |

The core supplies generic capability, not a built-in anger system or companion. A spatial plugin supplies interaction and display using the host's view/input primitives; its persistent position changes still pass through the kernel. Exact host rendering APIs need a prototype against both notes and drawing before freezing the SDK.

## Three Structures and Three Kinds of Time

The **content graph** may contain cycles, many relationships, and arbitrary spatial arrangement. The **history tree** describes immutable transaction ancestry. The **rule dependency graph** connects evaluated inputs and outputs; its execution constraints differ from ordinary knowledge links. Never infer execution edges from every semantic relationship.

Use single-parent commits initially. Branches are named references to tips; two branches share identical ancestor records, including a shared root. Merging histories would introduce multiple parents and reconciliation semantics; defer it. Git's object and commit references provide a useful identity model, without requiring Git as Tapestry's runtime store. [Git internals](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)

| Field | Meaning | Ordering behavior |
|-------|---------|-------------------|
| `domainTime` | When dinner happened; can be partial, uncertain, or calendar-only | Editable data; timeline plugins sort it with explicit uncertainty rules |
| `tick` | Integer step in the simulated world, with a versioned fixed interval | Advances only through recorded execution inputs |
| `recordedAt` | Wall-clock timestamp when a transaction was recorded | Audit metadata; never resolves ordering or drives simulation |
| `parent` + `sequence` | Causal ancestry and branch-local transaction order | Authoritative ordering, even when clocks tie or move backwards |

A history cursor identifies a commit and, where relevant, an interior tick of an `advance` interval. Editing dinner's date at today's tip creates a new correction transaction; it does not relocate that transaction in history. Scrubbing to an earlier world state and editing creates a branch at that cursor. Moving a node affects spatial state, not its event date.

### Forking Without Erasing the Original Future

1. Resolve the requested cursor using a compatible snapshot plus replay; reject unavailable exact states rather than fabricating them.
2. For an interior tick, create a new deterministic prefix `advance` from the preceding commit to that tick; preserve the original full interval on its existing branch.
3. Append the edit on the new branch, referencing the fork origin and unchanged prefix identity. Keep the original tip reachable.
4. Resume simulation under the new branch's recorded inputs and active rule versions. Do not automatically transplant later user commands or AI interpretations.
5. A future “apply later edits” operation must revalidate dependencies and explicitly resolve conflicts; it is not ordinary replay.

Branch metadata and the initial edit should commit together. A UI timeline showing historical content dates must also expose whether the user is editing a date or changing the history cursor.

## Transactions and Replay

Use one writer per open world initially. Plugins propose atomic groups of generic commands against an expected cursor or relevant entity revisions. The writer validates and resolves them into fully specified core operations, assigns order, commits durably, then publishes the state change. Concurrent stale proposals return an actionable conflict; plugin completion timing must not mutate state invisibly.

```typescript
// Illustrative protocol shape; language/runtime remain separate decisions.
type Transaction = {
  id: string; parent: string; sequence: number; tick: number;
  recordedAt: string; formatVersion: number; executionProfile: string;
  actor: { kind: "human" | "plugin"; id: string; artifactHash?: string };
  causeIds: string[]; operations: CoreOperation[];
};
type Proposal = { expectedCursor: string; operations: CoreOperation[] };
// Generic operations include node/edge creation, typed property assignment,
// content revision, review-state change, rule installation, and advance(ticks).
```

Committed operations contain assigned IDs, values, provenance, and order; replay does not invoke today's plugin command handler to rediscover their meaning. A malformed command group changes nothing. Preserve origin at property/text-revision granularity, with review state separate from authorship; accepting generated text records acceptance without rewriting its origin.

Record user inputs that affect the world, materialized AI outputs, external observations consumed by rules, rule revisions, and simulation advancement. Record AI request context identifiers and the returned interpretation/IR, not merely prompts or model seeds. Exact replay never asks a model to regenerate its prior answer. Temporal similarly treats matching command history as a determinism requirement; use the principle without adopting its service architecture. [Temporal workflow definition](https://docs.temporal.io/workflow-definition)

For randomness, begin with a specified generator/version, root seed, deterministic stream identities, and serialized counters; prohibit ambient random APIs. Record individual draws when they originate outside that contract. A seed alone is insufficient if draw order, algorithm, or hidden state changes. Stable node/rule iteration order is part of the execution profile.

For continuous motion, log compact `advance(ticks)` intervals plus changes to velocity, forces, pinning, rules, and initial state. Intermediate positions are derived. Rendering interpolates without feeding display-frame timing back into rules. Dragging while simulation runs requires tick-stamped input samples or a defined pause-drag-commit interaction; a final drop point alone cannot reproduce a proximity-sensitive path.

Live effect requests use durable request IDs and recorded results. Resume pending requests through the broker with idempotency where the external API supports it; expose uncertain outcomes otherwise. Historical replay suppresses all outbound effects. Replaying data must not resend an integration action. [Fowler's external-query and external-update boundaries](https://www.martinfowler.com/eaaDev/EventSourcing.html)

## Natural Language to a Minimal Typed Rule Representation

Keep prose interpretation in a plugin. The plugin proposes explicit node bindings, units, parameters, trigger cadence, expression, outputs, and an explanation. Unknown “chips” creates an unresolved reference; the rule remains inactive until bindings and ambiguities are resolved under the guessing policy. Preserve prose and every compiled revision together.

The initial kernel should interpret a small bounded expression tree. CEL's parse/check/evaluate separation is useful precedent; assess a compatible CEL subset versus a tiny purpose-built IR after the host language is selected. CEL itself does not define Tapestry's spatial units, state updates, or simulation order. [CEL overview](https://cel.dev/overview/cel-overview)

| Primitive family | Initial operations | Why sufficient |
|------------------|-------------------|----------------|
| Typed values | Boolean, integer, fixed-scale scalar, vector2, node reference, optional value | Validate units and distinguish unknown from zero |
| Reads/bindings | Constant, property read, explicit linked-node selection, previous-tick read | Reuse across anger, gold, position, velocity |
| Arithmetic | Add/subtract/multiply/divide, min/max/clamp, compare, if | Parameterized effects and conditions without arbitrary code |
| Spatial math | Vector addition/scaling, specified squared-distance operation | Proximity and simple movement without hardcoded concepts |
| Bounded collections | Stable-ID ordered filter and reduction with size limits | Multiple nearby inputs without unbounded evaluation |
| Outputs | Assign or contribute a typed delta to a declared property | All state writes go through kernel validation and reduction |
| Scheduling | On committed input, fixed tick, explicit one-step delay | Distinguish one-time rewards from continuously applied rates |

```text
rule proximity_anger(actor: Node, target: Node, radius: Distance, rate: Anger/Time)
  d2 = distanceSquared(read(actor.position), read(target.position))
  influence = clamp(1 - d2 / (radius * radius), 0, 1)
  contribute actor.anger += influence * rate * tickDuration

rule move(actor: Node)
  contribute actor.position += read(actor.velocity) * tickDuration

rule reward(actor: Node, amount: Gold) on recorded rewardInput
  contribute actor.gold += amount
```

These are examples of an explicitly chosen interpretation, not a claim that proximity prose uniquely implies this curve, radius, or accumulation rate. “Chips,” “anger,” and “gold” are bindings and schema declarations supplied by plugins. Require positive radius, valid units, specified overflow/division behavior, and declared clamps; an invalid rule contributes nothing and surfaces a diagnostic.

### Cycles, Conflicting Writes, and Motion Ownership

At each tick, read one immutable starting state, evaluate rules in stable order, collect proposed outputs, validate, then apply one simultaneous update. A rule reading another output sees the prior tick unless a separately declared acyclic combinational expression is evaluated within that rule. Reject zero-delay dependency cycles; permit explicit delayed feedback. Do not attempt arbitrary fixed-point convergence in the first evaluator.

Each property declares either one assignment owner or a named reducer. Reject competing assignments and assignment-plus-delta combinations unless an explicit policy defines them. Additive deltas reduce in stable rule-ID order with specified rounding; do not let registration order choose winners. Cap rule operations and collection traversal, and fail the offending rule deterministically rather than hanging the application.

Treat authored placement, authoritative simulated position, and ephemeral visual interpolation as distinct concerns. A spatial plugin translates a manual move to a recorded position update; pinning suppresses motion contributions. Automatic layout either proposes explicit positions or supplies recorded primitive rules. Two plugins cannot privately compete to control the same position.

## Plugin Contract and Missing-Plugin Behavior

Use a small manifest with plugin ID/version, host API compatibility, namespaced data schemas, entry points, capabilities, UI contributions, and behavior artifacts. Separate **host API version**, **data schema version**, and **execution artifact identity**; a compatible API range does not prove identical historical behavior. VS Code and Figma provide concrete precedents for explicit manifest compatibility. [VS Code manifest](https://code.visualstudio.com/api/references/extension-manifest), [Figma manifest](https://developers.figma.com/docs/plugins/manifest/)

Offer immutable queries/subscriptions; `submit(proposal)` for mutations; registered commands; and declarative property forms, toolbar actions, panels, and node presentation primitives. Render callbacks receive view data and emit intents, never mutable model pointers. Host-owned view containers and contribution declarations reduce coupling; VS Code demonstrates declarative contribution points. [Contribution points](https://code.visualstudio.com/api/references/contribution-points)

Support three explicit plugin behavior modes:

| Mode | Durable representation | Behavior when plugin is missing |
|------|------------------------|---------------------------------|
| Editor/import/AI adapter | Core operations plus readable plugin data and provenance | Existing data and committed outcomes replay; new plugin actions unavailable |
| Rule producer | Recorded core IR and bindings | Continues under the recorded primitive execution profile |
| Custom evaluator | Identified artifact, dependencies, serialized state, declared deterministic host inputs | Exact affected intervals require that compatible artifact; no silent substitute |

Initially favor the first two modes. Keep a versioned custom-evaluator extension point, but gate execution support on an isolation and determinism spike. Running JavaScript, native code, or WebAssembly does not by itself establish determinism or safety. A plugin's claim of purity is not evidence.

Readable plugin data includes namespace/schema version, title/body fallback, property descriptions/units, relationships, attachment descriptions, and provenance. Unknown payloads survive round trips. Store a readable schema descriptor when authored, so removal does not erase field meaning. Missing execution code may allow an exact recorded checkpoint to be inspected, while intermediate simulation remains unavailable.

The SDK should ship a starter manifest, typed protocol/schema bindings, local folder loading, hot reload for presentation code, a command inspector, and two small examples: a property editor and a rule-producing interaction. Version activation that affects execution is recorded; hot reload must not change historical meaning. Developers should test an extension without rebuilding the core.

## Readable `.tree` Storage and Recovery

Provisionally use UTF-8 JSON transaction records in a documented line-oriented `.tree` journal, with descriptive keys, readable string content, explicit links, and optional readable checkpoints. A companion format guide and an example world must make ancestry and provenance understandable in a normal editor. Long escaped text may prove insufficiently readable; validate with actual notes before freezing syntax.

Use strict JSON parsing: reject duplicate keys, invalid Unicode, non-finite values, and ambiguous numbers; encode exact fixed-scale amounts and large counters as typed decimal strings where needed. Canonicalize the hash input separately from human presentation, excluding the record's own hash; specify how unknown extension fields participate. JSON and JCS provide the baseline, not world semantics. [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html), [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)

A transaction's parent hash identifies its complete prefix, including execution-profile changes; a snapshot key includes prefix hash, interior tick if any, state-schema version, and execution profile. Store graph state, rule state, pending scheduled work, and random-stream state. Verify snapshots before use and rebuild incompatible/corrupt caches. A snapshot cannot reconstruct missing intermediate evaluator behavior.

One complete transaction envelope is the logical commit unit. Include length/count and digest validation with an explicit commit marker; buffer the entire envelope before applying it. On restart accept only the contiguous committed prefix, preserve a torn tail for recovery, and stop at internal corruption. Do not skip a damaged transaction and continue exact replay. JSON sequence framing alone supplies no integrity or transactional guarantee. [RFC 7464](https://www.rfc-editor.org/info/rfc7464/)

Use a platform-tested durable append path, single-writer locking, and durable checkpoint replacement; acknowledge persistence only after the chosen flush contract. Keep branch-tip updates in the same journal transaction instead of an independently updated source of truth. Failure-injection must cover partial writes, full disks, interrupted checkpoint replacement, and restart. SQLite's atomic-commit analysis explains why buffering, flush order, and filesystem assumptions matter even for small stores. [SQLite atomic commit](https://www.sqlite.org/atomiccommit.html)

External manual edits should import as validated changes on a new branch; never silently repair ancestry hashes in place. Keep attachments separately with stable IDs/digests and readable descriptions. Optional database indexes are caches; a user must retain authoritative history and content without them.

## Determinism Envelope and Verification

Start with fixed ticks, deterministic single-thread evaluation, explicit numeric semantics, and one declared runtime/platform envelope. Fixed-scale arithmetic is attractive for gold and simple geometry, but requires overflow limits and specified multiplication/division rounding. Do not promise general cross-platform float reproduction. Box2D's author demonstrates that ordering, math functions, compiler settings, and CI all matter. [Box2D determinism analysis](https://box2d.org/posts/2024/08/determinism/)

Retain execution-version identity per history interval. A bug fix that changes outcomes creates a new profile and an explicit migration/reinterpretation branch; it must not redefine an old branch silently. Test fresh replay against checkpoint-assisted replay, all branch prefixes, random streams, and interrupted writes. Add cross-platform hash comparisons only for platforms the product intends to support; Box2D explicitly distinguishes its own determinism from application-level determinism. [Box2D simulation documentation](https://box2d.org/documentation/md_simulation.html)

## Suggested Code Boundaries and Capability Order

Keep conceptual modules `core/model`, `core/commands`, `core/history`, `core/execution`, `host/protocol`, `host/views`, `sdk`, and `plugins/*`; language-specific packaging follows the stack decision. Depend inward: plugins → public protocol → core. Reuse prototype editing/rendering algorithms only after proving they can obey this direction and recorded-command boundary; prior persistence formats are not assumed compatible.

1. **Readable state and plugin seam:** generic graph, provenance, fallback display, ordered transactions, SDK starter, and a real editing plugin.
2. **Durable branching and replay:** format fixtures, prefix identities, fork/cursor behavior, recovery, compatibility diagnostics, snapshots.
3. **Executable interactions:** typed IR, fixed steps, pin/move/proximity/gold examples, cycle/write policies, repeatability checks.
4. **Usable feature plugins:** spatial editing, drawing, timeline navigation, visible rule inputs/outputs; refine public APIs through real use.
5. **Recorded external interpretation:** companion and memory plugins, materialized outcomes, review workflows, effect isolation.

These are dependency capabilities, not a complete roadmap. A thin usable spatial/editing slice should exercise the contract early rather than waiting for every history optimization.

## Scaling, Anti-Patterns, and Remaining Research

| Concern | First approach | Expand only with evidence |
|---------|----------------|---------------------------|
| Large visible worlds | View culling and derived spatial index | Measure rendering versus rule-query cost separately |
| Long simulated histories | Validated snapshots and bounded replay chunks | Index intervals; retain authoritative inputs |
| Many proximity rules | Rebuildable spatial queries, stable result ordering | Deterministic parallel evaluation only after profiling |
| Every hover occurrence | Append completed observations, batching records without losing occurrences | Aggregate derived summaries; record any summary consumed by AI |

Avoid per-frame position journals, arbitrary plugin state writes, AI calls during replay, silent evaluator upgrades, and snapshots treated as substitutes for history. Keep attention observations distinct from inferred sentiment; a hover duration does not establish approval. If attention influences world behavior, its consumed input must be durably identified.

Open decisions needing targeted prototypes: final `.tree` framing/readability; authoritative numeric ranges and tick interval; custom evaluator runtime and artifact retention; sufficient drawing/view extension APIs; partial date semantics; branch-local versus shared companion memory; drag sampling; and acceptable recovery/durability latency. No claim of feasibility for arbitrary natural-language execution or universal cross-platform replay is established by this research.

**Source currency:** Primary sources accessed 2026-09-08 local time. RFCs are stable dated specifications (2015/2017/2020); Fowler is foundational 2005 material; Box2D's author analysis is dated 2024 and cross-checked against current official documentation; CEL overview reports 2026-09-04. Proposed Tapestry contracts remain subject to prototype validation.
