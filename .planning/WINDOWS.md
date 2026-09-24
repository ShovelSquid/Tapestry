---
schema_version: 1
open_count: 4
waived_count: 0
fixed_count: 0
total_count: 4
last_updated: 2026-09-24T17:59:53.126Z
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
  }
]
````
