# Pitfalls Research

**Domain:** Deterministic fixed-point particle simulation with replay and scrubbing, driven by a pressure pen inside an Electron plugin, journaled through Tapestry's `.tree` kernel, later rendered by a local diffusion model
**Researched:** 2026-09-22
**Confidence:** MEDIUM overall. Local-codebase facts (kernel ids, `.tree` value types, Electron window setup) are HIGH from direct inspection. Numeric-determinism and Chromium input claims are MEDIUM: each was cross-checked against at least two independent sources (the `classify-confidence` seam rates a single web result LOW and a cross-checked one MEDIUM). Nothing below was tested on this Mac; the phase mapping tells you where to test it.

Phase names used below are proposals for the first milestone's roadmap (sim core plus painting frontend). The roadmap may renumber them; the ordering constraints are the point.

| Proposed phase | Scope |
|---|---|
| **P1 Numeric foundation** | Fixed-point type, PRNG, integer sqrt/trig, state hash, cross-build determinism harness |
| **P2 Sim core** | Node model, strictly ordered step, spring-damper brush body, one living material |
| **P3 Action model and kernel integration** | Stroke action schema in `.tree`, action and node identity, tick coalescing, readability test |
| **P4 Replay and timeline** | Scrub, reverse, speed, save/reopen hash verification, ephemeral keyframes |
| **P5 Painting plugin and pen input** | Electron pointer capture, quantization at the boundary, plane projection, camera |
| **P6 Placeholder renderer and feel tuning** | Deterministic rasterizer, brush cursor, latency budget |

## Critical Pitfalls

### Pitfall 1: A float leaks into the authoritative path through a side door

**What goes wrong:**
The sim core is declared fixed-point, and it is, but a `double` slips in somewhere that still decides state: the pen sample is quantized differently on two runs; a brush constant is written as `0.1` and converted at runtime; the 3D plane projection runs in the frontend's float math and its result is what gets recorded; the `.tree` stores a position as `real` (the kernel's `real` is a `double` formatted with `std::to_chars`, see `tapestry/kernel/Value.hpp`); or the sim is written in TypeScript where every `number` is a double and a 64-bit fixed-point product silently loses low bits above 2^53. Any one of these makes "bit-identical" false while every test that hashes the C++ core still passes.

**Why it happens:**
The boundary between "input" and "state" is fuzzier than the architecture diagram. Quantization, projection, and serialization all look like plumbing, not simulation, so nobody applies the numeric rule to them.

**How to avoid:**
- Define one quantization function at the input boundary (`pressure_u16 = round(pressure * 65535)`, positions to the fixed-point grid) and record its integer outputs in the action. Replay reads the integers; it never re-quantizes.
- Record plane-local stroke coordinates plus the plane pose as fixed-point integers at record time. Projection from screen space happens once, on the live machine, and its result is the action. Replay never re-projects.
- In `.tree`, write sim quantities as `int` with the scale declared once in the brush or stroke type (`position.x int 1234567` with a documented Q-format), never as `real`. The kernel's `real` type is for other plugins.
- If any part of the sim runs in JS/TS or WASM, keep every fixed-point value and every intermediate inside 2^53, or use `BigInt`/`Math.imul` deliberately. Prefer a C++ core compiled once and reached through the kernel bridge, so there is exactly one implementation.
- Brush constants are integers in the brush version. No literal `0.1` anywhere in the sim target; grep for `double`, `float`, `sqrt(`, `sin(` in the sim directory and fail CI on hits.

**Warning signs:**
`real` appears in a stroke or node line of a `.tree`; the sim target links libm; a TypeScript file under the sim module contains arithmetic on `number`; hashes match across replays on one build but differ after save/reopen.

**Phase to address:** P1 (type and boundary rules), enforced in P3 (schema) and P5 (input quantization).

---

### Pitfall 2: Fixed-point arithmetic that is deterministic but wrong, or undefined

**What goes wrong:**
Fixed-point removes float nondeterminism and introduces its own failure modes: a Q32.32 multiply overflows its 64-bit intermediate and wraps; signed overflow is undefined behaviour in C++, so the optimizer is entitled to assume it cannot happen and the `-O2` build diverges from `-O0`; division truncates toward zero while arithmetic shift rounds toward negative infinity, so mixing them produces asymmetric drift around zero; `sqrt` and `sin` are "ported" by calling libm on a converted double, reintroducing the libm-version dependency Box2D v3 and Bruce Dawson both document; and a normalized direction vector of a near-zero velocity divides by zero or explodes.

**Why it happens:**
Fixed-point tutorials show the happy path (`(a * b) >> 16`). The range analysis, rounding policy, and transcendental replacements are the actual work and are easy to defer.

**How to avoid:**
- Pick the format from range analysis, not habit: world extent, velocity ceiling, and the largest product in the integrator. With a 64-bit state type use `__int128` intermediates (Clang on arm64 and x86-64 both support it); with a 32-bit state type use 64-bit intermediates. Write the widening helper once and forbid raw `*` on the fixed type.
- Compile the sim target with `-fwrapv` (or use explicit wrapping/saturating helpers) so overflow is defined, and run UBSan in tests to find it anyway.
- One rounding rule, documented, used everywhere: round-half-even or floor, but not both. Divisions go through a helper that applies it.
- Integer Newton square root with a fixed iteration count (not "until converged"), LUT plus linear interpolation or CORDIC for sin/cos/atan2 with the table size baked into the sim version. Cross-check against a double reference in tests for accuracy, never call the double version at runtime.
- Dead zones: define `|v| < epsilon` behaviour for normalization, spring rest, and settling explicitly.
- Hash the state after every tick in the determinism harness and compare across `-O0`, `-O2`, `-O3`, Debug and Release, and arm64 versus x86-64 (Rosetta is enough to start). Box2D's golden-hash approach is the model.

