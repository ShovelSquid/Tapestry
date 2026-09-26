---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: "2.8"
current_phase_name: Agent Note Windows
status: executing
stopped_at: Completed 02.8-01 (wave 1)
last_updated: "2026-09-26T01:24:45.223Z"
last_activity: 2026-09-25
last_activity_desc: "Phase 2.8 Agent Note Windows planned: CONTEXT, UI-SPEC, RESEARCH, PATTERNS, 9 plans in 9 waves; next 02.8-01 (wave 1)"
state_head: 36f0bf7e2126b51f7e0676eb8cd045ef1fa12ea3
progress:
  total_phases: 15
  completed_phases: 0
  total_plans: 71
  completed_plans: 53
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Your world of thoughts must remain readable and under your control — in its spatial interface, its editable relationships and behavior, and its files and branching history.
**Current focus:** ws/mergin, the integration branch (merged 2026-09-24): 02.6 Placement Edges (10/10, human_needed), 02.7 File Windows (6/7, 02.7-07 parked), Data Drawing phase 01 (8/8, human_needed) and mathspace (all 7 phases headless) and 02.3 Time Threads (9/9, phase verification next) are in. Queued human checks live in autonomy/<branch>/REVIEW.md. Workspace trees are forest members (`kind` workspace, `workspace.root.hint`) pending Kaelen's approval of those names

## Current Position

Phase: 2.8 (Agent Note Windows) — EXECUTING
Plan: 1 of 9 complete; next is 02.8-02 (wave 2). 02.7 is 6/7, with 02.7-07 parked on a package approval (autonomy/REVIEW.md item 5)
Status: Ready to execute 02.8-02
Phase 02.4 (Lock Model): COMPLETE — verified 25/25, 2026-09-16; rebased onto the main line 2026-09-23
Last activity: 2026-09-25 - 02.8-01 complete (session notes and turn passages; Task 1 option a queued as autonomy/REVIEW.md item 6)

