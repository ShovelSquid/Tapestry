---
phase: 02-plugin-host-sdk-feasibility-gate
plan: 01
subsystem: plugin-host
tags: [native-addon, kernel-bridge, sdk-types, workspace-config, electron-vite]
dependency_graph:
  requires: [01-deterministic-core-readable-format]
  provides: [tapestry_addon.node, kernel-bridge, sdk-types, workspace-config]
  affects: [02-02, 02-03, 02-04, 02-05]
tech_stack:
  added: [node-addon-api, cmake-js, electron-vite, prosemirror-*, react, typescript]
  patterns: [Napi::ObjectWrap, IPC bridge, npm workspaces]
key_files:
  created:
    - app/native/addon.cpp
    - app/native/CMakeLists.txt
    - app/src/main/kernel-bridge.ts
    - app/src/main/index.ts
    - app/src/preload/index.ts
    - app/src/renderer/index.html
    - app/electron.vite.config.ts
    - app/package.json
    - app/tsconfig.json
    - app/tsconfig.node.json
    - sdk/src/index.ts
    - sdk/package.json
    - sdk/tsconfig.json
    - package.json
    - package-lock.json
    - .gitignore
    - plugins/.gitkeep
  modified: []
key_decisions:
  - "Used Napi::ObjectWrap to wrap Kernel as a stateful JS object with static create/open factory methods"
  - "SYSTEM includes for node-addon-api and Node headers to suppress third-party warnings"
  - "CMake options set via FORCE in CMakeLists.txt rather than cli -- args (cmake-js forwards -- to both configure and build phases)"
  - "KernelBridge holds a single kernel instance per process, matching the single-writer model"
  - "Value conversion: JS string -> Text, JS integer -> Int, JS float -> Real, JS boolean -> Bool; explicit type field supported for Ref/Time"
requirements_completed: [PLUG-06]
metrics:
  duration: 707s
  completed: 2026-09-09T23:22:12Z
  tasks_completed: 1
  tasks_total: 1
actuals:
  tokens: 65461
  tasks: 1
  commits: 1
plan_head_before: 4991dd54d359f6176bac8f525b779f828c9d4693
status: complete
---

# Phase 2 Plan 01: Native Addon, Kernel Bridge & SDK Types Summary

**One-liner:** C++ kernel compiled as Node native addon via node-addon-api/cmake-js, TypeScript bridge with IPC registration, and SDK type contracts (TapestryPlugin, KernelAPI, NodeSchema, PluginManifest, ValueType) in an npm workspace.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~12 minutes |
| Commits | 1 |
| Files created | 17 |
| Native addon size | 310 KB |
| Kernel tests | 52/52 passed |
| Build warnings | 0 |

## Accomplishments

### Task 0: Package Legitimacy Verification (checkpoint)
All 15 npm packages verified as legitimate by the user before any install.

### Task 1: End-to-end C++ Kernel as Node Addon (tracer)

**Native addon (app/native/addon.cpp):** Wraps `tapestry::kernel::Kernel` in a `Napi::ObjectWrap` class with:
- Static `create(path, worldName)` and `open(path)` factory methods returning wrapper instances
- Instance methods: `submit(actorKind, actorId, message, ops)`, `getNodes()`, `getNode(id)`, `getEdges()`, `status()`
- Full Op vocabulary conversion: createNode, setProperty, unsetProperty, createEdge, deleteNode, deleteEdge, advance
- Value conversion between JS primitives and kernel's six types (Text, Int, Real, Bool, Ref, Time)
- NAPI_DISABLE_CPP_EXCEPTIONS for safe error handling via Napi::Error

**CMake build (app/native/CMakeLists.txt):** Links `tapestry_kernel` static library into the `.node` shared library. Sets `TAPESTRY_BUILD_APP`, `TAPESTRY_BUILD_RENDER`, and `TAPESTRY_BUILD_TESTS` to OFF via FORCE cache. Uses SYSTEM includes for Node.js and node-addon-api headers.

**Kernel bridge (app/src/main/kernel-bridge.ts):** Loads the compiled `.node` addon and exposes a `KernelBridge` class with typed methods for all kernel operations. Includes `registerHandlers(ipcMain)` static method for Plan 02 to wire into Electron IPC.

**SDK types (sdk/src/index.ts):** Exports TypeScript interfaces:
- `TapestryPlugin` (name, version, activate, deactivate)
- `PluginContext` (kernel, registerNodeView)
- `KernelAPI` (submit, getNodes, getNode, getEdges, status)
- `NodeSchema` (type, displayName, defaultProperties)
- `PluginManifest` (name, version, displayName, main, api, contributions)
- `ValueType` enum (text, int, real, bool, ref, time)
- All seven `Op` types matching the kernel vocabulary

