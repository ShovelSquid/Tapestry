# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 2: approved`, or the issues you saw); the next session acts on it.

## Open

### 1. Phase 02.6, plan 02.6-02, Task 1 — record shape / settings migration gate (resolved as `recommended` by the 15:15 session, 2026-09-24)

**Chosen (PROTOCOL step 4, decision -> Recommended option):** `recommended` — Option A names and every
answer marked Recommended in Parts 1-4 (1.3 absolute path hints, 1.4 frames write only origin.x/origin.y,
1.10 ~/Documents/Tapestry/Tapestry.tree, 2.1 pointer key `tapestry`, launch cases (i), Part 3 (a) run,
4.1 app-error banner). Every item is recorded in shapes.ts and 02.6-02-SUMMARY § Checkpoint decisions.

**To check:** `awk '/PART 1 — Record shape/,/<\/task>/' .planning/phases/02.6-placement-edges-forest-tree/02.6-02-PLAN.md`
and compare with `app/src/main/space/shapes.ts` (or wherever 02.6-02-SUMMARY says the shapes live).
Before approving, nothing here has touched real data: tests use temp dirs only.

**If the answer is no:** write overrides by number into autonomy/RESPONSE (e.g. `item 1: 1.3 home-relative, 3 single`).
Plans 03-06 build on these shapes, so the fix is a gap-closure plan editing shapes.ts plus the writers;
since no real Tapestry.tree/Forest.tree has been written by a released build, changing the shape is still cheap
until you launch the app against your real settings.json. Do not run the app on real data until you answer.

Original gate text:

WAITING — Phase 02.6, plan 02.6-02, Task 1 (checkpoint:decision, gate="blocking-human")

