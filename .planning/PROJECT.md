# Tapestry

## What This Is

Tapestry is a spatial second brain where people create, connect, and arrange readable nodes containing notes, drawings, structured data, people, events, concepts, and executable natural-language rules. A conversational companion helps build and maintain this world, while a simple deterministic engine lets nodes influence one another through their content, relationships, properties, and position. Human-readable `.tree` files preserve the world's branching history so its meaning remains accessible without Tapestry itself.

## Core Value

Your world of thoughts must remain readable and under your control—in its spatial interface, its editable relationships and behavior, and its files and branching history.

## Requirements

### Validated

(None yet — this is a fresh project definition; prior prototypes are reference material, not validated delivery of this vision.)

### Active

- [ ] Create, read, edit, connect, and arrange nodes in a usable spatial interface.
- [ ] Combine notes with drawings and structured properties without requiring a separate conceptual system for each input type.
- [ ] Edit properties such as anger, gold, event time, position, and velocity, with visible consequences for connected nodes.
- [ ] Support user-controlled placement and nodes that can be pinned or respond to dynamic forces.
- [ ] Make natural-language rule nodes influence other nodes through executable inputs and outputs, including spatial forces.
- [ ] Maintain a coherent event timeline with editable event dates and contents.
- [ ] Record a readable `.tree` history sufficient for deterministic replay, with optional snapshots for faster loading.
- [ ] Fork history when editing the past, retaining the original future as an accessible branch.
- [ ] Converse naturally with a companion that turns user input into connected people, events, concepts, notes, and rules.
- [ ] Ask about conflicts, discrepancies, and missing details according to user-editable guessing policies represented as nodes.
- [ ] Preserve explicit versus generated origin, display it in the UI, and support acceptance or rejection without erasing origin.
- [ ] Establish readable, editable companion memory for language patterns, corrections, preferences, and inferred beliefs.
- [ ] Record attention observations such as hover occurrences and duration as metadata, separately from inferred sentiment or preference.

### Out of Scope

These are sequencing boundaries for the first core milestone, not exclusions from the product vision. The detailed requirements will distinguish initial foundations from later expansion.

- Broad integrations with Instagram, Reddit, TikTok, LinkedIn, and other apps — follow a working local world, readable history, and input/provenance model.
- Delegating multiple AI agents to different development branches — preserve the branching foundation now; build the orchestration experience later.
- A mature behavioral mimic that reliably speaks as the user — establish inspectable memory and correction first; imitation quality must be demonstrated rather than assumed.
- Comprehensive handling and execution of every external file/media type — begin with an extensible node/data model and add adapters incrementally.
- Treating earlier prototype milestones or their implementation choices as a completed GSD foundation — this project starts with a new definition and roadmap.

## Context

### The intended experience

The base experience should be as approachable as creating individual notes in Apple Notes, with interconnected knowledge reminiscent of Obsidian, but arranged spatially and extending beyond Markdown. The user is building their own world: thoughts, opinions, people, relationships, memories, imagined settings, and working material should fit into a common node system.

Readability is the priority, not an export feature. A person without the engine should be able to inspect the saved files and understand what was supplied, what was generated, what changed, and how things connect. The precise `.tree` syntax remains to be designed; the old prototype's `.tapestry` format is not the new format contract.

### Conversation and organic organization

The companion must be a conversational partner, not just a capture box. The user calls it the "God program": it takes user inputs, develops a natural language rapport, maintains the world's rules, and helps introduce and change events. The underlying forces and rules should continue functioning without a live companion.

Example input: "Met Sam at dinner; loves architecture and weird bird memes." This may create or enrich a Sam person node, a dinner event, architecture and meme concepts, and their relationships. Placement should reflect time, existing events, participants, and content. Exact entity-resolution, layout, and inference behavior remains to be specified.

If a new fantasy-setting rule conflicts with existing rules, the companion surfaces the discrepancy. If a character needs to speak at a particular moment and the companion cannot determine a suitable response, it asks the user when the guessing policy requires it. Policy can also allow generated suggestions or automatic filling of blanks; provenance remains recorded in every case.

### Nodes as executable instructions

Nodes can be both content and natural-language functions. They accept inputs from other nodes and produce outputs affecting properties or behavior.

Canonical example: a rule says "make more angry if closer to chips" and connects to a character. The rule connects proximity to the character's anger property. If "chips" has no known definition, create an unresolved definition node rather than silently inventing one; the user's guessing policy determines whether to ask or propose a definition. Encounters with chips feed the rule and affect anger. The UI must let the user see and edit relevant properties and connections.

The capability must generalize beyond that one example: content and position can influence variables such as gold, velocity, and forces. Natural-language interpretation must produce explicit executable behavior with inspectable inputs/outputs. Ambiguous or unsupported instructions need a visible resolution path; the engine cannot pretend arbitrary prose has a uniquely defined executable meaning.

### Space, dates, and control

All nodes should be movable by the user. Some can remain fixed; others can respond to forces. Pinning versus dynamic motion is the proposed initial interaction model, subject to UI design.

An event's date and a node's spatial position are separate data. Moving a node does not implicitly rewrite its event date or participants. Spatial changes can still be meaningful inputs to rules such as proximity-driven anger. Editing contents or dates may change relationships and automatic placement.

Any note's contents and event time remain editable. The exact relationship between automatic layout, physical forces, and user placement requires explicit rules so the world remains understandable.

### Timeline, replay, and branches

Branching is central to the name and meaning of `.tree`. Returning to an earlier point and changing it must preserve the original future as another branch, not overwrite it.

