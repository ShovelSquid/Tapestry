---
schema_version: 1
open_count: 13
waived_count: 0
fixed_count: 0
total_count: 13
last_updated: 2026-09-24T20:59:04.479Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02.3 | stub | app/src/renderer/threads/ThreadOverlay.tsx |  | Catch-up header shows n=total statically; replay has no incremental progress channel yet | open |  | 2026-09-24T17:59:35.478Z |  |
| 2 | 02.3 | stub | app/src/renderer/threads/ThreadCard.tsx |  | No drag-to-reposition or resize; position is fixed at creation | open |  | 2026-09-24T17:59:40.134Z |  |
| 3 | 02.3 | stub | app/src/main/threads/thread-service.ts |  | replayFlatText only replays ins/del into a flat single-paragraph string; mark/step/marker/session records are parsed but not applied on replay | open |  | 2026-09-24T17:59:47.499Z |  |
| 4 | 02.3 | stub | app/src/renderer/threads/use-thread-editor.ts |  | IME composition is buffered and flushed as raw steps at composition end, not grapheme-resynthesized | open |  | 2026-09-24T17:59:53.126Z |  |
| 5 | 02.3 | stub | app/src/renderer/threads/stage/glyph-cache.ts |  | Bundled single-file thread face (TA-25) not yet in the app; stage uses the typer's system font stack instead | open |  | 2026-09-24T19:43:26.305Z |  |
| 6 | 02.3 | stub | app/src/renderer/threads/stage/glyph-cache.ts |  | Atlas paging is a bounded 4-page pool (4096 cells), not true LRU eviction; spike 007 is the queued verdict for real eviction | open |  | 2026-09-24T19:43:33.576Z |  |
| 7 | 02.3 | stub | app/src/renderer/threads/ThreadOverlay.tsx |  | Historical ribbon reconstruction on reopen is one continuous session chunk, not a faithful session/gap/pause replay (D-07 owned by a later plan) | open |  | 2026-09-24T19:43:39.127Z |  |
| 8 | 02.3 | stub | app/src/renderer/threads/stage/glyphs.ts |  | aDeletedAtMs is always -1; D-03 ghost deletion is not wired into the live stage (out of this plan's must_haves) | open |  | 2026-09-24T19:43:44.797Z |  |
| 9 | 02.3 | unrun-verify | app/src/renderer/threads/ThreadOverlay.tsx |  | Plan 04 Task 2 human-check not run: live typing feel (dot streaming/slowdown/constant speed), zoomed-letter legibility, IME composition, and emoji-picker insertion in the real running app | open |  | 2026-09-24T19:43:53.651Z |  |
| 10 | 02.3 | stub | app/src/main/threads/thread-service.ts |  | LetterIndex not wired into thread-service.ts/ThreadOverlay.tsx yet (D-22 enforcement + live ghost population deferred to 02.3-06/07) | open |  | 2026-09-24T20:58:47.928Z |  |
| 11 | 02.3 | stub | app/src/renderer/threads/stage/markers.ts |  | attachMarkerNav built and exported but not attached to any element; no focus/ARIA-live-region plumbing exists in ThreadOverlay.tsx yet | open |  | 2026-09-24T20:58:56.704Z |  |
| 12 | 02.3 | stub | app/src/renderer/threads/stage/glyphs.ts |  | Ghost fade only implements the 70% ink case; no per-letter display-colour attribute exists yet for the 80% non-ink case (UI-SPEC Ghost letters) | open |  | 2026-09-24T20:59:04.406Z |  |
| 13 | 02.3 | unrun-verify | app/src/renderer/threads/ThreadOverlay.tsx |  | Plan 05 Task 3 human-check not run: delete/undo/paste/bold in a real thread and confirm ghosts+markers on the live line (proven only via synthetic --shots this session) | open |  | 2026-09-24T20:59:04.479Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/ThreadOverlay.tsx",
    "line": null,
    "description": "Catch-up header shows n=total statically; replay has no incremental progress channel yet",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T17:59:35.478Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/ThreadCard.tsx",
    "line": null,
    "description": "No drag-to-reposition or resize; position is fixed at creation",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T17:59:40.134Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/main/threads/thread-service.ts",
    "line": null,
    "description": "replayFlatText only replays ins/del into a flat single-paragraph string; mark/step/marker/session records are parsed but not applied on replay",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T17:59:47.499Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/use-thread-editor.ts",
    "line": null,
    "description": "IME composition is buffered and flushed as raw steps at composition end, not grapheme-resynthesized",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T17:59:53.126Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/stage/glyph-cache.ts",
    "line": null,
    "description": "Bundled single-file thread face (TA-25) not yet in the app; stage uses the typer's system font stack instead",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T19:43:26.305Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/stage/glyph-cache.ts",
    "line": null,
    "description": "Atlas paging is a bounded 4-page pool (4096 cells), not true LRU eviction; spike 007 is the queued verdict for real eviction",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T19:43:33.576Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/ThreadOverlay.tsx",
    "line": null,
    "description": "Historical ribbon reconstruction on reopen is one continuous session chunk, not a faithful session/gap/pause replay (D-07 owned by a later plan)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T19:43:39.127Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/stage/glyphs.ts",
    "line": null,
    "description": "aDeletedAtMs is always -1; D-03 ghost deletion is not wired into the live stage (out of this plan's must_haves)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T19:43:44.797Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "unrun-verify",
    "phase": "02.3",
    "file": "app/src/renderer/threads/ThreadOverlay.tsx",
    "line": null,
    "description": "Plan 04 Task 2 human-check not run: live typing feel (dot streaming/slowdown/constant speed), zoomed-letter legibility, IME composition, and emoji-picker insertion in the real running app",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T19:43:53.651Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/main/threads/thread-service.ts",
    "line": null,
    "description": "LetterIndex not wired into thread-service.ts/ThreadOverlay.tsx yet (D-22 enforcement + live ghost population deferred to 02.3-06/07)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T20:58:47.928Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/stage/markers.ts",
    "line": null,
    "description": "attachMarkerNav built and exported but not attached to any element; no focus/ARIA-live-region plumbing exists in ThreadOverlay.tsx yet",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T20:58:56.704Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "stub",
    "phase": "02.3",
    "file": "app/src/renderer/threads/stage/glyphs.ts",
    "line": null,
    "description": "Ghost fade only implements the 70% ink case; no per-letter display-colour attribute exists yet for the 80% non-ink case (UI-SPEC Ghost letters)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T20:59:04.406Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "unrun-verify",
    "phase": "02.3",
    "file": "app/src/renderer/threads/ThreadOverlay.tsx",
    "line": null,
    "description": "Plan 05 Task 3 human-check not run: delete/undo/paste/bold in a real thread and confirm ghosts+markers on the live line (proven only via synthetic --shots this session)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T20:59:04.479Z",
    "resolved_at": null
  }
]
````
