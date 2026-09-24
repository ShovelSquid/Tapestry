# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 2: approved`, or the issues you saw); the next session acts on it.

## Open

### 1. Moved from autonomy/WAITING (not yet resolved; the next session resolves it per PROTOCOL step 4)

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
