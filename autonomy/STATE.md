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

1. **`include/mathspace/world.hpp` + `src/mathspace/world.cpp`**: `World`
   with seed, tick, sorted notes vector, `next_group`. `create_space(dim)`,
   `create_note(space, kind, group?)`, `set_field`, `delete_note`,
   `delete_field`, all returning an error code and leaving state untouched
   on failure. `step()` increments tick only. Tests.
2. **Canonical walk + hash** in `src/mathspace/hash.cpp`, per the plan's
   walk, plus `serialize`/`restore` strict inverse. Tests: round-trip hash
   equality, tampered byte rejected, restore failure leaves state untouched.
3. **Actions** `include/mathspace/action.hpp`: kinds 32 to 36 with the
   ddsim header layout, bounds-checked decoder into a local, `World::apply`.
   Tests per kind including malformed payloads.
4. **Replay tool and goldens**: `tools/ms_replay/main.cpp`, fixture format
   shared with `tests/golden_support.hpp` where possible,
   `tests/golden/ms/empty.actions` and `two-notes.actions` with `.sha256`,
   wired into the two-process CTest loop in `CMakeLists.txt`.
5. **Tapestry Space page** (phase 1 done condition): `PageKind::Space`,
   page owns a mathspace `World`, notes drawn as labelled dots, drag
   issues `SetField pos`, `.tapestry` delta line `mspace <page> <base64
   actions>`; reload and compare hash. Link `mathspace` into
   `tapestry_core` (the tapestry CMake is a separate project; add it as a
   subdirectory or an `add_subdirectory(..)` bridge, whichever is cleaner,
   and record the choice under Decisions).

Then phase 2, per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `d7a8862` ms1 step 2: `note.hpp`/`note.cpp` Field, Note, NoteKind,
  `find_field`/`set_field`/`erase_field`/`fields_well_formed`, tests.
- `3cd79d9` ms1 step 1: build scaffolding. `mathspace` static lib over
  `src/mathspace/*.cpp`, `mathspace_tests` over `tests/mathspace/*.cpp`
  (doctest prefix `ms.`), `include/mathspace/ids.hpp` (`NoteId`,
  `SpaceId`, ddsim NodeId layout via ddsim's masks),
  `include/mathspace/version.hpp`. Gate reports 20 clean sources.
- `1d6f2f1` autonomy: driver `${budget_args[@]+...}` guard for bash 3.2
  `set -u` (was left uncommitted by the driver fix).

## Decisions

- A Space note is top level: its `space` id is unassigned (0), and that
  zero is what the hash walk writes for it.
- Field names: 1 to 31 bytes, no byte below 0x20. Anything else is
  legal in the store; the phase 2 grammar narrows what it parses.
- `Field::value` is `std::array<fx64, 8>`; lanes at index >= dim are
  always zero (set_field enforces), so `operator==` on Field matches
  hashed-byte equality.

## Learned

- Full Debug configure+build+ctest is ~10 s; Release the same. Run both
  every slice, it is cheap.
- The token gate scans comments too: writing the name of the forbidden
  container family in a header comment fails configure. Say "hash
  containers".
- `mathspace_tests` gets `MATHSPACE_GOLDEN_DIR` = `tests/golden/ms`
  (directory does not exist yet; step 5 creates it).

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)
