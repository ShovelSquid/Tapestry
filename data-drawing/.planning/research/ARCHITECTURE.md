# Architecture Research

**Domain:** Deterministic fixed-point particle simulation recorded through an append-only journal, viewed and painted through an Electron/TypeScript plugin
**Researched:** 2026-09-22
**Confidence:** MEDIUM overall — every claim about the existing Tapestry code was read directly from source (HIGH); the domain patterns (lockstep, rollback, fixed timestep, Factorio-style hashing, Wasm determinism) come from web sources that the confidence seam classifies LOW even though four independent primary sources agree on them. Nothing below rests on a single unverified web claim.

## Standard Architecture

### System Overview

The shape every deterministic-replay system converges on (RTS lockstep, GGPO rollback, Factorio replays, seeded world generation) is three strictly separated layers: an **action log** that is the only source of change, a **deterministic simulation** that is a pure function of (seed, rules version, action log, tick), and **derived view state** that reads the sim and never writes it. Data Drawing already has the first layer built (the Tapestry kernel and `.tree` journal) and must build the other two.

```
┌────────────────────────────────────────────────────────────────────────┐
│  RENDERER PROCESS (Electron)  —  nondeterministic side of the fence    │
│                                                                        │
│  ┌──────────────┐   pen samples    ┌──────────────────┐                │
│  │ Input capture│ ───────────────► │ Action builder   │  quantize +    │
│  │ pointer evts │  (float, wall    │ (TS, plugin)     │  tick-stamp    │
│  │ pressure/tilt│   clock)         └────────┬─────────┘  ONCE          │
│  └──────────────┘                           │ recorded action           │
│                                             ▼                          │
│  ┌──────────────┐  positions SoA   ┌──────────────────┐                │
│  │ WebGL2 stage │ ◄─────────────── │ Live sim         │  same bytes    │
│  │ camera/plane │  (read-only,     │ (C++20 → Wasm)   │  go to the     │
│  │ placeholder  │   double-buffer) │ fixed-point,     │  journal       │
│  │ render       │                  │ fixed step       │                │
│  └──────────────┘                  └────────┬─────────┘                │
│  ┌──────────────┐                           │                          │
│  │ Timeline UI  │ ── pause/speed/scrub ──►  │ (drives ticks; replays)  │
│  └──────────────┘                           │                          │
├─────────────────────────────────────────────┼──────────────────────────┤
│  IPC (preload contextBridge, async)         │ submit(ops) / getNodes   │
├─────────────────────────────────────────────┼──────────────────────────┤
│  MAIN PROCESS                               ▼                          │
│  ┌──────────────┐   Proposal      ┌──────────────────┐                 │
│  │ Plugin main  │ ──────────────► │ Kernel (N-API)   │ ─► .tree file   │
│  │ (index.js)   │  advance k;     │ single writer    │    SHA-256      │
│  │ stroke codec │  create-node    │ tick, ids, seq   │    chain        │
│  └──────────────┘  stroke@1 …     └──────────────────┘                 │
├────────────────────────────────────────────────────────────────────────┤
│  HEADLESS (native C++20, CMake/CTest)                                  │
│  ┌──────────────┐   reads .tree   ┌──────────────────┐                 │
│  │ ddreplay CLI │ ◄────────────── │ Same sim, native │  hash oracle    │
│  │ verify hashes│  via kernel lib │ build            │  for the Wasm   │
│  └──────────────┘                 └──────────────────┘  build          │
└────────────────────────────────────────────────────────────────────────┘
```

