---
phase: 02-plugin-host-sdk-feasibility-gate
fixed_at: 2026-09-10T03:26:33Z
review_path: /Users/kaelencook/conductor/workspaces/Tapestry/wellington/.planning/phases/02-plugin-host-sdk-feasibility-gate/02-REVIEW.md
iteration: 1
findings_in_scope: 18
fixed: 18
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-09-10T03:26:33Z
**Source review:** /Users/kaelencook/conductor/workspaces/Tapestry/wellington/.planning/phases/02-plugin-host-sdk-feasibility-gate/02-REVIEW.md
**Iteration:** 1 (second fix round for this phase; this report replaces the report from the prior round)

**Summary:**
- Findings in scope: 18 (CR-01..CR-08, WR-01..WR-10; IN-01..IN-06 out of scope)
- Fixed: 18
- Skipped: 0

**Verification (where it ran):**
- All edits, verification, and commits ran in the isolated worktree `/Users/kaelencook/conductor/workspaces/Tapestry/wellington/.claude/worktrees/rf-02-54249-1789008951` on temp branch `gsd-reviewfix/02-54249`, fast-forwarded into `phase-2-implementation` on cleanup. The worktree is nested inside the Conductor workspace, so Node module resolution found the main checkout's `node_modules`; no gates were run in the main checkout itself. Numbers below are reproducible from the main checkout after the fast-forward by re-running the same commands there.
- TypeScript (Tier 2): `npx tsc --noEmit -p app/tsconfig.node.json` and `-p app/tsconfig.web.json` were run after every TS/TSX fix and once more on the final tree; both clean (baseline was also clean).
- Native addon (Tier 2 + runtime): `app/native/addon.cpp` was syntax-checked with the project's exact compiler flags (`-std=c++20 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -DNAPI_DISABLE_CPP_EXCEPTIONS`) after each C++ fix, then fully built in the worktree with `npx cmake-js build --directory native -O native/build` (about 7 s) and exercised under Electron's bundled Node 20.18.1 (`ELECTRON_RUN_AS_NODE=1`). The worktree build output was gitignored and removed with the worktree; rebuild in the main checkout with `npm --workspace app run build:native` before launching the app.
- Plugin host (runtime): `app/src/main/plugin-host.ts` was compiled to CommonJS with the main checkout's `tsc` and driven under Electron's Node with a fake bridge and fixture plugin directories (malformed manifests, traversal names, `.ts` entries, crashing/rejecting commands, submodule edits, contribution collisions). Final end-to-end smoke: the two real bundled plugins loaded from `plugins/` through the compiled host against the real addon, `plugin:list` reported both `loaded`, and `example.inspect` executed against a live node.
- Tier 1 (re-read of every modified section) was performed for every fix.
- Not run: the Electron app itself (UI), the electron-vite build, and the C++ kernel test binaries. Findings that change user-visible behavior are marked "requires human verification" below.
- Tooling note: the `gsd-tools query commit` helper stages only existing paths, so the CR-01 rename (`index.ts` -> `index.js`) initially left the two deletions staged; the commit was amended (`fd2fb8c`) so the rename is atomic.

## Fixed Issues

### CR-01: Plugins cannot load -- host `require()`s TypeScript entry files

**Files modified:** `plugins/tapestry-notes/index.ts` -> `plugins/tapestry-notes/index.js`, `plugins/example-plugin/index.ts` -> `plugins/example-plugin/index.js`, `plugins/tapestry-notes/tapestry.plugin.json`, `plugins/example-plugin/tapestry.plugin.json`, `app/src/main/plugin-host.ts`
**Commit:** fd2fb8c
**Applied fix:** Both bundled plugins are now plain CommonJS JavaScript (renamed with `git mv`, SDK types carried through JSDoc `@typedef {import('@tapestry/sdk')...}` annotations) so the host can `require()` them with no build step; both manifests point at `index.js`. `loadPlugin` refuses any entry that is not `.js`/`.cjs` with an actionable reason ("build the plugin first"). Verified: both plugins `require()` and `activate()` under Electron's Node 20.18.1; end-to-end smoke shows `plugin:list` reporting both `loaded` and `getContributions().nodeViews['tapestry.notes/note@1'] = NoteCard`. Not added: a live TypeScript transpile hook (would need a new dependency) and the reviewer's suggested automated smoke test. `plugins/example-plugin/PropertyPanel.tsx` is untouched (IN-04, out of scope).
**Status:** fixed: requires human verification (confirm NoteCard renders instead of FallbackNodeView in the running app)

