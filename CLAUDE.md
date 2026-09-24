# physics-engine — working notes for Claude

This repo is building **mathspace**: a schema-less store of spatial notes in
an N-dimensional space, with expressions, rules, constraints, views, and
metric spaces layered on top. Read these two files before anything else:

- `mathspace_design.md` — what the thing is.
- `mathspace_plan.md` — phases, files, done conditions, and the
  foundational decisions that must not be silently changed.

`ddsim` (`include/ddsim`, `src/`) is the inherited fixed-point sim. It is
reference material and stays untouched until plan phase 7.

## Build and test

```bash
cmake --preset native-debug -DDDSIM_DOCTEST_DIR="$(pwd)/third_party/doctest"
cmake --build build/native-debug -j
ctest --test-dir build/native-debug --output-on-failure
```

`native-release` and `native-ubsan` presets exist; the golden hash tests
compare Debug against Release, so run both presets before calling a
phase done. Tapestry (`tapestry/`) builds separately with
`cmake -S tapestry -B build/tapestry && cmake --build build/tapestry -j`
and needs SDL2 (installed via Homebrew) and network on first configure
for glad. `--headless --frames N` runs it without a display.

## Invariants (the plan lists them too; they are absolute)

- No `float`, `double`, `<cmath>`, `<random>`, or `unordered_` anywhere in
  `include/`, `src/`, `wasm/`. The gate in `cmake/forbidden_tokens.cmake`
  fails configure if you slip.
- Every loop bound is fixed, never a convergence check.
- Every iteration over notes, fields, or tuples is in id order or name order.
- A rejected action leaves state byte-identical.
- Rendering and view state never enter the hash.
- Each phase ends with golden fixtures that pass two-process and
  Debug-vs-Release checks.

## Autonomous protocol

Sessions are started by `autonomy/run.sh` with no human present. Each
session is one bounded slice of work. The protocol:

1. Run `git status` and `git log --oneline -5`. Read `autonomy/STATE.md`.
   If the tree is dirty, that is the previous session's unfinished slice:
   read the "In progress" section and any `wip:` commits at the top of
   the log, then either finish it to green tests and commit, or
   `git checkout -- . && git clean -fd` and note why in STATE.md. Never
   leave a dirty tree at the end of a session. When you are in the middle
   of a slice, keep the "In progress" section of STATE.md current enough
   that a successor could continue from your last commit: what is done,
   what the next edit was going to be, and any half-formed conclusion.
2. Pick the **smallest next step** from STATE.md's "Next" list that can end
   in passing tests and one commit. Do not start a second step in the same
   session unless the first took under ten minutes.
3. Do the work. Build. Run the full test suite. Fix what you broke.
   **Commit as you go.** Whenever the tree builds and the existing tests
   pass, commit, even if the slice is half done; prefix such commits with
   `wip:` and fold them into the final commit only if that is quick. A
   session can end at any moment (power, network, an operator-set time
   limit stated in your prompt), and work that is not committed is work
   the next session has to redo from a dirty tree without your reasoning.
   Aim for a commit at least every thirty minutes of work.
4. Commit with a message that starts with the phase, e.g.
   `ms1: field store with sorted names`. End the message with
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
5. Update `autonomy/STATE.md`: move the step to "Done" with the commit
   hash, rewrite "Next" so the top item is concrete enough to start cold,
   record anything surprising under "Learned", and record anything you
   decided that the plan did not under "Decisions". Commit STATE.md
   separately as `state: <one line>`.
6. When a phase's done condition in the plan is met, say so in STATE.md
   under "Phases" and update `README.md`'s status paragraph.
7. When every phase is done, create the file `autonomy/DONE` with a
   summary and commit it. The driver stops on that file.
8. Exit. Do not ask questions; there is nobody to answer. If a decision is
   genuinely blocked, write the question under "Blocked" in STATE.md, pick
   the option the plan's spirit favours, record that you did, and continue.

Keep STATE.md under about 200 lines. Older "Done" entries can be
collapsed to one line each; git has the details. STATE.md is the memory
between sessions. The plan is the map. Do not duplicate either into the
user-level memory directory; that directory is for facts about this
machine's environment only.

## Style

Match the existing code: C++20, `fx64` for anything hashed, header
comments that explain why, doctest tests next to the feature, small
commits. Prefer deleting an inherited special case over adding a new one.
