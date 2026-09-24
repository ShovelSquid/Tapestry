---
phase: 01-painting-with-the-pen
plan: 02
subsystem: plugin-host
tags: [tapestry-sdk, plugin-host, electron-protocol, custom-scheme, cors, path-containment, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "plugins/data-drawing dist/ layout (surface.js entry, worker chunk, ddsim.wasm asset) that this scheme will serve"
provides:
  - "SDK (API 1, additive): SurfaceContribution { id, displayName, entry, placement: 'stage' }, SurfaceHost { container, treeId, onResize, close }, SurfaceHandle { dispose }, SurfaceModule { mount }; PluginContext.registerSurface; PluginManifest.contributions.surfaces?"
  - "PluginHost.registerSurface: collision check naming the owner, entry containment identical to manifest.main, .js/.mjs and placement checks; getContributions().surfaces keyed by id with pluginName (the directory id); list().surfaces"
  - "app/src/main/plugin-scheme.ts (no Electron import): PLUGIN_SCHEME 'tapestry-plugin', SCHEME_PRIVILEGES, SURFACE_HOST_RE, mimeForPath, resolvePluginFile, makePluginSchemeHandler"
  - "index.ts: protocol.registerSchemesAsPrivileged before app.whenReady; protocol.handle over the same pluginsDir PluginHost loads from, via net.fetch(file://)"
  - "Tests: plugin-host.test.ts (5), plugin-scheme.test.ts (17)"
affects: [01-04, 01-06, 01-07, 01-08, phase-2-plugin-signed-kernel-route]

# Actuals (#2632) — chars/4 over git diff df6a6d2..HEAD, not a harness token count.
actuals:
  tokens: 8848
  tasks: 3
  commits: 2
plan_head_before: df6a6d2ff5ebf0b319a39e8f54269352b2ecb511

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contribution registration mirrors the inspector shape: findOwner collision check that names the owner, Map registry, getContributions() emits { ...contrib, pluginName }"
    - "Any string a plugin hands the host that becomes a filesystem path gets the manifest.main containment (resolve + relative must not start with '..' nor be absolute)"
    - "Custom-scheme resolver is a pure function over URL/fs with no Electron import; the protocol.handle callback is built by a factory that takes fetchFile so tests inject a fake and production injects net.fetch"
    - "Scheme handler answers 404 for anything the resolver refuses and never throws; CORS headers ride every response including 404/405"

key-files:
  created:
    - app/src/main/plugin-scheme.ts
    - app/src/main/plugin-scheme.test.ts
    - app/src/main/plugin-host.test.ts
  modified:
    - sdk/src/contributions.ts
    - sdk/src/index.ts
    - sdk/tsconfig.json
    - app/src/main/plugin-host.ts
    - app/src/main/index.ts

key-decisions:
  - "CANV-04 contract (human decision, verbatim from the orchestrator): 'Decision: A-same-realm. Kernel: omit.' — SurfaceContribution + same-realm import() over tapestry-plugin://<lowercase plugin-id>/<path>; SurfaceHost carries no kernel handle in API 1 (Phase 2 adds a plugin-signed IPC route); the surface runs in the host renderer's realm at the same 'policy, not a sandbox' trust level as plugin mains"
  - "HTMLElement in the SDK: sdk/tsconfig.json lib gains DOM (the plan's preferred line) AND contributions.ts carries /// <reference lib=\"dom\" />, because the app's main-process program (tsconfig.node.json, lib ES2020, types node) also compiles contributions.ts through the type import and failed with TS2304 on the tsconfig change alone"
  - "resolvePluginFile refuses a raw '.'/'..' segment (plain or percent-encoded) before the URL parser runs: WHATWG normalises surface/../../secret.json to /secret.json (still inside the plugin), so the plan's 'traversal → null' fixtures could only hold as a defense-in-depth refusal of URLs the renderer would never construct"
  - "list() gained surfaces: string[] (plan: 'if list() enumerates contribution ids per plugin'); getContributions().surfaces carries pluginName, the directory id, so the renderer builds URLs from it and never from manifest.name"
  - "CANV-04 left unmarked: requirements.ready-ids reports 0/1 because 01-04, 01-06 and 01-08 also declare it (shared-ID gate); recorded honestly as requirements-completed: []"

patterns-established:
  - "One-way-door SDK additions are additive only: new interfaces, a new PluginContext method, an optional manifest field; nothing existing changed shape"
  - "Scheme URL = tapestry-plugin://<pluginName>/<entry> where both parts are host-validated values (directory id, registered entry), never user strings (T-02-02)"

requirements-completed: []

coverage:
  - id: D1
    description: "SDK exports SurfaceContribution, SurfaceHost (no kernel), SurfaceHandle, SurfaceModule; PluginContext.registerSurface; PluginManifest.contributions.surfaces?; both SDK and app typechecks pass"
    requirement: CANV-04
    verification:
      - kind: other
        ref: "cd /Users/kaelencook/Tapestry && npm --prefix sdk run typecheck && npm --prefix app run typecheck (exit 0 both)"
        status: pass
      - kind: other
        ref: "grep -n 'export interface Surface(Contribution|Host|Module|Handle)' sdk/src/contributions.ts -> lines 138, 162, 186, 193"
        status: pass
    human_judgment: false
  - id: D2
    description: "PluginHost.registerSurface stores contributions with pluginName, fails a colliding plugin naming the owner, rejects escaping and unbuilt entries, and still loads manifests without contributions.surfaces"
    requirement: CANV-04
    verification:
      - kind: unit
        ref: "app/src/main/plugin-host.test.ts#PluginHost.registerSurface (5 passed)"
        status: pass
      - kind: integration
        ref: "npm --prefix app test -> 17 files, 201 tests passed (example-plugin and tapestry-notes paths untouched)"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolvePluginFile serves only tapestry-plugin://<lowercase id>/<path> inside the plugin directory (raw and encoded traversal, uppercase host, symlink escape, unknown plugin, missing file, directory, other schemes, NUL, bad encoding all null); handler: 405 non-GET/HEAD, 404 otherwise, Content-Type + ACAO * + no-store on success, fetchFile called with a file:// URL"
    requirement: CANV-04
    verification:
      - kind: unit
        ref: "app/src/main/plugin-scheme.test.ts (17 passed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "index.ts registers the privileged scheme before app.whenReady and installs protocol.handle beside PluginHost.registerHandlers over the same pluginsDir; the dev app still starts"
    requirement: CANV-04
    verification:
      - kind: other
        ref: "grep -n registerSchemesAsPrivileged app/src/main/index.ts -> line 41; app.whenReady() -> line 218; protocol.handle(PLUGIN_SCHEME -> line 246"
        status: pass
      - kind: other
        ref: "npm --prefix app run dev for 28 s: main/preload built, renderer dev server at http://localhost:5173/, 'start electron app...', zero error/exception lines (log below)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The flagged assumption behind the scheme (a file:// or http://localhost document can import() a module from tapestry-plugin://, spawn a module Worker from it and instantiate .wasm, given corsEnabled + ACAO *) holds in Electron 32"
    requirement: CANV-04
    verification: []
    human_judgment: true
    rationale: "Not provable under Node: this is probe item 18, closed by the 01-04 spike inside the running Electron renderer; if it fails, RESEARCH A1's fallback (serve from the renderer's own origin) applies and the SDK contract in this plan is unchanged"

# Metrics
duration: 30min
completed: 2026-09-23
status: complete
---

# Phase 1 Plan 02: CANV-04 Host Half Summary

**Public `SurfaceContribution` extension point in the Tapestry SDK (no kernel handle in API 1), `PluginHost.registerSurface` with owner-naming collisions and `manifest.main`-grade entry containment, and a privileged `tapestry-plugin://` scheme whose Node-testable resolver serves only real files inside a lowercase plugin id's directory with correct MIME, `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-09-23T00:52:12Z
- **Completed:** 2026-09-23T01:22:23Z
- **Tasks:** 3 (1 pre-resolved decision checkpoint + 2 auto)
- **Files modified:** 8 (3 created, 5 modified) — all in the outer `sdk/` and `app/`; nothing under `plugins/data-drawing`

## Accomplishments

- The SDK now lets any plugin (first- or third-party alike) ship renderer code: `registerSurface({ id, displayName, entry, placement: 'stage' })` and an optional `contributions.surfaces` manifest field, with `SurfaceHost` / `SurfaceHandle` / `SurfaceModule` defining what the host hands the module and what it gets back. Additive to API "1"; every existing plugin compiles untouched.
- The host validates surfaces the way it already validates `manifest.main` and inspectors: a second claim on an id fails that plugin's activation naming the first owner; an entry escaping the plugin directory, a non-`.js/.mjs` entry or a placement other than `stage` throws; `getContributions().surfaces[id]` carries `pluginName` (the directory id) so the renderer builds `tapestry-plugin://<pluginName>/<entry>` from host-validated values only.
- `tapestry-plugin://` is registered as a standard, secure, CORS-enabled, streaming scheme before `app.whenReady()` (no `bypassCSP`, no `allowServiceWorkers`), and its handler serves exactly what `resolvePluginFile` returns — a regular file whose realpath sits under the realpath of `<pluginsDir>/<lowercase id>/` — as `net.fetch(file://…)` re-wrapped with `Content-Type`, `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`; every refusal is a 404, non-GET/HEAD a 405.
- 22 new main-process tests (5 host, 17 scheme), all green alongside the existing 179.

## Task 1 record: the decision (pre-resolved by the orchestrator)

Human response, verbatim: **`Decision: A-same-realm. Kernel: omit.`**

Meaning applied: `SurfaceContribution` + same-realm `import()` over `tapestry-plugin://<lowercase plugin-id>/<path>`; `SurfaceHost` does NOT carry a `kernel` handle in Phase 1 (to be added in Phase 2 through a plugin-signed IPC route, an additive change). The prohibition in the plan's frontmatter (no host-privileged capability beyond the `SurfaceHost` contract; no path that signs a plugin's commits as the human, D-06) is honoured: `SurfaceHost` has `container`, `treeId`, `onResize`, `close` and nothing else.

