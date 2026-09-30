---
name: spike-findings-tapestry
description: Implementation blueprint from spike experiments. Requirements, proven patterns, and verified knowledge for building Tapestry's thread rendering, the NPC-minds story world (Perihelion), and generative vectors (seeds, knots and rules grown into geometry and meshed into surfaces). Auto-loaded during implementation work.
---

<context>
## Project: Tapestry

**thread-rendering.** Tapestry's thread type (Kaelen, 2026-09-15; see `Tapestry Tales/Connections/Concept - Thread Type.md`) is a single growing note whose history is drawn as a line through the z-axis. The line gains a dot 60 times a second while live. Each typed letter sits at the point for the moment it was typed. Gaps show as time-out and time-in dashes. Old entries fade back and vanish, and a side view shows the whole thread left to right. These spikes tested whether that can be drawn at display refresh rate in Electron with legible text, before Phase 2.3 is planned.

Eleven spikes were run across three sessions on 2026-09-15, all on Kaelen's Apple M4 MacBook Air (60 Hz, 2560×1664, DPR 2) in the repo's Electron 32.3.3 / Chromium 128. The headline: **the thread is feasible.** Seven spikes validated outright, three landed partial with named fixes, one design was invalidated. The two open risks are both in the kernel and the atlas, not in the rendering.

**npc-minds.** Perihelion's NPCs (Kaelen, 2026-09-30) keep their minds in Tapestry worlds: facts, opinions with `because` reasons, voice samples and spoken lines as plugin node types, with a mind-sim model updating them and a speaker model turning a bounded context packet into a line. Four spikes (012, 013a/b, 014) ran on 2026-09-30 in a 4-core Xeon cloud container. The headline: **author one shared story world, ship per-NPC slices, and serve them from one localhost bridge that owns the file.** The kernel scales to a long game unchanged, and the context packet costs about 1 ms over HTTP. Local models are the unspiked piece.

**generative-vectors.** Kaelen's "Generative Vector Neural Rendering" note (2026-09-30): store the rules that make an object (a few seed vectors, knots that are relationships, and generative rules), not its geometry, and regrow detail at any resolution. Four spikes (015, 016a/b, 017) ran on 2026-09-30. The headline: **3 seeds and a 457-byte description grow a legible 3,765-vector tree that is deterministic, additive and local, and a narrow-band distance field turns it into one welded, watertight surface in 0.3–1 s, or tens of milliseconds for a region.** Surfaces are regenerated views, never stored. The neural-inference half of the note is unspiked.

Spike sessions wrapped: 2026-09-15 (thread-rendering), 2026-09-30 (npc-minds, generative-vectors)
</context>

<requirements>
## Requirements

All spikes wrapped in this session belong to one idea key, **thread-rendering**. These are non-negotiable design decisions that emerged from Kaelen's choices and from measured evidence while spiking it. Every feature-area reference honors these.

