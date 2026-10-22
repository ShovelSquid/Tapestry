---
phase: 02-shell
plan: "03"
subsystem: ui
tags: [rust, egui, shell, tool-routing, input-router, raw-input, terminal, simulation]

# Dependency graph
requires:
  - phase: 02-shell
    provides: "02-02 explorer, Cmd-K palette with typed PaletteAction, Cmd-K raw-input filter, GraphCamera navigation"
provides:
  - shell::Destination (Graph, Simulation, Rules, Files, Terminals, Notes, File(PathBuf)) kept separate from Tab, with Destination::regions mapping each destination to the existing Tab panes
  - Simulation composite view (Brushes left, Timeline bottom, Canvas and swarm center), each pane keeping its own marks key
  - route_palette_action, resolve_editor, and apply_ide_handoffs reducers so palette results, Ide open_requests, and terminal reveal_files select destinations without rebuilding App or Ide owners
  - shell_input as the single keyboard policy - filter_shell_chords (Cmd-K, Cmd-Shift-W), route_escape, route_exit_chord, simulation_keys_active, withhold_keyboard
  - raw_input_hook filtering of shell chords before marks and before Terminal::take_input, with chords queued for App::ui
affects: [02-shell, 02-04 dock removal, 03-canvas, shell-input]

# Actuals (#2632)
actuals:
  tokens: 11320
  tasks: 3
  commits: 6
commits: 6
plan_head_before: 7110c5e95f1bc01f7a4d408a4c8d3abe4f8a01a5

# Tech tracking
tech-stack:
  added: []
  patterns: [destination enum separate from dock Tab identity, pure reducers for shell transitions, raw_input_hook chord filtering with queued shell actions, focus struct fed to one shortcut policy, withhold-then-restore of keyboard events around views drawn under an overlay]

key-files:
  created: []
  modified: [apps/canvas/src/shell.rs, apps/canvas/src/shell_input.rs, apps/canvas/src/main.rs]

key-decisions:
  - "Destination is its own enum; Tab variants and their Debug spellings are unchanged, so marks pane keys and TAPESTRY_FILL keep working."
  - "Switching destinations only changes App::destination. App and Ide owners, editor buffers, and terminal processes stay alive while hidden."
  - "Shell chords are taken out of raw input in raw_input_hook, as both Key and the Text the press would type, then queued on App and applied at the start of App::ui."
  - "Cmd-K means Command without Shift; Cmd-Shift-W is the exit chord, checked first. Cmd-W and plain W still reach the terminal."
  - "Esc order is palette, then focused owner or tool (text field, opened Ide card, active terminal, picked keyframe), then return from a hosted view, then graph-local cancel (clear the selected note)."
  - "Simulation keys run only while Simulation is the destination and neither the palette nor a focused owner has the keyboard. Marks Cmd-Z undo stays available in other views when the keyboard is free."
  - "An open palette withholds key, text, and clipboard events from the views drawn under it and restores them before drawing itself, because Terminal::take_input drains every event."

patterns-established:
  - "KeyFocus is built once per frame in App::key_focus and passed to the pure shell_input policy functions."
  - "An Ide card counts as a focused owner only while its Files or Terminals view is showing."

requirements-completed: [SHELL-03, SHELL-04, SHELL-05]
coverage:
  - id: D1
    description: "Palette actions open Simulation, Rules, Files, Terminals, Notes, and editor tabs full-window. Simulation groups canvas, brushes, and timeline. Tab Debug identities are stable, and view changes keep the existing state owners."
    requirement: SHELL-04
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline tool_routing"
        status: pass
    human_judgment: true
    notes: "Routing and owner preservation are tested; native rendering of the composite needs a host check (question 16)."
  - id: D2
    description: "Ide open_requests select the matching File destination, terminal reveal_files selects Files, hidden terminals keep their session owner, and palette editor results reuse the existing buffer."
    requirement: SHELL-04
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline ide_handoffs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cmd-K with terminal focus opens the palette and Cmd-Shift-W leaves any hosted view; both chords are removed as Key and Text events before PTY input."
    requirement: SHELL-05
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline input_router"
        status: pass
    human_judgment: true
    notes: "Event filtering is tested; confirm with a focused native terminal (question 16)."
  - id: D4
    description: "Esc follows palette, focused owner or tool, hosted-view return, then graph-local cancel. Simulation bindings fire only while Simulation is hosted and the keyboard is free. An open palette withholds keyboard events from the views under it."
    requirement: SHELL-05
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline input_router"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline"
        status: pass
    human_judgment: true
    notes: "Policy functions are tested. The App wiring in main.rs (key_focus, keyboard, withhold/restore) has no automated test and needs a host check (question 16)."
  - id: D5
    description: "The Cmd-K palette from 02-02 stays reachable from every destination through the shared router."
    requirement: SHELL-03
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline input_router_cmd_k_with_terminal_focus_opens_palette_before_pty_input"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-10-22
status: complete
---

