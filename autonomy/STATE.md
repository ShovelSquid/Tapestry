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

Nothing of mine. **`autonomy/watch.py` is untracked and not ours**: an
operator wrote it at 11:02 on 2026-09-24 while a session was running,
and it is their live log viewer (two copies were running). Do not
`git clean -fd` it away and do not commit it for them; if it shows up in
`git status`, ignore it. If it has been committed by the operator, delete
this paragraph.

## Next

1. **Canonical walk + hash** in `src/mathspace/hash.cpp`, per the plan's
   walk with one addition: `u32 next_group` right after `u64 tick` (see
   Decisions). Declare `hash(const World&, uint8_t out[32])`,
   `serialize(const World&) -> std::vector<uint8_t>`,
   `restore(World&, bytes) -> Error` in `world.hpp` (add `Error::BadBytes`).
   `restore` decodes into a local World, checks `well_formed()`, and swaps
   only on success. Use `ddsim::sha256_bytes` from `ddsim/sim.hpp`. Look at
   `src/hash.cpp` for the ddsim byte-writer helpers and copy the style, not
   the code. Tests in `tests/mathspace/hash_test.cpp`: hash equal after
   round-trip, every single-byte tamper of a serialized world is rejected
   or hashes differently, restore failure leaves state untouched, hash
   changes when a field value / name / dim / bound / kind / space changes,
   hash ignores nothing that `operator==` sees.
2. **Actions** `include/mathspace/action.hpp`: kinds 32 to 36 with the
   ddsim header layout, bounds-checked decoder into a local, `World::apply`.
   Tests per kind including malformed payloads.
3. **Replay tool and goldens**: `tools/ms_replay/main.cpp`, fixture format
   shared with `tests/golden_support.hpp` where possible,
   `tests/golden/ms/empty.actions` and `two-notes.actions` with `.sha256`,
   wired into the two-process CTest loop in `CMakeLists.txt`.
4. **Tapestry Space page** (phase 1 done condition): `PageKind::Space`,
   page owns a mathspace `World`, notes drawn as labelled dots, drag
   issues `SetField pos`, `.tapestry` delta line `mspace <page> <base64
   actions>`; reload and compare hash. Link `mathspace` into
   `tapestry_core` (the tapestry CMake is a separate project; add it as a
   subdirectory or an `add_subdirectory(..)` bridge, whichever is cleaner,
   and record the choice under Decisions).

Then phase 2, per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `1832b88` ms1 step 3: `world.hpp`/`world.cpp` World store: create_space,
  create_note, set_field, delete_note, delete_field, step, well_formed,
  Error enum + error_name. 12 tests incl. untouched-on-reject checks.
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

- **A space's dimension is the dim of the Space note's own `pos` field**
  (zero vector, set by create_space). The plan's hash walk has no per-note
  dim slot, so dim had to be a field; `pos` is the one name the store
  already knows structurally. Rewriting a Space's pos at another dim is
  PosDimMismatch; deleting it is LockedField.
- `create_note` always allocates a fresh group ordinal (group of one,
  index 0). Appending to an existing group (stroke emission) is deferred
  until the input bridge needs it; it will need a per-group counter that
  must be serialized, so decide it then.
- `delete_note` on a Space that still holds notes is SpaceNotEmpty, not
  a cascade. Explicit over hidden mutation; can be relaxed later.
- `next_group` is state that must round-trip through serialize/restore,
  else a restored world could reuse a deleted group's ordinal and diverge
  from the original on the next create. It goes into the hash walk as
  `u32 next_group` immediately after `u64 tick`. This is a deliberate
  addition to the plan's walk, recorded here rather than made silently.
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