The line between the renderer's input capture and the action builder is the **deterministic fence**: everything left of it may use floats, wall clocks and pointer-event timing; everything right of it sees only integers already written into the action. This is the same split SnapNet describes for lockstep engines and it is what lets input sampling be sloppy while replay stays exact.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Sim core** (`data-drawing/sim`) | Owns authoritative node state, brush table, brush body (spring-damper), RNG, scheduled samples, tick. `step()` once per tick. `hash()`, `serialize()`, `restore()`. No I/O, no clock, no renderer, no kernel dependency. | Pure C++20 static library. Fixed-point `int64` (Q32.32 or Q40.24), struct-of-arrays, iteration strictly by id. Built twice: native (tests, oracle) and Wasm (live view). |
| **Action schema** (inside sim) | Typed actions the sim accepts: `DefineBrush`, `Stroke{brush, planeFrame, samples[]}`, later `SetParam`. Each carries the tick it applies on. | Plain structs; the sim never sees kernel ids as strings, only integer ordinals. |
| **Stroke codec** (`plugin/shared/grammar.ts` + C++ mirror) | Converts between sim actions and `.tree` ops: one `datadrawing/stroke@1` node per stroke with a readable `samples` text block; one `datadrawing/brush@1` node per brush version. Two implementations (TS for the plugin, C++ for `ddreplay`) tested against one golden fixture. | Pure functions, no Electron/DOM imports, mirrors Phase 2.3's `thread.log` pattern. |
| **Plugin main side** (`plugins/data-drawing/index.js`) | Registers node types, commands, panels; commits `advance` + stroke proposals through `KernelAPI.submit`; on open, reads stroke/brush nodes and reconstructs the ordered action list for the sim. | Node module `require()`d by the host, like every existing plugin. |
| **Sim host** (`plugin/surface/sim-host.ts`) | Loads the Wasm sim, owns the fixed-timestep accumulator, feeds tick-stamped actions, exposes read-only typed-array views of positions/weights, runs replay for scrubbing. | Renderer-side TS; Wasm on the renderer main thread first, Web Worker later if step cost demands. |
| **Painting surface** (`plugin/surface/`) | WebGL2 stage: orbit camera, camera-facing plane, pointer capture (pressure, tilt, coalesced events), placeholder instanced renderer, timeline controls. Reads sim state; writes only actions. | Raw WebGL2 (the 2.3 stage plan uses the same: instanced quads, one draw call), no three.js needed at this scale. |
| **`ddreplay` CLI** (`sim/tools`) | Opens a `.tree` through the kernel library, decodes stroke/brush nodes, replays the native sim, prints hash at every checkpoint, bisects to the first divergent tick against a recorded trace. | Native C++ executable; CI gate; the oracle the Wasm build must match bit-for-bit. |
| **Tapestry kernel** (exists) | Ordering, tick monotonicity, ids, durability, readability, SHA-256 chain, `replayUpTo`. | Unchanged. Data Drawing adds no verb and no value type. |

## Recommended Project Structure

```
data-drawing/
├── sim/                          # pure C++20 module, zero dependencies beyond the standard library
│   ├── CMakeLists.txt            # target datadrawing_sim (static); options DD_BUILD_WASM, DD_BUILD_TOOLS
│   ├── include/dd/
│   │   ├── Fixed.hpp             # Q-format int64 with saturating ops, sqrt, sin/cos tables — the ONLY numeric type in state
│   │   ├── Ids.hpp               # StrokeId (u64: branch tag | kernel ordinal), NodeId = {stroke, index}
│   │   ├── Rng.hpp               # seeded PCG/xoshiro; state is part of the hash
│   │   ├── Brush.hpp             # BrushVersion {description, mass, radius, spacing, damping…}; immutable once defined
│   │   ├── Action.hpp            # DefineBrush / Stroke{samples[]} / SetParam, each with .tick
│   │   ├── State.hpp             # struct-of-arrays node fields, brush body, scheduled samples, tick, seed — POD, no pointers
│   │   ├── Sim.hpp               # apply(actions for tick t); step(); hash(); serialize(); restore()
│   │   ├── Hash.hpp              # canonical byte walk + 64-bit hash; per-tick trace mode
│   │   └── rules/                # versioned rule steps: BrushBody, Emit, Settle… each with a version constant
│   ├── src/
│   ├── tests/                    # doctest: determinism, replay equality, snapshot round-trip, golden hashes, native≡wasm
│   ├── tools/ddreplay/           # headless replay + verify + bisect CLI (links tapestry/kernel for .tree reading)
│   └── wasm/                     # Emscripten build + flat C ABI (dd_create, dd_apply, dd_step, dd_positions_ptr, dd_hash…)
│
plugins/data-drawing/             # the Tapestry plugin, host convention (discovered under plugins/)
├── tapestry.plugin.json          # manifest: nodeTypes datadrawing/stroke@1, datadrawing/brush@1, datadrawing/canvas@1, datadrawing/checkpoint@1
├── index.js                      # main-process side: registrations, commit pipeline, open-time action reconstruction
├── shared/
│   ├── grammar.ts                # stroke sample block codec (format/parse), pure TS; golden fixture shared with C++ codec
│   └── ids.ts                    # kernel id ↔ sim ordinal mapping (n12 → 12; b2.n12 → (2,12) when Phase 3 lands)
└── surface/                      # renderer bundle (requires a host surface extension point — see Integration Points)
    ├── sim-host.ts               # Wasm loader, accumulator loop, action feed, replay/scrub, typed-array views
    ├── input.ts                  # pointer capture, coalesced events, pressure/tilt, ray→plane unproject, quantize, tick-stamp
    ├── stage/                    # WebGL2: camera, plane gizmo, instanced placeholder renderer, double-buffered upload
    └── timeline.tsx              # pause / speed / reverse / scrub controls
```

