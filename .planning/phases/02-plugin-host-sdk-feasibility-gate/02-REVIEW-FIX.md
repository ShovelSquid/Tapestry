---
phase: 02-plugin-host-sdk-feasibility-gate
fixed_at: 2026-09-10T01:41:15Z
review_path: /Users/kaelencook/conductor/workspaces/Tapestry/wellington/.planning/phases/02-plugin-host-sdk-feasibility-gate/02-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 12
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-09-10T01:41:15Z
**Source review:** /Users/kaelencook/conductor/workspaces/Tapestry/wellington/.planning/phases/02-plugin-host-sdk-feasibility-gate/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 12
- Fixed: 12
- Skipped: 0

**Verification:**
- All per-finding verification ran in the isolated worktree: `/Users/kaelencook/Tapestry/.claude/worktrees/rf-02-17079-1789004028`
- Required Tier 1 re-read verification was completed for every modified source section.
- TypeScript checks were attempted in the isolated worktree with `npx tsc --noEmit`, but the worktree had no installed TypeScript compiler and `npx` resolved the unsupported placeholder `tsc@2.0.4`.
- The fixer did not run main-checkout gates. Native C++ changes used Tier 1 verification only because no cheap standalone addon syntax check was available without the native build environment.
- Orchestrator follow-up fixed the SDK source import/typecheck configuration in commit `801371a`, then ran `npm --workspace app run typecheck` in the main checkout successfully.
- Human verification recommended for behavior/state fixes: CR-01, CR-02, CR-03, WR-05, WR-09.

## Fixed Issues

### CR-01: ProseMirror editor shows stale content after undo/redo

**Files modified:** `app/src/renderer/components/NoteCard.tsx`
**Commit:** 2fc901c
**Applied fix:** Added a secondary effect that compares the external `body` prop to the current ProseMirror document and updates the editor state when they diverge.
**Status:** fixed: requires human verification

### CR-02: Connection creation fails -- NoteCard stopPropagation blocks Canvas pointerUp

**Files modified:** `app/src/renderer/components/NoteCard.tsx`
**Commit:** ed8d10f
**Applied fix:** Changed the root `onPointerUp` handler to stop propagation only when the card is not in connecting mode, allowing Canvas to complete connection creation.
**Status:** fixed: requires human verification

### CR-03: Race condition -- file-opened event missed on launch

**Files modified:** `app/src/main/index.ts`
**Commit:** 56ef39c
**Applied fix:** Replaced the late `did-finish-load` listener with load-state-aware notification logic that sends immediately after startup async work when the renderer is already loaded, or waits once if it is still loading.
**Status:** fixed: requires human verification

### WR-01: C++ addon produces sparse arrays when nodes are skipped

**Files modified:** `app/native/addon.cpp`
**Commit:** 25b52ba
**Applied fix:** Added separate output indexes for `GetNodes` and `GetEdges`, compacting arrays when missing nodes or edges are skipped and trimming array length to the populated count.
**Status:** fixed

### WR-02: IPC event listeners accumulate without cleanup

**Files modified:** `app/src/preload/index.ts`, `app/src/renderer/App.tsx`, `app/src/renderer/global.d.ts`
**Commit:** 63ad33d
**Applied fix:** Made preload event subscriptions return unsubscribe functions, used those functions from the React effect cleanup, and updated ambient renderer API types.
**Status:** fixed

### WR-03: Plugin `main` field allows path traversal outside plugin directory

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** 7e8e029
**Applied fix:** Resolved plugin entry paths from the plugin directory and rejected entries whose relative path escapes that directory.
**Status:** fixed

### WR-04: require.cache cleanup throws on deleted plugin files

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** f9331bb
**Applied fix:** Wrapped `require.resolve` cache cleanup in a try/catch so already-deleted plugin files do not break unload.
**Status:** fixed

### WR-05: Command context `selectedNodes` is always empty

**Files modified:** `app/src/preload/index.ts`, `app/src/renderer/global.d.ts`, `app/src/main/plugin-host.ts`
**Commit:** b7d9cd1
**Applied fix:** Extended the plugin command IPC contract to accept selected node IDs and used the provided array when constructing `CommandContext`.
**Status:** fixed: requires human verification

### WR-06: ExamplePropertyPanel returns a plain object instead of a React element

**Files modified:** `plugins/example-plugin/PropertyPanel.tsx`
**Commit:** a4f0952
**Applied fix:** Rewrote the example property panel to return JSX while preserving the plugin's SDK-only import constraint.
**Status:** fixed

### WR-07: No IPC path validation for kernel:create and kernel:open

**Files modified:** `app/src/main/index.ts`
**Commit:** a9686c9
**Applied fix:** Added `.tree` path validation scoped under the user's home directory and guarded both `kernel:create` and `kernel:open`.
**Status:** fixed

### WR-08: Unsafe int64 to double conversion -- potential undefined behavior

**Files modified:** `app/native/addon.cpp`
**Commit:** 8bcad85
**Applied fix:** Replaced the `INT64_MAX` double comparison with a representable safe upper bound before casting to `int64_t`.
**Status:** fixed

### WR-09: discoverAndLoadAll does not unload plugins removed from disk

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** 5aa9f98
**Applied fix:** Compared loaded plugins against the latest discovery result and unloaded loaded plugins whose directories are no longer present.
**Status:** fixed: requires human verification

---

_Fixed: 2026-09-10T01:41:15Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
