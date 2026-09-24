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
slices; 2a and 2b are done, 2c remains.

1. **2c input.** In `tapestry/app/main.cpp`: a "new 2D space" / "new 3D
   space" command (menu entry or key, next to wherever new Note pages are
   made) creating a Space page and applying
   `encode_create_space(dim)`; click in a Space page's body creates a
   note (`encode_create_note(space_of(spaceId), NoteKind::Note)` then
   `encode_set_field(id, pos)` with pos = click point minus the body's
   top-left, in world units, `fx64::from_int` or q16 rounding); dragging
   a dot issues one SetField pos on release (not per frame). The
   space's id is the id of the world's single `NoteKind::Space` note.
   Body geometry: top-left is `page.rect.x + kPadding`,
   `page.rect.y + kPageTitleBarHeight + kPadding/2` (Pages.cpp), dot
   radius 4 world units; a hit-test helper next to `pageTextRegionAt`
   in Pages.hpp keeps input and render on the same geometry. Body text
   editing on a Space page is now label editing (one line per note);
   decide whether a click on a dot vs. blank body still opens the body
   editor. Then check phase 1's done condition (2D and 3D spaces
   created, notes placed and dragged, saved, reopened, hash equal) and
   mark it in Phases and README.md.

Then phase 2, per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `a118cba` ms1 step 7 (Space page 2b): `drawPages` threads
  `world.space(page.id)` into `drawPage`; `drawSpaceBody` draws each
  non-Space note in id order as a dot at `pos` lanes 0,1 (fx64 raw/2^32
  to double only at the nanovg call) labelled with the i-th body line.
  Verified by a windowed `--screenshot` over a generated fixture.

- `bdf03eb` ms1 step 7 (Space page 2a): tapestry CMake bridge to root
  `mathspace`, `PageKind::Space`, `core/Space.hpp` SpaceState (World +
  log), `World::applySpaceAction/space/adoptSpace`, `.tapestry` `mspace`
  and `mreset` lines, DocumentTest hash-equal round trip via baseline and
  delta. Headless run still clean.

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

- **Tapestry links mathspace by `add_subdirectory(${PROJECT_SOURCE_DIR}/..
  ${CMAKE_BINARY_DIR}/physics-engine)`** with `DDSIM_BUILD_TESTS` forced
  OFF first (the root only forces it off under Emscripten). Chosen over a
  duplicate library definition so there is one source list; the root's
  forbidden-token gate still runs at tapestry configure.
- **A Space page keeps its whole action log** (`SpaceState::log`), because
  mathspace has no journal; the baseline writes it all, a delta writes the
  tail past the file's copy, and `mreset <page>` precedes a full rewrite
  when the file's log is not a prefix (hand-edited file). `mspace` lines
  are applied as they are parsed, so a rejected action is a corrupt block.
- A Space page's mathspace `World` is seeded with the page id.
  `applySpaceAction` on a missing or non-Space page returns
  `mathspace::Error::NoSuchSpace` rather than adding a tapestry error type.
- `PageKind::Space` is appended after `Settings`; the format writes kinds
  by name ("space") so the numeric position only matters in memory.

## Learned

- Tapestry configure works on this machine (glad fetched, SDL2 present);
  full tapestry build ~1 min, its three test binaries run in under a
  second. Only warnings are pre-existing macOS deprecations in
  `FileDialog_mac.mm`.
- Full Debug configure+build+ctest is ~10 s; Release the same. Run both
  every slice, it is cheap.
- The token gate scans comments too: writing the name of the forbidden
  container family in a header comment fails configure. Say "hash
  containers".
- Rendering is not exercised headless (`gfx.vg` is null, so drawPages is
  never called). To see a Space page: generate a `.tapestry` with a
  throwaway program linked against `build/tapestry/libtapestry_core.a`
  + `physics-engine/libmathspace.a` + `libddsim.a` + `third_party/
  libnanovg.a` (`-I tapestry -I include`), then run
  `tapestry --file F --frames 5 --size 640x480 --screenshot out.png`
  under a `perl -e 'alarm 60; exec @ARGV'` cap; a cocoa window opens
  fine on this machine unattended and the run takes ~2 s. Read the PNG.
- `mathspace_tests` and `ms_replay` get `MATHSPACE_GOLDEN_DIR` =
  `tests/golden/ms`. New fixtures there are picked up at configure
  (GLOB CONFIGURE_DEPENDS); write the `.sha256` from native-release,
  then run native-debug's ctest to confirm before committing.

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)