### CR-02: Undo followed by a new edit corrupts the `.tree` file on next open

**Files modified:** `app/src/main/kernel-bridge.ts`, `app/src/renderer/App.tsx`
**Commit:** 48d4bbe
**Applied fix:** `KernelBridge.submit` now throws `Cannot commit while history is rewound; redo to the latest change or discard the undo first` whenever `currentSeq !== getLastSeq()`, so a commit can never be appended after undone commits (the reviewer's interim hard-fail; compensating commits / real branching remain future work). In `App.tsx`, every kernel failure that previously went only to `console.error` now also surfaces to the user: a `reportSaveError(action, err)` helper sets the save indicator to error and shows the message in the existing notification banner (`showAppError`), used by create/move/resize/connect/save/property-edit/delete; undo/redo failures also show the banner.
**Status:** fixed: requires human verification (behavior change: editing after undo is refused until redo; confirm the banner wording and that the kernel-level reopen test the reviewer suggested is added later)

### CR-03: Plugin *name* from IPC still escapes `plugins/` and drives `require()`

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** 404ffda
**Applied fix:** Added `PLUGIN_NAME_RE` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, plus an explicit `..` rejection), an exported `isValidPluginName()` type guard, and a private `resolvePluginDir(name)` that additionally requires the resolved directory to be a direct child of `pluginsDir`. `loadPlugin` and `unloadPlugin` go through the helper; the `plugin:reload`/`plugin:enable`/`plugin:disable` IPC handlers reject invalid names before touching the host. Verified with the harness: `../../../../tmp/rf-evil`, `../rf-evil`, and a non-string name all return `Invalid plugin name` and the planted module never executes.
**Status:** fixed

### CR-04: `Submit` aborts the main process on a malformed op; non-array `ops` writes an empty commit

**Files modified:** `app/native/addon.cpp`
**Commit:** 652ef89
**Applied fix:** Rewrote the JS-to-kernel conversion layer around `throwTypeError()` (throws only if no exception is pending) and `requireString()`; every field in `jsToValue`, `jsToValueInferred`, `parseTarget`, `jsPropsToMap`, and `jsToOp` is type-checked before it is cast and each function returns immediately after the first throw. `Submit` validates all four arguments (`IsString` x3, `IsArray`) before any conversion, rejects non-object array elements, and never calls `m_kernel->submit` while an exception is pending. Verified at runtime against the built addon: 20 malformed-input cases (`[42]`, `[null]`, `[[1]]`, `{}`, bad verb, non-string target/from/id/type/key, uninferrable props, non-array/undefined `ops`, non-string actor) all surface as JS `TypeError`s with `getLastSeq()` unchanged; valid submits still succeed afterwards.
**Status:** fixed

### CR-05: HTML injection in `deserializeBody`

**Files modified:** `app/src/renderer/components/NoteCard.tsx`
**Commit:** 8060141
**Applied fix:** Replaced the `innerHTML` + `DOMParser` fallback with `plainTextToDoc()`, which builds the document through the schema (`noteSchema.text(line)` per paragraph), so body text is never interpreted as HTML; the unused `DOMParser` import was removed. The secondary suggestion (a `Content-Security-Policy` meta tag in `index.html`) was deliberately not applied: `@vitejs/plugin-react` 4.7 injects its fast-refresh preamble as an inline `<script>` in dev, so `script-src 'self'` would break the dev loop. Recommended follow-up: apply the CSP for packaged builds only (e.g. `session.webRequest.onHeadersReceived` when `ELECTRON_RENDERER_URL` is unset).
**Status:** fixed

