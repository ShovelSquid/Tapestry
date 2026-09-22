# Feature Research

**Domain:** Node/particle-based deterministic drawing program with mass-driven brush feel and a scrubbable simulation timeline (Data Drawing, milestone 1: deterministic core + painting frontend)
**Researched:** 2026-09-22
**Confidence:** MEDIUM (official vendor docs cross-checked by web search for every product surveyed; no Context7 or curated provider available in this environment, so nothing rates HIGH under the classify-confidence seam)

## How to read this file

Data Drawing is not competing with Krita or Procreate on pixel features. It borrows the *feel* layer from drawing programs (input fidelity, stabilization, pressure), the *time* layer from simulation tools (Houdini, Rebelle, falling-sand games, Drawpile) and the *meaning* layer from paint-with-words research (GauGAN/Canvas, eDiff-I, SpaText). The survey below translates each borrowed feature into its node-world equivalent and says whether milestone 1 needs it.

A recurring finding: **every product surveyed that records the drawing process either records video (Procreate, Krita Recorder, Rebelle) or records commands without a simulation tick (Drawpile).** None combines a command log, a deterministic simulation, and a human-readable file. That gap is the differentiator; the table-stakes list exists so the differentiator ships inside something that still feels like a drawing program.

## Feature Landscape

### Table Stakes (Users Expect These)

