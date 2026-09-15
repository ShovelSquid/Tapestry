# Spike Manifest

## Ideas

### thread-rendering
Tapestry's thread type (Kaelen, 2026-09-15; see `Tapestry Tales/Connections/Concept - Thread Type.md`) is a single growing note whose history is drawn as a line through the z-axis. The line gains a dot 60 times a second while live. Each typed letter sits at the point for the moment it was typed. Gaps show as time-out and time-in dashes. Old entries fade back and vanish, and a side view shows the whole thread left to right. These spikes test whether that can be drawn at display refresh rate in Electron with legible text, before Phase 2.3 is planned.

**Requirements:**
- Runs in Electron (the repo's Electron 32 / Chromium 128), not a plain browser (Kaelen, 2026-09-15)
- Holds 60 fps on Kaelen's machine (Apple M4 MacBook Air, 60 Hz built-in display)
- Scope for this session: load (001) and glyph legibility (002a/002b) only (Kaelen, 2026-09-15)
- Thread data is sessions and keystrokes, never per-dot records; dots are drawn procedurally from time × speed (spike 001)
- Multi-hour threads use hour-block times and a moving render origin to stay precise on float32 GPUs (spike 001)

## Spikes

| # | Idea | Name | Type | Validates | Verdict | Tags |
|---|------|------|------|-----------|---------|------|
| 001 | thread-rendering | thread-stream-load | standard | Given a WebGL thread in Electron, when it gains 60 dots/s plus a glyph per keystroke fast-forwarded to 1 h (216k dots) and 8 h, then it holds 60 fps with bounded memory, fading and distance collapse | ✓ VALIDATED (procedural ribbon: 60 fps, 0 dropped, 0.9 MB at 8 h continuous; explicit points ✗ 10–20 fps at 8 h) | webgl, electron, performance |
| 002a | thread-rendering | glyphs-sdf | comparison | Given letters along the thread, when drawn with an SDF glyph atlas (troika-three-text) along the z-axis and from the side, then text is crisp at all zooms | PENDING | webgl, text, sdf |
| 002b | thread-rendering | glyphs-canvas-atlas | comparison | Same as 002a with a canvas texture atlas and instanced quads (no text library) | PENDING | webgl, text, instancing |
