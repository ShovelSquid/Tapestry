---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 1
total_count: 2
last_updated: 2026-09-24T07:17:11.877Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | data-drawing/sim/src/sim.cpp |  | dd_step() advances the tick and runs no rules; stroke kinds return DD_ERR_UNKNOWN_KIND (resolved by 01-05) | fixed |  | 2026-09-23T00:44:45.100Z | 2026-09-24T07:17:11.877Z |
| 2 | 01 | deviation | plugins/example-plugin/surface/surface.js |  | 01-04 deviation 4: direct new Worker(tapestry-plugin://...) refused cross-origin; spawned via same-origin blob trampoline (ea6bc9e); sim-host.ts must adopt the same in 01-06/01-08 | open |  | 2026-09-24T06:44:12.002Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "data-drawing/sim/src/sim.cpp",
    "line": null,
    "description": "dd_step() advances the tick and runs no rules; stroke kinds return DD_ERR_UNKNOWN_KIND (resolved by 01-05)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-23T00:44:45.100Z",
    "resolved_at": "2026-09-24T07:17:11.877Z"
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "01",
    "file": "plugins/example-plugin/surface/surface.js",
    "line": null,
    "description": "01-04 deviation 4: direct new Worker(tapestry-plugin://...) refused cross-origin; spawned via same-origin blob trampoline (ea6bc9e); sim-host.ts must adopt the same in 01-06/01-08",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-24T06:44:12.002Z",
    "resolved_at": null
  }
]
````