## Final SDK interface text (`sdk/src/contributions.ts`, lines 138-195)

```ts
export interface SurfaceContribution {
  /** Namespaced id (e.g. "datadrawing.canvas"). */
  id: string
  /** Human-readable display name shown where the surface can be opened. */
  displayName: string
  /** ES module path relative to the plugin root (e.g. "surface/dist/surface.js"). Must be a built .js/.mjs file inside the plugin directory. */
  entry: string
  /** API version "1" supports exactly one placement: a full-window stage layer. */
  placement: 'stage'
}

export interface SurfaceHost {
  /** Host-owned, absolutely sized element filling the stage layer. The plugin owns its children and must remove them in SurfaceHandle.dispose. */
  readonly container: HTMLElement
  /** Identity of the tree the surface was opened for. */
  readonly treeId: string
  /** Subscribe to size changes of container (CSS px width, height, device pixel ratio); returns an unsubscribe function. */
  onResize(cb: (width: number, height: number, dpr: number) => void): () => void
  /** Ask the host to unmount the surface (the host then calls dispose). */
  close(): void
}

export interface SurfaceHandle {
  /** Must be idempotent: React StrictMode double-mounts in development. */
  dispose(): void
}

export interface SurfaceModule {
  /** The entry module's default export. */
  mount(host: SurfaceHost): Promise<SurfaceHandle> | SurfaceHandle
}
```

