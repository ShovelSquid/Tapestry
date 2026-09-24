# Spike Wrap-Up Summary

**Date:** 2026-09-15
**Idea:** thread-rendering
**Spikes processed:** 11 (of 13 in the manifest; 009 and 010 were proposed and never run)
**Feature areas:** thread geometry and load · glyph rendering · editor and app integration · persistence and replay · navigation and feel
**Skill output:** `./.claude/skills/spike-findings-tapestry/`

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | thread-stream-load | standard | ✓ VALIDATED | Thread geometry and load |
| 002a | glyphs-sdf | comparison | ✗ INVALIDATED | Glyph rendering |
| 002b | glyphs-canvas-atlas | comparison | ✓ WINNER of 002 | Glyph rendering |
| 003a | sharp-glyphs-sdf | comparison | ⚠ PARTIAL | Glyph rendering |
| 003b | sharp-glyphs-msdf | comparison | ✓ WINNER of 003 | Glyph rendering |
| 004 | typer-over-live-thread | standard | ✓ VALIDATED | Editor and app integration |
| 005 | thread-in-real-app | standard | ✓ VALIDATED | Editor and app integration |
| 006 | record-redraw-roundtrip | standard | ⚠ PARTIAL | Persistence and replay |
| 007 | hybrid-glyph-worker | standard | ⚠ PARTIAL | Glyph rendering |
| 008 | scrub-to-any-moment | standard | ✓ VALIDATED | Persistence and replay |
| 011 | navigation-feel | standard | ✓ VALIDATED | Navigation and feel |

## Key Findings

**The thread renders.** A procedural ribbon — sessions and keystrokes stored, dots drawn from time × speed in a fragment shader — holds 59.9 fps with zero dropped frames at 8 h continuous (1.73 M dots, 78 k letters) in 0.9 MB of GPU buffers and under 55 MB of memory. One GPU point per dot was invalidated beyond about an hour, on rasterization and overdraw rather than vertex count.

**Letters are instanced quads from one atlas.** One text object per keystroke was invalidated outright (4–5.5 fps, 850 MB at 78 k letters). The atlas itself took three spikes to settle: a canvas bitmap is fast but blurs above 48 px; a browser-derived SDF is fast and Unicode-complete but ripples at 120–240 px; MSDF from font files is razor-sharp but costs ~8 ms per glyph, worst 22.6 ms. Spike 007's hybrid resolves it — show the cheap cell in 0.5 ms, swap in the worker-generated MSDF cell ~15 ms later for 0.1 ms — so D-19's sharpness never touches a frame.

**The real editor over a live thread is not a performance problem.** Key → painted is 8.7–9.1 ms median and 16.9 ms worst at twice a fast typist's speed with 8 h of history on screen, and the editor's own work is 0.3 ms per keystroke. Inside the app's own React canvas with real NoteCards, every phase matched the canvas-only baseline, and twenty open/close cycles leaked no WebGL context.

**Storage round-trips exactly, and reveals a kernel problem.** Keystrokes written as ordinary `.tree` `set` properties come back identical and readable in a text editor at every commit window tested. But reopening is quadratic in commit count — `Kernel::fromJournal` copies the whole world once per commit — so an 8 h thread takes 23 s to open at D-06's ⅓ s commits and 237 ms at 5 s. Threads are the first feature to make a pre-existing kernel cost visible; the commit window is a lever, not the fix.

**Scrubbing and navigation are comfortable.** Rebuilding the document at any past moment from snapshots costs 0.2 ms median against 3.6 ms naive, and a 300-step drag held 60 fps. Zoom expressed as a span in seconds held 60 fps from 8 hours down to 0.25 s across stills, sweeps, pans, flights and a whole-history scrubber drag.

## What Is Still Open

- **Kernel copy-per-commit** makes opening any world quadratic. Candidates: apply ops to the live world with an undo log, or copy only the nodes a commit touches.
- **Atlas paging.** LRU eviction thrashes past 1024 cells and evicted letters vanish. Candidates: a second atlas page, a larger atlas, or evicting only cells with no visible instances.
- **Two human verification checkpoints** remain unanswered in the spike READMEs: input-method composition (004) and whether the navigation gravity feels right (011).
- **Two spikes proposed, never run:** 009 (deleted letters staying legible, D-03/D-04) and 010 (two twisted author strands, D-21). D-21 also needs a per-instance colour channel that the shared glyph shader does not yet have (found in 005).
- **Not covered anywhere:** 120 Hz displays, slower machines, threads longer than 8 h, more than one thread in a world, and concurrent writers.

## Housekeeping

Spike 005's frontmatter still read `verdict: PENDING` while its own Results section and `MANIFEST.md` both recorded VALIDATED. Corrected to `VALIDATED` during this wrap-up.