What: approve the one-way door before any forest / Tapestry-tree record or
settings.json v2 is written:
  Part 1  on-disk record shape (#17): node types, keys, edge label, actors,
          world names, file locations, commit messages (items 1.1-1.12)
  Part 2  settings.json migration (#18): pointer key, version 2, import order,
          launch cases A-J
  Part 3  how far Ctrl+Z reaches after frame drags (run vs single)
  Part 4  every new sentence the phase shows (4.1-4.12)

Read the full question here (all options and the Recommended answers):
  .planning/phases/02.6-placement-edges-forest-tree/02.6-02-PLAN.md
  -> the first <task> block, "PART 1 — Record shape" through the <options>.
  e.g.  awk '/PART 1 — Record shape/,/<\/task>/' \
          .planning/phases/02.6-placement-edges-forest-tree/02.6-02-PLAN.md

For item 1.4 (which placement keys are written), take the 3D frame
convention into account:
  .planning/phases/02.6-placement-edges-forest-tree/02.6-3D-FRAMES.md
(recommendation: frames write only origin.x / origin.y; the other six reals
stay unwritten with defaults stated in the reader's guide).

Background, if wanted: 02.6-RESEARCH.md § Q7, § Q8, Open Questions 2, 3, 6;
02.6-CONTEXT.md D-06, D-10, D-13, D-14; Decision Register Pending #17 / #18.

Pre-check done: `git grep -n SETTINGS_POINTER_KEY -- app/src` prints
nothing, and app/src/main/space/ does not exist, so nothing has been written.

How to answer: one of
  recommended          (Option A names + every Recommended answer)
  option-b             (everything under tapestry.forest/, member.tree / member.path)
  option-c             (tapestry.spaces/space@1 + tapestry.spaces/tree@1)
or overrides by number, e.g.
  "recommended, except 1.3 home-relative, B ii, 3 single, 4.5: <your wording>"

When done, write your answer (`approved`, or the issues you saw) into `autonomy/RESPONSE`, delete this file, and rerun `autonomy/run.sh`.

### 2. Phase 02.6, plan 02.6-03 — launch into the forest, one signed commit per drop (queued by the 15:28 session, 2026-09-24)

**What was built (82df051, 719ba90):** app launch starts the space and draws frames from `Forest.tree`;
a drop plus every frame it pushed aside is one commit signed `human user.<name>` via a new
`trees:moveFrames` channel; quit releases the locks; dev-only `TAPESTRY_USER_DATA_DIR` /
`TAPESTRY_SPACE_DIR` variables. Tests for no-write launch cases E, G, H. 559 tests green.
Deviation: note handlers that push frames now use the same batched call (settleFrames was removed).
Note: case H (wrong forest) cannot tell two forests apart if created in the same second, since every
forest is named `Forest`; a kernel change, left as is.

**No human gate in this plan**; this is its end-of-phase check, best done together with Plan 06's.
Use copies only, never real data:
1. `cp -R ~/Library/Application\ Support/@tapestry/app /tmp/tapestry-ud-copy && mkdir /tmp/tapestry-space-scratch`
2. `TAPESTRY_USER_DATA_DIR=/tmp/tapestry-ud-copy TAPESTRY_SPACE_DIR=/tmp/tapestry-space-scratch npm --prefix app run dev`
3. Your frames appear where they were.
4. Drag a frame so it pushes another aside, quit, relaunch with the same variables: both stay where they landed.
5. Open `/tmp/tapestry-space-scratch/Forest.tree`: each tree's path and position is readable; the latest move is signed `human user.<name>`.
6. In the copied `settings.json` the `trees` list is unchanged, `version` is 2, and the pointer names the scratch `Tapestry.tree`.

**If the answer is no:** `git revert 82df051` (and 719ba90), delete the scratch folders, and describe the issue in autonomy/RESPONSE.
Until Plans 04-05 land, open/create/close tree and add-vault still write settings.json; do not run on real data before Plan 06's check.

### 3. Phase 02.6, plan 02.6-04 — membership and identity by header digest (queued by the 15:39 session, 2026-09-24)

**What was built (8b85ae5, d6efff1, b73ec11):** opening, creating or adding a tree writes one
`add tree` commit signed by the person, then one `record identity` commit signed `system tapestry`
(once only). Closing writes one person-signed `delete-node` commit. A moved file keeps its frame; a
copy of an open world is refused; a different world at a tree's path shows as unavailable and writes
nothing; duplicate entries fold into one system commit. `Forest.tree`/`Tapestry.tree` (or copies) cannot
be added. Open/create/close/vault handlers no longer write settings.json `trees` (only `trees:setFrame`
does, until Plan 05). 576 tests green.
Deviations (see 02.6-04-SUMMARY): Plan 02's first-launch test now expects 3 forest commits; self-file
protection runs before trees are restored; vault restore carries the expected digest; re-adding a
member without identity writes the identity commit. `vault:locate` doesn't exist on this branch yet;
`relocateMember` is ready for it.
Edge case left for Plan 06: explicitly opening a path now holding a different world gives it a new
entry; the old tree is hidden that session and reappears as unavailable after relaunch.

**No human gate in this plan**; end-of-phase check, together with items 2 and Plan 06's, copies only
(same `TAPESTRY_USER_DATA_DIR` / `TAPESTRY_SPACE_DIR` setup as item 2):
1. Open a tree. `Forest.tree` gains an `add tree` commit signed by you, then a `record identity` commit
   signed `system tapestry`.
2. Close it. The latest commit is `remove tree ... from the forest` with `delete-node`; the tree stays
   gone after a relaunch.
3. Try to open `/tmp/tapestry-space-scratch/Forest.tree` as a tree: refused with the approved sentence,
   nothing written.

**If the answer is no:** `git revert b73ec11 d6efff1 8b85ae5` and describe the issue in autonomy/RESPONSE.

### 4. Phase 02.6, plan 02.6-05 — Ctrl+Z after a drag, system-signed fit (queued by the 15:56 session, 2026-09-24)

**What was built (1ee3adc, ed0a42f, 9340af9):** Ctrl+Z right after dragging a frame writes a new
person-signed commit to `Forest.tree` that restores the dragged frame and every frame it pushed aside
(before-values read from the forest by main, never from the renderer); Ctrl+Shift+Z redoes. Reach is
`'run'` (approved Part 3 answer): consecutive drags undo one by one; editing, selecting, or a tree undo
ends the run, and Ctrl+Z goes back to the selected tree. History capped at 100 drops
(`FRAME_HISTORY_LIMIT`). Automatic fit is signed `system tapestry`, only when a frame actually moves, at
most once per tree per session, never over a frame the person moved. `trees:setFrame` is removed, so
nothing writes frame positions to settings.json. A failed drop shows the 4.12 banner "Could not move the
frame: [reason]" and frames snap back. 596 tests green.
Deviations (see 02.6-05-SUMMARY): undo/redo/fit commit messages added to `shapes.ts`; `close()` also
clears frame history and fit allowance.

**Task 1's hands-on check was deferred** (approved-deferred, PROTOCOL step 4). On copies only (same
`TAPESTRY_USER_DATA_DIR` / `TAPESTRY_SPACE_DIR` setup as item 2):
1. Drag a frame so it pushes another aside, press Ctrl+Z: both return.
2. Press Ctrl+Shift+Z: both move again.
3. Drag two frames in turn, press Ctrl+Z twice: both drags undone.
4. Edit a note, press Ctrl+Z: the note edit is undone, not a frame.
5. `Forest.tree`: the moves and their undos are separate commits signed `human user.<name>`; a fit, if
   any, is signed `system tapestry`.

**If the answer is no:** `git revert 9340af9 ed0a42f 1ee3adc` and describe the issue in autonomy/RESPONSE.

### 5. Phase 02.6, plan 02.6-06 — end-of-phase check on copied data (queued by the 16:08 session, 2026-09-24)

**What was built (9b9ff29, 6247076):** launch with no pointer recovers a half-finished upgrade without
importing twice: an existing `Tapestry.tree` is reopened and the pointer rewritten last (case B(i)); a
lone `Forest.tree` is reused unwritten and a new Tapestry tree names its digest (case C(i)); a foreign
file is refused with the 4.7 wording and left byte-identical. A space that can't open shows why in the
app-error banner (4.1 banner), once per distinct message; add-tree / add-vault refusals now show the
approved sentences verbatim. The settings writers `addTree`, `setTreeFrame`, `removeTree`,
`migrateLastOpened` are deleted (2.2 delete); every settings write carries `trees` unchanged. Reader's
guide: `tapestry/docs/tree/forest.md`. 30 files / 619 app tests, 59/59 kernel tests, typecheck clean.
Deviations (see 02.6-06-SUMMARY): a Plan 01 test that expected `trees: []` in a brand-new settings file
now expects no `trees` key; refusals travel as a dedicated error type that main turns into the notice.

**Plan 06's human check was deferred** (approved-deferred, PROTOCOL step 4). It also covers items 2-4;
do it once, on copies only. Close every Tapestry window first, then:
`cp -R ~/Library/Application\ Support/@tapestry/app /tmp/tapestry-ud-copy && mkdir -p /tmp/tapestry-space-scratch`
`TAPESTRY_USER_DATA_DIR=/tmp/tapestry-ud-copy TAPESTRY_SPACE_DIR=/tmp/tapestry-space-scratch npm --prefix app run dev`
1. Your trees appear where they were. `Forest.tree` and `Tapestry.tree` exist in the space folder. In the
   copy's `settings.json`, `trees` is unchanged, `version` is 2, and the pointer is set.
2. Open `Forest.tree` in a text editor: you can tell which tree each stand-in is, where each frame sits,
   and who wrote each commit. Compare with `tapestry/docs/tree/forest.md`.
3. Drag a frame into another: one move, one commit. Ctrl+Z: both return. Ctrl+Shift+Z: they move again.
   Edit a note and press Ctrl+Z: the note edit is undone.
4. Add a tree, close it, relaunch: the closed tree is gone, and its removal is a signed commit.
5. Quit. Rename one member's file, relaunch: it is listed as can't-be-found. Add it again from its new
   name: it returns to its old frame.
6. Open tree on `Forest.tree`: the approved refusal.
7. Quit. Rename `Tapestry.tree` in the space folder and relaunch: the approved message, an empty space,
   nothing new written. Rename it back and relaunch: everything returns.
8. With one window running, launch a second with the same variables: the approved locked message
   appears in the second window.

**If the answer is no:** `git revert 6247076 9b9ff29` for this plan (items 2-4 list theirs), and describe
the issue in autonomy/RESPONSE.