### CR-06: Body-sync effect discards in-progress edits, selection, and editor history

**Files modified:** `app/src/renderer/components/NoteCard.tsx`, `app/src/renderer/App.tsx`
**Commit:** 36c9947
**Applied fix:** `NoteCard` keeps `lastEmittedBodyRef` (updated in the debounce save and the unmount save, reset when the editor mounts for a node); the sync effect returns early when the prop equals the last emitted body (echo of our own save) or when a debounce timer is pending (user mid-edit), and otherwise replaces the document via a transaction tagged `addToHistory: false` and `externalSync: true` instead of recreating `EditorState`. `dispatchTransaction` ignores `externalSync` transactions for dirty-marking/saving. `App.handleNoteSave` now mirrors the saved `body`/`title` into local `nodes` state after a successful submit so the prop no longer lags the kernel.
**Status:** fixed: requires human verification (reproduce the reviewer's "type, then double-click within 300 ms" case and confirm in-editor Mod-z still works after moving a note)

### CR-07: Plugin "Restart" always fails and the failure is hidden

**Files modified:** `app/src/main/plugin-host.ts`, `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/renderer/global.d.ts`, `app/src/renderer/components/PluginErrorNotification.tsx`, `app/src/renderer/App.tsx`
**Commit:** 6a5b064
**Applied fix:** `onPluginError` now carries `(pluginName, displayName, message, canRestart)`; `handlePluginCrash` passes the plugin id as `pluginName` at all three call sites, `index.ts` forwards both over `plugin-error`, and the preload/`global.d.ts` signatures match. The renderer stores both, `PluginErrorNotification` shows `displayName` and calls `onRestart(pluginName)` with the id, and `handlePluginRestart` honours the reload result: `loaded` clears the banner and refreshes contributions; anything else keeps the banner with `<displayName> could not restart: <reason>` and `canRestart: true`. Harness confirms crash notices carry `["good", "Good Plugin", ...]`.
**Status:** fixed: requires human verification (UI flow)

### CR-08: A malformed manifest field aborts world opening (D-33)

**Files modified:** `app/src/main/plugin-host.ts`, `app/src/main/index.ts`
**Commit:** 014b2cb
**Applied fix:** Added `normalizeManifest()` which type-checks `name`/`version`/`main` as strings (plus `displayName`, `api`, `contributions` normalization) and is used by both `discoverPlugins` and `loadPlugin`, so path resolution can no longer throw a `TypeError` out of the host. `discoverAndLoadAll` wraps each load/unload in its own try/catch. Entry-path failures (`main` escaping the directory or not `.js`) are now recorded via `recordFailure()` so the plugin remains visible in `plugin:list` with its reason instead of vanishing. In `index.ts`, a `loadPluginsSafely()` helper isolates plugin discovery in `kernel:create`, `kernel:open`, and startup; startup opens the kernel first and only a kernel failure clears `currentFilePath`. Harness: `"main": 1` and `"name": {"x":1}` are skipped with reasons, a throwing `activate` is isolated, and `discoverAndLoadAll` resolves.
**Status:** fixed

### WR-01: Addon has no `close()`; the journal lock is held until GC

**Files modified:** `app/native/addon.cpp`, `app/src/main/kernel-bridge.ts`, `app/src/main/index.ts`
**Commit:** 9bf7e21
**Applied fix:** Added `TapestryAddon.close()` (resets `m_kernel`; idempotent; later calls report `No kernel loaded`). `KernelBridge.create/open` create/open the new kernel first (a failure keeps the old world), then `close()` the previous instance; reopening the path that is already open releases our own lock first. `KernelBridge.close()` also resets `currentSeq`/`undoStack`. `index.ts` calls `bridge.close()` on `will-quit`. Runtime test: opening a held file fails with the lock error, reopening after `close()` succeeds, double close is a no-op.
**Status:** fixed

### WR-02: `int` values are silently truncated or saturated

**Files modified:** `app/native/addon.cpp`
**Commit:** aa5b695
**Applied fix:** Added `requireSafeInteger()` (rejects non-numbers with `TypeError`; NaN/Infinity, fractional values, and magnitudes above 2^53 with `RangeError`) and `throwRangeError()`. Used for explicit `int` properties, `advance.ticks` (additionally must be non-negative), and `replayUpTo(seq)` (non-negative). Runtime test: `1.75`, `1e30`, `NaN`, `Infinity`, `2^53+2`, `ticks: -1`, `ticks: 1.5`, `replayUpTo(-1)`, `replayUpTo(1.5)` all throw with the journal unchanged; `2^53`, `-5`, `ticks: 2`, `replayUpTo(1)` succeed. The inferred-type path (`{ key: 3 }`) is unchanged.
**Status:** fixed

### WR-03: Any command-handler error is treated as a plugin crash

**Files modified:** `app/src/main/plugin-host.ts`, `app/src/renderer/global.d.ts`
**Commit:** 40a8903
**Applied fix:** `plugin:executeCommand` classifies only `TypeError`/`ReferenceError`/`RangeError` as crashes (escalating to `handlePluginCrash`); every other rejection is returned to the caller as `{ ok: false, error, crashed: false }` without unloading the plugin. The renderer type gains `crashed?: boolean`. Harness: a handler throwing `Error('validation failed')` returns the error and leaves the plugin loaded with no notification; a `TypeError` restarts it. The reviewer's `CommandError` SDK class was not added (SDK contract change; out of this fix's scope).
**Status:** fixed: requires human verification (classification policy: a plugin passing a malformed op receives a `TypeError`/`RangeError` from the addon and is therefore restarted)

