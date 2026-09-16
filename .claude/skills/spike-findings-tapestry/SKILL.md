---
name: spike-findings-tapestry
description: Implementation blueprint from spike experiments. Requirements, proven patterns, and verified knowledge for building Tapestry's thread rendering. Auto-loaded during implementation work.
---

<context>
## Project: Tapestry

**thread-rendering.** Tapestry's thread type (Kaelen, 2026-09-15; see `Tapestry Tales/Connections/Concept - Thread Type.md`) is a single growing note whose history is drawn as a line through the z-axis. The line gains a dot 60 times a second while live. Each typed letter sits at the point for the moment it was typed. Gaps show as time-out and time-in dashes. Old entries fade back and vanish, and a side view shows the whole thread left to right. These spikes tested whether that can be drawn at display refresh rate in Electron with legible text, before Phase 2.3 is planned.

Eleven spikes were run across three sessions on 2026-09-15, all on Kaelen's Apple M4 MacBook Air (60 Hz, 2560×1664, DPR 2) in the repo's Electron 32.3.3 / Chromium 128. The headline: **the thread is feasible.** Seven spikes validated outright, three landed partial with named fixes, one design was invalidated. The two open risks are both in the kernel and the atlas, not in the rendering.

Spike sessions wrapped: 2026-09-15
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

## Open Risks Carried Into the Build

1. **`Kernel::fromJournal` copies the whole world per commit.** Opening any world is quadratic in its commit count; threads are simply the first feature to make it visible. A wider commit window buys one order of magnitude and does not change the curve.
2. **Atlas paging is unsolved.** LRU eviction thrashes past 1024 cells, drives MSDF cells to zero and makes evicted letters vanish. A CJK thread reaches that limit quickly.
3. **Two human checks are still open** — input-method composition (spike 004) and whether the navigation gravity feels right (spike 011). Both have checkpoints written in their READMEs.
4. **Two spikes were proposed and never run:** 009 (deleted letters staying legible on the line, D-03/D-04) and 010 (two twisted author strands, D-21).

## Source Files

Original spike source files are preserved in `sources/` for complete reference — launchers, page scripts, the shared glyph layer and rasterizer, the hybrid worker fork, the kernel round-trip script, and each spike's full README with its investigation trail. Benchmark JSON and screenshots were left in `.planning/spikes/*/results/` rather than duplicated here.
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

Not processed (proposed, never run): 009-deleted-letters-on-the-line, 010-two-twisted-strands.
</metadata>
