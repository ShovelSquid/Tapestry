---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: "02.3"
current_phase_name: Time Threads (INSERTED)
status: executing
stopped_at: Completed 02.3-03-PLAN.md
last_updated: "2026-09-24T18:38:42.000Z"
last_activity: 2026-09-24
last_activity_desc: Phase 02.3 Plan 03 executed (grammar published, replay, readable fallback)
state_head: 44c048deb1e3193fc176eee78bf007fbc9dae331
progress:
  total_phases: 10
  completed_phases: 0
  total_plans: 38
  completed_plans: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Your world of thoughts must remain readable and under your control — in its spatial interface, its editable relationships and behavior, and its files and branching history.
**Current focus:** Phase 02.3 — Time Threads (INSERTED)

## Current Position

Phase: 02.3 (Time Threads (INSERTED)) — EXECUTING
Plan: 3 of 9
Status: Ready to execute (Plan 04 next — Wave 3, blocked on Wave 2)
Last activity: 2026-09-24 — Phase 02.3 Plan 03 executed (grammar published, replay, readable fallback)

Progress: [█████░░░░░] 53%

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
| Phase 02.2 P01 | 13 min | 3 tasks | 22 files |
| Phase 02.2 P02 | 9 min | 2 tasks | 14 files |
| Phase 02.2 P03 | 19 min | 3 tasks | 18 files |
| Phase 02.2 P04 | 25 min | 3 tasks | 21 files |
| Phase 02.3 P01 | 8 min | 2 tasks | 6 files |
| Phase 02.3 P02 | 44 min | 2 tasks | 30 files |
| Phase 02.3 P03 | 25 min | 3 tasks | 17 files |

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
- [Phase 02.2]: [Phase 02.2]: Host-stamped actors — the Electron main process names the actor for every commit; kernel:submit takes (message, ops) and plugins are bound to plugin <pluginId>, throwing if they claim human or system (D-06/D-07)
- [Phase 02.2]: [Phase 02.2]: ACTOR_NAME_RE (^[a-z0-9][a-z0-9_-]{0,31}$) is stricter than the kernel token rule so actor ids stay readable; agent./user./obsidian. and bare tapestry are reserved against plugin impersonation
- [Phase 02.2]: Authorship is derived from the actor line on the creating commit via buildHistoryIndex over Journal::commits(); no created-by property exists, so the D-05 check rests on facts on disk (HIST-08)
- [Phase 02.2]: Every history read takes the displayed replay seq rather than the journal head, so a rewound view never attributes a commit the reader cannot see; getNextIds is refused while rewound
- [Phase 02.2]: Provenance is a glyph plus the literal actor id and never a color (DRAW-04); only obsidian.bridge is annotated 'author unknown' because that id names the watcher, not the author (D-21)
- [Phase 02.2]: Agent identity is derived from a per-agent token in main (sha256 + timingSafeEqual), never from a tool argument: no MCP schema has an actor field and all are .strict()
- [Phase 02.2]: The agent bridge transport is a stdio shim plus a 0600 Unix socket, so no TCP port is opened; a browser page cannot address it
- [Phase 02.2]: The grew-from edge runs new note -> parent, so the file line reads 'create-edge e5 n13 n12 grew-from' as 'n13 grew from n12'
- [Phase 02.2]: A tree's identity is its header digest, derived from world name + creation second, so two worlds created with the same name in the same second collide
- [Phase 02.2]: [Phase 02.2]: D-05 ownership is read from the journal — assertOwnNote compares the calling actor with createdBy on the creating commit, so an agent cannot claim ownership; the check runs after a rewound tree is returned to its head, so it reads the world the commit will land in
- [Phase 02.2]: [Phase 02.2]: D-05 restricts agents only; a human may change any note in their own world
- [Phase 02.2]: [Phase 02.2]: An agent write into a rewound tree reconciles (discardRedo) and announces the lost redo rather than being refused (UA-14), replacing Plan 03's rewound refusal
- [Phase 02.2]: [Phase 02.2]: connect_notes refuses cross-tree endpoints rather than writing one end, because D-16 requires both trees to record a cross-tree link (Plan 15)
- [Phase 02.2]: [Phase 02.2]: Every value interpolated into the claude mcp add command is single-quoted by shellQuote, and markConnected is throttled to one agents.json write per agent per minute
- [Phase 02.3]: D-26 rename applied to TreeFrame.tsx, not Canvas.tsx: 02.2's frame work moved every knot call site there
- [Phase 02.3]: KNOT_TYPE ('tapestry.notes/knot@1') and KNOT_TIE_LABEL ('knot-tie') are exported from KnotNode.tsx and matched with ===, never by substring
- [Phase 02.3]: [Phase 02.3]: thread.log grammar locked verbatim per Kaelen's checkpoint approval (in/out/ins/del/mark+/mark-/step/marker verbs, integer-millisecond offsets, FORMAT.md escaping, cont-line splitting past 1 MiB)
- [Phase 02.3]: ThreadService is the single write authority per open thread: replays thread.log on open (never the body checkpoint), applies pushed steps to one authoritative doc, flushes on idle 300ms OR max-wait ~1s OR close OR actor switch
- [Phase 02.3]: getPropertyValues added as a general kernel read API (Journal::commits() scan, no new verb or value type) mirroring buildHistoryIndex's shape
- [Phase 02.3]: thread.log grammar and threads.md published as the reader's spec; example.tree grown to 10 commits (byte-identical through commit 6); a thread's body checkpoint is stored as plain flat text, not ProseMirror JSON, for maximum .tree readability
- [Phase 02.3]: replay.ts's docAt/replayTo never sort records by time (commit order then line order only) and never replay more than one checkpoint interval, since a checkpoint's own stored text already accounts for everything before it
- [Phase 02.3]: ThreadService.open() degrades to {unreadable: true, unreadableReason} with no write handle registered on a thread.log parse failure, rather than throwing (T-02.3-03-01)
- [Phase 02.3]: kernel:getPropertyValues exposed as a generic, ungated IPC read (KernelBridge/preload/global.d.ts), independent of any plugin's enabled state, so FallbackNodeView can read a checkpoint's own recorded stamp with the owning plugin disabled
- [Phase 02.3]: App.css gains its first CSS custom properties (--tap-destructive-text, --tap-surface), scoped to ThreadNotice.tsx's no-raw-hex requirement rather than a full token-system migration

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
| 3 | Move development scope constraint to the primary checkout (PROJECT.md, CLAUDE.md) | 2026-09-15 | 0bb6638 | — |
| 260915-v62 | Fix connect-agent command argument order so `claude mcp add` parses the server name | 2026-09-15 | 27b3869 | [260915-v62-fix-connect-agent-command-argument-order](./quick/260915-v62-fix-connect-agent-command-argument-order/) |

### Roadmap Evolution

- Phase 02.2 inserted after Phase 2: Obsidian Bridge: two-way connection between an Obsidian Markdown vault and a Tapestry world (Kaelen, 2026-09-15; discuss with Kaelen, not skipped) (URGENT)
- Phase 2.3 inserted after Phase 2.2: Time Threads: live z-axis writing threads split out of the 2.2 discussion (Kaelen, 2026-09-15); discuss with Kaelen before planning
- Phase 2.2 edited: goal reworded to cover the agent MCP bridge plus the Obsidian bridge (02.2-CONTEXT D-01)

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

Last session: 2026-09-24T18:38:42.000Z
Stopped at: Completed 02.3-03-PLAN.md
Resume file: None