### Structure Rationale

- **`sim/` has no idea Tapestry exists.** It takes integer actions and produces integer state. That is what makes it buildable as both a native library and a Wasm module from one source, testable headless, and safe from renderer influence by construction rather than discipline.
- **Two codecs, one fixture.** The TS codec runs in the plugin; the C++ codec runs in `ddreplay`. Both must decode the same golden `.tree` fixture to the same action list, or the oracle cannot verify what the app wrote.
- **`surface/` is the only place floats live.** Camera math, ray-plane intersection and pointer timing happen here and are quantized once into an action. Nothing in `surface/` is ever an input to the sim except through a recorded action.
- **`tools/ddreplay` exists before the UI.** It is how "a person can replay this file and get the same hash" is proven without Electron, and how Phase 3's hash-verified replay will consume Data Drawing worlds.

## Architectural Patterns

### Pattern 1: Tick-stamped actions behind a deterministic fence

**What:** Every action carries the sim tick it applies on. The tick is assigned once, at record time, from the plugin's fixed-timestep clock; the assignment itself uses wall-clock timing and is therefore nondeterministic, but its *result* is written into the action, so replay is exact. The sim applies all actions stamped `t` at the start of tick `t`, in commit order, then steps. This is Gaffer's lockstep rule ("the simulation can only simulate frame n when it has the input for frame n") applied to a single local writer.

**When to use:** Always. It is the only way display-rate or tablet-rate input (60–240 Hz, jittered) maps onto a fixed tick rate without the sim ever seeing a wall clock.

**Trade-offs:** Several samples may land on one tick and some ticks get none — that is fine, the sim consumes the list per tick. Do not resample or downsample at record time; the samples are the source of truth for the stroke and drawing-program fidelity depends on keeping them.

**Example:**
```typescript
// surface/input.ts — the fence. Left of here: floats and wall clock. Right: integers only.
function onPointerSample(ev: PointerEvent, stroke: OpenStroke) {
  for (const s of ev.getCoalescedEvents?.() ?? [ev]) {
    const hit = rayPlane(camera.rayFor(s.clientX, s.clientY), stroke.plane) // float
    if (!hit) continue
    stroke.samples.push({
      tickOffset: simHost.currentTick() - stroke.startTick,  // integer, assigned once
      u: toFixed(hit.u), v: toFixed(hit.v),                  // quantized once
      pressure: Math.round(s.pressure * 4095),               // 12-bit integer
      tiltX: Math.round(s.tiltX), tiltY: Math.round(s.tiltY),
    })
  }
}
```

### Pattern 2: Fixed timestep, whole steps only, sim state double-buffered for render

**What:** The sim host keeps an accumulator of real elapsed time and drains it in whole ticks at the world's fixed rate; it never runs a fractional final step (that is the "semi-fixed" variant every source names as the determinism breaker). Pause = stop draining. Speed-up = drain more ticks per frame (with a cap so a stalled tab does not spiral). Reverse/scrub = replay to a target tick. The renderer reads a snapshot of positions taken *between* steps (copy into a second typed array, or read the Wasm heap only between `step()` calls) so it never observes a half-updated tick.

**When to use:** From the first line of the sim host. The tick rate (`sim.tick-hz`) is a world constant recorded in the canvas node; changing it is a new world, not a setting.

**Trade-offs:** Rendering the latest whole tick without interpolation shows at most one tick (16.7 ms at 60 Hz) of staleness, which is invisible for painting and avoids interpolation code. Recommend 60 Hz for milestone 1: it matches display rate, Phase 2.3's 1/60 s cadence, and halves replay cost versus 120 Hz; pen samples above 60 Hz are all kept as multiple samples per tick, so no fidelity is lost.

**Example:**
```typescript
// surface/sim-host.ts
let acc = 0
function frame(nowMs: number) {
  if (!paused) acc += Math.min(nowMs - lastMs, 250) * speed   // clamp: no spiral of death
  lastMs = nowMs
  while (acc >= TICK_MS) {                                    // whole ticks only
    sim.apply(pendingActionsFor(sim.tick()))                  // scheduled samples for this tick
    sim.step()
    acc -= TICK_MS
  }
  positions.set(sim.positionsView())                          // copy between steps; renderer reads `positions`
  stage.draw(positions, camera)
  requestAnimationFrame(frame)
}
```

### Pattern 3: Stroke record is the action; nodes are emitted deterministically

