---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-09-23T00:44:45.100Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | data-drawing/sim/src/sim.cpp |  | dd_step() advances the tick and runs no rules; stroke kinds return DD_ERR_UNKNOWN_KIND (resolved by 01-05) | open |  | 2026-09-23T00:44:45.100Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "data-drawing/sim/src/sim.cpp",
    "line": null,
    "description": "dd_step() advances the tick and runs no rules; stroke kinds return DD_ERR_UNKNOWN_KIND (resolved by 01-05)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-23T00:44:45.100Z",
    "resolved_at": null
  }
]
````