**Workspace infrastructure:**
- Root `package.json` with workspaces: app, sdk, plugins/*
- `electron-vite` config with main/preload/renderer entries
- TypeScript configs for Node.js (main/preload) and SDK
- `.gitignore` for node_modules, build outputs, OS files

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 012b75d | feat(02-01): wire C++ kernel as Node addon with SDK type contracts |

## Files Created

| File | Purpose |
|------|---------|
| `package.json` | Workspace root with app, sdk, plugins/* |
| `package-lock.json` | Lockfile for reproducible installs |
| `.gitignore` | Ignore node_modules, build outputs |
| `app/package.json` | Electron app with native addon build scripts |
| `app/electron.vite.config.ts` | Three-entry electron-vite configuration |
| `app/tsconfig.json` | Project references root |
| `app/tsconfig.node.json` | Main/preload TypeScript config |
| `app/native/CMakeLists.txt` | Native addon build linking tapestry_kernel |
| `app/native/addon.cpp` | N-API ObjectWrap wrapping Kernel |
| `app/src/main/index.ts` | Main process entry (re-exports KernelBridge) |
| `app/src/main/kernel-bridge.ts` | TypeScript bridge with IPC registration |
| `app/src/preload/index.ts` | Preload script placeholder |
| `app/src/renderer/index.html` | Renderer HTML placeholder |
| `sdk/package.json` | SDK package with build/typecheck scripts |
| `sdk/tsconfig.json` | SDK TypeScript configuration |
| `sdk/src/index.ts` | Plugin contract types |
| `plugins/.gitkeep` | Workspace glob anchor |

## Decisions Made

1. **Napi::ObjectWrap pattern:** The kernel is wrapped as a stateful JS object rather than using plain N-API functions. This allows natural JS usage (`const k = TapestryAddon.create(...)`) and matches the kernel's single-instance model.

2. **FORCE cache for CMake options:** The `TAPESTRY_BUILD_*` options are set via `FORCE` in the addon's CMakeLists.txt rather than passed as `--` arguments to cmake-js, because cmake-js forwards `--` arguments to both the configure and build phases, and `cmake --build` rejects `-D` flags.

3. **SYSTEM includes for third-party headers:** Node.js and node-addon-api headers use SYSTEM include directories to suppress -Wsign-conversion and other warnings from code we do not own.

4. **Single kernel instance per bridge:** The KernelBridge holds one kernel at a time, matching the kernel's single-writer transaction model. Opening a new world replaces the previous instance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Digest.hex access**
- **Found during:** Task 1, first compile
- **Issue:** `cr.digest.hex()` called hex as a method, but `Digest::hex` is a public data member (std::string), not a method
- **Fix:** Changed to `cr.digest.hex` (member access instead of function call)
- **Files modified:** app/native/addon.cpp
- **Commit:** 012b75d

**2. [Rule 3 - Blocking] Fixed cmake-js `--` argument forwarding**
- **Found during:** Task 1, first native build attempt
- **Issue:** cmake-js passes `--` arguments to both configure AND build phases; `cmake --build` rejects `-D` flags
- **Fix:** Removed `--` arguments from build:native script; set CMake options via FORCE cache in CMakeLists.txt instead
- **Files modified:** app/package.json, app/native/CMakeLists.txt
- **Commit:** 012b75d

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| Empty preload script | app/src/preload/index.ts | Plan 02 wires contextBridge.exposeInMainWorld |
| Placeholder renderer HTML | app/src/renderer/index.html | Plan 02 adds React entry point |
| Main index re-export only | app/src/main/index.ts | Plan 02 adds BrowserWindow creation and IPC setup |

## Verification Results

| Check | Result |
|-------|--------|
| Native addon compiles without warnings | PASS |
| Native addon links tapestry_kernel | PASS |
| KernelBridge exposes all 7 methods | PASS |
| SDK exports all required types | PASS |
| Kernel test suite (52 CTest cases) | 52/52 PASS |
| Workspace npm install resolves | PASS |
| electron-vite config valid (3 entries) | PASS |
| Functional round-trip test (create, submit, read) | PASS |
| SDK TypeScript compiles (tsc --noEmit) | PASS |
| Tracer feedback gate | PASS |

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries beyond the documented Main-to-Native-Addon boundary (T-02-01).

## Self-Check: PASSED

All 17 created files verified present. Commit 012b75d verified in git log. SUMMARY.md verified on disk.
