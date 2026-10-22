---
phase: 02-shell
plan: "01"
subsystem: ui
tags: [rust, egui, vault, filesystem-watcher, background-worker]

# Dependency graph
requires:
  - phase: 01-vault-model
    provides: Vault Store, watcher classification, scanning, and immutable index types
provides:
  - Default read-only graph workspace backed by a background vault snapshot
  - Remembered vault root with world/vault as the first-launch default
  - Serialized watcher, classification, rescan, root-switch, and index-refresh worker
affects: [02-shell, 03-canvas, vault-selection, shell-startup]

# Actuals (#2632)
actuals:
  tokens: 6587
  tasks: 2
  commits: 3
commits: 3
plan_head_before: 7e41f3784f64b0c9c5b1c9053a5a4b266164d6ad

# Tech tracking
tech-stack:
  added: []
  patterns: [bounded worker command handoff, immutable Arc snapshots, Store hash classification]

key-files:
  created: [apps/canvas/src/shell.rs, apps/canvas/src/vault_host.rs]
  modified: [apps/canvas/src/main.rs]

key-decisions:
  - "Keep vault selection independent from the simulation world path."
  - "Serialize all vault filesystem and index work on one worker; the UI only polls and renders snapshots."

patterns-established:
  - "VaultHost owns Store and Watch on a single worker and publishes complete immutable Arc<VaultIndex> snapshots."
  - "UI-to-worker commands use bounded nonblocking handoff so a frame never waits on filesystem work."

requirements-completed: [VAULT-01, SHELL-01]
coverage:
  - id: D1
    description: "App startup opens the remembered or default vault on a worker and displays its initial immutable snapshot in a read-only graph workspace."
    requirement: VAULT-01
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline shell_boot_to_snapshot"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline"
        status: pass
    human_judgment: false
  - id: D2
    description: "External edits, removals, and fallback rescans publish fresh snapshots; own-write echoes are suppressed and failed root switches preserve the active snapshot."
    requirement: VAULT-01
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline vault_host"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline"
        status: pass
    human_judgment: false
  - id: D3
    description: "The default shell route is a blank read-only graph workspace while simulation initialization remains on its existing world path."
    requirement: SHELL-01
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline shell_boot_to_snapshot"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline"
        status: pass
    human_judgment: false

# Metrics
duration: 34min
completed: 2026-10-22
status: complete
---

# Phase 02 Plan 01: Vault Startup and Shell Summary

**The default shell now renders a read-only graph workspace from a remembered vault through a serialized background Store/Watch worker.**

## Performance

- **Duration:** 34 min
- **Started:** 2026-10-22T08:05:00Z (approximate session start)
- **Completed:** 2026-10-22T08:39:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Connected app startup to a local remembered vault root, defaulting to `world/vault`, while keeping simulation initialization on its existing `world_dir` path.
- Added the blank read-only workspace and loading/open-error presentation backed by immutable vault snapshots.
- Serialized watcher delivery, Store classification, fallback rescans, root switching, and index rebuilds on one worker; covered OwnEcho suppression and preservation of the last snapshot after a failed switch.

## Task Commits

Each task was committed atomically:

1. **Task 1: Tracer — app startup opens a vault snapshot into the graph workspace** - `482a89d` (feat)
2. **Task 2 RED: Expose OwnEcho refresh regression** - `a211c16` (test)
3. **Task 2 GREEN: Serialize vault refresh and switching** - `2290341` (feat)

## Files Created/Modified

- `apps/canvas/src/main.rs` - Connects the app startup and default UI route to VaultHost and shell workspace.
- `apps/canvas/src/shell.rs` - Renders loading/error states and the blank read-only graph workspace.
- `apps/canvas/src/vault_host.rs` - Persists vault selection and serializes Store/Watch work and immutable snapshot publication.

## Decisions Made

- Kept the selected vault separate from simulation world configuration.
- Kept filesystem scans, classification, watcher handling, and indexing off the UI frame on a single worker.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The shell reroute leaves legacy dock-only symbols unused, producing compiler warnings for `Tabs`, `Ide::tab_title`, and `Ide::close`. The dock removal is part of the later shell work; these warnings do not affect behavior or verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The app has a working vault-backed startup route and worker refresh foundation. The following shell plans can build navigation and tool routing on top of the default workspace.

---
*Phase: 02-shell*
*Completed: 2026-10-22*

## Self-Check: PASSED

- Summary file exists.
- Task commits `482a89d`, `a211c16`, and `2290341` are present in Git history.
- Measured task commit count from plan base: 3.
