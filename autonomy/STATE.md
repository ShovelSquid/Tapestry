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

Nothing. (`autonomy/watch.py` is the operator's log viewer, committed in
`b2a884d`; it is theirs to edit.)

## Next

1. **Replay tool and goldens** (phase 1 needs goldens that pass two-process
   and Debug-vs-Release). `tools/ms_replay/main.cpp`, same CLI as
   `tools/ddsim_replay/main.cpp` (`<fixture>`, `--compare <golden>`,
   `--write-golden <out>`, `--roundtrip`; exit 0/1/2 the same way) but
   driving `mathspace::World` directly (`apply`, `step`, `hash`,
   `serialize`, `restore`; there is no C ABI yet and none is needed).
   Fixture text is the ddsim format from `tests/golden_support.hpp`
   (`seed <u64>` | `action <tick> <hex bytes>` | `checkpoint <tick>` |
   `#` comments; replay rule: for t = 0..max apply that tick's actions
   in file order, record the hash if t is a checkpoint, then step).
   Put a mathspace copy of the parser in `tests/mathspace/fixture.hpp`
   rather than including `golden_support.hpp`, which drags in ddsim's
   action writer; keep the grammar identical so a later merge is a
   delete. Fixtures in `tests/golden/ms/`: `empty.actions` (seed 42,
   checkpoints 0, 1, 60) and `two-notes.actions` (create a 2-space at
   tick 0, two notes with `pos` at ticks 0 and 1, SetField pos again at
   tick 2, DeleteNote one at tick 3; checkpoints 0..4). Write the hex by
   hand from `encode_*` (a doctest in `tests/mathspace/golden_test.cpp`
   that builds the same log via the encoders and checks it equals the
   fixture's bytes keeps the hex honest). CMake: `ms_replay` target next
   to `ddsim_replay`, a second `file(GLOB ...)` loop over
   `tests/golden/ms/*.actions` naming tests `ms_golden_two_process_<n>`
   and reusing `cmake/two_process.cmake` with `-DREPLAY=ms_replay`
   (check that its `ddsim_replay` in error text is only a message).
   Produce `.sha256` with `--write-golden` from native-release, then
   confirm native-debug agrees, then commit both.
2. **Tapestry Space page** (phase 1 done condition): `PageKind::Space`,
   page owns a mathspace `World`, notes drawn as labelled dots, drag
   issues `SetField pos`, `.tapestry` delta line `mspace <page> <base64
   actions>`; reload and compare hash. Link `mathspace` into
   `tapestry_core` (the tapestry CMake is a separate project; add it as a
   subdirectory or an `add_subdirectory(..)` bridge, whichever is cleaner,
   and record the choice under Decisions).

Then phase 2, per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `0978fb6` ms1 step 5: `action.hpp` kinds 32..36 + encoders,
  `action.cpp` `World::apply` (`Error::BadAction` for grammar, mutator
  errors for content), `wire.hpp` shared field record. 8 tests incl.
  every truncation/extension of every kind and log-replay == direct.
- `4c8a5de` ms1 step 4: `hash.cpp` walk + `hash`/`serialize`/`restore`
  (strict, local-then-swap, `Error::BadBytes`), `MAX_FIELDS` 255 cap with
  `Error::TooManyFields`. 9 tests incl. every-single-byte tamper.
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

- **Walk pins are `u32 FORMAT_VERSION` (world.hpp, =1) then `u32
  ddsim::DD_FX_FORMAT_ID`.** Bump FORMAT_VERSION on any walk change.
- **A note holds at most 255 fields** (`MAX_FIELDS`), because the walk's
  field count is one byte. Replacing an existing name at capacity is fine;
  a new name is `TooManyFields`.
- `restore` reuses `ddsim::ByteReader` from `ddsim/action.hpp` (public
  header, bounds-checked) rather than a copy; the writer helpers are
  re-implemented in hash.cpp since ddsim's are TU-local.
- A bound field's value lanes are still written to the walk (the phase 2
  evaluated value is state until the next tick overwrites it).

- **`apply` reports grammar and content separately.** Bytes the grammar
  cannot account for (short, bad header, unknown kind, trailing byte, dim
  above 8, bound byte not 0/1) are `BadAction`; anything that decodes is
  handed to the mutator and gets its error (`BadDim`, `BadName`,
  `NoSuchNote`...). So a replayed log and a direct build agree on every
  result code, which the replay tool will rely on.
- `src/mathspace/wire.hpp` is library-internal (not under include/): the
  field record and LE writers shared by the walk and SetField. Public
  callers use `serialize`/`restore` and the `encode_*` functions.
- Encoders do not validate; they exist so tests and tools never hand-pack
  bytes. Validation happens once, in `apply`.

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
