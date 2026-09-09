---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: 01
current_phase_name: Deterministic Core & Readable Format
status: executing
stopped_at: Completed 01-03-PLAN.md
last_updated: "2026-09-09T07:39:48.093Z"
last_activity: 2026-09-08
last_activity_desc: Phase 01 execution started
state_head: 956fbfdf516b7b8b1172d5250ca3a8f7604495bb
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 5
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Your world of thoughts must remain readable and under your control — in its spatial interface, its editable relationships and behavior, and its files and branching history.
**Current focus:** Phase 01 — Deterministic Core & Readable Format

## Current Position

Phase: 01 (Deterministic Core & Readable Format) — EXECUTING
Plan: 4 of 5
Status: Ready to execute
Last activity: 2026-09-08 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 12 min | 3 tasks | 19 files |
| Phase 01 P02 | 33 min | 2 tasks | 17 files |
| Phase 01 P03 | 17 min | 2 tasks | 11 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Minimal core; all feature systems (notes, drawing, companion, attention) delivered as plugins on the same versioned public API
- Readable `.tree` files are a first-class interface; history records inputs and materialized decisions, with snapshots as caches only
- Branching history preserves original futures; replay never re-queries a live model or external service
- UI toolkit (Electron vs Qt Quick vs SDL/NanoVG baseline) is deliberately undecided until the Phase 2 feasibility gate; Phase 1 work stays toolkit-independent
- [Phase 01]: .tree v1 format bundle locked as block-lines: byte-counted @commit/@end envelope with <<TEXT blocks, full 64-hex SHA-256 chain, sequential n<k>/e<k> ids, recorded stamps at whole seconds (PD-01/02/03/07, one-way door confirmed by user)
- [Phase 01]: Kernel numeric text confined to kernel/Value.cpp: std::to_chars shortest form out; whitelisted decimal grammar then from_chars (if __cpp_lib_to_chars) or strtod_l under a C locale handle in; NaN/Inf rejected
- [Phase 01]: Render stack gated behind TAPESTRY_BUILD_RENDER; tapestry_kernel links only tapestry_settings; doctest v2.5.3 and PicoSHA2 161cb3fc vendored as SYSTEM includes
- [Phase 01]: C++ TDD convention: RED commit carries headers plus deliberately wrong stub bodies so tests link and fail on assertions; RED evidence persisted per plan as <phase>-<plan>-tdd-red-evidence.json
- [Phase 01]: Decoder keeps each set line as its own SetProperty op (CreateNode decodes with empty props) so encode(decode(x)) reproduces the file's line order byte for byte; folding into the std::map would re-sort keys on save-as
- [Phase 01]: Kernel::submit fixed order: refuse unless journal Ok, validate actor, prepare+apply every op on a scratch World (ids assigned there), encode, Journal::append (writeAll then F_FULLFSYNC), only then swap the world in; replay applies each verified commit on a scratch copy and a refused commit flips the journal to Corrupt via markCorrupt
- [Phase 01]: Text validity (strict UTF-8, no NUL) is enforced by World::prepare, Kernel::submit and Journal::createWithSink before any bytes are written, using the same isValidText predicate the decoder applies, so a written .tree file always reopens
- [Phase 01]: A torn or corrupt @tree header record makes open() fail NotATree with the decode reason; Journal::open reads then scans then flocks and checks the sink size equals the bytes scanned (Plan 04 may refine the torn-header case)
- [Phase 01]: Decoded records compare equal to their inputs in flattened form (each set line its own SetProperty, per Plan 02) and every op struct carries a defaulted operator==; byte identity is asserted directly
- [Phase 01]: Decoder offsets and details: DigestMismatch reports the record head-line offset, InvalidUtf8 the line holding the bad byte; UnsupportedOp/TickMismatch details name the reason, verb and seq so JournalStatus.reason is greppable; set with missing value or unknown type is BadValue, wrong shape is BadLine; advance 0 is refused at decode
- [Phase 01]: Plan 03 completed three small edits outside its file list as documented deviations: Journal::scan raises expectedTick from advance ops, Kernel::submit fills CommitResult.edgeIds, World::prepare refuses text with a line over kMaxLineBytes (World.cpp includes tree/Codec.hpp for the constant)

### Pending Todos

None yet.

### Blockers/Concerns

- [Research] `.tree` framing/readability with real long notes, canonical hashing of unknown extension fields, and durability failure-injection design need deeper research during Phase 1 planning
- [Research] Phase 2 needs Electron version pinning, per-plugin isolation design, and ProseMirror forge/release verification before install
- [Research] Rule numeric contract (ranges, rounding, tick interval) needs targeted spikes during Phase 5 planning; prompt-injection boundary and policy precedence semantics during Phase 6 planning

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-09-09T07:39:12.912Z
Stopped at: Completed 01-03-PLAN.md
Resume file: None