# Phase 02 Plan 03: Hosted Tools and Shell Input Router Summary

**Every existing tool now opens full-window from Cmd-K through a typed `shell::Destination`, with Simulation grouping canvas, brushes, and timeline, and one `shell_input` policy filters Cmd-K and Cmd-Shift-W out of raw input before the PTY, orders Esc, and limits simulation keys to the Simulation view.**

## Performance

- **Duration:** about 9 min of commits (first task commit 2026-10-22T09:32:48Z, last 2026-10-22T09:41:12Z). The first executor stopped before Task 3 GREEN. A continuation session finished the uncommitted Task 3 work and closed out the plan.
- **Tasks:** 3, all TDD, each with a RED and a GREEN commit
- **Files modified:** 3 source files, plus 3 RED evidence JSON files

## Accomplishments

- **Tool routing (Task 1):** `shell::Destination` is separate from the dock's `Tab`. `Destination::regions` maps each destination onto the existing Tab renderers. Simulation draws Brushes on the left, Timeline at the bottom, and Canvas with the swarm in the center. Rules, Files, Terminals, Notes, and each `File(path)` are separate full-window views. `TAPESTRY_FILL` and the synced maximized tab map onto destinations. Palette dispatch changes only `App::destination`. `Ide::begin_frame` runs every frame, and the highlight, tabnote, and marks overlays draw above every destination.
- **Handoffs (Task 2):** `apply_ide_handoffs` turns `Ide::open_requests` into the matching `File` destination and `reveal_files` into `Files`. `resolve_editor` makes a palette editor result select the existing buffer by its path and load it only if it is missing, so dirty buffers survive. Terminal processes stay owned by `Ide` while Terminals is hidden.
- **Input router (Task 3):** `filter_shell_chords` replaces 02-02's `filter_palette_shortcut`. It removes the Cmd-K and Cmd-Shift-W Key events (press and release) and the Text event each press would type. `raw_input_hook` runs it before marks interception and before any `Terminal::take_input`, and queues the chords on `App::chords`. `App::apply_chords` applies them at the start of `App::ui`: it opens the palette, or uses `route_exit_chord` to return from any hosted view to the graph. `App::keyboard` builds a `KeyFocus` and routes Esc with `route_escape`. It consumes Esc when the shell acts on it, so views under the palette never see it. Simulation bindings (Space, 1-7, Delete/Backspace, Cmd-Z, arrows, Home, Esc to drop a picked keyframe) run only when `simulation_keys_active` allows them. The hosted view's old ad hoc Esc check is gone. While the palette is open, `withhold_keyboard` keeps key, text, and clipboard events from the views drawn under it, and they are restored before the palette draws.

## Task Commits

1. **Task 1: Route every palette destination through persistent tool owners**
   - RED `3857586` test(02-03): add failing tool routing tests
   - GREEN `82050be` feat(02-03): route palette destinations through persistent tool owners
2. **Task 2: Preserve file-tab and terminal handoffs in hosted views**
   - RED `1761048` test(02-03): add failing ide handoff tests
   - GREEN `3c678bb` feat(02-03): preserve file-tab and terminal handoffs in hosted views
3. **Task 3: Filter shell shortcuts before terminal input and centralize precedence**
   - RED `9e724bd` test(02-03): add failing input router tests
   - GREEN `7d576df` feat(02-03): route shell shortcuts through one focus-aware input policy

`7110c5e` (docs(02-02): clarify host UI verification) comes just before this plan's first commit. It is the measurement base (`plan_head_before`) and is not counted as part of 02-03.

## Files Created/Modified

- `apps/canvas/src/shell.rs`: Destination, Region, regions/is_hosted, route_palette_action, resolve_editor, apply_ide_handoffs, plus tool_routing and ide_handoffs tests
- `apps/canvas/src/shell_input.rs`: ShellChords, KeyFocus, EscapeRoute, filter_shell_chords, route_escape, route_exit_chord, simulation_keys_active, withhold_keyboard, plus input_router tests
- `apps/canvas/src/main.rs`: hosted full-window views, Ide handoff wiring, queued chords, apply_chords, key_focus, the router-driven keyboard, and palette keyboard withholding

## Verification

- `cargo test -p tapestry-canvas-app --offline tool_routing`: 4 passed
- `cargo test -p tapestry-canvas-app --offline ide_handoffs`: 4 passed
- `cargo test -p tapestry-canvas-app --offline input_router`: 5 passed
- `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline`: canvas 21, canvas-app 47 (2 ignored), and every vault suite passed (unit 9, blocks 18, frontmatter 33, grammar 2, index 4, links 18, scan 5, store 20, tracer 1, watch 3)
- Clippy reports no new findings in the edited regions. The only compiler warnings are the expected `Ide::tab_title` and `Ide::close` dead-code warnings, which go away when 02-04 removes the dock.