The user wants a deterministic structure that stores inputs rather than every node's position at every moment, with snapshots as an acceleration mechanism. The proposed replay contract records human inputs plus materialized AI decisions, external observations, and any required randomness; replay should not ask a model to regenerate prior decisions. Generated decisions remain visibly distinct from human inputs.

Distinguish domain event time (when dinner happened), simulation time (when a rule updates anger), and history order (when the user recorded or corrected something). Editing an event date must not erase the record of that correction. Branches share an unchanged prefix and preserve divergent futures. Exact branching, snapshot, serialization, and engine-version compatibility policies need technical research and phase-level design.

### Provenance, attention, and the evolving mimic

The UI should distinguish text explicitly supplied by the user from program inference. Color is one candidate; the user also suggested a gradual color change on hover. Each relevant node or passage should permit acceptance or rejection. Acceptance changes review status, never historical authorship. Mixed-origin content needs finer detail than a single whole-node generated flag.

The user wants every hover occurrence and its duration recorded as node metadata to help guide future interpretations. An observation such as repeated attention must remain distinguishable from an inferred positive or negative attitude. Lingering alone does not establish approval; explicit corrections and review actions provide stronger evidence. Recording semantics and storage volume need design, especially how observational metadata relates to replay inputs.

The companion should retain the user's language, interaction patterns, cadence, corrections, and preferences in readable, editable memory. Over time this can support a mimic that fills blanks as the user might. Original utterances, program interpretations, and user-approved conclusions must remain distinguishable, with evidence references. Branch-local versus shared profile memory is an open decision.

### Longer-term applications

- Ingest semantic material from other applications and organize it into graphs.
- Build person nodes for people the user meets, connect their interests and shared material, and capture the user's editable opinions and relationships.
- Organize conversations, documents, code, and AI work spatially; delegate AIs to different branches while retaining memory and development history.
- Treat saved memory files as a readable base for future work across sessions and tools.

### Existing workspace

The repository includes `tapestry/`, `semantic-scroll/`, `semantic-world/`, and `chrono_magnetic_particles/`, plus older plans. The `tapestry/` README describes a native C++20/SDL2/OpenGL/NanoVG spatial editor with notes, drawing, and incremental `.tapestry` persistence. These descriptions are useful leads, not verified compatibility with the new requirements.

Start fresh in planning and product definition while retaining existing work for reference and selective reuse. A full rewrite, deletion of prototypes, retention of the old stack, or compatibility with old files has not been mandated. Those choices require evidence against the new core requirements.

## Constraints

- **Readability:** Core content, relationships, changes, and provenance must be inspectable without the application. Binary attachments may be referenced; their bytes cannot substitute for readable descriptions.
- **Control:** Users can edit content, properties, dates, connections, placement, and guessing policies. Historical origin remains available after correction.
- **History:** Editing the past preserves the original future in a branch. Replay must use recorded outcomes, not new model guesses.
- **Simple core:** Storage, graph state, and rule execution must be conceptually small and separable from live AI and integration adapters.
- **Usable UI:** The initial milestone includes actual editing, spatial interaction, rule effects, and timeline navigation, not only backend demonstrations.
- **Development scope:** Work remains in the current Conductor workspace. Do not rename its branch or write planning artifacts into the primary checkout.
- **Unspecified:** No delivery date, budget, monetization model, AI provider, final UI toolkit, or universal cross-platform replay guarantee has been chosen.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fresh project definition, existing prototypes retained as reference | Preserve the vision without inheriting an old plan as the new contract | — Pending implementation |
| Readable `.tree` files are a first-class interface | The user's knowledge must be understandable without the engine | — Pending format design |
| Branching history is core, with original futures preserved | Explicit user requirement; foundational meaning of `.tree` | — Pending implementation |
| Nodes represent content, properties, rules, and policies | A common model supports both note-taking and living worlds | — Pending implementation |
| Nodes influence each other through content, position, and connected values | An interactive world is essential to the core milestone | — Pending implementation |
| Companion is conversational and resolves discrepancies | Natural rapport and coherent world-building are central | — Pending implementation |
| Generated origin survives user acceptance | Approval must not misrepresent the source of a claim | — Pending implementation |
| User controls guessing policy through nodes | Different worlds and situations require different inference behavior | — Pending policy semantics |
| Every node is user-movable; forces can move dynamic nodes | User agency and automatic organization must coexist | — Pending pinning/layout design |
| Persist language and interaction evidence for companion memory | The user wants an evolving, inspectable mimic | — Pending memory scope |
| Record inputs and materialized decisions, derive intermediate state | Proposed deterministic replay strategy avoids frame-by-frame state storage | — Pending research and format contract |

## Open Design Questions

- Which prototype components should be reused, and which stack best supports readable editing, drawing, accessible UI, and deterministic behavior?
- What is the smallest extensible rule language that can express the requested natural-language functions and forces?
- How are units, rule ordering, cycles, conflicting writes, undefined values, and unknown concepts handled?
- How do branch creation, event-date edits, simulation time, and reusable snapshots interact?
- What replay guarantees apply across engine versions and hardware?
- How are mixed-origin text spans and their edits represented and displayed?
- How do automatic layout, pinning, and physical behavior share control of position?
- Which attention and mimic capabilities belong in the first milestone versus its follow-up?
- Does user-profile learning span branches, or stay local to a world's history?
- What drawing and attachment interactions are essential initially?

## Evolution

This document evolves at phase transitions and milestone boundaries.

After each phase transition, move validated requirements to Validated, record invalidated requirements with reasons, add newly discovered requirements, update decisions, and check that What This Is remains accurate.

After each milestone, review all sections, check the core value, revisit deferred scope, and update context with demonstrated behavior and user feedback.

---
*Last updated: 2026-09-08 after project-definition conversation*