### WR-04: Enable/disable are recorded inaccurately and are not durable within the session

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** 45bb175
**Applied fix:** Added an authoritative `disabled` set: `discoverAndLoadAll` skips names in it, `disablePlugin` adds to it and keeps a `status: 'disabled'` map entry (manifest read from disk if needed) so the plugin stays in `plugin:list`, `enablePlugin`/`reloadPlugin` remove from it. Journal events go through a `recordEvent()` helper and are written only for real transitions: `enabled plugin X` only when the load result is `loaded` and the plugin was not already running; `disabled plugin X` only when it was running. Harness (13 checks): disabled plugin survives re-discovery with no re-activation, unknown/already-disabled/failed cases are not journaled. Persisting `disabled` across launches (D-35) was not implemented.
**Status:** fixed: requires human verification (D-32 journal semantics)

### WR-05: `enablePlugin`/`loadPlugin` on an already-loaded plugin activates it twice

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** f20e607
**Applied fix:** `loadPlugin` short-circuits with `{ status: 'loaded' }` when the plugin is already running; `enablePlugin` calls `reloadPlugin` (deactivate, then activate) when it was already loaded. Harness: `loadPlugin` on a running plugin leaves activations at 1; `enablePlugin` yields activations 2 / deactivations 1.
**Status:** fixed

### WR-06: `unloadPlugin` only evicts the entry module from `require.cache`

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** a0238b4
**Applied fix:** `unloadPlugin` deletes every `require.cache` key under the plugin directory, matching both the logical path and `realpathSync(pluginDir)` (cache keys are real paths; `/tmp` -> `/private/tmp` on macOS and a symlinked `plugins/` would otherwise never match), then also evicts the resolved entry. Harness: editing `helper.js` and calling `reloadPlugin` yields the new value.
**Status:** fixed

### WR-07: Save dialog permits locations that `validateTreePath` rejects, and the user gets no feedback

