# Data Drawing — Concept Brief

Context handoff from an exploratory design conversation. Bingus is already building toward this (branching timelines are in progress). **Read the existing codebase first and map it against this brief before proposing changes.** Where this brief conflicts with working code, the code reflects more recent decisions; flag the conflict rather than silently "fixing" it.

This document separates three kinds of content:

- **Decisions**: stated and confirmed by Bingus. Treat as requirements.
- **Proposals**: architecture suggested during the conversation. Treat as a strong starting point, not settled.
- **Open questions**: unresolved. Ask before committing to an answer.

---

## Vision

A drawing program where you paint with meaning instead of pixels. Every mark places particles/nodes that carry a description of the brush that made them ("rust", "green rust", "loneliness", anything). The node field is the source of truth; the image is a render of it, produced by a visual generation model, reproducibly.

The canvas is a living, deterministic simulation: materials behave (rust spreads, weight settles), time can be paused, reversed, sped up, and branched, and any moment of any branch can be reproduced exactly. You can zoom infinitely and make tiny local edits without disturbing larger structure.

---

## Decisions (confirmed)

1. **Nodes, not pixels.** Painting places particles/nodes with the same fidelity and feel as a normal drawing program. Each node references a brush whose payload is a free-text description.
2. **Rendered by a visual model, reproducibly.** A quick brush action becomes an object that will always render the same way, so it can be edited later.
3. **Infinite zoom with localized edits.** Small edits in small areas must not affect larger structure.
4. **Deterministic, procedural storage.** Saved state works like procedural world generation (seed + inputs → identical output), not like stored pixels.
5. **Math as authoring material.** Areas and properties can be defined mathematically, not only by hand-placed nodes.
6. **Physical properties.** Nodes carry properties like mass. Mass makes both the drawn thing *and the drawing process* heavier (brush feel).
7. **Living simulation.** Materials actually behave over time: rust spreads, weight settles.
8. **Manipulable timeline.** Pause, reverse, speed up. Scrubbing cycles through the history of actions, giving a reproducible history of all interactions.
9. **Branching timelines.** Editing at a past moment forks a new branch; the original timeline survives. (Chosen over rewrite-history.)
10. **Hierarchical nodes.** Nodes can hold nodes (folders/groups), and nodes can hold other nodes *with weights*, giving armature-like control over complex node materials.

---

## Proposed architecture

### The layer stack

```
action log (per branch)
      │  replayed through
      ▼
deterministic simulation  ──► node state at tick t
                                    │  conditions
                                    ▼
                          tile tree (quadtree, infinite depth)
                                    │  renders
                                    ▼
                                  image
```

The saved file is small: root seed, brush/material definitions, the branch tree of action logs, and a model/version pin. Images and snapshots are caches that can be regenerated.

### Data model (sketch)

- **Node**: stable ID, position, radius/falloff, weight (from pen pressure), direction and velocity (from stroke), creation tick, scale band (zoom level it was authored at), brush reference, physical properties (mass, viscosity, temperature, age, wetness…), optional per-node overrides.
- **Brush**: text description compiled once into a locked artifact (embedding + optional reference swatch; optionally a small trained adapter for hero brushes). Locality parameter (see below). Physical defaults. Versioned, so edits to a brush don't silently change old renders.
- **Group**: containment + inheritance. Children inherit group properties unless overridden. Groups can be *definitions with instances* (build a rivet once, place 400; editing the definition updates all).
- **Binding**: weighted influence between nodes, like skinning weights. Moving control nodes deforms bound nodes by weight. Bindings can also be physical (weighted springs → soft bodies that sag under mass). Bindings can degrade (e.g. rust weakening structure).
- **Action**: a user input stamped with the sim tick it occurred on. The only thing that changes history.
- **Branch**: parent branch + fork tick + its own action log. Everything before the fork tick is shared with the parent (including snapshots).

Note: groups (containment/inheritance) and bindings (weighted influence) are deliberately separate relationships.

### Brushes: material vs. atmospheric

"Rust" is a material: it says what the surface *is* locally. "Loneliness" is an atmosphere: it biases lighting, palette, composition, emptiness over a wider area. Proposed: a single continuous **locality** parameter per brush (tight local conditioning ↔ diffuse field), rather than two hard brush types. Node density = strength. Overlapping brushes blend in embedding space rather than meeting at hard edges.

### Math brushes

Regions can be signed distance fields; brushes can be **generators** (e.g. "fill this region with lichen, Voronoi-distributed, density falling off with distance from the edge"). Analytic fields are resolution-independent and evaluate at any zoom depth, so they fit the infinite tile tree naturally. Hand-placed particles (gesture, intent) and fields (precision, infinite detail) coexist.

### Mass does two jobs

1. **Feel (authoring time):** the brush is a simulated object on a spring-damper. Heavy materials have inertia, lag, and momentum through curves. Lead feels different from smoke.
2. **Meaning (sim + render):** mass and other properties are read by the simulation (settling, sagging) and by the renderer (density, weight).

### Simulation

