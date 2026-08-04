# Semantic World Engine

A deterministic simulation engine where the world is built from semantic
particles and brush strokes, physical laws are explicit and versioned, every
change is an event, and the same seed plus the same event log always reproduces
the same world state.

Rendering is never authoritative. See `../semantic_world_executable_plan.md`
for the full phase plan.

## Status

**Phase 0 — technical baseline. Complete.**

- C++20, CMake ≥ 3.24
- SDL2 for the window and input layer
- Catch2 v3 for tests (found on the system, otherwise downloaded)
- JSON for readable event logs first, binary snapshots later

Phases 1+ are unimplemented. Headers under `core/`, `materials/`, `rules/`,
`commands/`, `events/`, `snapshots/` and `serialization/` declare the intended
shape of each subsystem and name the phase that fills it in.

## Build

```bash
cmake -S . -B build
cmake --build build -j
```

Then:

```bash
ctest --test-dir build --output-on-failure
```

```bash
./build/semantic_world
```

The window closes on Escape or the window close button. `--frames N` exits
after N frames and `--headless` uses SDL's dummy video driver, so the
application can be smoke-tested without a display:

```bash
./build/semantic_world --headless --frames 60
```

### Dependencies

| Platform | Command |
| --- | --- |
| macOS | `brew install cmake sdl2` |
| Debian / Ubuntu / Raspberry Pi OS | `sudo apt install cmake build-essential libsdl2-dev` |
| Windows | Visual Studio 2022 + SDL2 (vcpkg: `vcpkg install sdl2`) |

Catch2 is fetched from GitHub at configure time unless a system Catch2 v3 is
already installed. To build offline against an installed Catch2, configure with
`-DSW_FETCH_CATCH2=OFF`. To skip tests entirely, use `-DSW_BUILD_TESTS=OFF`.

If SDL2 is missing, the configure step warns and skips the application target;
the core library and the tests still build. That keeps headless machines and CI
usable.

## Layout

```text
app/            SDL2 application shell (window, input, fixed-timestep loop)
core/           Authoritative world state: types, particles, entities, grid, hashing
materials/      Material definitions and the versioned material library
rules/          Ordered, versioned simulation rules
commands/       Input converted into validated commands
events/         Append-only event log and replay
snapshots/      Snapshots and timeline scrubbing
rendering/      Renderer interface and the SDL2 implementation (read-only)
serialization/  Event log codecs
tests/          Determinism, replay, snapshot and material/rule tests
assets/         Sprites
```

## Rules the code must keep

1. Fixed simulation timestep.
2. Rendering never mutates authoritative state.
3. User input becomes commands; commands become validated events.
4. Rule changes are logged; material definitions are versioned.
5. Rules, particles and entities update in stable order.
6. Randomness is seeded and address-based.
7. Parallelism cannot change results.
8. State hashes are generated regularly; snapshots are verified before replay.
9. No wall-clock time and no floating point in the simulation.
10. Every saved world records its schema, solver, material and rule versions.

Wall-clock time appears in exactly one place — pacing the application loop in
`app/main.cpp` — and never enters the world.

## Verified

- Configures and builds clean (`-Wall -Wextra -Wpedantic -Wshadow -Wconversion`,
  no warnings) on macOS 15 / AppleClang 14 / arm64.
- Blank SDL2 window opens (cocoa) and closes cleanly; headless dummy-driver run
  works too.
- 7 tests build and pass; pending tests for Phases 1–6 are registered under the
  `[.pending]` tag and are skipped by default (`./build/tests/sw_tests
  '[pending]'` lists them).

Not yet verified: desktop Linux and Raspberry Pi builds. Nothing in the build
is macOS-specific — the only Apple-conditional code is a Homebrew prefix hint
for finding SDL2 — but the Linux and Pi targets in the Phase 0 completion
criteria still need a real build on that hardware.