**What:** The recorded action is the raw sampled pen path plus the brush version and the plane frame. Inside the sim, a **brush body** (mass from the brush, spring-damper toward the current tick's last sample) integrates once per tick in fixed point, and **nodes are emitted along the body's path** whenever accumulated path length crosses `k * spacing` (Krita's distance-information model, made integer). Node `k` of stroke `s` receives position on the path, weight from pressure at emission, direction and velocity from the body, creation tick, scale band and brush ref. No per-node state is ever written to the journal; it is a pure function of (stroke record, brush version, rule versions, tick).

**When to use:** This is the core invariant of the project. It is also why the spring-damper must live in the sim (see Pattern 5).

**Trade-offs:** Emission depends on the brush body's integrated path, so node count for a stroke is not known at record time. That is correct: it is what makes "heavy materials lag and carry momentum through curves" a reproducible fact of the file rather than a UI effect.

### Pattern 4: Stable node identity from (stroke ordinal, emission index)

**What:** The sim's `StrokeId` is the kernel node ordinal of the stroke record (`n12` → 12). The kernel guarantees ordinals are assigned in commit order and never reused, and Phase 3's documented rule tags post-fork ids with the branch (`b2.n12`), so `(branchTag, ordinal)` is unique across every branch that could ever share history. `NodeId = {stroke: StrokeId, index: u32}`. Iteration order for every rule is ascending `NodeId`; that order is part of the rule version.

**When to use:** Always; never allocate particle ids from a counter, because a counter's value depends on how many ticks ran before, which is exactly what a branch changes.

**Trade-offs:** 64-bit ids cost 8 bytes per node; irrelevant at any scale this milestone reaches. Reserve the high bits for the branch tag now so Phase 3 needs no id migration.

### Pattern 5: Brush feel lives in the sim, not in input shaping

**What:** Three placements were weighed. (a) *Frontend shaping* — smooth or lag the pen in TS, record the shaped path: feel is not reproducible from the file, raw intent is lost, and "mass" becomes a UI preference rather than a property of the material. (b) *Both* — frontend smooths and the sim has a body: double-shaping, and any UI change silently changes the feel of old strokes on replay. (c) **Sim-resident** — record raw samples, the brush body integrates in fixed point per tick: feel is a versioned brush property, replay reproduces it exactly, the raw pen path stays inspectable in the `.tree`, and the renderer only *shows* the body position. Choose (c).

**Consequences the roadmap must absorb:**
1. The live cursor/preview must come from the sim, so the sim must run in the renderer at frame latency — this decides the process topology (Pattern 6).
2. Editing a brush's mass creates a new brush version; old strokes keep their ref, so old feel is preserved (requirement satisfied for free).
3. Stabilizer-style features ("pulled string", averaging) are brush parameters evaluated by the body rule, never frontend filters. The frontend may draw a faint raw-pen ghost for the user; that ghost is not state.
4. The body rule must specify exactly how several samples on one tick are consumed (recommend: integrate toward each sample in order with sub-steps of `1/n` tick, all in fixed point) and that spec is the rule version.

### Pattern 6: One C++ source, two builds; the renderer runs the live sim, the native build is the oracle

**What:** Compile `data-drawing/sim` natively (CMake, doctest, `ddreplay`) and to WebAssembly (Emscripten, flat C ABI). The plugin's renderer surface loads the Wasm build and steps it locally, reading positions straight from the Wasm heap into WebGL with no IPC per frame. Kernel commits go main-ward over the existing async IPC as durability, not as the sim's input path. Wasm integer arithmetic is fully specified (wrapping add/sub/mul, trapping division edge cases), so a fixed-point sim produces identical bytes native and in Wasm; a golden-hash test proves it in CI.

**Why not the alternatives:**
- *N-API addon in main* (like the kernel): every frame's positions would cross IPC to the renderer, and every pen sample would cross back; the brush-feel cursor would pay round-trip latency. Native modules also cannot safely be loaded in workers per Electron's docs.
- *`utilityProcess` sidecar*: same IPC cost with more process lifecycle to own.
- *Worker + SharedArrayBuffer*: attractive later, but SAB requires `crossOriginIsolated`, whose availability under Electron's custom protocol is unverified (LOW); start on the renderer thread behind a `SimHost` interface and move to a worker with transferable buffers if profiling shows `step()` exceeding the frame budget.

**Authority framing:** the renderer's sim instance is not "the authority" — the journal plus deterministic replay is. The live instance is a view that happens to be computed by the same function; if it ever disagrees with the native oracle's hash, that is a bug report with a tick number, not a data-loss event.

### Pattern 7: Hash everything authoritative, nothing else, and record the hash where a person can read it

**What:** `hash()` walks a canonical serialization: tick, seed, tick-hz, rule versions, brush table in ordinal order, node arrays in `NodeId` order, brush body state, RNG state, and scheduled-but-unapplied samples. Never camera, selection, frame time or Wasm heap layout. The same byte walk is `serialize()`, so hash and snapshot can never drift apart. A **trace mode** hashes every tick (Factorio's debug mode) so two runs can be bisected to the first divergent tick, which is where the actual bug is.

**Where the hash goes:** the plugin writes `sim.hash text "<hex>"` and `tick int` on each stroke commit (state *before* the stroke) and on close via a small `datadrawing/checkpoint@1` node. On reopen the sim replays and verifies at each checkpoint. These are ordinary readable properties, so Phase 3's HIST-04/HIST-06 verification can consume them without a Data-Drawing-specific parser.

### Pattern 8: Scrub by replay now; snapshots are a byte-identical `serialize()` Phase 3 will persist

**What:** For milestone 1, scrubbing to tick `t` means `sim.reset(seed); apply actions ≤ t in order; step to t`. To keep this fast without building Phase 3's persistent snapshots, two sim-side properties are designed in now: (1) **sleeping** — nodes at rest and no active stroke make `step()` O(sleeping-check), so quiet stretches replay in microseconds; (2) **`serialize()`/`restore()` are memcpy-cheap** because the state is POD struct-of-arrays with no pointers and no hash-map iteration. The sim host may keep a transient in-memory ring of recent snapshots for smooth reverse scrubbing; those are never written to the file. When Phase 3 lands, its snapshot store persists exactly these bytes keyed by (branch, tick, hash), and branching is "replay a different linear action list" — the sim needs no change.

## Data Flow

### Request Flow (a stroke, pen-down to durable)

```
pen down (PointerEvent, pressure, tilt)
    ↓ surface/input.ts: plane frame captured from camera ONCE at pen-down; ray→plane unproject; quantize; tick-stamp
OpenStroke{startTick, plane, brushRef, samples[]}
    ↓ every frame: samples for the current tick fed to the LIVE sim (optimistic — identical bytes to what will be committed)
sim.apply(stroke-so-far at tick t); sim.step()   → brush body moves, nodes emitted, positions updated
    ↓ pen up (or idle flush, mirroring 2.3's 300 ms policy, for very long strokes)
plugin surface → IPC → plugin main (index.js)
    ↓ commit 1: { ops: [advance Δ] }                 header tick = old tick; world tick becomes startTick
    ↓ commit 2: { ops: [create-node datadrawing/stroke@1, set … brush ref, plane.*, tick int, sim.hash text, samples text <<TEXT] }
Kernel.submit → World::Transaction → Journal::append (fsync) → CommitResult{nodeIds:[n12]}
    ↓ nodeIds[0] ordinal (12) is the StrokeId the live sim already used (the plugin predicts it from getNextIds(); a mismatch is a hard error, never a silent renumber)
```

Two commits per stroke are required because the kernel stamps a commit's `tick` *before* applying that commit's own `advance` ops (`Kernel.hpp:63-64`, `FORMAT.md` commit 5), so an `advance` in the same record as the stroke would leave the header tick disagreeing with the stroke's tick. Both records are short and readable: "advance 312" then "stroke at tick 1544". Also commit an `advance` on pause/close so the journal's final tick equals the session's final sim tick; without it replay would not know how long the world kept settling.

### State Management

```
.tree journal (durable, ordered, readable)
    ↓ open: plugin main reads brush + stroke + checkpoint nodes; orders by (tick, ordinal); decodes sample blocks
ordered action list  ──►  sim host (renderer)  ──►  Wasm sim state (authoritative view, derived)
                                                        ↓ read-only typed arrays, copied between steps
                                                  WebGL2 placeholder renderer / timeline UI
                                                        ↓ user gesture
                                                  new action → live sim (optimistic) → commit (durable)
```

Stroke nodes carry an explicit `tick int` property even though the commit header also has it, because `KernelAPI.getNodes()` returns live nodes without commit metadata; the property lets the plugin rebuild action order from the world alone, and it makes a stroke's moment readable on the node's own lines.

### Key Data Flows

1. **Camera and plane are not the same thing.** The camera is renderer-only, never recorded, and orbiting or zooming never changes state (brief invariant 2). The plane frame *is* recorded — per stroke, as `plane.origin.x/y/z`, `plane.right.x/y/z`, `plane.up.x/y/z` in fixed-point (the 2.3 threads precedent stores `origin/direction/roll` the same way). "Facing the camera" means the plugin derives the frame from the camera at pen-down; after that the stroke's meaning is fixed in world space.
2. **Brush definitions are nodes, versions are new nodes.** `datadrawing/brush@1` with `description text`, `mass int`, `radius int`, `spacing int`, `version int`, `supersedes ref`. Strokes `ref` the exact version. The sim's brush table is keyed by ordinal and immutable once defined.
3. **Replay verification runs in two places with one function.** Reopen in the app verifies checkpoint hashes with the Wasm build; `ddreplay` verifies the same file with the native build; CI verifies the two builds against each other on golden fixtures.

## Scaling Considerations

Scale here is node count and session length, not users.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| ≤ 20k nodes, sessions of minutes | Wasm on the renderer thread; replay-from-start scrub; instanced points. Nothing else needed. This is milestone 1. |
| 20k–200k nodes, hour-long sessions | Sleeping nodes make quiet ticks free; transient in-memory snapshot ring for reverse scrub; move `step()` to a Web Worker with transferable buffers; spatial hash for any neighbour-dependent material rule (iterate cells in fixed order). |
| 200k+ nodes, multi-hour histories | Phase 3 persistent snapshots keyed by hash; per-region sleeping; consider SIMD in Wasm (integer lanes stay deterministic). GPU compute is never authoritative — it may only render. |

### Scaling Priorities

1. **First bottleneck: replay-from-start for scrubbing.** Fix with sleeping (cheap, sim-side, now) before snapshots (Phase 3). Design `step()` so a tick with no active stroke and no awake nodes is a few integer compares.
2. **Second bottleneck: `step()` on the renderer thread competing with draw.** Fix by moving the Wasm instance to a worker; the `SimHost` interface should be async-shaped from day one (`await host.stepTo(tick)`) so the move is a transport change, not an API change.

## Anti-Patterns

### Anti-Pattern 1: Committing derived state

**What people do:** Write per-node positions to the journal "for safety" or so the file loads faster.
**Why it's wrong:** It explodes the readable `.tree` (thousands of lines per stroke), and it creates a second source of truth that can disagree with replay; the kernel's readability promise dies with it.
**Do this instead:** Commit strokes and brushes only. If load time matters, that is what Phase 3 snapshots are for — cached bytes, not history.

### Anti-Pattern 2: One `advance` commit per tick

**What people do:** Mirror the sim's 60 Hz clock into the kernel with an `advance 1` every tick.
**Why it's wrong:** Every commit is an fsync and a chained record; 60 records per second is unreadable and slow, and the kernel tick has no meaning between actions anyway.
**Do this instead:** Advance lazily: before each stroke commit (so the header tick is right) and on pause/close (so the final tick is recorded). The sim's in-memory tick may run ahead of the journal's; the journal catches up at action boundaries.

### Anti-Pattern 3: The fractional final step

**What people do:** After draining whole ticks, run one more `step(remainder)` so motion looks perfectly smooth.
**Why it's wrong:** The remainder depends on frame timing; the same actions now produce different state on different runs. Every fixed-timestep source names this as the determinism breaker.
**Do this instead:** Whole ticks only. Render the latest whole tick; at 60 Hz nobody can see the difference.

### Anti-Pattern 4: Shaping the stroke in the frontend and recording the result

**What people do:** Apply a smoothing or lag filter in TS and commit the smoothed path because "that is what the user saw".
**Why it's wrong:** Raw intent is lost, feel becomes a UI setting rather than a property of the material, and a later filter change silently alters how old strokes replay.
**Do this instead:** Record raw quantized samples; make lag, smoothing and momentum brush parameters evaluated by the versioned brush-body rule inside the sim.

### Anti-Pattern 5: Floats or unordered containers anywhere in state

**What people do:** Use `double` for "just the positions" or `std::unordered_map` for node lookup.
**Why it's wrong:** Float results differ across compilers and Wasm engines only sometimes, which is worse than always; unordered iteration order differs across standard libraries. Either one makes native and Wasm hashes diverge and cannot be retrofitted.
**Do this instead:** Fixed-point `int64` everywhere in `State.hpp`; sorted vectors or dense arrays indexed by ordinal; `-fwrapv`-style explicit wrapping helpers; a static assert that `State` is trivially copyable.

### Anti-Pattern 6: Letting the renderer read mid-step memory

**What people do:** Point WebGL at the Wasm heap and draw whenever the browser wants.
**Why it's wrong:** Draws see half-updated ticks (tearing), and worse, the temptation grows to let render timing influence step timing.
**Do this instead:** Copy positions into a render buffer between steps, or step only inside the frame callback before draw; never draw during `step()`.

### Anti-Pattern 7: Kernel node ids for particles

**What people do:** Create a kernel node per particle so the inspector can select one.
**Why it's wrong:** Anti-pattern 1 again, plus ids would then depend on tick count, breaking branch identity.
**Do this instead:** Particle identity is `(stroke ordinal, index)`; the inspector addresses a particle through its stroke node plus index, and the sim answers queries about it.

## Integration Points

### External Services

None in milestone 1. No AI, no network, no wall clock reaches the sim. When the render model arrives (brief milestone 5), it sits *after* the sim as a pure consumer of node state, and HIST-05's "record outcomes" rule applies to it, not to the sim.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Sim core ↔ everything | C ABI (`dd_apply`, `dd_step`, `dd_hash`, `dd_serialize`, `dd_positions_ptr`) | Integers only across the boundary. The sim never imports Tapestry, Electron or the DOM. |
| Plugin main ↔ Kernel | `KernelAPI.submit` / `getNodes` (SDK, existing) | `AdvanceOp` is already in the SDK op union; plugin actor is host-stamped. No new verb, no new value type, no `x-` lines needed (the SDK cannot emit them; use properties). |
| Plugin surface ↔ Plugin main | preload IPC (existing channels) | Async; used for durability and open-time reconstruction, never per frame. |
| Plugin surface ↔ Host renderer | **Gap.** `TreeFrame.tsx:49` resolves node views from a compiled-in `NODE_VIEW_COMPONENTS` map; plugins contribute a *name*, and the host "is never handed code to execute". Plugin code runs only in main via `require()`. | The painting surface needs a WebGL canvas in the renderer, which no plugin can ship today. The Tapestry CLAUDE.md SDK table already anticipates "an isolated custom web surface for complex editors"; that host extension point must be built (or, as a flagged interim, the surface compiled into the app like `NoteCard`) before the painting phase. This is an external dependency on Tapestry and belongs early in the roadmap. |
| Stroke codec (TS) ↔ Stroke codec (C++) | Shared golden `.tree` fixture | Lock the sample-block grammar with Kaelen before the first real stroke commit — it is a one-way door into an append-only journal, exactly as Phase 2.3 treated `thread.log`. |
| Sim ↔ Tapestry Phase 3 | `serialize()/restore()/hash()`; branch = different action list; ids carry branch tag bits | Nothing in the sim changes when Phase 3 lands. Phase 3 must tighten its "numeric compatibility envelope" wording to bit-identity for Data Drawing worlds, as PROJECT.md already flags. |
| Sim ↔ Tapestry Phase 5 rule engine | None in milestone 1 | Phase 5's fixed-step engine is a separate consumer of kernel ticks; Data Drawing's sim is a plugin-owned world under the same tick. Keep them separate until both exist. |

## Suggested Build Order

Dependencies run downward; each step has a headless proof before the next starts.

1. **Sim skeleton and determinism harness** — `Fixed`, `Ids`, `Rng`, POD `State`, no-op `step()`, `hash()`, `serialize()/restore()`, trace mode, doctest "two runs, same hash; 100 replays; snapshot round-trip". Native only. *Proves:* the numeric and state discipline before any behaviour exists.
2. **Actions, brush body, node emission** — `DefineBrush`, `Stroke` with tick-scheduled samples, spring-damper body, spacing-based emission, `(stroke, index)` ids, sleeping. Golden-hash fixtures of synthetic strokes. *Proves:* stroke → nodes is a pure function; feel is in the sim.
3. **Journal codec and `ddreplay`** — stroke/brush/checkpoint node types, readable sample-block grammar (checkpoint with Kaelen; one-way door), advance policy, C++ codec, `ddreplay` reading a `.tree` through the kernel library and verifying checkpoint hashes. *Proves:* "read a saved `.tree` and identify each stroke, brush, tick" and the sim/kernel seam, with no UI.
4. **Wasm build and host surface extension** — Emscripten target with flat C ABI; CI test native ≡ Wasm on the golden fixtures; the Tapestry host gains a renderer surface extension point for plugin bundles (external dependency — schedule with the Tapestry roadmap); `SimHost` TS wrapper with the accumulator loop. *Proves:* the same bytes in the browser; a plugin can own a canvas.
5. **Painting surface** — WebGL2 stage, orbit camera, camera-facing plane frame captured at pen-down, pointer capture with pressure/tilt/coalesced events, quantize-and-stamp, optimistic live sim, commit pipeline (advance + stroke, id prediction check), placeholder instanced renderer. *Proves:* drawing-program feel from recorded raw input.
6. **Timeline** — pause, speed, reverse, scrub by replay-from-start (plus transient snapshot ring), reopen-time hash verification against checkpoints. *Proves:* any moment reproduces; the file is the truth.
7. **One living material** — a versioned `Settle` rule (mass-driven), demonstrating the canvas is alive and that rule versions are part of the hash. *Proves:* behaviour over time replays exactly.

Ordering rationale: 3 before 4–5 because the grammar is irreversible and must be judged on real files before UI pressure shapes it; 4's native≡Wasm test before 5 because building the UI on a sim that silently diverges from the oracle would waste the whole milestone; the host surface gap in 4 is the one item outside this project's control and should be raised now.

## Sources

Codebase (HIGH — read directly):
- `/Users/kaelencook/Tapestry/tapestry/kernel/Kernel.hpp` — commit tick captured before the commit's own `advance` ops; `replayUpTo`; single writer
- `/Users/kaelencook/Tapestry/tapestry/kernel/Ops.hpp`, `World.hpp` — seven verbs, id assignment at prepare, never reused, tombstones
- `/Users/kaelencook/Tapestry/tapestry/docs/tree/FORMAT.md` — `advance` semantics, branch-tagged ids planned for Phase 3, block text, no `x-` lines from plugins
- `/Users/kaelencook/Tapestry/sdk/src/index.ts`, `contributions.ts` — `AdvanceOp` in the op union; node views registered by name
- `/Users/kaelencook/Tapestry/app/native/addon.cpp`, `app/src/main/kernel-bridge.ts`, `plugin-host.ts` — kernel as N-API addon in main; plugins `require()`d in main
- `/Users/kaelencook/Tapestry/app/src/renderer/components/TreeFrame.tsx:37-60` — compiled-in `NODE_VIEW_COMPONENTS`; host never executes plugin UI code
- `/Users/kaelencook/Tapestry/.planning/phases/02.3-time-threads/02.3-02-PLAN.md`, `02.3-04-PLAN.md` — `thread.log` integer-offset grammar as a one-way door; raw WebGL instanced stage
- `/Users/kaelencook/Tapestry/semantic-world/core/*.hpp`, `commands/Command.hpp`, `semantic_world_executable_plan.md` — adopted invariants: commands sorted by (tick, sequence), hash only authoritative state, fixed-point alias
- `/Users/kaelencook/Tapestry/.planning/ROADMAP.md`, `REQUIREMENTS.md` — Phase 3 HIST-01..08, Phase 5 RULE-02

Web (LOW per confidence seam; corroborating primary sources):
- [Deterministic Lockstep — Gaffer On Games](https://gafferongames.com/post/deterministic_lockstep/) — inputs not state; frame-stamped inputs; cross-compiler float caveat
- [Fix Your Timestep! — Gaffer On Games](https://gafferongames.com/post/fix_your_timestep/) and [Fixed timestep without interpolation — Jakub Tomsu](https://jakubtomsu.github.io/posts/fixed_timestep_without_interpolation/) — accumulator, whole steps only, input accumulation per tick, replay = initial state + inputs
- [Netcode Architectures Part 1: Lockstep — SnapNet](https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/) and [Part 2: Rollback](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/) — deterministic fence; contiguous memcpy-able state for save/restore
- [Friday Facts #47 — CRC fun — Factorio](https://www.factorio.com/blog/post/fff-47) and [Desynchronization — Factorio Wiki](https://wiki.factorio.com/Desynchronization) — per-tick state hash, replay to find first divergent tick, diff human-readable dumps
- [Multithreading — Electron](https://www.electronjs.org/docs/latest/tutorial/multithreading) — native modules unsafe in workers; Node workers only in main
- [WebAssembly Core Specification](https://www.w3.org/TR/wasm-core-2/) and [WebAssembly design Rationale](https://github.com/WebAssembly/design/blob/af8e951/Rationale.md) — deterministic integer semantics across engines
- [SharedArrayBuffer — MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) — requires cross-origin isolation (Electron specifics unverified)
- [Freehand Brush Tool — Krita Manual](https://docs.krita.org/en/reference_manual/tools/freehand_brush.html) and [Stabilization — Drawpile](https://docs.drawpile.net/help/draw/stabilization.html) — distance-based spacing, time-based stabilizer models

---
*Architecture research for: Data Drawing (deterministic fixed-point particle sim + Tapestry journal + Electron/TS plugin)*
*Researched: 2026-09-22*