**Platform**
- Runs in Electron (the repo's Electron 32.3.3 / Chromium 128), not a plain browser (Kaelen, 2026-09-15)
- Holds 60 fps on Kaelen's machine (Apple M4 MacBook Air, 60 Hz built-in display)

**Thread geometry and load** (spike 001)
- Thread data is sessions and keystrokes, never per-dot records; dots are drawn procedurally from time × speed
- Multi-hour threads use hour-block times and a moving render origin to stay precise on float32 GPUs

**Glyph rendering** (spikes 002a/002b, 003a/003b, 007)
- Thread letters are instanced quads from one glyph atlas in a single draw call, never one text object per keystroke
- Thread letters stay sharp at every zoom the side view offers (Kaelen, 2026-09-15, Phase 2.3 D-19), which means MSDF glyphs from font files; a raster-derived SDF ripples when magnified
- Glyph generation runs off the main thread: an MSDF glyph costs ~8 ms, up to 22.6 ms
- Thread letters and the note typer use the same font files, or the same word looks like two typefaces
- Letters are grapheme clusters, not code points; colour emoji are bitmap cells in the same atlas, flagged per letter
- Joining scripts (Arabic) can't be read along the line, because each letter sits at its own keystroke time; the text window carries them
- Thread letters show a browser-SDF cell immediately and swap to an MSDF cell generated in a worker ~15 ms later; the swap costs 0.1 ms and satisfies D-19 without MSDF generation ever touching a frame
- Replacing a glyph's cell means rewriting every instance that already drew it, because `write()` snapshots quad/uv/dist per instance rather than referencing the cache
- Placeholder cells are rasterized across frames, never inside the paste transaction: 2000 never-seen graphemes cost 268 ms synchronously, while the same paste of cached glyphs costs under 10 ms
- The 1024-cell atlas needs real paging, not LRU eviction: under thrash every MSDF cell is discarded and evicted letters vanish from the line

**Editor and app integration** (spikes 004, 005)
- Letters are drawn from ProseMirror transaction steps, not key events, so typing, paste, undo and input methods all flow through one path, independent of the 300 ms save debounce
- Drawing a keystroke costs ~0.3 ms in the editor and lands within one frame at 40 keys/s over 8 h of history
- A large paste arrives as one transaction and lands as one cluster; it can cost a dropped frame only while its glyphs are new
- The thread is a full-window layer over the dimmed canvas, not a child of the canvas's transformed container, so CSS pan/zoom never touches it; the order is notes → scrim → thread → typer (D-09)
- D-09's dimming is load-bearing, not decoration: glyphs are drawn near-white, so a thread over the undimmed cream canvas is invisible
- Closing a thread must call `renderer.dispose()` **and** `renderer.forceContextLoss()`; dispose alone holds the context until GC and a browser allows only a handful
- The app and anything drawing thread letters must share one ProseMirror instance; two copies make a schema built by one unreadable to the other
- Thread letters need a per-instance colour channel for D-21's author strands; the shared glyph shader currently hardcodes near-white with no colour uniform

**Persistence and replay** (spikes 006, 008)
- Keystrokes are recorded as ordinary `set` properties, never `x-` extension lines: the codec supports extension lines but the addon's only path to the journal is `submit(ops)`
- Each keystroke's time offset is measured from its batch anchor, never from the previous keystroke; cumulative deltas re-accumulate rounding and drift with batch length
- Opening a world is quadratic in its commit count, because `Kernel::fromJournal`, `replayUpTo` and `submit` each copy the whole world per commit; threads are the first feature to make that visible
- The commit window is a user-facing tradeoff between crash exposure, file size and reopen time (⅓ s: 8.0 MB and 23 s at 8 h; 5 s: 1.2 MB and 237 ms) — Kaelen's call, not a silent default
- The document at a past moment is rebuilt in the renderer from keystroke records, never through the kernel's `replayUpTo`, which is quadratic in commit count
- Document snapshots every ~1000 edits are kept as derived data — 2.6 MB and 108 ms for an 8 h thread — so a scrub costs 0.2 ms and leaves the frame free for the thread's rendering
- Scrubbing must survive a real ProseMirror document, not just characters: formatting, links and passages have to rebuild too for D-18's read-only view (untested)

**Navigation and feel** (spike 011)
- Zoom is a span in seconds across the window, not a scale factor, so pixels-per-em falls out of it and "letters are readable here" is a threshold
- Session markers are drawn at a constant screen size, weighted by how much was written in them; that is what makes a zoomed-out thread read as planets rather than an empty line
- Gravity is suppressed while the user is moving the view and scaled by frame time, so it never fights the hand and does not pull twice as hard at 120 Hz
- The date scrubber carries the sessions themselves, not just a position: it is the only view where hours of gaps and sessions are visible at once
**NPC minds and the story world** (spikes 012, 013a/013b)
- Built on the generic kernel with plugin node types only; no kernel change for NPCs (Kaelen, 2026-09-30)
- The mind-sim and speaker roles run on local models, spiked on Kaelen's Mac rather than in the cloud (Kaelen, 2026-09-30)
- The shared story world is the source of truth; per-NPC slices in spike 012's schema are generated from it for runtime, never authored by hand
- Belief is a `believes` edge carrying confidence and source; canon is a bool on the fact, kept apart from belief
- Queries walk outward from the speaker and index edges in one pass; scanning the world per query is quadratic
- A mind is served only when its journal status is Ok; a torn or hand-edited file opens with only its verified prefix
- Spoken lines are recorded outcomes; replay never asks a model again

**The mind bridge** (spike 014)
- One process owns a story world; the journal lock refuses a second writer and the addon has no read-only open
- The owner keeps a live index, updated by replaying each accepted commit; never rebuild it per packet
- Ids for nodes created in a commit are predicted from `getNextIds()` and asserted after `submit`
**Generative vectors** (spike 015)
- Store the rules, not the geometry: seeds, knots and rules; everything else is regrown
- Deterministic: only `+ − × ÷ √` touch geometry, and randomness is a hash of each vector's structural path id
- Additive: level N+1 never moves level N; local: a region grown alone equals the whole expansion there
- A level is frozen into the neighbour index only when complete; forces bend only new children (Jacobi) and are summed in order-key order
- Any spatial index is checked against a brute-force reference, and its cell keys stay below 2⁵³

**Surfaces from vectors** (spikes 016a, 016b, 017)
- The surface is a smooth union of capsules meshed on a global lattice with marching tetrahedra (Freudenthal split); surface nets isn't watertight
- The surface is a regenerated view per level of detail and region, never stored
- Build only in a narrow band of bricks, keeping the reference traversal order, so the output is bit-identical
- A capsule's index reach is `2r + k + 2h` from its axis
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Thread geometry and load | `references/thread-geometry-and-load.md` | A procedural ribbon holds 60 fps at 1.73 M dots with 0.9 MB of buffers; one GPU point per dot collapses to 10–15 fps past about an hour |
| Glyph rendering | `references/glyph-rendering.md` | Instanced quads from one atlas, showing a browser-SDF cell in 0.5 ms and swapping in a worker-generated MSDF cell ~15 ms later for 0.1 ms |
| Editor and app integration | `references/editor-and-app-integration.md` | The real ProseMirror typer over a live thread inside the app's real canvas costs nothing measurable: 8.7 ms key→painted, 59.9 fps, no GL leak over 20 open/close cycles |
| Persistence and replay | `references/persistence-and-replay.md` | The `.tree` round-trip is exact and readable, but reopening is O(commits²) in the kernel — 23 s for an 8 h thread at D-06's ⅓ s commits |
| Navigation and feel | `references/navigation-and-feel.md` | Zoom as a span in seconds holds 60 fps from 8 hours to 0.25 s, with hover gravity suppressed while the hand is moving |
| NPC minds and the story world | `references/npc-minds-story-world.md` | One shared story world with believes-edges and canon; per-NPC slices are byte-identical to hand-built files; packets identical three ways (96/96); the kernel scales linearly to 55k commits |
| The mind bridge | `references/npc-mind-bridge.md` | A dependency-free Node sidecar on the kernel addon with a live index serves a packet in 1.2 ms over HTTP at 5k lines; JS equals C++ 240/240; one writer per world |
| Generative vectors | `references/generative-vectors-growth.md` | 3 seeds and 457 B grow 3,765 vectors (×527); deterministic, additive, order-independent and local to L7; knots generate structure (the bridge's arch); a cell key past 2⁵³ once doubled forces |
| Surfaces from vectors | `references/vector-surfaces.md` | A narrow-band distance field meshed with marching tetrahedra welds joints and is watertight; 0.32 s for tree L4, 35 ms for a region; bit-identical to the reference; swept tubes and surface nets are dead ends |

## Open Risks Carried Into the Build

1. ~~**`Kernel::fromJournal` copies the whole world per commit.**~~ **Fixed by commit `7fed53f`** (copy only the nodes and edges a commit touches). Spike 012 measured reopen as linear: 55k commits in 745 ms. Spike 006's numbers predate the fix. `replayUpTo` still rebuilds from scratch on each call, so spike 008's renderer-side rebuild still stands.
2. **Atlas paging is unsolved.** LRU eviction thrashes past 1024 cells, drives MSDF cells to zero and makes evicted letters vanish. A CJK thread reaches that limit quickly.
3. **Two human checks are still open** — input-method composition (spike 004) and whether the navigation gravity feels right (spike 011). Both have checkpoints written in their READMEs.
4. **Two spikes were proposed and never run:** 009 (deleted letters staying legible on the line, D-03/D-04) and 010 (two twisted author strands, D-21).
5. **npc-minds: local models are unspiked.** The mind-sim and speaker roles, and whether the loop feels like conversation with a real model, need a spike on Kaelen's Mac (the cloud container has no GPU).
6. **npc-minds: the addon doesn't link on Linux** until `tapestry_kernel` sets `POSITION_INDEPENDENT_CODE ON`.
7. **npc-minds: the game and the Tapestry app can't both own a story file.** The journal lock allows one writer, so the build must pick which one serves the other.
8. **generative-vectors: the neural half is unspiked.** Nothing yet infers seeds and knots from an image or strokes. data-drawing's pen strokes are the natural first input.
9. **generative-vectors: the surface cost.** 0.3–1.4 s single-threaded for a whole tree. Workers per brick range, gradient normals through the per-brick lists, and the field on the GPU or in WASM are the next steps. Bulging rings at continuation joints need a plain minimum there.
10. **generative-vectors: determinism across engines is unproven.** Only V8 (Node and Chromium) was compared; a Firefox or Safari run is owed.

## Source Files

Original spike source files are preserved in `sources/` for complete reference — launchers, page scripts, the shared glyph layer and rasterizer, the hybrid worker fork, the kernel round-trip script, the npc-minds C++ spikes and the Node bridge, the generative-vector grower and its surface builders, and each spike's full README with its investigation trail. Benchmark JSON and screenshots were left in `.planning/spikes/*/results/` rather than duplicated here.
</findings_index>

<metadata>
## Processed Spikes

- 001-thread-stream-load
- 002a-glyphs-sdf
- 002b-glyphs-canvas-atlas
- 003a-sharp-glyphs-sdf
- 003b-sharp-glyphs-msdf
- 004-typer-over-live-thread
- 005-thread-in-real-app
- 006-record-redraw-roundtrip
- 007-hybrid-glyph-worker
- 008-scrub-to-any-moment
- 011-navigation-feel
- 012-npc-mind-kernel
- 013a-per-npc-worlds
- 013b-shared-story-world
- 014-mind-bridge
- 015-generative-vectors
- 016a-sdf-surface-nets
- 016b-swept-tubes
- 017-fast-sdf

Not processed (proposed, never run): 009-deleted-letters-on-the-line, 010-two-twisted-strands.
</metadata>