## TDD Gate Compliance

All three tasks have a RED `test(02-03)` commit followed by a GREEN `feat(02-03)` commit. RED evidence is in `02-03-task1-red.json`, `02-03-task2-red.json`, and `02-03-task3-red.json`. In Task 3's RED run, 4 of 5 tests failed on assertions. The Cmd-K test already passed because of 02-02's filter and is kept as a regression guard.

## Decisions Made

See `key-decisions` in the frontmatter. In short: Destination is separate from Tab; switching views never rebuilds owners; shell chords are filtered in raw input and queued; Esc follows the locked precedence; simulation keys are gated on the Simulation destination and on keyboard focus.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ide card focus counted only while its view shows**
- **Found during:** Task 3 GREEN
- **Issue:** `Ide::has_focus()` stays true when a file or terminal card is left open and the user leaves Files or Terminals. Read directly, it would block simulation keys in Simulation and turn graph Esc into a no-op.
- **Fix:** `App::key_focus` treats an open Ide card as a keyboard owner only when the destination is `Files` or `Terminals`. `terminal_active()` already checks visibility.
- **Files modified:** apps/canvas/src/main.rs
- **Commit:** 7d576df

**2. [Rule 2 - Security, T-02-06] Open palette withholds keyboard events from hosted views**
- **Found during:** Task 3 (the RED tests define this policy)
- **Issue:** `Terminal::take_input` drains every event in the frame. With the palette open over a focused terminal, the query being typed would also reach the PTY, and the palette would get nothing.
- **Fix:** `withhold_keyboard` takes Key, Text, Paste, Copy, Cut, and Ime events before the views draw. They are put back into `InputState.events` right before `shell::palette` draws.
- **Files modified:** apps/canvas/src/shell_input.rs, apps/canvas/src/main.rs
- **Commit:** 7d576df

**3. [Rule 3 - Blocking] Replaced 02-02's `filter_palette_shortcut` with `filter_shell_chords`**
- **Found during:** Task 3 GREEN
- **Issue:** Two policies would filter raw events. The plan asks for one ShellInput policy.
- **Fix:** Removed `filter_palette_shortcut`. The two 02-02 tests now call `filter_shell_chords`, with the same assertions. Cmd-K now requires no Shift (Cmd-Shift-K is no longer a palette chord), so Cmd-Shift-W can be checked first without overlap.
- **Files modified:** apps/canvas/src/shell_input.rs, apps/canvas/src/main.rs
- **Commit:** 7d576df

### Interpretations (not deviations)

- "Graph-local cancellation" clears the graph's selected note (`GraphCamera::focus = None`), the only cancelable graph state in Phase 2.
- Marks Cmd-Z undo still works outside Simulation when the keyboard is free, because marks draw over every view. Timeline undo is Simulation-only.

## Issues Encountered

- The first executor was stopped after the Task 3 RED commit. The continuation session kept its uncommitted `shell_input.rs` policy work, which was correct, and added the missing `main.rs` wiring. Before that wiring, the crate failed to compile because `main.rs` still called the removed `filter_palette_shortcut`.

## Known Stubs

None added by this plan. The graph workspace is the intended Phase 2 read-only stub from 02-01.

## Deferred / Noted

- **Overlap bug from 02-02, still open:** in `shell::workspace`, a selected note title and the partial-error line both draw at `canvas.left_top() + (16, 16)`. `shell.rs` is not among Task 3's files, so this was left alone. It is recorded in `.context/HUMAN-QUESTIONS.md` #16 for a later plan.
- **Simulation clock while hidden:** 02-RESEARCH suggested gating simulation clock work on the hosted Simulation state. The plan only requires gating bindings, so `run_clock` still advances playback while another view shows. Revisit in 02-04 if background simulation cost matters.
- **Native checks:** Cmd-Shift-W from a focused shell, typing into the palette over a terminal, the Esc order, and simulation-key gating are logged as `.context/HUMAN-QUESTIONS.md` #16 (non-blocking).

## Next Phase Readiness

02-04 can remove `egui_dock`: every tool is now reached through `Destination`, and the shell input policy has no dock dependency. The leftover `Tab` dock code and the `Ide::tab_title` and `Ide::close` warnings are 02-04's to clean up.

## Self-Check: PASSED

- FOUND: apps/canvas/src/shell.rs, apps/canvas/src/shell_input.rs, apps/canvas/src/main.rs
- FOUND: .planning/phases/02-shell/02-03-task1-red.json, 02-03-task2-red.json, 02-03-task3-red.json
- FOUND commits: 3857586, 82050be, 1761048, 3c678bb, 9e724bd, 7d576df
