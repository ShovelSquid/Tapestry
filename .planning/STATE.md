---
gsd_state_version: "1.0"
current_phase: 2
current_phase_name: Shell
current_plan: 4
status: verifying
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-10-22T09:56:09.822Z"
last_activity: 2026-10-22
last_activity_desc: Phase 2 plans 4/4 executed, awaiting phase verification
state_head: b3b14f05d69e289cc05e17d12cb92ebf439eca71
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-21)

**Core value:** Write about a subject and watch a connected, spatial map of it build up: notes as cards on an infinite canvas, joined by links you describe, fed by sources the app finds on its own.
**Current focus:** Phase 2 — Shell

## Current Position

Phase: 2 — Shell
Current Plan: 4
Total Plans in Phase: 4
Status: All 4 plans executed — awaiting Phase 2 verification (phase not yet marked complete)
Last activity: 2026-10-22 — 02-04 complete (screenshots on wall clock, hidden sim paused, egui_dock removed)

Progress: [██████████] 100% of planned plans (9/9)

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: 18 min
- Total execution time: 1.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 | 5 | 91 min | 18 |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 8 min | 2 tasks | 12 files |
| Phase 01 P02 | 20 min | 3 tasks | 8 files |
| Phase 01 P03 | 15 min | 3 tasks | 19 files |
| Phase 01 P04 | 13 min | 2 tasks | 6 files |
| Phase 01 P05 | 35 min | 2 tasks | 8 files |
| Phase 02 P01 | 34 | 2 tasks | 3 files |
| Phase 02 P02 | 12min | 3 tasks | 3 files |
| Phase 02 P03 | 9min | 3 tasks | 3 files |
| Phase 02 P04 | 8min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (D-01..D-11 locked).
Recent decisions affecting current work:

- [Roadmap]: Six phases kept (Vault, Shell, Canvas, Research, Proposals, Tree); Phase 3 not split, spike-first ordering lives inside it
- [Roadmap]: VAULT-06 (single writer + watcher) assigned to Phase 1 and tested headless; VAULT-01 (open/remember vault) assigned to Phase 2 with the shell
- [Roadmap]: Journal and `created:` stamping start in Phase 1 so Phase 6 replay has data
- [Roadmap]: Autonomous run — no blocking-human gates; agent visual checks logged to .context/HUMAN-QUESTIONS.md
- [Phase 01]: 01-01: frontmatter splice refuses rather than guesses (KeyNotSpliceable/Conflict); every edit re-parsed by a verify guard before it can be written
- [Phase 01]: 01-01: Store refuses any write whose folder path passes through a symlink (checked before create_dir_all)
- [Phase 01]: 01-02: Link and block parsers use byte ranges over plain text; block segmentation reuses shared fence detection
- [Phase 01]: 01-03: Scans are read-only; placements are computed per folder; ambiguous links retain candidates with a deterministic pick
- [Phase 01]: 01-04: Store writes use fresh reads, atomic replacement, and hash-based classification; journal estimates are recorded before first legacy-note rewrites
- [Phase 01]: 01-05: Watcher events and stat-diff recovery both feed hash classification; native event delivery was unavailable in the sandbox runner and remains pending host validation
- [Phase 2]: 02-01: Keep vault selection independent from the simulation world path.
- [Phase 2]: 02-01: Serialize vault filesystem and index work on one background worker; UI consumes immutable snapshots.
- [Phase 2]: Explorer docked and floating modes share one ExplorerState; selection, width, and path survive close, float, and reopen.
- [Phase 2]: Explorer and palette both emit NavigationTarget keyed by normalized VaultIndex keys; stale targets leave the camera unchanged.
- [Phase 2]: Cmd-K is consumed in raw_input_hook before Terminal::take_input, so the shortcut never reaches the PTY.
- [Phase 2]: 02-03: shell::Destination is separate from Tab; switching views only changes App::destination, so App/Ide owners, buffers, and terminals persist
- [Phase 2]: 02-03: Shell chords (Cmd-K, Cmd-Shift-W) are filtered from raw input as Key and Text before marks and Terminal::take_input, then queued for App::ui
- [Phase 2]: 02-03: Esc precedence palette > focused owner/tool > hosted-view return > graph cancel; simulation keys only while Simulation is hosted and keyboard is free
- [Phase 2]: 02-03: Open palette withholds keyboard events from views drawn under it and restores them before drawing itself
- [Phase 2]: 02-04: TAPESTRY_SHOT fires once by wall-clock delay from App startup from any destination; TAPESTRY_VIEW unchanged
- [Phase 2]: 02-04: Simulation clock and catch-up run only while Simulation is the destination (clock_step returns None when hidden)
- [Phase 2]: 02-04: Shell presentation, files folder, and open editors persist in local shell.json; vault choice stays in vault.json; the synced legacy layout record is read once as fallback and never written
- [Phase 2]: 02-04: egui_dock removed; Tab variants and Debug names kept for marks pane keys; saved editors close from the File view header

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 3]: Camera/coordinate spike must come first (f32 precision at nesting depth, egui text/IME/hit-test under transforms, galley line y for line-anchored edges)
- [Phase 2]: vault_host tests write the real ~/.local/state/tapestry/vault.json (see 02-shell/deferred-items.md, HUMAN-QUESTIONS #17)
- [Phase 4]: Re-verify free-provider limits at phase start (OpenAlex keyless ~100 searches/day, DDG challenge behavior)
- Shared worktree: commit only own paths; `cargo build`/`cargo test` for `tapestry-canvas` and `tapestry-canvas-app` must pass after every plan

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-10-22T09:56:09.805Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None