Progress: [███████░░░] 76%

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 5 | - | - |
| 02.4 | 2 | - | - |

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
| Phase 02.2 P05 | 25 min | 2 tasks | 19 files |
| Phase 02.2 P06 | 40 min | 3 tasks | 13 files |
| Phase 02.2 P07 | 35 min | 1 tasks | 26 files |
| Phase 02.4 P01 | 14 min | 2 tasks | 4 files |
| Phase 02.4 P02 | 8 min | 2 tasks | 5 files |
| Phase 02.7 P01 | 16 min | 4 tasks | 36 files |
| Phase 02.7 P02 | 29 min | 4 tasks | 29 files |
| Phase 02.7 P03 | 20 min | 3 tasks | 15 files |
| Phase 02.7 P04 | 10 min | 2 tasks | 13 files |
| Phase 02.7 P05 | 16 min | 3 tasks | 23 files |
| Phase 02.7 P06 | 18 min | 3 tasks | 17 files |

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
- [Phase 02.2]: Every kernel IPC channel names its tree first; an unknown or malformed treeId is refused rather than falling back to the primary tree
- [Phase 02.2]: The open trees and their frame positions live in settings.json, not a forest file (D-18); last-opened.json migrates once at frame (0,0)
- [Phase 02.2]: pushApart never moves the dropped frame, re-queues displaced frames so chains settle, and is capped at 200 steps in deterministic id order
- [Phase 02.2]: A tree that will not open stays in the space as an unavailable entry with the kernel's reason (damaged/locked/missing); a non-Ok journal is closed again immediately so nothing can append to it, and nothing is ever repaired automatically
- [Phase 02.2]: TreeRegistry.list() stays bridge-bearing and unavailable trees surface through summary(), because the agent command layer iterates list() and reads .bridge
- [Phase 02.2]: Locked trees are detected by the kernel's real phrase 'another process holds the journal lock' — the word 'locked' never appears in that message, so the plan's stated heuristic would have mislabelled every locked tree as damaged
- [Phase 02.2]: Vault trees record what the files contain: every key starting md. is the file's, every other key is Tapestry's (02.2-07, D-10/D-14)
- [Phase 02.2]: The vault test fixture is synthetic and authored in-repo; no House Party content enters git history, and .gitattributes pins its bytes so normalisation cannot rewrite the shapes under test (02.2-07)
- [Phase 02.2]: A plugin's registered node-view name now selects a component through NODE_VIEW_COMPONENTS; an unmapped name falls back to the readable card instead of rendering as a NoteCard (02.2-07)
- [Phase 02.2]: The Obsidian mirror refuses bytes it would have to change in order to store them, rather than transcoding them (02.2-07, D-12)
- [Phase 02.4]: 02.4-01: update/rename check the note's text aspect, delete checks delete, all via writeToNote -> assertMayWrite -> checkLock; 02.2 D-05 authorship gate removed
- [Phase 02.4]: 02.4-01: malformed lock values fail closed; only exact 'open' unlocks; blank owner shown as (unknown); allow list read in Plan 02
- [Phase 02.4]: 02.4-02: lock.<aspect>.allow is read for explicit and derived locks; only a text value counts, whitespace-split, exact match
- [Phase 02.4]: 02.4-02: agent tool text states the lock rule and that refusals name the owner, without publishing lock.* key names
- [Phase 02.7]: Workspace trees live at <userData>/workspaces/<name>-<hash8>.tree outside the folder (reversible); node types tapestry.workspace/{text,file,folder}@1 with file.* keys; observer actor plugin workspace.watcher
- [Phase 02.7]: Agent file tools reach exactly git's view of the workspace; git-ignored paths, symlinks, .git, '..' and outside paths are refused with nothing written
- [Phase 02.7]: 02.7-02: the in-app chat signs as agent.claude-chat, its token re-issued each launch into a 0600 MCP config file under <userData>/chat
- [Phase 02.7]: 02.7-02: the chat CLI runs with --setting-sources user, so a workspace's own .claude settings and hooks are not loaded in the panel
- [Phase 02.7]: 02.7-02: agents show Connected now from the shim's startup hello (60 s keep-alive), not only after a tool call (D-20)
- [Phase 02.7]: 02.7-03: workspace note positions are folder-local; folders carry the Tapestry keys subspace (bool true) and collapsed (bool), never file.* (D-21)
- [Phase 02.7]: 02.7-03: an existing workspace tree is re-laid out once on open in one system tapestry commit 'arrange workspace <name> into folder subspaces'; every folder starts collapsed
- [Phase 02.7]: 02.7-04: Shell-on tool set is exactly Bash,Read,Edit,Write,Glob,Grep (one --tools element); --allowedTools mcp__tapestry plus the same; no --restricted
- [Phase 02.7]: 02.7-04: The Allow shell switch resets to off on every relaunch and for New chat; chats.json keeps shell {on, changedAt} only to say it was reset
- [Phase 02.7]: 02.7-04: A shell-on turn's done is held until WorkspaceService.catchUp records its file changes as plugin workspace.watcher; shell-off turns never trigger it
- [Phase 02.7]: 02.7-05: workspace file notes are open to every agent unless an explicit lock.<aspect> says otherwise (WORKSPACE_LOCK_POLICY); native/vault keep 2.4 defaults
- [Phase 02.7]: 02.7-05: main refuses createNode/deleteNode/file.* submits and undo/redo on workspace trees; note tools refuse workspace trees
- [Phase 02.7]: 02.7-06: workspaces are watched with recursive fs.watch (FSEvents), not chokidar; events are hints, the stat-cached reconcileNow decides, and 'all' also trusts the stat cache
- [Phase 02.7]: 02.7-06: watch errors restart after 5 s with a full catch-up; a missing folder commits nothing, shows folder-missing, and heals by itself when it returns
- [Phase 02.7]: 02.7-06: an agent file edit costs ~40 ms of main time on an 800-file tree (whole-tree getNodes per call); reopen does not grow measurably over 200 commits

### Pending Todos

3 pending in `.planning/todos/pending/` (captured 2026-09-24):

- Make pan and zoom far more sensitive (minor, quick task)
- Trees as folders: notes anywhere, drag in and out (major, phase-sized; overlaps Phase 2.6)
- Run Claude in the app with an ask and respond channel (major, new inserted phase; slice before Phase 6)

### Blockers/Concerns

