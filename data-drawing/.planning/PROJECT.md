# Data Drawing

## What This Is

Data Drawing is a drawing program where you paint with meaning instead of pixels. Every mark places nodes that carry a free-text description of the brush that made them ("rust", "green rust", "loneliness"), together with physical properties such as mass. The node field is the source of truth; the picture is a render of it, produced reproducibly. The canvas is a living, deterministic simulation whose time can be paused, reversed, sped up, scrubbed, and branched, and any moment of any branch can be reproduced exactly.

It lives inside the Tapestry repository as its own project. The simulation is a pure module here; Tapestry's kernel records the strokes and drives the ticks; the painting surface is a Tapestry plugin. It is built by and for Kaelen.

## Core Value

The same file, seed, and pinned versions reproduce the same node state at every tick of every branch, so every mark is an object that can be revisited and edited later rather than a pixel that is gone.

## Requirements

### Validated

(None yet — ship to validate)

### Active

First milestone: deterministic core plus painting frontend (brief milestones 1 and 2, minus branching, which Tapestry Phase 3 owns).

- [ ] Nodes, not pixels: painting places nodes with the fidelity and feel of a normal drawing program; each node references a brush whose payload is a free-text description.
- [ ] Node data model: stable id, 3D position, radius/falloff, weight from pen pressure, direction and velocity from the stroke, creation tick, scale band, brush reference, physical properties (mass first; viscosity, temperature, age, wetness as the model grows).
- [ ] Brush definitions are versioned: editing a brush creates a new version and old strokes keep referencing the version they were made with.
- [ ] Fixed-timestep simulation with fixed-point integer state, strictly ordered updates, seeded randomness only, no wall clock, no renderer influence.
- [ ] Stroke actions are recorded through Tapestry's kernel as `.tree` commits stamped with the simulation tick; particles are derived from actions and never committed individually.
- [ ] Replay of a recorded stroke log reproduces bit-identical node state, verified by hashing state across replays and across save/reopen.
- [ ] Timeline control: pause, reverse, speed up, and scrub to any tick by replaying from the start of the recorded actions.
- [ ] Mass affects brush feel: the brush is a simulated object on a spring-damper so heavy materials lag and carry momentum through curves.
- [ ] At least one material behaves over time in the simulation (for example weight settling), demonstrating that the canvas is alive.
- [ ] Painting surface as a Tapestry plugin: strokes land on a plane facing the camera in a 3D node space; the plane can be moved or the camera orbited to paint elsewhere.
- [ ] Pressure pen input drives node weight; tilt is captured when available.
- [ ] A deterministic placeholder renderer shows the node field live so the sim is visible before any model render exists.
- [ ] A person can read a saved `.tree` and identify each stroke, its brush description, its tick, and its branch without Data Drawing installed.

### Out of Scope

- Branching and snapshots inside this project — Tapestry Phase 3 (HIST-01..08) owns forking, snapshot loading, and hash-verified branch replay; Data Drawing consumes them when they land rather than building a second implementation. Until then scrubbing works by replay from the start.
- Model-based rendering (brief milestone 5) — deferred until the node field, sim, and replay are proven. Working assumption is a local diffusion model on this Mac's GPU; nothing in this milestone may depend on it.
- Tile tree, infinite zoom, procedural node spawning (brief milestone 6) — requires the render tier. Scale band is recorded on nodes now so the data is ready.
- Groups, instancing, and weighted bindings (brief milestone 3) — separate relationships to be designed after the flat node model works.
- Math brushes, signed distance fields, generator brushes (brief milestone 7) — later.
- Atmospheric brushes and the locality parameter — the brief's open question; material brushes first.
- Reusing `semantic-world/` or `chrono_magnetic_particles/` code — the former is a stub skeleton and the latter cannot run on macOS. Their invariants are adopted; their code is not.
- Reusing the old `tapestry/core` SDL/NanoVG stroke model — reference only, superseded by the Electron app and kernel.

## Context

### Origin

The concept brief lives at `data-drawing-brief.md` in this folder. It separates confirmed decisions (ten, treated as requirements), proposed architecture (a strong starting point), and open questions (ask before answering). It also instructs: read the existing codebase first and map it against the brief; where they conflict, the code reflects more recent decisions, so flag the conflict rather than silently fixing it.

### Codebase mapping (2026-09-22)

Three prior attempts already point at this brief:

- `semantic-world/` is the closest ancestor: semantic particles and brush strokes, explicit versioned physical laws, every change an event, seed plus event log reproduces the world, rendering never authoritative, floating point banned from authoritative state. It is a Phase 0 skeleton of about 460 lines with three-line stub sources and a single commit. Its invariants are adopted. Its plan at `semantic_world_executable_plan.md` remains useful reading.
- `chrono_magnetic_particles/` has the particle aesthetic and requires OpenGL 4.3 compute shaders, which macOS does not have. Reference only.
- `tapestry/kernel/` is the only working deterministic core. Tapestry Phase 1 is complete: an append-only `.tree` journal of SHA-256 chained commits, each stamped with a branch name, a recorded time, and a simulation tick (the three kinds of time). It has replay to any commit, a history index, crash recovery and repair, stable ids, and readable fallback for unknown plugin data. The format guide is `tapestry/docs/tree/FORMAT.md`.