- **Deterministic above all.** One bit of drift at tick 10 is a different painting at tick 10,000. Proposed rules: fixed timestep; fixed-point math in the sim core (or rigorously controlled floats); strictly ordered updates, no parallelism that can reorder results; seeded randomness only.
- **Engine-independent core.** Keep the sim as a pure crate/module with no rendering or engine dependency. The frontend only *views* sim state; it never influences it except through actions.
- **Multi-scale rule:** the coarse simulation is authoritative and runs everywhere. Fine detail is *derived* from coarse state + seed and regenerates identically whenever viewed, so *looking never changes the outcome*. Regions touched at fine scale get real state and report aggregated results upward.
- **Group LOD:** a distant/zoomed-out group simulates as one lumped body; up close it expands into its children.

### Timeline

- Pause = stop ticking. Speed up = more ticks per frame.
- Reverse/scrub: snapshots every N ticks; to reach tick t, load the nearest earlier snapshot and replay forward. Snapshot density trades memory for scrub speed.
- Branching: forking at tick t on branch B creates a new branch sharing B's history and snapshots up to t.

### Tile tree (render structure)

- Infinite quadtree. Each tile's image is a pure function of: nodes touching it, its parent's render, a seed derived from (tile coordinates, depth), brush versions, model version, and sim tick (only if something inside changed).
- Hash those inputs into a cache key (Merkle-style, like git). Unchanged inputs → byte-identical tile reused forever.
- **Direction of influence:** structure flows *down* (children generated conditioned on parents). Fine edits flow *up* only by compositing a downsampled result into ancestors, never by regenerating them. Big structure never rerolls because of small edits.
- **Scale bands:** strokes belong to the zoom level they were made at. "Rust" at the top level = rusty region; "rust" at depth 10 = pits and flakes. Same brush, different meaning per scale.
- **Procedural node spawning:** at deep zoom, detail nodes are spawned from parent regions with seeded noise (Minecraft-ore style). Only nodes the user touched are stored.

### Render pipeline

- Two tiers: fast few-step model for live preview while painting; slower high-quality render on demand.
- Starting point: rasterize node field into soft per-brush masks and use regional prompting (constrain each brush prompt's attention to its mask). Works today; strains with many overlapping brushes.
- Ambitious path: per-pixel embedding field injected directly into cross-attention, handling blends and gradients natively. Requires deeper model work.
- Tile seams: render with overlap and blend (MultiDiffusion-style).
- Relevant precedents to research: GauGAN/SPADE (label-map conditioning), NVIDIA eDiff-I "paint with words", SpaText (free-text per region), regional prompting / MultiDiffusion, IP-Adapter (image-reference conditioning for locked brushes), infinite-zoom diffusion demos.

---

## Invariants (should never break)

1. Same file + same pinned model/hardware → identical output at every tick, every branch, every zoom.
2. Viewing, zooming, or scrubbing never changes simulation results.
3. An edit invalidates only tiles whose inputs changed (plus their descendants); everything else stays byte-identical.
4. Fine-scale edits never regenerate coarse-scale structure (composite up, don't re-imagine).
5. Actions are the only source of change to history. Branching never mutates an existing branch.
6. Brush edits create new versions; old renders stay reproducible.

---

## Known risks

- Cross-hardware nondeterminism in diffusion models: "reproducible" may in practice mean pinned hardware/model, or treating baked tiles as stored artifacts rather than always regenerating.
- Floating-point drift in the sim if fixed-point or strict ordering isn't enforced from day one. Hard to retrofit.
- Style drift across zoom levels and seams between tiles.
- Rendering cost as sim state changes over time; mitigated by hashing unchanged regions.
- Physical simulation of armature bindings and multi-scale materials can get expensive quickly.

---

## Open questions

- Local GPU or remote inference? Which render model(s)? What latency is acceptable for live preview?
- Fixed-point vs. carefully controlled floats in the sim core?
- 2D canvas only, or does the node space have depth?
- How are material behaviors defined: hardcoded, data-driven rules, or authored per brush? Do atmospheric brushes ("loneliness") participate in the simulation, and how?
- How do actions reference nodes stably across branches (IDs derived from action + index?)
- Can branches be merged or cherry-picked, or only compared and switched?
- Snapshot density and storage budget.
- Store baked tiles in the file, or always regenerate?
- Is the locality parameter enough, or do material and atmospheric brushes need genuinely different pipelines?

---

## Suggested milestone order (proposal)

1. **Deterministic core:** node model, action log, fixed-timestep sim, snapshots, scrubbing, branching. Headless, verified by hashing state across replays. (Partly in progress.)
2. **Painting frontend:** placing nodes with drawing-program fidelity, brush descriptions, mass-driven brush feel.
3. **Groups and bindings:** containment/inheritance, instancing, weighted armature bindings.
4. **Material behaviors:** rust spreading, settling, soft-body bindings.
5. **Render v1:** single-tile regional-prompt render of the node field with locked brushes and pinned seeds.
6. **Tile tree:** hashing, parent-conditioned children, compositing upward, infinite zoom, procedural node spawning.
7. **Math brushes:** SDF regions and generator brushes.
