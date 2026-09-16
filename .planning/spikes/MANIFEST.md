# Spike Manifest

## Ideas

### thread-rendering
Tapestry's thread type (Kaelen, 2026-09-15; see `Tapestry Tales/Connections/Concept - Thread Type.md`) is a single growing note whose history is drawn as a line through the z-axis. The line gains a dot 60 times a second while live. Each typed letter sits at the point for the moment it was typed. Gaps show as time-out and time-in dashes. Old entries fade back and vanish, and a side view shows the whole thread left to right. These spikes test whether that can be drawn at display refresh rate in Electron with legible text, before Phase 2.3 is planned.

**Requirements:**
- Runs in Electron (the repo's Electron 32 / Chromium 128), not a plain browser (Kaelen, 2026-09-15)
- Holds 60 fps on Kaelen's machine (Apple M4 MacBook Air, 60 Hz built-in display)
- Scope for this session: load (001) and glyph legibility (002a/002b) only (Kaelen, 2026-09-15)
- Scope for the second session: sharp glyphs (003a/003b) and the typer over a live thread (004), chosen by Kaelen in frontier mode (2026-09-15)
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

## Spikes

| # | Idea | Name | Type | Validates | Verdict | Tags |
|---|------|------|------|-----------|---------|------|
| 001 | thread-rendering | thread-stream-load | standard | Given a WebGL thread in Electron, when it gains 60 dots/s plus a glyph per keystroke fast-forwarded to 1 h (216k dots) and 8 h, then it holds 60 fps with bounded memory, fading and distance collapse | ✓ VALIDATED (procedural ribbon: 60 fps, 0 dropped, 0.9 MB at 8 h continuous; explicit points ✗ 10–20 fps at 8 h) | webgl, electron, performance |
| 002a | thread-rendering | glyphs-sdf | comparison | Given letters along the thread, when drawn with an SDF glyph atlas (troika-three-text) along the z-axis and from the side, then text is crisp at all zooms | ✗ INVALIDATED (sharpest letters, but 4–5.5 fps and 850 MB at 78 k letters; one Text per keystroke doesn't scale) | webgl, text, sdf |
| 002b | thread-rendering | glyphs-canvas-atlas | comparison | Same as 002a with a canvas texture atlas and instanced quads (no text library) | ✓ WINNER (60 fps, 0 dropped, 42–50 MB at 78 k letters; legible 8–24 px, soft when magnified ≥48 px) | webgl, text, instancing |
| 003a | thread-rendering | sharp-glyphs-sdf | comparison | Given instanced glyph quads, when the atlas holds SDF glyphs generated at runtime, then letters stay razor-sharp from 8 to 240 px at 60 fps with 78 k letters, and new glyphs (emoji, non-Latin) are added on first use | ⚠ PARTIAL (60 fps, 0.5 ms/glyph, browser font fallback and shaped clusters; but edges ripple and corners round at 120–240 px) | webgl, text, sdf, instancing, unicode |
| 003b | thread-rendering | sharp-glyphs-msdf | comparison | Same as 003a with an MSDF atlas (plus bitmap fallback for colour emoji) | ✓ WINNER (straight edges and true corners at 240 px, 60 fps; but 7.7–8.1 ms/glyph, 122–127 MB, font files only, no cluster shaping) | webgl, text, msdf, instancing, wasm, unicode |
| 004 | thread-rendering | typer-over-live-thread | standard | Given the ProseMirror typer over a live 60 fps WebGL thread, when typing fast, composing with an IME, and pasting, then each letter lands on the line within one frame with no input lag or dropped frames | ✓ VALIDATED (key→painted 7–9 ms median, ≤16.9 ms max at 20–40 keys/s over 8 h of history; paste of 2000 chars applies in ~3 ms as one cluster; IME composition awaiting Kaelen's hand check) | electron, prosemirror, webgl, input, latency |
