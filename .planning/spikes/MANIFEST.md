# Spike Manifest

## Ideas

### thread-rendering
Tapestry's thread type (Kaelen, 2026-09-15; see `Tapestry Tales/Connections/Concept - Thread Type.md`) is a single growing note whose history is drawn as a line through the z-axis. The line gains a dot 60 times a second while live. Each typed letter sits at the point for the moment it was typed. Gaps show as time-out and time-in dashes. Old entries fade back and vanish, and a side view shows the whole thread left to right. These spikes test whether that can be drawn at display refresh rate in Electron with legible text, before Phase 2.3 is planned.

**Requirements:**
- Runs in Electron (the repo's Electron 32 / Chromium 128), not a plain browser (Kaelen, 2026-09-15)
- Holds 60 fps on Kaelen's machine (Apple M4 MacBook Air, 60 Hz built-in display)
- Scope for this session: load (001) and glyph legibility (002a/002b) only (Kaelen, 2026-09-15)
- Scope for the second session: sharp glyphs (003a/003b) and the typer over a live thread (004), chosen by Kaelen in frontier mode (2026-09-15)
- Scope for the third session: app integration (005), record round-trip (006), hybrid glyphs (007), scrubbing (008) and navigation feel (011), chosen by Kaelen in frontier mode (2026-09-15). Spikes 009 and 010 were proposed and not run.
- Thread data is sessions and keystrokes, never per-dot records; dots are drawn procedurally from time × speed (spike 001)
- Multi-hour threads use hour-block times and a moving render origin to stay precise on float32 GPUs (spike 001)
- Thread letters are instanced quads from one glyph atlas in a single draw call, never one text object per keystroke (spikes 002a/002b)
- Thread letters stay sharp at every zoom the side view offers (Kaelen, 2026-09-15, Phase 2.3 D-19), which means MSDF glyphs from font files; a raster-derived SDF ripples when magnified (spike 003)
- Glyph generation runs off the main thread: an MSDF glyph costs ~8 ms, up to 22.6 ms (spike 003b)
- Thread letters and the note typer use the same font files, or the same word looks like two typefaces (spike 003b)
- Letters are grapheme clusters, not code points; colour emoji are bitmap cells in the same atlas, flagged per letter (spike 003)
- Joining scripts (Arabic) can't be read along the line, because each letter sits at its own keystroke time; the text window carries them (spike 003)
- Letters are drawn from ProseMirror transaction steps, not key events, so typing, paste, undo and input methods all flow through one path, independent of the 300 ms save debounce (spike 004)
- Drawing a keystroke costs ~0.3 ms in the editor and lands within one frame at 40 keys/s over 8 h of history (spike 004)
- A large paste arrives as one transaction and lands as one cluster; it can cost a dropped frame only while its glyphs are new (spike 004)
- The thread is a full-window layer over the dimmed canvas, not a child of the canvas's transformed container, so CSS pan/zoom never touches it; the order is notes → scrim → thread → typer (spike 005, D-09)
- D-09's dimming is load-bearing, not decoration: glyphs are drawn near-white, so a thread over the undimmed cream canvas is invisible (spike 005)
- Closing a thread must call `renderer.dispose()` **and** `renderer.forceContextLoss()`; dispose alone holds the context until GC and a browser allows only a handful (spike 005)
- The app and anything drawing thread letters must share one ProseMirror instance; two copies make a schema built by one unreadable to the other (spike 005)
- Thread letters need a per-instance colour channel for D-21's author strands; the shared glyph shader currently hardcodes near-white with no colour uniform (spike 005)
- Keystrokes are recorded as ordinary `set` properties, never `x-` extension lines: the codec supports extension lines but the addon's only path to the journal is `submit(ops)` (spike 006)
- Each keystroke's time offset is measured from its batch anchor, never from the previous keystroke; cumulative deltas re-accumulate rounding and drift with batch length (spike 006)
- Opening a world is quadratic in its commit count, because `Kernel::fromJournal`, `replayUpTo` and `submit` each copy the whole world per commit; threads are the first feature to make that visible (spike 006)
- The commit window is a user-facing tradeoff between crash exposure, file size and reopen time (⅓ s: 8.0 MB and 23 s at 8 h; 5 s: 1.2 MB and 237 ms) — Kaelen's call, not a silent default (spike 006)
- Thread letters show a browser-SDF cell immediately and swap to an MSDF cell generated in a worker ~15 ms later; the swap costs 0.1 ms and satisfies D-19 without MSDF generation ever touching a frame (spike 007)
- Replacing a glyph's cell means rewriting every instance that already drew it, because `write()` snapshots quad/uv/dist per instance rather than referencing the cache (spike 007)
- Placeholder cells are rasterized across frames, never inside the paste transaction: 2000 never-seen graphemes cost 268 ms synchronously, while the same paste of cached glyphs costs under 10 ms (spike 007)
- The 1024-cell atlas needs real paging, not LRU eviction: under thrash every MSDF cell is discarded and evicted letters vanish from the line (spike 007)

## Spikes

| # | Idea | Name | Type | Validates | Verdict | Tags |
|---|------|------|------|-----------|---------|------|
| 001 | thread-rendering | thread-stream-load | standard | Given a WebGL thread in Electron, when it gains 60 dots/s plus a glyph per keystroke fast-forwarded to 1 h (216k dots) and 8 h, then it holds 60 fps with bounded memory, fading and distance collapse | ✓ VALIDATED (procedural ribbon: 60 fps, 0 dropped, 0.9 MB at 8 h continuous; explicit points ✗ 10–20 fps at 8 h) | webgl, electron, performance |
| 002a | thread-rendering | glyphs-sdf | comparison | Given letters along the thread, when drawn with an SDF glyph atlas (troika-three-text) along the z-axis and from the side, then text is crisp at all zooms | ✗ INVALIDATED (sharpest letters, but 4–5.5 fps and 850 MB at 78 k letters; one Text per keystroke doesn't scale) | webgl, text, sdf |
| 002b | thread-rendering | glyphs-canvas-atlas | comparison | Same as 002a with a canvas texture atlas and instanced quads (no text library) | ✓ WINNER (60 fps, 0 dropped, 42–50 MB at 78 k letters; legible 8–24 px, soft when magnified ≥48 px) | webgl, text, instancing |
| 003a | thread-rendering | sharp-glyphs-sdf | comparison | Given instanced glyph quads, when the atlas holds SDF glyphs generated at runtime, then letters stay razor-sharp from 8 to 240 px at 60 fps with 78 k letters, and new glyphs (emoji, non-Latin) are added on first use | ⚠ PARTIAL (60 fps, 0.5 ms/glyph, browser font fallback and shaped clusters; but edges ripple and corners round at 120–240 px) | webgl, text, sdf, instancing, unicode |
| 003b | thread-rendering | sharp-glyphs-msdf | comparison | Same as 003a with an MSDF atlas (plus bitmap fallback for colour emoji) | ✓ WINNER (straight edges and true corners at 240 px, 60 fps; but 7.7–8.1 ms/glyph, 122–127 MB, font files only, no cluster shaping) | webgl, text, msdf, instancing, wasm, unicode |
| 004 | thread-rendering | typer-over-live-thread | standard | Given the ProseMirror typer over a live 60 fps WebGL thread, when typing fast, composing with an IME, and pasting, then each letter lands on the line within one frame with no input lag or dropped frames | ✓ VALIDATED (key→painted 7–9 ms median, ≤16.9 ms max at 20–40 keys/s over 8 h of history; paste of 2000 chars applies in ~3 ms as one cluster; IME composition awaiting Kaelen's hand check) | electron, prosemirror, webgl, input, latency |
| 005 | thread-rendering | thread-in-real-app | standard | Given the app's own React canvas with real NoteCards, when a WebGL thread layer and the typer panel open over it with the canvas dimmed (D-09), then the thread holds 60 fps, the canvas stays pannable and editable, and opening/closing the thread leaks no GL context | ✓ VALIDATED (59.9 fps and 0 dropped frames in every phase, matching the canvas-only baseline; 42 contexts created / 41 disposed / 0 unexpectedly lost over 20 open/close cycles; the app's own zoom drops 0.4 % with no thread on screen) | electron, react, webgl, integration, vite |
| 006 | thread-rendering | record-redraw-roundtrip | standard | Given live typing captured as readable `.tree` keystroke and session records (D-06), when the world is closed and reopened, then the line redraws identically from records alone — same letters, same positions, same dashes — and a person can read the typing in a text editor | ⚠ PARTIAL (round-trip is exact and readable through the real kernel at every commit window; but reopening is O(commits²) — an 8 h thread takes 23 s to open at D-06's ⅓ s commits, 237 ms at 5 s — because `Kernel::fromJournal` copies the whole world per commit) | tree, persistence, replay, readability, kernel |
| 007 | thread-rendering | hybrid-glyph-worker | standard | Given browser-SDF cells shown at once while MSDF cells generate in a worker, when a 2000-character paste lands on a cold atlas and the thread passes 1024 distinct glyphs, then no frame drops, cells swap without a visible pop, and the atlas pages | ⚠ PARTIAL (hybrid validated: letters sharpen within ~15 ms, swap costs 0.1 ms, 60 fps and 0 dropped frames while typing and on a warm paste; but a paste of 2000 never-seen glyphs stalls 268 ms rasterizing placeholders inside one transaction, and LRU eviction thrashes past 1024 cells — MSDF cells fall to zero and evicted letters vanish) | webgl, text, msdf, worker, atlas |
| 008 | thread-rendering | scrub-to-any-moment | standard | Given 78 k keystrokes of history, when the user drags along the line or the date scrubber, then the document as it was at that moment appears in the text window at interactive rate with that letter highlighted (D-17, D-18) | PENDING | prosemirror, replay, performance, navigation |
| 009 | thread-rendering | deleted-letters-on-the-line | standard | Given heavy editing where nothing on the line is erased (D-03, D-04), when text is written, deleted, rewritten and undone, then the line stays readable rather than turning to mush | ○ PROPOSED (not run this session) | webgl, text, legibility |
| 010 | thread-rendering | two-twisted-strands | standard | Given a person and an agent writing the same stretch, when each author has a coloured strand (D-21), then the strands twist legibly, drag apart (D-23), and simultaneous typing orders sensibly | ○ PROPOSED (not run this session) | webgl, multi-actor, geometry |
| 011 | thread-rendering | navigation-feel | standard | Given the side view of a long thread, when zooming from the whole thread to single dots with hover gravity and a date scrubber (D-17), then navigation feels like "huge gaps broken up with small planets" | PENDING | webgl, navigation, ux, feel |