**Warning signs:**
A particle jumps across the world (wraparound); settling never reaches rest (rounding bias); Release hash differs from Debug hash; `sqrt(` or `std::sin` in the sim tree.

**Phase to address:** P1.

---

### Pitfall 3: Ordering nondeterminism that no numeric policy can fix

**What goes wrong:**
The integrator is bit-exact, yet two replays diverge because the sim iterated an `std::unordered_map`, sorted particles with `std::sort` on equal keys, keyed a spatial hash by pointer (ASLR changes the order every launch), built neighbour lists from an unordered container, used a thread pool for the force pass, or reduced forces in whichever order threads finished. Deletion followed by vector compaction reorders survivors. In JS, object key order for integer-like keys is numeric while `Map` is insertion-ordered, and the two get mixed.

**Why it happens:**
Order dependence is invisible when there is one machine, one run, and no deletions. It appears with the first fork, the first deleted stroke, or the first parallel-for added for performance.

**How to avoid:**
- Every collection the sim iterates is either a vector in stable id order or a container whose iteration order is defined by the sim (a sorted vector, a btree). `unordered_*` is banned from the sim target.
- Neighbour queries return results sorted by stable node id before any force is accumulated. Force accumulation order is the id order, and the reducer is documented.
- `std::stable_sort` with a total order that ends in the stable id. Never compare pointers.
- No threads in the sim for this milestone. If parallelism is added later, partition by id range and reduce in id order; verify with the golden hash across worker counts as Box2D does.
- Deletions tombstone or compact by a rule that depends only on ids.

**Warning signs:**
A test that runs the sim twice in one process passes but two separate processes disagree (ASLR); adding a delete to a scenario changes downstream hashes; a "performance" commit changes any golden hash.

**Phase to address:** P2 (container policy), re-verified in every later phase by the harness from P1.

---

### Pitfall 4: Seeded randomness that is not actually reproducible

**What goes wrong:**
"Seeded randomness only" is satisfied on paper with `std::mt19937` plus `std::uniform_int_distribution`, but the C++ standard leaves distribution algorithms implementation-defined, so libstdc++, libc++ and MSVC yield different sequences from the same seed. One global stream is shared by the sim, the placeholder renderer's jitter and (later) procedural spawning, so drawing a preview consumes draws and shifts every subsequent particle. Draw order is coupled to iteration order, so Pitfall 3 also corrupts randomness.

**Why it happens:**
"Seeded" reads as "deterministic". The standard library's contract only covers the engine, not the distributions, and nobody expects the renderer to touch the sim's stream.