- [Research] `.tree` framing/readability with real long notes, canonical hashing of unknown extension fields, and durability failure-injection design need deeper research during Phase 1 planning
- [Research] Phase 2 needs Electron version pinning, per-plugin isolation design, and ProseMirror forge/release verification before install
- [Research] Rule numeric contract (ranges, rounding, tick interval) needs targeted spikes during Phase 5 planning; prompt-injection boundary and policy precedence semantics during Phase 6 planning
- [Resolved 2026-09-24] Phase 02.3 Plan 09's precondition block (vault-service.ts missing) was resolved when the orchestrator cherry-picked 02.2 Plans 06-08 onto this branch. Plan 09 then executed and found a second, narrower gap the cherry-pick didn't cover: 02.2 Plan 10 (the vault's live filesystem watcher and its general Tapestry-to-vault write-back path) is still absent from this branch. Plan 09 built a narrowly-scoped writer (VaultService.writeThreadFile) directly rather than halting again -- see 02.3-09-SUMMARY.md's key-decisions and Deviations. Still open for whoever later cherry-picks or executes 02.2 Plan 10: point its author at VaultService.writeThreadFile before adding a second vault-write path of their own.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260909-thn | Fix renderer actor kind: send human instead of user to kernel submit so notes can be created | 2026-09-09 | a9d4f8d | [260909-thn-fix-renderer-actor-kind-send-human-inste](./quick/260909-thn-fix-renderer-actor-kind-send-human-inste/) |
| 260909-u0o | Add Phase 2 COVERAGE.md declaring that Tapestry's plugin API and SDK are internal, not an external service integration | 2026-09-09 | cb0fe28 | [260909-u0o-add-phase-2-coverage-md-declaring-that-t](./quick/260909-u0o-add-phase-2-coverage-md-declaring-that-t/) |
| 3 | Move development scope constraint to the primary checkout (PROJECT.md, CLAUDE.md) | 2026-09-15 | 0bb6638 | — |
| 260915-v62 | Fix connect-agent command argument order so `claude mcp add` parses the server name | 2026-09-15 | 27b3869 | [260915-v62-fix-connect-agent-command-argument-order](./quick/260915-v62-fix-connect-agent-command-argument-order/) |
| 260915-v51 | Fix the kernel copy-per-commit quadratic: Kernel::replayUpTo and Kernel::submit copied the entire World once per commit, making reopen O(n^2) in commit count | 2026-09-15 | 7fed53f | [260915-v51-fix-the-kernel-copy-per-commit-quadratic](./quick/260915-v51-fix-the-kernel-copy-per-commit-quadratic/) |
| 260924-0ii | Add layout as a third lock aspect (lock.layout), text-aspect defaults, not yet gating any command | 2026-09-24 | 4d78287 | [260924-0ii-add-layout-as-a-third-lock-aspect-lock-l](./quick/260924-0ii-add-layout-as-a-third-lock-aspect-lock-l/) |
| 260924-dwq | Make pan and zoom far more sensitive: exponential zoom with pinch/wheel rate split, 1.6x pan multiplier, deltaMode normalization | 2026-09-24 | a146b7f | [260924-dwq-make-pan-and-zoom-far-more-sensitive-in-](./quick/260924-dwq-make-pan-and-zoom-far-more-sensitive-in-/) |
| 260924-glr | Canvas camera: view roll and eased camera motion | 2026-09-24 | e66b3a8 | [260924-glr-canvas-camera-view-roll-and-eased-camera](./quick/260924-glr-canvas-camera-view-roll-and-eased-camera/) |

### Roadmap Evolution

- Phase 02.2 inserted after Phase 2: Obsidian Bridge: two-way connection between an Obsidian Markdown vault and a Tapestry world (Kaelen, 2026-09-15; discuss with Kaelen, not skipped) (URGENT)
- Phase 2.3 inserted after Phase 2.2: Time Threads: live z-axis writing threads split out of the 2.2 discussion (Kaelen, 2026-09-15); discuss with Kaelen before planning
- Phase 2.2 edited: goal reworded to cover the agent MCP bridge plus the Obsidian bridge (02.2-CONTEXT D-01)
- Phase 2.4 inserted after Phase 2.3: Lock Model: allow unless locked; lock aspects replace the D-05 authorship gate (Kaelen, 2026-09-16)
- Phase 2.7 inserted after Phase 2.5: File Windows & Workspace Sandbox: workspace folder, file windows, agent file tools confined to the root; dogfood on this repo (ws/windows)
- Phase 2.8 inserted after Phase 2.7: Agent Note Windows: chat sessions as notes, spec in ~/Tree/Connections/Spec - Agent Note Windows.md

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
| 02.7 (02.7-02 + 02.7-03 combined checkpoint) | verification_deferred_human | autonomy/REVIEW.md item 1 |
| 02.7-06 (live watch, Retry write, feel on ~/Tapestrees/windows) | verification_deferred_human | 02.7-06-SUMMARY.md "Hands-on checks for later" |

## Session Continuity

Last session: 2026-09-25T23:47:31.112Z
Stopped at: Phase 2.8 UI-SPEC approved
Resume file: .planning/phases/02.8-agent-note-windows/02.8-UI-SPEC.md
