# STATE — the handoff between autonomous sessions

Read fully at the start of every session. Rewrite the "Next" section at
the end of every session so its first item can be started cold.

## Phases

| Phase | Status |
| --- | --- |
| 1 store | not started |
| 2 expressions | not started |
| 3 force rules | not started |
| 4 constraints | not started |
| 5 views | not started |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean.

## Next

1. **Build scaffolding for the `mathspace` library.** In `CMakeLists.txt`:
   change the `ddsim` glob to non-recursive `src/*.cpp`; add
   `add_library(mathspace STATIC)` over `src/mathspace/*.cpp` with public
   include `include/`, linking `ddsim_settings` and `ddsim` (for
   `fx64.hpp` and `sha256_bytes`); add `mathspace_tests` over
   `tests/mathspace/*.cpp` with doctest discovery. Create
   `include/mathspace/ids.hpp` (u64 structured `NoteId`: branch 8 bits,
   group 32, index 24, reuse the masks from `ddsim/ids.hpp`) and one
   trivial test so the target builds and `ctest` runs it. Confirm the
   forbidden-token gate still passes and reports the new files.
2. **`include/mathspace/note.hpp`**: `Field` (name up to 31 bytes, dim 1
   to 8, `fx64 value[8]`, `bound` flag, bytecode bytes empty for now),
   `Note` (id, space id, kind enum Space/Note/Rule/View, sorted fields
   vector). Helpers: `find_field`, `set_field` (insert sorted),
   `erase_field`. Tests for sort order and replacement.
3. **`include/mathspace/world.hpp` + `src/mathspace/world.cpp`**: `World`
   with seed, tick, sorted notes vector, `next_group`. `create_space(dim)`,
   `create_note(space, kind, group?)`, `set_field`, `delete_note`,
   `delete_field`, all returning an error code and leaving state untouched
   on failure. `step()` increments tick only. Tests.
4. **Canonical walk + hash** in `src/mathspace/hash.cpp`, per the plan's
   walk, plus `serialize`/`restore` strict inverse. Tests: round-trip hash
   equality, tampered byte rejected, restore failure leaves state untouched.
5. **Actions** `include/mathspace/action.hpp`: kinds 32 to 36 with the
   ddsim header layout, bounds-checked decoder into a local, `World::apply`.
   Tests per kind including malformed payloads.
6. **Replay tool and goldens**: `tools/ms_replay/main.cpp`, fixture format
   shared with `tests/golden_support.hpp` where possible,
   `tests/golden/ms/empty.actions` and `two-notes.actions` with `.sha256`,
   wired into the two-process CTest loop in `CMakeLists.txt`.
7. **Tapestry Space page** (phase 1 done condition): `PageKind::Space`,
   page owns a mathspace `World`, notes drawn as labelled dots, drag
   issues `SetField pos`, `.tapestry` delta line `mspace <page> <base64
   actions>`; reload and compare hash. Link `mathspace` into
   `tapestry_core` (the tapestry CMake is a separate project; add it as a
   subdirectory or an `add_subdirectory(..)` bridge, whichever is cleaner,
   and record the choice under Decisions).

Then phase 2, per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

(nothing yet)

## Decisions

(decisions made by sessions that the plan did not already make)

## Learned

(surprises about the codebase or the machine worth passing on)

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)
