---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: "02.1"
current_phase_name: Passage Anchors, Threads & Complete Rich Editing
status: executing
stopped_at: Phase 2.1 UI-SPEC approved
last_updated: "2026-09-10T08:43:37.995Z"
last_activity: 2026-09-10
last_activity_desc: Phase 02.1 execution started
state_head: 12b11a8f1b722fbad883174d8f76a2ee8079d559
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 13
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Your world of thoughts must remain readable and under your control — in its spatial interface, its editable relationships and behavior, and its files and branching history.
**Current focus:** Phase 02.1 — Passage Anchors, Threads & Complete Rich Editing

## Current Position

Phase: 02.1 (Passage Anchors, Threads & Complete Rich Editing) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 02.1
Last activity: 2026-09-10 — Phase 02.1 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 5 | - | - |

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
| Phase 01 P04 | 16 min | 2 tasks | 10 files |
| Phase 01 P05 | 9 min | 3 tasks | 4 files |

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
- [Phase 01]: Journal::append turns an unacknowledged write or sync into an in-memory TornTail at the verified prefix and refuses the next submit (JournalNotClean) — a retry used to write a second @commit N behind unconfirmed bytes; a complete record that did reach the medium is valid history on reopen (the rejection means not confirmed, not did-not-happen)
- [Phase 01]: Journal keeps m_bytes (verified prefix plus any unverified tail) and m_path so repair() preserves the exact tail and saveAs() copies the exact verified prefix; lastGoodSeq equals lastSeq() whenever the status is Ok
- [Phase 01]: Repair is explicit only (PD-04): sidecar <journal>.torn-<stamp with ':' as '-'> named from path + clock, CreateNew (an existing sidecar is refused), write → F_FULLFSYNC → close → ftruncate journal → F_FULLFSYNC → Ok; refused for Ok, Corrupt, read-only and sink-only journals; saveAs is CreateNew (EEXIST) of exactly the verified prefix on any status
- [Phase 01]: Plan 04 sweeps: 1847 prefix cuts of a 5-commit journal and 1280 bit flips of a 3-commit journal never yield Ok on damaged input and never lose a complete record; a torn header stays NotATree (Plan 02 open question closed); BadEnvelope offset for a flipped byte count is logged in deferred-items.md (codec suite pins it)
- [Phase 01]: Golden fixture pattern: the readability suite regenerates docs/tree/example.tree with the production kernel under a FixedClock and compares byte for byte; TAPESTRY_REGEN_FIXTURE is the only regeneration path so drift is always a git diff
- [Phase 01]: FORMAT.md is the reader's spec for .tree v1 and quotes example.tree verbatim; the acceptance check diffs the fenced block against the file, so the fixture and the guide must change in the same commit
- [Phase 01]: TREE-04 proven by name and place: recorded and tick are line-initial header keys, event is a set-line value; corrections keep the earlier value in the earlier record and a backwards wall clock never reorders seq/parent

### Pending Todos

None yet.

### Blockers/Concerns

- [Research] `.tree` framing/readability with real long notes, canonical hashing of unknown extension fields, and durability failure-injection design need deeper research during Phase 1 planning
- [Research] Phase 2 needs Electron version pinning, per-plugin isolation design, and ProseMirror forge/release verification before install
- [Research] Rule numeric contract (ranges, rounding, tick interval) needs targeted spikes during Phase 5 planning; prompt-injection boundary and policy precedence semantics during Phase 6 planning

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260909-thn | Fix renderer actor kind: send human instead of user to kernel submit so notes can be created | 2026-09-09 | a9d4f8d | [260909-thn-fix-renderer-actor-kind-send-human-inste](./quick/260909-thn-fix-renderer-actor-kind-send-human-inste/) |
| 260909-u0o | Add Phase 2 COVERAGE.md declaring that Tapestry's plugin API and SDK are internal, not an external service integration | 2026-09-09 | cb0fe28 | [260909-u0o-add-phase-2-coverage-md-declaring-that-t](./quick/260909-u0o-add-phase-2-coverage-md-declaring-that-t/) |

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Deferred Verification

| Phase | State | Resume |
|-------|-------|--------|
| 1 | verification_deferred_human | /gsd-verify-work 1 |
| 2 | verification_deferred_human | /gsd-verify-work 2 |
| 2.1 | verification_deferred_human | /gsd-verify-work 2.1 |

## Session Continuity

Last session: 2026-09-10T06:37:40.815Z
Stopped at: Phase 2.1 UI-SPEC approved
Resume file: .planning/phases/02.1-passage-anchors-threads-complete-rich-editing/02.1-UI-SPEC.md