`sdk/src/index.ts`: the four types are re-exported; `PluginContext.registerSurface(contribution: SurfaceContribution): void` follows `registerInspector`; `PluginManifest.contributions.surfaces?: string[]` ("API 1 addition; optional for backward compatibility").

## Task 3 record: scheme, resolver, dev log

`SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }`; `SURFACE_HOST_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/`; MIME table `.js/.mjs → text/javascript`, `.wasm → application/wasm`, `.json/.map → application/json`, `.css`, `.html`, `.svg`, `.png`, else `application/octet-stream`.

`resolvePluginFile(pluginsDir, rawUrl)` order: raw dot-segment refusal → `new URL` → protocol check → host regex + no `..` → `resolve`/`relative` host containment (mirrors `resolvePluginDir`) → `decodeURIComponent(pathname)` (throw or NUL → null) → per-segment `.`/`..`/empty/backslash checks → `resolve(dir, ...segments)` + `relative` containment → `statSync().isFile()` → `realpathSync(file).startsWith(realpathSync(dir) + sep)`. Never throws.

`index.ts` line numbers: `registerSchemesAsPrivileged` at 41 (module top level, right after the imports), `app.whenReady()` at 218, `protocol.handle(PLUGIN_SCHEME, …)` at 246 (immediately after `PluginHost.registerHandlers`). `BrowserWindow` `webPreferences` untouched (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`).

First 20 lines of `npm --prefix app run dev` (run for 28 s, then the process group was killed; 36 lines total, zero matches for error/exception/uncaught; the log continued with the preload build, `dev server running for the electron renderer process at: http://localhost:5173/` and `start electron app...`):

```
> @tapestry/app@0.1.0 dev
> electron-vite dev

vite v5.4.21 building SSR bundle for development...
transforming...
✓ 113 modules transformed.
rendering chunks...
out/main/index.js                     130.42 kB
out/main/chunks/registry-DAbTZfwZ.js  165.33 kB
out/main/mcp.js                       609.79 kB
✓ built in 453ms

build the electron main process successfully

-----

vite v5.4.21 building SSR bundle for development...
transforming...
✓ 1 modules transformed.
rendering chunks...
```

## Task Commits

1. **Task 1: Decide the CANV-04 contract shape** — no commit (decision recorded here and in STATE.md)
2. **Task 2: SDK SurfaceContribution types and PluginHost.registerSurface with tests** — `b9a156d` (feat)
3. **Task 3: tapestry-plugin:// privileged scheme — resolver, MIME table, handler** — `e849109` (feat)

**Plan metadata:** the final `docs(01-02)` commit.

## Files Created/Modified

- `sdk/src/contributions.ts` — Surface Contribution section (four interfaces); `/// <reference lib="dom" />` at the top
- `sdk/src/index.ts` — re-exports, `PluginContext.registerSurface`, `PluginManifest.contributions.surfaces?`
- `sdk/tsconfig.json` — `lib: ["ES2020", "DOM"]`
- `app/src/main/plugin-host.ts` — `surfaces` in `PluginManifest`, `ContributionRegistry`, `createEmptyRegistry`, `unloadPlugin`; `findOwner` kind union; `registerSurface`; `getContributions().surfaces`; `list().surfaces`
- `app/src/main/plugin-host.test.ts` — 5 cases over real temp plugin directories loaded through `discoverAndLoadAll` with a truthy stub bridge (`loadPlugin` refuses `null`)
- `app/src/main/plugin-scheme.ts` — scheme constants, MIME, resolver, handler factory (no Electron import)
- `app/src/main/plugin-scheme.test.ts` — 17 cases over a temp `plugins/demo/` tree with an outside file and a symlink to it
- `app/src/main/index.ts` — `net, protocol` import, scheme registration before ready, `protocol.handle` inside `whenReady`

## Decisions Made

See `key-decisions` in the frontmatter: the human's A-same-realm / kernel-omit answer; the double DOM-lib fix; raw dot-segment refusal ahead of URL normalisation; `list().surfaces`; CANV-04 left to the shared-ID gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `HTMLElement` unresolved in the app's main-process typecheck**
- **Found during:** Task 2
- **Issue:** The plan's preferred one-line fix (`lib: ["ES2020", "DOM"]` in `sdk/tsconfig.json`) makes the SDK typecheck pass, but `app/tsconfig.node.json` (lib ES2020, `types: ["node"]`) compiles `sdk/src/contributions.ts` through `plugin-host.ts`'s type import and failed with `TS2304: Cannot find name 'HTMLElement'`.
- **Fix:** Kept the tsconfig line (honest for SDK consumers) and added `/// <reference lib="dom" />` to `contributions.ts`, the plan's stated alternative, so every program that includes the file resolves the type. Both typechecks pass; no main-process DOM/Node global conflicts surfaced.
- **Files modified:** `sdk/src/contributions.ts`, `sdk/tsconfig.json`
- **Verification:** `npm --prefix sdk run typecheck && npm --prefix app run typecheck` exit 0
- **Committed in:** `b9a156d`

**2. [Rule 1 - Bug] Traversal fixtures resolved to a contained file instead of null**
- **Found during:** Task 3
- **Issue:** `tapestry-plugin://demo/surface/../../secret.json` and the `%2e%2e` form are normalised by the WHATWG URL parser to `/secret.json` before `pathname` is inspected, so the per-segment `..` check the plan specifies could never fire and the resolver returned `demo/secret.json` (inside the plugin, so not an escape — but not the `null` the plan's must-have requires).
- **Fix:** `resolvePluginFile` first percent-decodes the raw URL string and refuses any `.`/`..` segment before parsing (defense in depth: the renderer never constructs such a URL). The per-segment check after decoding stays for `%2f`-encoded slashes, which the parser does not normalise.
- **Files modified:** `app/src/main/plugin-scheme.ts`
- **Verification:** `plugin-scheme.test.ts` 17/17
- **Committed in:** `e849109`

### Design choices within the plan's contract (not deviations from must-haves)

- The handler answers `HEAD` with headers and no body (the plan allows GET/HEAD) and carries the CORS headers on 404/405 too, so a failed cross-origin probe reads as 404 rather than as an opaque CORS error.
- Rejected raw-URL segments also cover backslashes; hosts starting with `.` fail the regex as intended.
- `list()` gained `surfaces: string[]` per the plan's "if list() enumerates contribution ids" clause.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). **Impact on plan:** both required to satisfy the plan's own verify commands and must-haves; no scope creep. The Task 1 decision was supplied by the orchestrator (already answered by the human), so no checkpoint stop occurred.

## Issues Encountered

- `npm --prefix app run dev` printed `Re-optimizing dependencies because lockfile has changed` (Vite dep cache after 01-01 added a workspace member); harmless and unrelated to the scheme.
- macOS has no `setsid`/`timeout`; the dev run was wrapped in `perl -e 'setpgrp; exec'` so the whole Electron process group could be killed cleanly after the log was captured. No stray process remained.

## Known Stubs

None. Every new function is wired and tested; the renderer-side consumer (`PluginSurfaceLayer`, `App.tsx`, `global.d.ts`) is deliberately 01-04's work, not a stub here.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-surface | app/src/main/index.ts | `tapestry-plugin://` is a new privileged origin reachable by any renderer document; mitigated by `resolvePluginFile` containment (T-02-01), registered without `bypassCSP`/`allowServiceWorkers` (V14). Already in the plan's threat model; listed because the surface now exists. |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 01-04 can now build `PluginSurfaceLayer` against `getContributions().surfaces` and `import(/* @vite-ignore */ \`tapestry-plugin://${pluginName}/${entry}\`)`; its spike closes probe item 18 (module import, module Worker and `.wasm` from the scheme inside Electron 32). If it fails, RESEARCH A1's own-origin fallback applies and nothing in this plan's SDK contract changes.
- 01-06 can register `datadrawing.canvas` with `entry: 'surface/dist/surface.js'` and add `contributions.surfaces` to `plugins/data-drawing/tapestry.plugin.json`.
- Phase 2: add a plugin-signed kernel route to `SurfaceHost` (additive).
- CANV-04 stays unchecked in REQUIREMENTS.md until 01-04, 01-06 and 01-08 finish (shared-ID gate).
- For a human, optionally: open the dev app and confirm the window still appears; everything else asserted here ran headlessly.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-23*

## Self-Check: PASSED

Created files exist on disk (`app/src/main/plugin-scheme.ts`, `app/src/main/plugin-scheme.test.ts`, `app/src/main/plugin-host.test.ts`); commits `b9a156d` and `e849109` are in history; `git rev-list --count df6a6d2..HEAD` = 2 with code changes, matching `actuals.commits`.
