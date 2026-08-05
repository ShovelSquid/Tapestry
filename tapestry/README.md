# Tapestry

A spatial workspace. Pages occupy world space at real reading size — some are
conversations, some are notes, some are files on disk — and you plan by arranging
them rather than by filling in a form.

Native C++20, SDL2, OpenGL 3.3 core, [nanovg](https://github.com/memononen/nanovg)
for 2D and text.

## Status

**Milestone 2 — pages with text content.** A `World` owns pages in draw order
and advances only through fixed ticks, never wall-clock time — the seam replay
verification will clamp onto. Pages occupy world space at real reading size:
1 world unit is 1 logical pixel at 100% zoom, so a page's body text is the
same size as text in any other window. Typography is laid out in world units
and projected through the camera; as zoom drops, body text degrades to greeked
lines, then to a bare card whose accent dot still tells a conversation from a
note from a file. Dragging a page moves it, dragging empty space pans, and
double-click creates a note. A first launch seeds a small starter workspace.

The UI font is a two-face family (regular + bold) that prefers bundled faces —
drop `ui.ttf` and `ui-bold.ttf` into `assets/fonts/` — and falls back to
platform fonts. Page bodies are not editable yet; the document title is.

**The workspace is a document.** One file is one document: plain text, with a
title (click it, top-left, to rename), saved by `Cmd`/`Ctrl`+`S`. `--file PATH`
picks it (default `workspace.tapestry`, opened at launch if it exists);
`Cmd`/`Ctrl`+`O` re-opens it.

The first save writes a full baseline. Every save after it diffs against what
the file already describes and appends **only what changed**, field by field —
dragging a page costs one `pmove` line whatever the length of its text, and
saving an unchanged workspace writes nothing at all. So the file keeps a
complete version history (the raw material for a timelapse or scrubber)
without growing by the size of the whole workspace on every save. In practice
a save costs tens of bytes against a baseline of hundreds; loading replays the
baseline plus every delta to reconstruct the newest state.

```
tapestry 1
snapshot 0                     ← baseline: title, camera, settings, all pages
...
end
delta 1                        ← only the differences, per field
pmove 1 -300 -180 440 330
end
delta 2
pfold 2 1
end
```

Every page can minimize to its title bar via the button at its top right; a
minimized page's hidden body is not clickable — clicks fall through to
whatever is underneath.

**Settings are a page.** An ordinary page (drag it, minimize it, it saves with
the document) whose body is three controls: a typed zoom percentage that may
leave the interactive 5%–600% band entirely (hard limits 0.0001%–100,000,000%,
guarding the projection arithmetic — scroll-zoom from out there walks back
gradually rather than snapping), a center-at-origin button, and an
invert-scroll toggle that flips two-finger pan direction.

Earlier: **Milestone 0** built the shell (GL 3.3 core window, fixed-timestep
loop, adaptive grid with pinned axis labels); **Milestone 1** put pages into
the world as model state with hit-testing and deterministic stepping.

The y axis grows downward (screen convention, matching how page content flows),
not upward as on a blackboard.

## Build

Requires CMake ≥3.24, a C++20 compiler, SDL2, and — for glad's code generation at
configure time — Python with Jinja2.

```bash
brew install cmake sdl2          # macOS
sudo apt install cmake libsdl2-dev python3-jinja2   # Debian/Ubuntu

cmake -S . -B build
cmake --build build -j
./build/tapestry
```

The first configure clones glad and generates its loader, so it needs network
access. nanovg is vendored under `third_party/`, so it does not.

| Option | Effect |
| --- | --- |
| `-DTAPESTRY_BUILD_APP=OFF` | Build only the core library (no SDL2 needed) |
| `-DTAPESTRY_BUILD_TESTS=OFF` | Skip the test suite |

```bash
ctest --test-dir build --output-on-failure
```

The tests are pure arithmetic over `tapestry_core` — no window, no GL context,
no display — so they run anywhere the library compiles.

## Running

```bash
./build/tapestry                             # normal
./build/tapestry --file plan.tapestry        # open/save this document
./build/tapestry --size 1600x1000            # initial window size
./build/tapestry --zoom 0.25                 # start zoomed out
./build/tapestry --pan -3000,-2200           # start away from the origin
./build/tapestry --headless --frames 60      # smoke test, no window or GL
./build/tapestry --screenshot shot.png       # render, dump a PNG, quit
```

`--headless` runs the loop with no window and no GL context at all — the SDL
dummy video driver has no GL to give, and the point of the mode is to exercise
the loop on a machine with no display. It also steps the simulation
**deterministically**: exactly one tick per frame, with no wall-clock read
feeding the simulation. Pacing a headless run by wall clock would step zero
ticks, because frames with nothing to draw all finish inside a single tick
interval — and that is the harness replay verification will be built on.

`--screenshot` reads the back buffer and writes a PNG. It exists so rendering
can be verified without capturing the whole desktop.

## Navigating

| Action | Input |
| --- | --- |
| Pan | Drag empty space, middle-drag, two-finger scroll, or arrow keys |
| Zoom | Pinch, `Ctrl`/`Cmd` + scroll, or `+` / `-` |
| Move a page | Drag it (also selects and raises it) |
| Minimize / restore a page | The button at the page's top right |
| New note | Double-click empty space, or `N` at the cursor |
| Frame all pages | `F` |
| Reset view | `0` |
| Rename the document | Click the title top-left; `Enter` commits, `Esc` cancels |
| Save / open the document | `Cmd`/`Ctrl`+`S` / `Cmd`/`Ctrl`+`O` |
| Deselect, then quit | `Esc` |

Zoom is cursor-pinned: the world point under the pointer stays under it.

## Layout

```
app/          entry point, event loop, input → world/camera
core/         camera, geometry, pages, world — no windowing, no SDL
render/       drawing built on nanovg: grid, pages, fonts
tests/        invariants over core/, no display required
third_party/  vendored nanovg (zlib) and stb_image_write (public domain)
assets/       fonts (drop ui.ttf / ui-bold.ttf in fonts/ to override the
              system fallbacks)
```

## Constraints worth knowing before you change things

**The GL context is 3.3 core and stays there.** Apple froze OpenGL at 4.1 and
never shipped compute shaders or shader storage buffers. Raising the context
version costs the macOS build and gains nothing — the sibling
`chrono_magnetic_particles` project requires 4.3 and cannot run on this machine
at all ([diagnosis](../chrono_magnetic_particles/logs/2026-07-30-macos-opengl-blocker.md)).
Particles here are simulated on the CPU and drawn with instanced arrays, which
is comfortably fast at the scale this app needs.

**Wall-clock time paces the loop and never enters the simulation.** The
accumulator in `app/main.cpp` is the only place real time is read. Everything
downstream of it steps in fixed 16 ms ticks so that recorded input replays
identically.

**Logical pixels vs. drawable pixels.** On HiDPI displays the drawable is larger
than the window. GL works in drawable pixels; the camera, nanovg, and SDL mouse
coordinates all work in logical pixels, bridged by the device pixel ratio passed
to `nvgBeginFrame`. Mixing the two produces a view that is subtly offset or
half-scale, and it is easy to misread as a camera bug.

**The context reports 4.1 on macOS, and that is correct.** We ask for 3.3 core;
macOS hands back the highest core profile it can, which is 4.1. glad only loaded
3.3 entry points, so the app is still bound to the 3.3 feature set and still
runs anywhere 3.3 does. Do not "fix" the startup line by raising the request.