Features a person holding a pressure pen assumes exist. Missing these = "it is a demo, not a drawing program". Complexity is for milestone 1 in the Tapestry plugin + fixed-point sim context, not for a raster app.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Pressure drives stroke weight, with a global pressure curve | Procreate has a global Pressure Curve in Preferences; Krita and Photoshop expose per-input curves. Every pen user retunes this within minutes of first use. | LOW | Record *raw* device pressure (0..1 quantized to fixed point) in the stroke action; apply the curve inside the sim as a parameter of the brush version, not as a frontend preference. Otherwise replay depends on machine settings. |
| Tilt captured when available | Procreate's Apple Pencil group maps tilt to size/opacity/bleed; Pointer Events L3 gives tiltX/tiltY (-90..90) and twist. | LOW | Capture and record; do not have to *use* it in milestone 1. Risk: macOS Chromium has historically reported Wacom pens as `pointerType: "mouse"` while still delivering pressure. Verify on this Mac in Electron before relying on `pointerType` for anything. |
| High-rate input sampling (coalesced events) | Chromium coalesces pointer samples into one `pointermove` per frame; without `getCoalescedEvents()` fast strokes turn into polygons. Every native app reads the tablet at full rate. | LOW | Use `getCoalescedEvents()` on `pointermove` (or `pointerrawupdate`). Predicted events (`getPredictedEvents()`) may drive the on-screen preview only; never record them. |
| Stroke smoothing / stabilizer with a dead zone | Procreate (StreamLine, Stabilization, Motion Filtering), Krita (Basic, Weighted, Stabilizer with Delay dead zone and Finish Line), Photoshop (0-100% + Pulled String), Rebelle (Moving Average or Pulled String), Blender GP (Stabilize Stroke), Lazy Nezumi Pro (Pulled String, MA, EMA). Universal. | MEDIUM | In Data Drawing the mass spring-damper *is* the stabilizer (Krita's Dynamic Brush Tool with Mass/Drag and Lazy Nezumi's scripted "Weighted" preset with mass+drag are the direct precedents). Ship one physically-motivated model plus a pulled-string dead zone and a "finish line on pen-up" (Photoshop's Catch-up on Stroke End). Must run inside the sim on tick-quantized input so replay is exact. |
| Brush radius and node spacing/density controls | Size is the first slider in every app; spacing (Procreate Stroke Path "Spacing", Krita spacing) controls dab density. Node density = strength in the brief. | LOW | Radius/falloff and spacing per brush version; a quick size slider on the toolbar. |
| Brush picker with a handful of presets | Users expect to switch brushes without editing anything. | LOW | Presets are brush versions with a description already filled in ("graphite", "rust", "smoke") and differing mass. |
| Eraser / remove marks | Universal. | MEDIUM | An eraser is a recorded action ("remove nodes within radius on plane at tick t"), never a direct mutation. Depends on stable node ids (open question: ids derived from action id + index). Removed nodes must stay in history so scrubbing back shows them. |
| Undo / redo | Universal; Photoshop History panel, Affinity "Save History with Document". | HIGH | Hardest table stake here. Drawpile's model (commands marked done/undone/gone, re-execute from a savepoint) proves undo can live in a command log. But undoing a stroke placed at tick 100 while the sim is at tick 500 changes everything after tick 100. Recommend: milestone-1 undo = a new *retract* action recorded at the current tick that removes the last stroke's nodes (history intact, no recompute); true "unhappen" undo arrives with Tapestry Phase 3 branching. Decide this in phase discussion; it shapes the action schema. |
| Pan / zoom / rotate the view | Universal; Photoshop "Adjust for Zoom" and Krita "Scalable Distance" show that smoothing is expected to scale with zoom. | MEDIUM | Orbit camera + camera-facing painting plane (project decision). Smoothing distances should be defined in plane units, with a documented zoom-scaling rule, so a zoomed-in stroke replays identically. |
| Immediate visual feedback while drawing | Any latency above a frame or two feels broken. | MEDIUM | Deterministic placeholder rasterizer of the node field (points/discs colored from a hash of the brush description). Preview may lead the committed sim using predicted points, then reconcile. |
| Brush cursor showing radius, and the lagging brush position | Photoshop's Pulled String draws the dead-zone circle and string; Krita draws the outline. With mass, users need to see where the brush *is* versus where the pen is. | LOW | Draw pen position, brush body position, and the spring between them. This is the cheapest way to make mass legible. |
| Save / open a document | Universal. | LOW | Kernel `.tree` journal already exists (Phase 1). The plugin must register a readable schema for stroke actions and brush versions. |
| Simulation transport: play / pause / step / speed | Powder Toy (Space pause, F frame-step), Rebelle (Pause Diffusion, D key), Houdini timeline. Any "living canvas" user expects a pause button within seconds of seeing things move. | LOW | Pause = stop ticking. Speed = ticks per frame (never by capping FPS as Powder Toy does; that also slows input). Step = one tick. |
| Timeline scrubber with tick readout | The brief requires scrubbing; Procreate's replay is scrubbable by swiping; Drawpile's player has a seek bar. | MEDIUM | Milestone 1 scrubs by replay from tick 0 (no snapshots yet). Mark stroke actions on the bar. Reverse playback = scrub target moving backward, re-simulated; it is not the sim running backwards. |
| Inspect a mark: description, tick, brush version, weight | Clip Studio vector layers and Concepts let you select any line and see/edit its tool; Blender GP exposes per-point pressure/strength. Once marks are "objects", users will click one and expect to see what it is. | MEDIUM | Read-only inspector in milestone 1 (select stroke, show its action). Editing properties after the fact is a later action type. |

### Differentiators (Competitive Advantage)

These align with the Core Value ("same file, seed, and pinned versions reproduce the same node state at every tick of every branch"). Do not dilute them by trying to also match raster feature counts.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Free-text brush description as the mark's payload | "Paint with words" exists only inside model UIs (NVIDIA Canvas: about 20 fixed material labels; eDiff-I: phrases from the prompt scribbled as a segmentation map; SpaText: free text per region). None store it as a durable, editable object with physical properties and none work offline without the model. | LOW (milestone 1) | It is a string plus a version id in the brush definition. The renderer that gives it visual meaning is milestone 5; a hash-to-color placeholder is enough now. |
| Versioned, immutable brush definitions | Concepts lets you change a stroke's tool "weeks later" (mutating old marks). Substance Designer is non-destructive but re-cooks everything when a parameter changes. Data Drawing: editing a brush creates a new version; old strokes keep the version they were made with, so old renders stay reproducible (brief invariant 6). | MEDIUM | Needs a brush registry in the plugin schema, readable in `.tree`. "Upgrade these strokes to brush v3" is itself a recorded action (later). |
| Mass-driven brush feel from the material itself | Krita's Dynamic Brush Tool (Mass/Drag) and Lazy Nezumi's Weighted preset prove that a spring-damper brush feels good, but in those tools mass is a smoothing knob unrelated to what is painted. Here lead lags and carries momentum because it *is* heavy; smoke does not. Brief decision 6. | MEDIUM | Spring-damper integrated in fixed point inside the sim, driven by tick-quantized pen samples; stiffness/damping derived from brush mass with per-brush overrides. Tune with the pulled-string dead zone so light brushes still feel direct. |
| Bit-identical deterministic replay with hash verification | Drawpile replays commands to the same end result but its canvas is raster and not tick-simulated; lockstep games (Gaffer on Games) do exactly this with fixed-point state and per-tick state hashes for desync diffing. No drawing app offers it. | HIGH | Fixed-point integer state, fixed timestep, strictly ordered updates, seeded RNG. Ship the desync tool with it: hash state every N ticks during record and replay and diff the first mismatch. This is the feature that cannot be retrofitted. |
| Living canvas whose time can be scrubbed | Rebelle can *pause* diffusion and *dry* a layer but cannot go back; Fresco's oils never dry at all; Houdini sims are forward-only unless every frame is cached; falling-sand games have pause/step but no rewind. A canvas whose material behavior is reproducible at any tick is new. | HIGH | Depends on deterministic replay. Milestone 1: one material behavior (weight settling) plus replay-from-zero scrubbing. Snapshots (Drawpile-style index: nearest earlier snapshot then replay) come from Tapestry Phase 3. |
| Reverse and variable-speed playback | Procreate's time-lapse replay is 30 fps video; nobody offers reverse playback of the *state*. | LOW-MEDIUM | Reverse = scrub target decreasing per frame. With replay-from-zero it is O(t) per frame; acceptable at milestone-1 scale, and the reason snapshots are the first thing to consume from Phase 3. |
| Human-readable history file | Drawpile recordings have a text encoding but are for tools, not people. Affinity history is opaque. Tapestry's `.tree` is designed to be read by a person, and the project requires that each stroke, description, tick and branch be identifiable without the app. | LOW-MEDIUM | Kernel owns the format; this plugin owns the stroke/brush schema and its fallback rendering for readers without the plugin. Per-node state must never be committed (storage-growth conflict flagged in PROJECT.md). |
| 3D node space with a camera-facing painting plane | Blender GP draws 2D strokes in 3D space on a plane/surface and orbits the camera; Procreate has 3D model painting. Combining that with a particle sim on the same plane is unusual. | MEDIUM-HIGH | Plane placement and camera state are view concerns; the stroke action records the plane transform so replay does not depend on the camera. |
| Marks as inspectable objects with provenance | Clip Studio vectors and Concepts prove artists value editing a line after the fact; Blender GP exposes per-point pressure. Data Drawing adds tick, velocity, direction, brush version and scale band. | MEDIUM | Inspector in milestone 1; edit actions later. Scale band is recorded now for the future tile tree. |
| One material that behaves over time | Rebelle's diffusion/drying is the closest product precedent; Noita/Powder Toy show that simple per-particle rules produce a convincingly alive canvas. | MEDIUM | Weight settling first (mass-dependent downward drift on the plane with damping). Keep material rules data-driven from the start so "rust spreads" is a rule file, not a code branch (open question in PROJECT.md). |

### Anti-Features (Commonly Requested, Often Problematic)

Things that look like obvious wins because every other drawing app has them, but that conflict with the invariants or the milestone scope.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Raster layers and pixel compositing | Every drawing app has layers; Procreate/Krita users reach for them immediately. | Pixels are not the source of truth; a layer stack invites blend modes, masks and other pixel semantics that the node field cannot replay. | Planes in 3D space now; groups with inheritance (brief decision 10) in milestone 3. |
| Video time-lapse recording | Procreate, Krita Recorder docker, Rebelle all ship it and artists love it. | Video is a lossy cache of the action log. Recording it in milestone 1 adds ffmpeg/encoding work with no information gain. | Render a time-lapse *from replay* later; the log already contains everything. |
| Frontend-side stabilization using wall-clock timestamps | Procreate's Stabilization is speed-dependent; Lazy Nezumi computes pressure from pen speed in real time. Cheap to do in JS. | Speed measured by wall clock is nondeterministic; replay on a slower machine produces a different stroke. Violates "no wall clock". | Quantize input samples to sim ticks (tick plus integer sub-tick offset) at record time; compute velocity, smoothing and the spring inside the sim from those. |
| Speed control by changing the frame rate | Powder Toy's only speed control is an FPS cap. | Ties sim time to render time and slows input handling. | Ticks per rendered frame, decoupled from frame rate; the renderer samples state. |
| Floating-point or GPU-parallel simulation | Noita, chrono_magnetic_particles and every fluid demo use floats and threads/compute shaders for speed. | One bit of drift at tick 10 is a different painting at tick 10,000 (brief). Parallel updates reorder results. Cannot be retrofitted. | Fixed-point integers, single-threaded strictly ordered update; GPU only in the renderer, which reads state and never writes it. |
| Committing per-node state or snapshots into `.tree` | "Just save the state so scrubbing is instant" (Houdini caches every frame; Drawpile indexes snapshots). | Explodes the human-readable journal (PROJECT.md storage-growth conflict) and duplicates Phase 3. | Snapshots are regenerable caches outside the journal, keyed by branch and tick; Phase 3 supplies them. |
| Destructive undo that truncates the log | Simplest undo implementation; how most editors' undo stacks work. | Destroys the future that branching (Phase 3) is meant to preserve; also breaks hash-chained commits. | Retract-as-new-action in milestone 1; branch-at-tick undo after Phase 3. |
| Editing a brush preset mutates existing strokes | Concepts and Substance advertise "change it any time, everything updates". | Silently changes old renders; violates invariant 6. | New brush version per edit; an explicit "rebind strokes to version" action if the user wants propagation. |
| Model-based rendering in this milestone | It is the headline of the vision; GauGAN-style regional prompting "works today". | Cross-hardware nondeterminism (brief known risk), large dependency surface, and it would mask whether the node model and feel are right. | Deterministic placeholder rasterizer; keep node fields renderer-agnostic so milestone 5 plugs in. |
| Porting a raster brush engine (grain, wet mix, blend modes, shape sources) | Procreate's Brush Studio has 14 setting groups; users will ask for texture and wet edges. | Those are pixel-space concepts; in a node field they are renderer prompts, not sim properties. | Brush = description + physical defaults + locality later. Texture is the model's job in milestone 5. |
| A menu of many stabilizer algorithms | Lazy Nezumi offers twelve; Krita four. | Each is another deterministic code path to version and replay forever. | One spring-damper model plus dead zone and finish-line; expose mass, stiffness, damping, dead-zone radius. |
| Recording predicted pointer samples | `getPredictedEvents()` makes the preview feel instant. | Predictions are browser-implementation-defined and change between Chromium releases; recording them breaks replay across versions. | Preview only; record coalesced real samples. |
| Live collaboration | Drawpile shows a command log makes it almost free. | Ordering, identity and branching semantics are Phase 3 concerns; adds network nondeterminism. | Defer; the action log keeps the door open. |
| Infinite canvas / tile tree / procedural spawning now | Brief decision 3; Concepts markets infinite canvas. | Requires the render tier and scale-band semantics that do not exist yet. | Record scale band per node now (already in requirements); build the tree in milestone 6. |

## Feature Dependencies

```
[Fixed-point node model + fixed-timestep tick]
    └──requires──> nothing (foundation)

[Stroke action schema (tick-quantized samples, brush version, plane transform)]
    └──requires──> [Node model]
    └──requires──> [Brush registry with versions]
    └──requires──> [Kernel .tree command registration]

[Deterministic replay + state hashing]
    └──requires──> [Stroke action schema]
    └──requires──> [Seeded RNG, strict update order]

[Timeline scrub / reverse / speed]
    └──requires──> [Deterministic replay]
    ──enhanced by──> [Snapshots] (Tapestry Phase 3, external)

[Spring-damper brush feel (mass)]
    └──requires──> [Tick-quantized input in the action]
    └──requires──> [Brush version carries mass/stiffness/damping]
    ──conflicts──> [Wall-clock frontend smoothing]

[Pressure curve, radius, spacing]
    └──requires──> [Brush version parameters]

[Coalesced pointer capture + tilt]
    └──requires──> [Electron pointer-event verification on this Mac]

[Placeholder renderer]
    └──requires──> [Node model snapshot read API]
    ──enables──> [Cursor / lagging-brush overlay], [Inspector], [Scrub feedback]

[Eraser action]
    └──requires──> [Stable node ids derived from action id + index]

[Undo (retract action)]
    └──requires──> [Stroke action schema], [Stable node ids]
    ──conflicts──> [Destructive log truncation]
    ──superseded by──> [Branch-at-tick undo] (Phase 3)

[Camera-facing plane + orbit camera]
    └──requires──> [Tapestry 3D stage (Phase 2.3)]
    ──feeds──> [Stroke action plane transform]

[Material behavior (weight settling)]
    └──requires──> [Node model with mass], [Deterministic tick]
    ──shows value of──> [Timeline scrub]

[Readable .tree fallback]
    └──requires──> [Stroke/brush schema], [Kernel fallback rendering for unknown plugin data]
```

### Dependency Notes

- **Spring-damper brush requires tick-quantized input:** the spring integrates over time; if "time" is wall clock the stroke differs on replay. Input samples must be stamped with sim tick (and an integer sub-tick offset if the input rate exceeds the tick rate) at record time. This single decision determines whether feel is replayable.
- **Stabilization conflicts with frontend smoothing:** any smoothing applied in the renderer process before recording is invisible to replay. Either record post-smoothing positions (loses the raw gesture forever) or, recommended, record raw samples and smooth inside the versioned sim.
- **Eraser and undo require stable node ids:** both name nodes that already exist. The open question "ids derived from action id + index" must be answered before either is built, and the answer must survive branching (same action in two branches yields the same ids).
- **Timeline scrub is enhanced, not enabled, by snapshots:** replay-from-zero is sufficient for milestone 1 and keeps Phase 3 dependencies out; the scrubber UI should not change when snapshots arrive, only its latency.
- **Placeholder renderer enables every UI feature:** cursor overlay, inspector and scrub feedback all read the same snapshot API; build it first in the frontend phase.
- **Pointer capture depends on platform verification:** Chromium on macOS has had `pointerType` mis-reporting for Wacom pens (Mozilla and WICG threads; the Chrome side is less documented). Pressure has generally worked. Verify `pressure`, `tiltX/Y`, `getCoalescedEvents()` and `pointerrawupdate` in the actual Electron build before designing around any of them.

## MVP Definition

### Launch With (v1)

Minimum to validate "nodes, not pixels, with the feel of a drawing program, on a deterministic scrubbable canvas".

- [ ] Fixed-point node model and fixed-timestep sim with seeded RNG and strict ordering — nothing else is testable without it
- [ ] Stroke action schema recorded through the kernel: tick-quantized samples (position, pressure, tilt), brush version id, plane transform, scale band — the only source of change
- [ ] Brush registry with immutable versions; three or four presets differing in description and mass — proves versioning and gives something to switch between
- [ ] Deterministic replay with periodic state hashes and a replay-diff tool — proves the core value; also the debugging tool for everything after
- [ ] Coalesced pointer capture with pressure and tilt in the Electron plugin — input fidelity
- [ ] Spring-damper brush driven by mass, with dead zone and finish-line on pen-up — the feel differentiator
- [ ] Pressure curve, radius, spacing as brush-version parameters — table-stakes controls
- [ ] Placeholder renderer of the node field with pen/brush/spring cursor overlay — visibility and legibility of mass
- [ ] Camera-facing painting plane in the 3D stage; orbit and move plane — project decision
- [ ] Transport: play, pause, step, speed (ticks per frame), reverse, scrubber with stroke markers, replay-from-zero — brief decision 8 minus branching
- [ ] Eraser as a recorded remove-nodes action — table stake, exercises stable ids
- [ ] Undo as a recorded retract action — table stake without destroying history
- [ ] One material behavior (weight settling) — proves the canvas is alive
- [ ] Read-only stroke inspector (description, tick, brush version, weight, velocity) — marks as objects
- [ ] `.tree` readable without the plugin: a person can identify each stroke, description, tick, branch — project requirement

### Add After Validation (v1.x)

- [ ] Snapshot-accelerated scrubbing — when Tapestry Phase 3 lands snapshots and hash-verified replay
- [ ] Branch-at-tick undo and "edit the past forks a branch" — Phase 3
- [ ] Edit actions on existing marks (change description, mass, position; rebind to a newer brush version) — once the inspector shows the data is right
- [ ] Per-brush stabilizer overrides and a user-editable pressure curve UI — after feel is tuned with presets
- [ ] Tilt-driven parameters (radius elongation, direction) — after tilt is verified on this Mac
- [ ] Time-lapse video export rendered from replay — cheap once replay exists

### Future Consideration (v2+)

- [ ] Groups, instancing, weighted bindings — brief milestone 3
- [ ] Data-driven material rules (rust spread, soft bodies) — milestone 4; keep settling rule data-driven now so this is additive
- [ ] Model render with regional prompting (GauGAN/SpaText lineage) and locked brushes — milestone 5; requires hardware/model pinning policy
- [ ] Tile tree, infinite zoom, procedural spawning — milestone 6
- [ ] Math brushes, SDF regions, generator brushes — milestone 7
- [ ] Atmospheric brushes / locality parameter — open question
- [ ] Collaboration over the action log — not planned; Drawpile shows the shape

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fixed-point node model + tick | HIGH | MEDIUM | P1 |
| Stroke action schema via kernel | HIGH | MEDIUM | P1 |
| Deterministic replay + hash diff tool | HIGH | HIGH | P1 |
| Coalesced pressure/tilt capture | HIGH | LOW | P1 |
| Spring-damper mass brush feel | HIGH | MEDIUM | P1 |
| Pressure curve / radius / spacing | HIGH | LOW | P1 |
| Brush registry with versions + presets | HIGH | MEDIUM | P1 |
| Placeholder renderer + cursor overlay | HIGH | MEDIUM | P1 |
| Camera-facing plane + orbit | MEDIUM | MEDIUM-HIGH | P1 (project decision) |
| Transport + scrubber (replay-from-zero) | HIGH | MEDIUM | P1 |
| Eraser (remove action) | HIGH | MEDIUM | P1 |
| Undo (retract action) | HIGH | HIGH | P1 (scope-limited) |
| Weight settling material | MEDIUM | MEDIUM | P1 |
| Read-only inspector | MEDIUM | LOW | P1 |
| Readable `.tree` fallback | HIGH | LOW-MEDIUM | P1 |
| Snapshot scrubbing | HIGH | external (Phase 3) | P2 |
| Edit-mark actions | HIGH | MEDIUM | P2 |
| Tilt-driven brush parameters | MEDIUM | LOW | P2 |
| Time-lapse export from replay | LOW | LOW | P3 |
| Video recording, raster layers, brush texture engine | LOW (here) | HIGH | Anti-feature |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Krita / Procreate / Photoshop | Rebelle / Fresco / Painter | Drawpile / Houdini / Powder Toy | Canvas / eDiff-I / SpaText | Our Approach |
|---------|-------------------------------|----------------------------|---------------------------------|----------------------------|--------------|
| Stabilization | Krita: Basic/Weighted/Stabilizer, Delay dead zone, Finish Line, Stabilize Sensors; Procreate: StreamLine/Stabilization/Motion Filtering; Photoshop: 0-100%, Pulled String, Catch-up, Adjust for Zoom | Rebelle: Moving Average or Pulled String; Painter: n/a per se | n/a | n/a | One spring-damper (mass, stiffness, damping) + dead zone + finish line, run inside the deterministic sim on tick-quantized input |
| Physics brush feel | Krita Dynamic Brush Tool: Mass, Drag; Lazy Nezumi Weighted preset: mass, drag, gravity | Painter Particle brushes: Gravity/Flow/Spring particle paths emitted from a center point | n/a | n/a | Mass comes from the material; same knob changes feel and sim behavior |
| Pressure / tilt | Global pressure curve (Procreate), per-brush graphs for size/opacity/flow; tilt and barrel roll | Full pen support | n/a | Canvas: mouse-driven label painting | Raw pressure/tilt recorded; curve is a brush-version parameter |
| Marks as editable objects | Clip Studio vector layers (control points, change tip later); Blender GP per-point pressure/strength | No (raster) | Drawpile: commands, not objects | No | Nodes with provenance; inspector now, edit actions later |
| Material behavior over time | No | Rebelle: diffusion, drying, gravity/tilt, Pause Diffusion, Wet/Dry layer; Fresco: watercolor blooms, oils never dry | Powder Toy/Noita: cellular automata materials | No | Data-driven rules on nodes; settling first |
| Time control | Photoshop History states (cleared on close); Affinity saves history with document | Rebelle: pause only | Houdini: cache-dependent scrub, checkpoints; Powder Toy: pause, frame step, FPS cap; Drawpile: replay + index snapshots + seek | No | Pause/step/speed/reverse/scrub by replay from zero; snapshots from Phase 3 |
| Process recording | Procreate time-lapse video (30 fps, 1080p-4K); Krita Recorder docker snapshots to ffmpeg | Rebelle time-lapse video | Drawpile records commands (same as network messages), deterministic replay across clients | No | Action log in human-readable `.tree`; video is a derived export |
| Undo | Undo stack / History panel | Undo stack | Drawpile: done/undone/gone flags, re-execute from savepoint | n/a | Retract action now; branch-at-tick later |
| Semantic painting | No | No | No | Canvas: about 20 fixed materials, 9 styles, 1K output, RTX only; eDiff-I: prompt phrases scribbled as segmentation map; SpaText: free text per region | Free text per brush, versioned, offline-first; renderer later |
| Determinism guarantee | No | No | Drawpile: same command order gives same raster; games: fixed-point + per-tick hash | Diffusion: nondeterministic across hardware | Fixed-point, bit-identical, hash-verified |

## Notes for Requirements Writing

- Write the input-capture requirement as "records coalesced raw samples quantized to ticks", not "supports stabilization". Stabilization is a consequence of the sim, and the raw record is what keeps the gesture editable later.
- Write undo as a scope-limited requirement ("retract last stroke as a recorded action; full history-editing undo deferred to Phase 3") so it is not silently implemented as log truncation.
- Write the speed requirement in ticks-per-frame terms, with reverse as negative scrub, so nobody ties it to frame rate.
- Add an explicit platform verification task for pen input in Electron on this Mac (pressure, tilt, pointerType, coalesced events) early in the frontend phase; it is LOW cost and blocks several table stakes.
- The material-behavior requirement should specify that the rule is data-driven (parameters in the brush/material definition, versioned) even if only one rule ships, so milestone 4 is additive.

## Sources

Confidence per the classify-confidence seam: WebSearch cross-checked = MEDIUM; single-source or training-only = LOW. No HIGH-tier provider was available.

**Drawing-program stroke fidelity (MEDIUM)**
- Krita Freehand Brush Tool (stabilizer modes): https://docs.krita.org/en/reference_manual/tools/freehand_brush.html
- Krita Dynamic Brush Tool (Mass, Drag): https://docs.krita.org/en/reference_manual/tools/dyna.html
- Krita Particle Brush Engine: https://docs.krita.org/en/reference_manual/brushes/brush_engines/particle_brush_engine.html
- Krita Recorder Docker: https://docs.krita.org/en/reference_manual/dockers/recorder_docker.html
- Procreate Brush Studio Settings: https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings
- Procreate Time-lapse (Actions > Video): https://help.procreate.com/procreate/handbook/actions/actions-video
- Procreate Preferences (global Pressure Curve): https://help.procreate.com/procreate/handbook/actions/actions-preferences
- Photoshop stroke smoothing (fetch blocked 403; content via search snippets): https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html
- Lazy Nezumi Pro smoothing modes and Weighted (mass/drag) preset: https://lazynezumi.com/smoothing
- Clip Studio Paint vector layers: https://help.clip-studio.com/en-us/manual_en/180_layers/Vector_layers.htm
- Concepts app (editable vector strokes on infinite canvas): https://concepts.app/en/
- Blender Grease Pencil onion skinning: https://docs.blender.org/manual/en/latest/grease_pencil/properties/onion_skinning.html
- Blender Grease Pencil 2.90 release notes (Interpolate, Build, stabilizer): https://developer.blender.org/docs/release_notes/2.90/grease_pencil/

**Physics / material painting (MEDIUM; Painter control names LOW)**
- Rebelle about page (Rebelle 8 feature set): https://www.escapemotions.com/products/rebelle/about
- Rebelle 8 manual, Working with Water (Pause Diffusion, Wet/Dry layer): https://www.escapemotions.com/products/rebelle/manual/latest/starting-painting/water/
- Adobe Fresco live brushes: https://helpx.adobe.com/fresco/desktop/draw-paint-animate-and-share/live-brushes.html
- Corel Painter Particle brushes (Gravity/Flow/Spring): http://product.corel.com/help/Painter/540215550/Main/EN/Win-Documentation/Corel-Painter-Particle-brushes.html
- Corel Painter Gravity Particle brushes: http://product.corel.com/help/Painter/540215550/Main/EN/Win-Documentation/Corel-Painter-Gravity-Particle-brushes.html

**Timeline / replay / determinism (MEDIUM; falling-sand determinism LOW)**
- How Drawpile works (command log, ordering, savepoints, undo): https://github.com/drawpile/Drawpile/wiki/How-Drawpile-works
- Drawpile recording indexes: https://www.tumblr.com/drawpile-dev-diary/184574203272/recording-indexes
- Drawpile FAQ (recordings are commands, not screenshots): https://docs.drawpile.net/help/common/faq.html
- Houdini Caching simulations: https://www.sidefx.com/docs/houdini/dyno/cache.html
- Houdini Cache LOP (time-dependent modes): https://www.sidefx.com/docs/houdini/nodes/lop/cache.html
- Deterministic Lockstep, Gaffer on Games: https://gafferongames.com/post/deterministic_lockstep/
- Debugging desync in lockstep games (state hash diffing): https://bugnet.io/blog/how-to-debug-desync-in-deterministic-lockstep-games
- Preparing your game for deterministic netcode: https://yal.cc/preparing-your-game-for-deterministic-netcode/
- The Powder Toy hotkeys (pause, frame step, stamps): https://steamcommunity.com/sharedfiles/filedetails/?id=3269715263
- Falling-sand game overview: https://en.wikipedia.org/wiki/Falling-sand_game
- Noita falling-sand basis: https://noita.wiki.gg/wiki/Falling_Sand_Game
- Sandspiel repository: https://github.com/MaxBittker/sandspiel
- Affinity undo/history (Save History with Document): https://s3-eu-west-1.amazonaws.com/affinity-docs/help/photo/en-US.lproj/pages/DesignAids/undo.html
- Photoshop History panel: https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html

**Paint-with-words ML tools (MEDIUM)**
- NVIDIA Canvas GauGAN2 update, Jan 2022 (materials, styles, 1K, PSD export, RTX): https://blogs.nvidia.com/blog/studio-canvas-update-gaugan2-ces
- NVIDIA Canvas FAQ (fetch blocked 403; availability confirmed via search): https://nvidia.custhelp.com/app/answers/detail/a_id/5105/~/nvidia-canvas-faq
- eDiff-I project page (paint with words, style transfer, expert denoisers; 2022): https://research.nvidia.com/labs/cosmos-lab/ediff-i/
- Paint-with-words community implementation: https://github.com/cloneofsimo/paint-with-words-sd
- SpaText (CVPR 2023): https://omriavrahami.com/spatext/

**Input platform (MEDIUM for spec; LOW for current Chromium-on-macOS pen behavior)**
- W3C Pointer Events (pressure, tilt, getCoalescedEvents, getPredictedEvents): https://w3c.github.io/pointerevents/
- MDN PointerEvent: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent
- MDN pointerrawupdate: https://developer.mozilla.org/docs/Web/API/Element/pointerrawupdate_event
- Chrome pointer events introduction: https://developer.chrome.com/blog/pointer-events
- Historical macOS pen-as-mouse report (Firefox; Chrome behavior needs local verification): https://bugzilla.mozilla.org/show_bug.cgi?id=1304904

**Node-based procedural tools (MEDIUM, background only)**
- Substance Designer node cleanup, Dec 2025: https://digitalproduction.com/2025/12/15/substance-designer-cleans-up-its-nodes/
- TouchDesigner Substance TOP: https://docs.derivative.ca/Substance_TOP

**Gaps and things not verified**
- Corel Painter's individual particle controls (Count, Chaos, Damping, Stiffness) come from training memory; the help page for common controls returned 404. LOW.
- Whether Chromium/Electron on current macOS reports Wacom pens as `pen` with tilt: not verified by any current source found; must be tested locally.
- Falling-sand game determinism and rewind: no source documents it; treated as absent.
- NVIDIA Canvas current version/status: search indicated still downloadable in 2026 but the FAQ could not be fetched. LOW.

---
*Feature research for: node-based deterministic drawing program (Data Drawing milestone 1)*
*Researched: 2026-09-22*
