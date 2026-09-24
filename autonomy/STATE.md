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

The Tapestry Space page (phase 1 done condition) is split into three
slices; do them in order, one per session unless the first is quick.

1. **2a Space page model + `.tapestry` round trip, headless.** Build the
   tapestry tree first to confirm the environment
   (`cmake -S tapestry -B build/tapestry && cmake --build build/tapestry -j`;
   first configure needs network for glad). Then:
   - CMake bridge: in `tapestry/CMakeLists.txt` before `tapestry_core`,
     `add_subdirectory(${PROJECT_SOURCE_DIR}/.. ${CMAKE_BINARY_DIR}/physics-engine)`
     (the root CMakeLists already forces `DDSIM_BUILD_TESTS OFF` when it is
     not the top-level project, line ~30; verify) and link `mathspace` into
     `tapestry_core` PUBLIC. Record the choice under Decisions. Tapestry is
     not under the forbidden-token gate (gate covers include/, src/, wasm/
     only), so its doubles are fine; only mathspace bytes are hashed.
   - `PageKind::Space` appended AFTER `Settings` in `tapestry/core/Page.hpp`
     so the numeric kinds already in saved files do not shift.
   - `tapestry/core/Space.hpp`: `struct SpacePage { mathspace::World world;
     std::vector<std::vector<std::uint8_t>> log; std::size_t saved = 0; }`,
     one per Space page, kept in the tapestry `World` in a vector sorted by
     page id (find the page container in `tapestry/core/World.hpp`). `apply`
     helper: `world.apply(bytes)`; on Ok push to `log`. The World's seed is
     the page id. mathspace has no journal, so the page keeps the full log;
     the snapshot writes all of it, a delta writes `log[saved..]`.
   - Document (`tapestry/core/Document.cpp`): new body line
     `mspace <page-id> <base64 action bytes>`, one per action, in log order;
     base64 encoder/decoder local to Document.cpp (std only). On load,
     apply each line to that page's world in file order; a rejected action
     fails the load like any other malformed line. After a successful save
     set `saved = log.size()`.
   - Test in `tapestry/tests/DocumentTest.cpp`: make a Space page, apply
     CreateSpace(2), CreateNote, SetField pos; save; reload into fresh
     state; `mathspace::hash` equal before and after; save again, then a
     second SetField, save (delta), reload, hash equal again.
2. **2b render.** Notes drawn as labelled dots in `tapestry/render/Pages.cpp`
   for `PageKind::Space` pages: iterate the page world's notes in id order,
   skip the Space note, take `pos` lanes 0 and 1 (a 3-space draws x,y and
   ignores z for now), label i-th note from the i-th line of the page body.
3. **2c input.** In `tapestry/app/main.cpp`: a "new 2D space" / "new 3D
   space" command creating a Space page and applying CreateSpace(dim);
   click in the body creates a note (CreateNote + SetField pos); dragging a
   dot issues SetField pos on release (one action per drag, not per
   frame). `--headless --frames N` must still run. Then check phase 1's
   done condition and mark it in Phases and README.md.

Then phase 2, per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `a9297de` ms1 step 6: `tools/ms_replay/main.cpp` (ddsim_replay CLI twin over
  `World`), `tests/mathspace/fixture.hpp` (parser copy, identical grammar),
  goldens `empty` and `two-notes` under `tests/golden/ms` with `.sha256`
  from native-release, confirmed by native-debug; `golden_test.cpp` checks
  hand hex == encoders, replay == direct build, in-process == committed.
  CMake `ms_replay` + `ms_golden_two_process_<n>` via `two_process.cmake`.

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
- `mathspace_tests` and `ms_replay` get `MATHSPACE_GOLDEN_DIR` =
  `tests/golden/ms`. New fixtures there are picked up at configure
  (GLOB CONFIGURE_DEPENDS); write the `.sha256` from native-release,
  then run native-debug's ctest to confirm before committing.

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)