What the kernel provides versus what the brief needs:

| Brief needs | Tapestry today |
|---|---|
| Action log as the only source of change | Yes. Commits are the only mutation path; plugins submit commands. |
| Tick-stamped actions | Yes, but no fixed-timestep simulation advances the tick yet. |
| Replay to any moment | Yes, to any commit sequence. |
| Fork at a tick, original future survives | No. Tapestry Phase 3, zero plans written. |
| Snapshots every N ticks | No. Phase 3. |
| Hash-verified replay | No. Phase 3 success criteria 3 and 4. |
| Recorded model outcomes replay without a live model | Designed in as HIST-05, not built. |
| Nodes with position, velocity, mass | Kernel nodes are generic property bags; the Electron app has notes, not particles. Drawing strokes are Phase 4, not started. |

Tapestry Phase 2.3 (Time Threads, in progress) writes time along a z-axis with scrubbing and a 3D stage view; that is the "branching timelines in progress" the brief refers to, together with Phase 3.

### Conflicts flagged

- **Numeric policy.** The brief and semantic-world require fixed-point or strictly controlled math from the first line. Tapestry Phase 3 promises replay "within a declared engine/numeric compatibility envelope," a float-with-tolerance stance. Decision for this project: the sim core is fixed-point integer, bit-identical. Tapestry's envelope wording should be tightened when Phase 3 is planned, or the two must be reconciled explicitly.
- **Storage growth.** Tapestry's core value is a `.tree` a person can read. The brief's file is small only because it stores strokes, not particles. These are compatible as long as actions are what get committed and particle fields are derived. Committing per-node state would explode the readable journal.

### Technical environment

- Tapestry repo, branch `data-drawing`; this folder is tracked by the outer repo, with its own `.planning/`.
- Kernel: C++20, CMake 3.24 or later, doctest, rendering-independent target `tapestry/kernel`.
- App: Electron with a TypeScript renderer; plugins register through `sdk/` and live under `plugins/`. Phase 2.3 introduces a 3D stage for threads, which the painting plane can build on.
- Machine: this Mac with Apple silicon. OpenGL is frozen at 4.1; GPU work goes through Metal, WebGPU, or WebGL.
- Input: a pressure pen or tablet is available and is the primary painting device.

### Open questions carried from the brief

Unresolved and to be asked before committing to an answer during phase discussion:

- How are material behaviors defined: hardcoded, data-driven rules, or authored per brush?
- How do actions reference nodes stably across branches (ids derived from action plus index?)
- Can branches be merged or cherry-picked, or only compared and switched? (Phase 3 question.)
- Snapshot density and storage budget. (Phase 3 question.)
- Store baked render tiles in the file, or always regenerate? (Render milestone; Tapestry's HIST-05 stance is to record outcomes.)
- Is the locality parameter enough, or do material and atmospheric brushes need different pipelines?
- Which local render model, and what preview latency is acceptable?

## Constraints

- **Determinism**: fixed-point integer authoritative state, fixed timestep, strictly ordered updates, seeded randomness only, no wall clock, no parallelism that can reorder results — one bit of drift at tick 10 is a different painting at tick 10,000, and this cannot be retrofitted.
- **Engine independence**: the sim is a pure module with no rendering, Electron, or kernel dependency; the frontend only views sim state and changes it only through recorded actions.
- **Readability**: strokes, brush descriptions, ticks, and branch ancestry must be readable in the `.tree` file without the application; per-node state is derived, never committed.
- **Tapestry contract**: the painting surface uses the same public plugin API as any third-party plugin; no core fork, no private hooks.
- **Platform**: must run on this Mac; no OpenGL 4.3, no compute shaders through OpenGL.
- **Dependency**: forking and snapshots come from Tapestry Phase 3, which is not yet planned; this project's scrubbing must work without them.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Sim core lives in this folder; Tapestry's kernel records history | The kernel already has the action log, tick stamps, replay, and readable format; building a second journal would duplicate Phase 1 | — Pending |
| Painting surface is a Tapestry plugin, not a separate app | Exercises the public plugin API on a demanding editor, as Tapestry's constraints require | — Pending |
| Fixed-point integer numerics in the sim core | Bit-identical replay across machines; semantic-world and the brief both require it; cannot be retrofitted | — Pending |
| Full 3D node space | Chosen over 2D and 2D-plus-layers; positions are x, y, z and the camera can orbit | — Pending |
| Strokes land on a plane facing the camera | Keeps drawing-program fidelity while the world is 3D; volume painting and painting onto nodes deferred | — Pending |
| Branching deferred to Tapestry Phase 3 | Avoids building forking twice; scrubbing by replay from the start suffices for the first milestone | — Pending |
| Local GPU render as working assumption, renderer stubbed for now | Render is milestone 5; a deterministic placeholder rasterizer keeps the sim visible without committing to a model | — Pending |
| First milestone is core plus painting frontend | Something you can draw in proves the node model and brush feel before render and materials expand scope | — Pending |
| Adopt semantic-world's invariants, discard its code | The skeleton has no implementation; the invariants are exactly right | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-22 after initialization*