**How to avoid:**
- Implement the PRNG in the sim (PCG32, xoshiro, or splitmix64: a few lines, no library) with your own range reduction and your own fixed-point uniform. Version it as part of the sim version.
- Per-entity streams derived from `(root seed, stream purpose, stable id)` so a node's randomness does not depend on how many other nodes drew before it. This is also what makes later procedural spawning (`(tile coords, depth)` seeds) and branch-local draws stable.
- The renderer, the preview, and any UI jitter derive their own seeds from a hash of sim state; they never hold a sim stream.
- Serialize stream state in any snapshot (Tapestry's ARCHITECTURE.md already requires "random-stream state" in snapshots).

**Warning signs:**
`#include <random>` in the sim target; a rendered preview changes sim hashes; a hash differs only after a material with randomness is introduced.

**Phase to address:** P1.

---

### Pitfall 5: Time leaks: wall clock, frame cadence, and input timestamps steering the sim

**What goes wrong:**
The sim never calls the clock, but the frontend does: it advances "as many ticks as elapsed since last frame", applies a stroke sample "now", and the tick a sample lands on depends on how fast the machine ran that day. Recorded as ticks it is reproducible; recomputed from `event.timeStamp` on replay it is not. The subtler variant: the frontend applies an action to the live sim at tick T while the kernel records it at tick T+1 because the advance commit and the action commit raced, so live state and replayed state disagree by one tick from then on.

**Why it happens:**
Real-time apps drive simulation from frame time. The kernel's `advance` and the plugin's action are two commits with no atomic pairing unless designed.

**How to avoid:**
- Define the contract: an action applies at the start of the tick named in its commit header, before that tick's physics. The plugin computes the target tick, submits the action stamped for it, and only then lets the live sim step into that tick. If the kernel rejects or reorders, the live sim rewinds to the recorded truth (it can, because keyframes exist, see Pitfall 8).
- Samples carry `(tick, index within tick)` as recorded integers. Sub-tick ordering is by index, never by timestamp. `event.timeStamp` may be stored for audit but is never an input to replay.
- The sim exposes `step()` with no arguments; ticks-per-frame is a frontend policy that only ever changes how many times `step()` is called, never what it does.
- Do not commit one `advance 1` per tick. At 60 ticks/s that is 216,000 commits per hour in a file meant to be read by a person. Advance lazily: commit `advance n` only immediately before an action that needs a later tick, and once on save or idle timeout so a living material's elapsed time is preserved. The `.tree` format already states that "two edits in a row without an advance between them carry the same tick", so gaps are legal.

**Warning signs:**
`performance.now`, `Date.now` or `requestAnimationFrame` referenced anywhere that computes a tick that gets recorded; replay of a session recorded on a slow day differs from live; the journal grows while the user is idle.

**Phase to address:** P3 (tick contract and coalesced advance), verified in P4.

---

### Pitfall 6: Committing derived state, or raw input, without deciding which is which

**What goes wrong:**
Two opposite mistakes, both fatal to the readable journal. First, committing per-node state (positions after settling, spring-lagged brush positions, smoothed pressure) turns the `.tree` into a database dump that explodes in size and freezes the sim's current behaviour into history. Second, committing only the frontend's smoothed output (a "nice" polyline) instead of raw samples discards the pen's real motion, so the spring-damper feel cannot be re-simulated, brush versions cannot be re-applied, and the stroke can never be edited as an object with the fidelity the core value promises.

**Why it happens:**
The first is convenient for scrubbing; the second is what every conventional drawing app stores.

**How to avoid:**
- The stroke action records raw, quantized pen samples (position on the plane, pressure, tilt when present, tick, index) plus the brush version reference and plane pose. Nothing the sim computes is ever committed.
- The spring-damper brush body and any smoothing live in the sim and read their parameters from the brush version. Changing feel means a new brush version; old strokes keep the old one.
- Budget the raw samples: a 240 Hz pen for one hour is about 864k samples. At roughly 30 bytes per sample as readable text that is tens of megabytes, acceptable but worth a compact per-stroke block encoding (one `samples` text block per stroke, one sample per line) rather than one `set` line per field per sample. Quantize tilt and pressure to what the driver actually delivers (typically 10 to 13 bits) so the text stays short.
- Write the readability test now: a person opens the `.tree`, finds a stroke, its brush description, tick, and branch, without Data Drawing. Tapestry's `readability` suite regenerates `example.tree` byte-for-byte; add a `data-drawing` example the same way.

**Warning signs:**
A `set` line for a node the user never touched; the journal grows during scrubbing or idle simulation; a brush edit changes the hash of an old branch; stroke lines contain values with more precision than the pen delivers.

**Phase to address:** P3.

---

### Pitfall 7: Action and node identity that has to be renumbered when branching arrives

**What goes wrong:**
Particles receive ids from a counter incremented during replay. On `main` this is deterministic. When Tapestry Phase 3 forks at tick t and inserts a stroke earlier than an existing one, every particle after the fork gets a different number on the new branch, so "edit this node later" resolves to a different object per branch, cross-branch comparison is meaningless, and any cached keyframe keyed by id is silently wrong. The same happens if the action's identity is its commit `seq` or its digest: a fork with a different `message` shifts both.

**Why it happens:**
Counters are the obvious id source and Phase 3 is out of scope, so nothing exercises the failure until it is expensive.

**How to avoid:**
- The action's identity is the kernel node id of the stroke node (`n42`, or `b2.n42` after a fork; the format guide already reserves branch-tagged ids and never reuses ids). Not `seq`, not the digest, not a UUID minted by the frontend.
- Particle ids are derived, not allocated: `(stroke node id, sample index, spawn index)` packed into a 64-bit key, or a hash of that tuple. Two branches that share a stroke share its particles' ids; a branch that adds a stroke adds new ids without touching old ones.
- Procedurally spawned nodes (milestone 6) follow the same rule with `(tile coords, depth, seed)` in place of the stroke id. Decide the key layout now so the field can be reserved.
- Never let the frontend hold particle ids across a replay boundary without re-deriving them.

**Warning signs:**
A `next_particle_id` counter in the sim; ids that change when a scenario inserts a stroke in the middle; frontend code that indexes particles by array position.

**Phase to address:** P3, with a test in P4 that replays two logs differing by one inserted stroke and checks that shared particles keep their ids.

---

### Pitfall 8: Scrubbing by replay-from-start with no cache at all

**What goes wrong:**
"Snapshots are Phase 3" is read as "no keyframes of any kind", so reverse playback becomes a full replay per frame. Cost is O(ticks x nodes) per scrub: ten minutes at 60 ticks/s is 36,000 ticks; with 20k particles that is 7 x 10^8 particle-steps for each frame of reverse. The timeline feels broken long before the first material is interesting.

**Why it happens:**
Snapshots-as-persisted-artifacts and keyframes-as-a-RAM-cache are conflated. The former needs Phase 3's compatibility and hashing rules; the latter is a private optimization.

**How to avoid:**
- Keep ephemeral in-memory keyframes every N ticks (N tuned by measurement), keyed by `(branch, tick, sim version, brush versions)`, discarded on any change to the log prefix. They are never written to disk and never become the source of truth; once Phase 3 lands its snapshot contract, they become that contract's cache.
- Verify the cache with the hash: replaying from a keyframe must produce the same per-tick hash as replaying from tick 0, checked in tests and occasionally at runtime.
- Make the headless sim fast in absolute terms and measure it: target and record ticks per second at a representative particle count in P2, and treat regressions as bugs.
- Keep the sim's canonical state serializable in P2 (a byte-exact, endian-defined form) so a keyframe is a memcpy-free copy today and a Phase 3 snapshot tomorrow.

**Warning signs:**
Scrub latency scaling with session length; reverse playback frame rate below 30 at five minutes of history; keyframe code that writes to disk.

**Phase to address:** P4, with the serializable state form from P2.

---

### Pitfall 9: Chromium's pen pipeline throws away or misreports samples

**What goes wrong:**
Since Chrome 60, `pointermove` is aligned to the animation frame, so a 240 Hz pen produces about 60 dispatched events per second and three of every four samples vanish unless `getCoalescedEvents()` is read. Mouse input reports `pressure` 0.5 while a button is held, some touch devices report 0, so `width = base * pressure` gives half-width mouse strokes and invisible touch strokes. React's synthetic event wrapping, per-event state updates, and a rAF throttler stacked on top of Chromium's own alignment each add latency or drop coalesced data. Hover (pen in proximity, `buttons === 0`) fires `pointermove` and gets painted. Without `touch-action: none` the browser claims pan/zoom gestures mid-stroke. Palm touches arrive as separate `touch` pointers because Chromium provides no palm rejection. Tilt sign conventions vary by browser and driver (Firefox on macOS inverts `tiltY`; Chrome reports it correctly). Electron on macOS has a history of Wacom input simply not arriving (electron/electron#7815, never root-caused).

**Why it happens:**
Web input APIs are designed for scrolling and clicking; drawing is the edge case, and each of these behaviours is documented in a different place.

**How to avoid:**
- Attach a native (non-React) listener on the painting canvas; iterate `event.getCoalescedEvents()` on every `pointermove`; never dispatch synthetic pointer events into that path (Chromium returns an empty coalesced list for them).
- Only paint when `pointerType === 'pen'` (fall back to mouse behind an explicit setting) and `buttons & 1`. Use `setPointerCapture` so strokes survive leaving the canvas. Set `touch-action: none` on the canvas. Ignore `touch` pointers while a pen is active; that is the palm-rejection policy for this milestone.
- Treat pressure 0 with a pen as a real sample (lift-off) and mouse 0.5 as "no pressure sensor": record a `pressure_source` flag on the stroke so replay does not guess.
- Record tilt raw as delivered and mark it best-effort; do not let any sim rule depend on tilt until the driver on this Mac is confirmed to report it.
- `pointerrawupdate` is optional: it needs a secure context (Electron's `file://` and the dev server's `localhost` both qualify, and the app loads via `loadFile`), may itself be coalesced, and MDN warns that a handler that cannot keep up makes the app feel slower. Start with coalesced `pointermove`; measure before adopting `pointerrawupdate`.
- Verify the actual device on this Mac in the first input session: pressure range, tilt presence and sign, sample rate (count coalesced events per second), and whether the Wacom driver's per-app pressure setting or macOS input-monitoring permission is required. Write the numbers down in the phase's verification.

**Warning signs:**
Straight-line segments in fast strokes (dropped samples); strokes that start before the pen touches; half-width strokes with a mouse; stroke ends at the wrong place after leaving the canvas; a `React.PointerEvent` in the stroke path.

**Phase to address:** P5.

---

### Pitfall 10: Brush feel that is either laggy or unstable, and cannot be tuned because it is not in tick units

**What goes wrong:**
The mass-on-a-spring brush is integrated with explicit Euler at a stiff spring constant and oscillates or blows up at the fixed timestep; or it is tuned to feel good and then lags so far behind the pen that the stroke end never reaches the pen-up point (Krita's stabilizer needs a dedicated "finish line" option for exactly this). Tuning is done in seconds against a variable frame rate, so the feel changes when ticks-per-frame changes. Latency stacks: Chromium's frame alignment, a rAF throttler, React state, IPC to the kernel, then the spring lag, and the user sees the mark land two or three frames late with no indication where the brush body currently is.

**Why it happens:**
Spring-damper is simple to write and hard to make stable at a fixed dt in integers; stabilizers and physical lag look the same to the user but have different remedies.

**How to avoid:**
- Semi-implicit (symplectic) Euler in fixed point, with stiffness and damping expressed per tick and clamped to the stable region for the tick rate. Assert stability bounds in the brush version validator.
- On pen-up, run the brush body to rest deterministically over a bounded number of ticks (the finish-line behaviour) so the stroke always terminates at the last sample; record nothing extra, it is derived.
- Draw the brush body's current position as a cursor in the placeholder renderer so lag reads as weight, not bugginess. This is what Lazy Nezumi's pulled string and Krita's two-circle cursor do.
- Keep the input path off React state and off IPC round trips: samples go straight to the local sim; the kernel commit is asynchronous and reconciled (Pitfall 5).
- Do not add a separate stabilizer in the frontend for this milestone. Mass is the stabilizer. If light brushes feel jagged, that is a brush-version parameter, not a second smoothing system.

**Warning signs:**
Oscillating or exploding brush position for heavy brushes; stroke ends short of the pen-up position; feel changes with window size or with speed-up playback; more than one smoothing implementation.

**Phase to address:** P2 (integrator and stability), P6 (cursor, latency budget).

---

### Pitfall 11: Letting the render tier touch the sim, or promising image-level reproducibility

**What goes wrong:**
The diffusion render is nondeterministic across hardware and often on the same hardware: Hugging Face's reproducibility docs state that cross-hardware reproducibility is not guaranteed because GPU matmul is less deterministic than CPU and seeds are not portable across GPU architectures; on Apple MPS, PyTorch has open nondeterminism issues (dropout, training) and diffusers needed CPU generators and a warm-up pass because the first pass differed from later ones. If any sim quantity (a spawned node's placement, a material's colour-driven behaviour, a "looks done" flag) reads from the render, sim reproducibility dies with the render's. The softer failure is the promise: the brief's invariant 1 says identical output "at every zoom", and if that is read to include pixels across machines it cannot be kept.

**Why it happens:**
The render is the visible product, and it is tempting to close feedback loops through it.

**How to avoid:**
- Direction of dependence is one way: render key = hash(node field region, brush versions, model pin, seed derived from sim state). The sim never receives a render input, ever. Enforce it structurally: the sim module has no reference to the renderer, and the renderer's API takes an immutable snapshot.
- Reword the reproducibility promise now: bit-identical node state everywhere; byte-identical tiles only on pinned model plus pinned hardware, otherwise a recorded outcome. Tapestry HIST-05 already says recorded model outcomes replay without a live model; adopt that for tiles and decide storage in the render milestone.
- The placeholder renderer for this milestone is deterministic and CPU/integer-based so it can also serve as the reference for "the sim is visible without any model".

**Warning signs:**
Any sim struct with a colour, an image, or a tile reference; a test that needs a GPU; a document that says "identical image".

**Phase to address:** P6 for the boundary; the render milestone for storage policy.

---

### Pitfall 12: The numeric contract diverges from Tapestry Phase 3 and the sim state is left out of hash-verified replay

**What goes wrong:**
Tapestry's roadmap promises replay "within the declared engine/numeric compatibility envelope" (ROADMAP.md, Phase 3 success criterion 3). Phase 3 hashes kernel graph state; if Data Drawing's sim state is not part of what that hash covers, a snapshot can be "verified" while the particle field it implies is wrong, and forking at a tick can restore kernel nodes without the sim's canonical state. Conversely, if Data Drawing declares bit-identity and Phase 3 declares tolerance, the two systems will make different decisions about what counts as a corrupt snapshot.

**Why it happens:**
Two planning tracks, one not yet planned. PROJECT.md already flags the conflict.

**How to avoid:**
- Define the sim state hash (canonical byte form, endian-defined, fast non-cryptographic hash per tick for tests, SHA-256 at commit or snapshot boundaries) in P1 and expose it through the plugin API as the plugin's contribution to any snapshot key.
- Pin a sim version, PRNG version, and fixed-point format id in the `.tree` header extension lines (`x-` lines are kept verbatim by the format), so Phase 3's "compatibility envelope" can be exact for this plugin.
- Raise the envelope wording with Tapestry Phase 3 planning before it is written: for plugins that declare bit-identity, the envelope is "identical or invalid".

**Warning signs:**
A Phase 3 plan that hashes only kernel nodes; a snapshot that loads with no sim version check; a tolerance parameter anywhere in Data Drawing.

**Phase to address:** P1 (hash and version pins), P3 (header lines), and a note into Tapestry Phase 3 discussion.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Write the sim in TypeScript alongside the plugin | One language, fast iteration | Doubles everywhere; 64-bit fixed point needs BigInt; a second implementation appears when C++ is wanted for speed | Never for authoritative state. A TS viewer of C++ state is fine |
| `double` "just for the constant" or "just for the LUT generation at startup" | Fewer integer literals | Startup values differ by libm version; the LUT differs per machine | Only in an offline generator whose output is committed as integers |
| One global PRNG stream | Simple | Every new consumer shifts every later draw; procedural spawning becomes impossible to keep stable | Never |
| Counter-allocated particle ids | Trivial | Renumbering on the first fork; cached keyframes keyed wrongly | Never; derive from action identity from day one |
| Commit `advance 1` per tick | Matches kernel semantics literally | Journal growth of hundreds of thousands of commits per hour | Never; coalesce advances |
| Frontend smoothing before recording | Feels good immediately | Raw motion lost; brush feel not re-simulatable; strokes not editable objects | Never; smoothing belongs in the brush version inside the sim |
| Skip cross-build determinism CI (Debug vs Release, -O levels) | Faster CI | Undefined-behaviour divergence found after months of history exist | Only until P1 ends |
| Ephemeral keyframes written to disk "temporarily" | Faster reopen | Becomes a second snapshot format that conflicts with Phase 3 | Never; keep them in RAM until Phase 3 defines the contract |
| Tune brush feel in seconds at whatever the frame rate is | Fast tuning loop | Feel changes with ticks-per-frame; parameters cannot be versioned meaningfully | Never; tune in ticks |
| Fixed 60 Hz tick chosen by default | Familiar | Changing tick rate later invalidates every recorded tick; pen samples at 240 Hz then map four-to-one | Acceptable if chosen deliberately; consider a rate that divides the pen's sample cadence and record the decision |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Tapestry kernel commits | Treating `seq` or the commit digest as the action's identity | Use the stroke's kernel node id (`n<k>`, branch-tagged after Phase 3) |
| Tapestry kernel `advance` | One commit per tick | Lazy `advance n` before actions and on save/idle; the format allows repeated ticks without advances |
| `.tree` value types | Writing fixed-point as `real` | Write `int` with the Q-format declared once in the brush or stroke type |
| `.tree` `int` in a JS reader | Parsing int64 into `number` | Keep magnitudes below 2^53 by format choice, or parse as BigInt in the frontend |
| Plugin API (sandboxed renderer, `contextIsolation: true`, `sandbox: true` in `app/src/main/index.ts`) | Running the sim in the renderer and shipping state over IPC per tick | Sim runs where the kernel bridge can drive it deterministically; the renderer receives read-only snapshots at frame rate |
| Chromium pointer events | Reading only the dispatched `pointermove` | Iterate `getCoalescedEvents()`; native listener on the canvas; `touch-action: none`; pointer capture |
| Chromium `pressure` | Using the value blindly | 0.5 with a mouse button means no sensor; record a pressure-source flag |
| Wacom on macOS | Assuming tilt exists and has a fixed sign | Record raw, mark best-effort, verify on this Mac before any rule depends on it |
| Wacom on macOS in Electron | Assuming pen events arrive at all | Test on day one of P5 (electron/electron#7815 history); check driver permissions and per-app pressure setting |
| Diffusion render (later) | Feeding render output into sim state or promising pixel identity across machines | One-way dependence; recorded tile outcomes; pinned model plus hardware for byte identity |
| Tapestry Phase 3 snapshots | Assuming kernel hashes cover sim state | Expose the sim state hash and version pins as the plugin's snapshot contribution |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Replay-from-start on every scrub | Scrub latency grows with session length; reverse playback stutters | Ephemeral RAM keyframes verified by hash; measured headless ticks per second | Around 5 minutes of history at 10k particles on this Mac (estimate; measure in P4) |
| O(n^2) neighbour search | Living material slows as strokes accumulate | Grid or sorted spatial index whose iteration order is by id | A few thousand interacting particles |
| SHA-256 of full state every tick | Sim throughput halves | Fast non-cryptographic per-tick hash in tests; SHA-256 only at commit/snapshot boundaries | Immediately at high tick rates |
| Per-sample `set` lines in the journal | Multi-megabyte files per session; slow reopen | Per-stroke sample block; quantized fields | An hour of drawing |
| Per-event React state update on pen input | Dropped coalesced samples; visible lag | Native listener, direct write into the sim's input queue | Any 200 Hz plus pen |
| IPC round trip per sample | Input latency of several frames | Batch samples per frame; local sim applies immediately; kernel commit asynchronous | Immediately |
| Placeholder renderer redrawing every node every frame on the CPU | Frame rate collapses with particle count | Dirty regions or WebGL/WebGPU point rendering; render reads a snapshot, never blocks the sim | Tens of thousands of nodes |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting `advance n` or sample counts from a `.tree` written elsewhere | A hostile file requests billions of ticks or samples and hangs the app | Bound `n` per commit and samples per stroke in the reader; reject, never clamp silently |
| Parsing fixed-point ints without overflow checks | Undefined behaviour from a crafted file | Checked parse into the declared range; the kernel's `parseNodeId` style (reject anything the writer would not produce) is the pattern |
| Brush descriptions as raw prompt text into the render tier (later) | Prompt injection into the diffusion pipeline via a shared `.tree` | Treat descriptions as data; the render milestone defines the escaping/conditioning path |
| Plugin bypassing the public API to poke sim state | Breaks the recorded-actions-only invariant and the Tapestry contract | Sim mutation only through the kernel's command path; the plugin has read-only snapshots |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Heavy brush lag with no visible brush body | Feels like input lag, not weight | Draw the brush body as a cursor; show the pulled distance |
| Stroke ends short of pen-up | Marks look unfinished | Deterministic finish-line settling over bounded ticks |
| Painting while scrubbed to a past tick silently appends at head, or silently drops | Confusing history | Until Phase 3 lands: block painting off-head with an explicit message, or jump to head on pen-down with a visible cue |
| Reverse playback of living materials | Rust un-spreads; users think it is broken | Label the timeline direction clearly; this is correct behaviour |
| Mouse strokes half width | "Pressure is broken" | Pressure-source flag; mouse maps to full width by default |
| Speed-up changing feel | Strokes drawn during fast playback behave differently | Painting is disabled during non-1x playback, or ticks-per-frame is reset to 1 on pen-down |
| Hover paints | Marks appear before touching | Paint only with `buttons & 1` |

## "Looks Done But Isn't" Checklist

- [ ] **Bit-identical replay:** Often verified only in one build config on one process. Verify Debug vs Release, `-O0` vs `-O2`, two separate processes (ASLR), arm64 vs x86-64 under Rosetta, and after save/reopen, with per-tick hashes not just the final one.
- [ ] **Fixed-point sim:** Often has a `double` in LUT generation, constant conversion, or projection. Grep the sim target for `double`, `float`, `<cmath>`, `<random>`, `unordered_`; all must be absent.
- [ ] **Seeded randomness:** Often uses standard-library distributions. Verify the PRNG and range reduction are project code and per-entity streams exist.
- [ ] **Actions are the only source of change:** Often the frontend applies a stroke to the live sim on a tick the kernel did not record. Verify live-state hash equals replayed-state hash at every commit boundary.
- [ ] **Readable `.tree`:** Often per-node `set` lines or `real` values sneak in. Verify a golden `data-drawing` example file regenerated byte-for-byte, and that a person can identify stroke, brush description, tick and branch from the text.
- [ ] **Scrubbing:** Often works for a 30-second session only. Verify at a recorded 10-minute session with the target particle count; reverse playback frame rate is measured.
- [ ] **Pen input:** Often tested with a mouse. Verify coalesced sample rate, pressure range, tilt presence and sign with the actual tablet on this Mac, and that strokes survive leaving the canvas.
- [ ] **Brush feel:** Often tuned at one frame rate. Verify identical stroke geometry at 1x and 4x ticks-per-frame from the same recorded samples.
- [ ] **Living material:** Often changes state while the user idles without an `advance` being recorded on save. Verify reopen reproduces the settled state.
- [ ] **Identity across insertion:** Often untested until Phase 3. Verify that two logs differing by one inserted stroke keep ids for the shared strokes' particles.
- [ ] **Render independence:** Often the placeholder renderer holds a sim reference. Verify the sim target has no renderer include and the renderer takes an immutable snapshot.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Float leaked into recorded actions | HIGH | Cannot fix old files' values; bump sim version, quarantine old branches as read-only "legacy numeric" and re-record |
| Undefined-behaviour overflow found late | MEDIUM | Add `-fwrapv`/helpers; old histories replayed with the old binary become the recorded truth; new sim version for new branches |
| Order nondeterminism discovered after history exists | HIGH | Define the order, bump the sim version, mark old branches as reproducible only with the old build (Tapestry's "explicit unavailable state") |
| Counter-based ids shipped | HIGH | Introduce derived ids as a new sim version; write a one-time migration that maps old ids on `main` only; branches created before migration cannot be re-keyed reliably |
| Per-tick `advance` commits shipped | MEDIUM | Files stay valid; coalesce going forward; optionally offer a lossless rewrite tool that merges consecutive advances into a new file with a new header |
| Per-node state committed | HIGH | Stop committing; derived lines become dead weight in old files; new files start clean |
| Frontend smoothing recorded instead of raw | HIGH | Old strokes keep the recorded polyline as their "raw" input under a brush version with zero mass; new strokes record raw |
| Scrubbing too slow | LOW | Add ephemeral keyframes; no file change |
| Pen samples dropped | LOW | Switch to coalesced events; old strokes stay as recorded |
| Spring instability | LOW | Clamp parameters in a new brush version; old strokes keep the old version's behaviour |
| Render leaked into sim | HIGH | Remove the dependency and bump sim version; states that depended on renders are not reproducible and must be marked so |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Float leak through side doors | P1, enforced in P3 and P5 | Grep gate on the sim target; `.tree` golden file contains no `real` on stroke or node lines; save/reopen hash equality |
| 2 Fixed-point overflow, UB, rounding, transcendental ports | P1 | Cross-build and cross-arch per-tick hash equality; UBSan clean; accuracy tests against a double reference |
| 3 Ordering nondeterminism | P2 | Two-process hash equality; scenario with deletes; `unordered_` absent |
| 4 Randomness not reproducible | P1 | `<random>` absent; per-entity stream test: adding an unrelated node does not change another node's draws |
| 5 Time leaks and tick contract | P3, verified P4 | Live hash equals replayed hash at every commit; journal size constant while idle; no clock calls in tick computation |
| 6 Derived state or smoothed input committed | P3 | Golden `.tree` review; brush-version change does not alter old-branch hashes |
| 7 Identity not branch-stable | P3, tested P4 | Insert-a-stroke test keeps shared particle ids; no id counter in the sim |
| 8 Scrub without cache | P4 (state form from P2) | Measured scrub latency at 10 minutes of history; keyframe-vs-from-zero hash equality |
| 9 Chromium pen pipeline | P5 | Coalesced sample rate measured; pressure-source flag; pen-only painting; capture survives leaving canvas; device facts recorded |
| 10 Brush feel stability and lag | P2 (integrator), P6 (cursor, latency) | Stability bound assertions; identical geometry across ticks-per-frame; finish-line test |
| 11 Render touches sim | P6 boundary; render milestone policy | No renderer include in sim; reproducibility promise reworded in PROJECT.md |
| 12 Numeric contract vs Tapestry Phase 3 | P1 hash and pins; P3 header lines | Sim hash exposed via plugin API; note filed into Tapestry Phase 3 discussion |

## Later-Milestone Risks to Design Around Now

| Later milestone | What must exist in this milestone | Why |
|---|---|---|
| Branching (Tapestry Phase 3) | Derived particle ids (Pitfall 7); sim state hash and version pins (Pitfall 12); canonical serializable sim state (Pitfall 8) | Forks share prefixes; anything keyed by replay order or missing from the hash breaks on the first fork |
| Snapshots (Phase 3) | Serializable canonical state including PRNG streams; keyframe-vs-replay hash test | Snapshots must be verifiable, and Tapestry requires random-stream state in them |
| Model render (milestone 5) | One-way dependence; render key derived from sim state; reproducibility promise scoped to state | Cross-hardware image identity is not achievable; the sim must never wait for or read the render |
| Tile tree and infinite zoom (milestone 6) | Scale band recorded on nodes; per-entity seeds from `(tile, depth)`; "viewing never changes the outcome" enforced by the sim having no view input | Procedural spawning and coarse-authoritative simulation both need seeds and ids that do not depend on what was looked at |
| Groups, bindings, materials (milestones 3 and 4) | Strict id-ordered reduction and a documented reducer for competing forces | Soft bodies and spreading materials multiply the order-dependence surface |

## Sources

Confidence tags follow the `classify-confidence` seam: a single web result is LOW; a claim cross-checked against a second independent source is MEDIUM; direct inspection of this repository is HIGH.

**Local (HIGH):**
- `/Users/kaelencook/Tapestry/tapestry/docs/tree/FORMAT.md` (value types, `advance` semantics, id rules, Phase 3 branch-tagged ids, `x-` extension lines)
- `/Users/kaelencook/Tapestry/tapestry/kernel/Ids.hpp`, `Time.hpp`, `Value.hpp` (uint64 ids, `real` is `double`, clock injected only at commit)
- `/Users/kaelencook/Tapestry/app/src/main/index.ts` (`contextIsolation: true`, `sandbox: true`, `loadFile` in production)
- `/Users/kaelencook/Tapestry/.planning/ROADMAP.md` Phase 3 wording ("engine/numeric compatibility envelope")
- `/Users/kaelencook/Tapestry/.planning/research/ARCHITECTURE.md` and `PITFALLS.md` (Tapestry-level determinism and snapshot requirements)

**Numeric determinism (MEDIUM, cross-checked):**
- [Gaffer On Games, Floating Point Determinism](https://gafferongames.com/post/floating_point_determinism/)
- [Bruce Dawson, Floating-Point Determinism](https://randomascii.wordpress.com/2013/07/16/floating-point-determinism/)
- [Box2D v3 determinism notes](https://deepwiki.com/erincatto/box2d/11.2-determinism)
- [Clang User's Manual, `-ffp-contract`](https://clang.llvm.org/docs/UsersManual.html); [KDAB, FMA Woes](https://www.kdab.com/fma-woes/); [ImageMagick #8265](https://github.com/ImageMagick/ImageMagick/issues/8265); [TISEAN #161](https://github.com/StefanCaldararu/TISEAN/issues/161)
- [CPP Cat, Deterministic Physics in C++](https://cppcat.com/deterministic-physics-engine/); [Deterministic Physics in TS](https://dev.to/shaisrc/deterministic-physics-in-ts-why-i-wrote-a-fixed-point-engine-4b0l); [shibukawa/fixmath](https://pkg.go.dev/github.com/shibukawa/fixmath)
- [Arthur O'Dwyer, `<random>` distributions are stateful](https://quuxplusone.github.io/blog/2019/10/22/psa-stateful-distributions/); [MSVC `<random>` docs](https://learn.microsoft.com/en-us/cpp/standard-library/random)

**Chromium and pen input (MEDIUM, cross-checked):**
- [Chrome for Developers, Aligned input events](https://developer.chrome.com/blog/aligning-input-events)
- [MDN, `getCoalescedEvents()`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents); [MDN, `pointerrawupdate`](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerrawupdate_event)
- [Reading Apple Pencil pressure in the browser, the `e.pressure` trap](https://dev.to/sendotltd/reading-apple-pencil-pressure-in-the-browser-pointerevent-getcoalescedevents-and-the-2e23)
- [Nolan Lawson, High-performance input handling on the web](https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/)
- [Nutrient, Smoother interactions with getCoalescedEvents](https://www.nutrient.io/blog/using-getcoalescedevents/)
- [Bugzilla 1822714, Firefox macOS Wacom tiltY inverted](https://bugzilla.mozilla.org/show_bug.cgi?id=1822714); [electron/electron#7815, Wacom input on macOS](https://github.com/electron/electron/issues/7815); [W3C pointer-events list, Chrome M58 tangential pressure and twist on Mac](https://lists.w3.org/Archives/Public/public-pointer-events/2017AprJun/0012.html)
- [Wacom support, pen pressure not working](https://support.wacom.com/hc/en-us/articles/1500006343962-Why-is-my-pen-pressure-not-working); [Wacom support, tablet on macOS](https://support.wacom.com/hc/en-us/articles/1500006343942-Why-is-my-tablet-not-working-on-Mac-OS)
- [Electron `protocol` docs, secure schemes](https://www.electronjs.org/docs/latest/api/protocol) (LOW: single source for `file://` being a secure context; verify `window.isSecureContext` in P5 before relying on `pointerrawupdate`)

**Brush feel (MEDIUM, cross-checked):**
- [Krita Manual, Freehand Brush Tool: stabilizer, delay, finish line](https://docs.krita.org/en/reference_manual/tools/freehand_brush.html)
- [Clip Studio ASK, stabilization request comparing Krita and Lazy Nezumi](https://ask.clip-studio.com/en-us/detail?id=46736); [Krita Artists, how the stabiliser works](https://krita-artists.org/t/how-does-stabiliser-in-krita-work/47797)

**Replay and snapshots (MEDIUM, cross-checked):**
- [Kurrent, Snapshots in Event Sourcing](https://www.kurrent.io/blog/snapshots-in-event-sourcing/)
- [Event Sourcing in Backend Systems: replays and trade-offs](https://thebackenddevelopers.substack.com/p/event-sourcing-in-backend-systems-3e7)
- [Theater mode: deterministic replays with scrubbing (Godoiosis #209)](https://github.com/Phaazoid/Godoiosis/issues/209)

**Diffusion reproducibility (MEDIUM, cross-checked):**
- [Hugging Face Diffusers, Create reproducible pipelines](https://huggingface.co/docs/diffusers/v0.16.0/en/using-diffusers/reproducibility); [Diffusers, MPS](https://huggingface.co/docs/diffusers/en/optimization/mps)
- [pytorch/pytorch#84516, Dropout nondeterministic on MPS](https://github.com/pytorch/pytorch/issues/84516); [pytorch/pytorch#97236, nondeterministic MPS training](https://github.com/pytorch/pytorch/issues/97236); [huggingface/diffusers#292 and PR #355, MPS warm-up pass](https://github.com/huggingface/diffusers/issues/292)

---
*Pitfalls research for: Data Drawing (deterministic fixed-point particle sim, pen-driven Electron plugin, Tapestry kernel journal)*
*Researched: 2026-09-22*