**Files modified:** `app/src/main/index.ts`, `app/src/renderer/App.tsx`
**Commit:** 1a33fb2
**Applied fix:** Chose the "validate the dialog's result in main" option so the home restriction (the prior round's fix) is kept for fabricated paths: `dialog:showSave` normalizes the chosen path (resolved, `.tree` appended if missing) and records it in a session `approvedPaths` set; `validateTreePath` accepts well-formed paths that are either approved or under home. A shared `isWellFormedTreePath()` (absolute, `.tree`, no `..` segments) is also applied by `readLastOpened()`, and the restored last-opened path is approved at startup. In the renderer, a failed world creation now calls `reportSaveError('Could not create world', err)` so the reason is visible. The "Replace existing file" case is not auto-handled: `Kernel::create` still refuses an existing path, but the error is now shown instead of silently ignored.
**Status:** fixed: requires human verification (path policy and dialog flow on the target platform)

### WR-08: Directory name and manifest `name` are conflated

**Files modified:** `app/src/main/plugin-host.ts`, `app/src/renderer/global.d.ts`
**Commit:** a95e069
**Applied fix:** `discoverPlugins()` returns `DiscoveredPlugin { dir, manifest }` (directory entries sorted by name for deterministic load order, and validated with `isValidPluginName`), `discoverAndLoadAll` keys everything by `dir`, and `list()` exposes `id` (directory) alongside `name` (manifest metadata); the renderer type gains `id`. Harness: a directory `mismatch-dir` whose manifest says `"name": "other-name"` loads, runs its command, and reloads by its directory id.
**Status:** fixed

### WR-09: Contribution collisions between plugins are resolved silently by iteration order

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** 9d77b0a
**Applied fix:** `registerNodeView`/`registerCommand`/`registerInspector` consult a `findOwner()` closure over other loaded plugins and throw `... is already registered by plugin <owner>`; the throw fails the second plugin's activation (status `failed`, reason names the owner) and discards its partial registrations, so the first registrant -- deterministic thanks to WR-08's sorted discovery -- keeps the contribution. Property panels remain additive per node type. Harness: `zz-dup` colliding on `x/y@1` fails with the owner named while `good` is unaffected.
**Status:** fixed: requires human verification (policy choice: reject rather than warn)

### WR-10: `handlePluginCrash` and `plugin:executeCommand` mutate `host.plugins` while iterating it

**Files modified:** `app/src/main/plugin-host.ts`
**Commit:** 157ecc4
**Applied fix:** `plugin:executeCommand` resolves the owning `[pluginId, loaded]` entry with a single `find` over a snapshot of `host.plugins.entries()` before executing, returns `not found` early, and runs the handler and crash handling outside any loop; crash handling now receives the map key (directory id, per WR-08) rather than `loaded.manifest.name`. All host harnesses (crash/restart, enable/disable, reload, collisions) pass on the final tree.
**Status:** fixed

## Skipped Issues

None -- all in-scope findings were fixed.

## Notes for the orchestrator

- Fix commits on `phase-2-implementation` (in order): fd2fb8c, 48d4bbe, 404ffda, 652ef89, 8060141, 36c9947, 014b2cb, 6a5b064, aa5b695, 9bf7e21, 40a8903, 1a33fb2, 45bb175, f20e607, a0238b4, a95e069, 9d77b0a, 157ecc4.
- Plugin entry files changed extension (`plugins/*/index.ts` -> `index.js`); any phase docs or plans that describe bundled plugins as TypeScript sources should be updated, and IN-04 (no tsconfig covers `plugins/`) now applies only to `PropertyPanel.tsx`.
- Rebuild the addon in the main checkout (`npm --workspace app run build:native`) before running the app; the worktree build was discarded with the worktree.
- Follow-ups not done here: production-only CSP (CR-05), undo as compensating commits or real branches plus the reopen-after-undo kernel test (CR-02), addon malformed-input tests in the repo (CR-04), `CommandError` in the SDK (WR-03), persisting the disabled set across launches (WR-04).

---

_Fixed: 2026-09-10T03:26:33Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
