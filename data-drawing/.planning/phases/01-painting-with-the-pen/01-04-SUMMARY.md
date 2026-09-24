---
phase: 01-painting-with-the-pen
plan: 04
subsystem: renderer-plugin-surface
tags: [tapestry-renderer, react, plugin-surface, custom-scheme, module-worker, webassembly, blob-url, electron, canv-04]

# Dependency graph
requires:
  - phase: 01-02
    provides: "SurfaceContribution/SurfaceHost/SurfaceHandle/SurfaceModule SDK types, PluginHost.registerSurface, getContributions().surfaces with pluginName, and the privileged tapestry-plugin:// scheme with containment/MIME/CORS"
provides:
  - "app/src/renderer/components/PluginSurfaceLayer.tsx: SurfaceLauncher (one 'Open <displayName>' button per registered surface, zIndex 8500) and PluginSurfaceLayer (fixed full-window layer, zIndex 9000, header + Close, Escape closes) that dynamically imports tapestry-plugin://<pluginName>/<entry> from registry data only and calls the module's default mount(host); dispose exactly once per mount under StrictMode; import/mount failures rendered in the layer and console.error'd"
  - "app/src/renderer/global.d.ts: surfaces record on getContributions() and TapestrySurfaceHost/TapestrySurfaceHandle/TapestrySurfaceModule mirrors of the SDK types"
  - "app/src/renderer/App.tsx: pluginSurfaces/openSurface state, refreshPluginContributions reads contributions.surfaces, SurfaceLauncher after ForestBar, PluginSurfaceLayer before Canvas"
  - "plugins/example-plugin/surface/{surface.js, surface.worker.js, spike.wasm}: a no-build third-party-style surface that prints isSecureContext, crossOriginIsolated, gpu, worker, wasm, size; registered via context.registerSurface and contributions.surfaces in the manifest"
  - "Human-verified fact sheet on Electron 32 for the electron-vite dev build and the built (loadFile) app: worker=ok, wasm=ok in both; mounts == disposes over four open/close cycles; no MIME/CORS/SecurityError console lines"
  - "The same-origin blob: trampoline pattern for spawning a module Worker whose script lives on tapestry-plugin://"
affects: [01-06, 01-07, 01-08, phase-2-plugin-signed-kernel-route]

# Actuals (#2632) — chars/4 over git diff cc9b5dc..HEAD (23836 bytes), not a harness token count.
actuals:
  tokens: 5959
  tasks: 3
  commits: 3
plan_head_before: cc9b5dc01e26486bb2d1b40441935fd5a31e0b29

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Renderer builds the surface module URL from getContributions().surfaces (pluginName = directory id, entry = host-validated registered path) and nowhere else; the literal scheme prefix appears exactly once in PluginSurfaceLayer.tsx"
    - "Mount/dispose in a useEffect keyed on pluginName+entry with a cancelled flag; the module's dispose() is idempotent by contract so StrictMode's double invoke is safe and counted"
    - "A module Worker whose script is served from tapestry-plugin:// is spawned through a same-origin blob: module whose sole statement is a static import of the absolute worker URL; the blob URL is revoked on first message, onerror, construction catch and dispose"
    - "The host validates that an imported surface module has a default export with a mount function before calling it, rendering the error state otherwise"

key-files:
  created:
    - app/src/renderer/components/PluginSurfaceLayer.tsx
    - plugins/example-plugin/surface/surface.js
    - plugins/example-plugin/surface/surface.worker.js
    - plugins/example-plugin/surface/spike.wasm
  modified:
    - app/src/renderer/App.tsx
    - app/src/renderer/global.d.ts
    - plugins/example-plugin/index.js
    - plugins/example-plugin/tapestry.plugin.json

key-decisions:
  - "Blob trampoline for the spike Worker (human decision, Kaelen at the Task 3 checkpoint): Chromium refuses `new Worker('tapestry-plugin://...')` from a document on http://localhost:5173 or file:// because Worker scripts must be same-origin with the document and CORS cannot relax it. Chosen over RESEARCH fallback A1 (serve the surface from the renderer origin) and over halting, because it is plugin-side only, keeps the scheme as the origin of the worker's module graph and of the .wasm, and changes nothing in the SDK contract or the host"
  - "SurfaceLauncher sits at zIndex 8500 (plan said 9500) so an open layer (9000) covers its own launcher while PluginErrorNotification (10000) stays on top"
  - "RESEARCH A2 (module Worker spawned directly from the scheme) is refuted in its literal form on Electron 32; A1 (import over the scheme) and A12 (crossOriginIsolated=false) stand as observed in both load modes"
  - "CANV-04 left unmarked after 01-04: shared-ID gate (01-06 and 01-08 also declare it); recorded honestly as requirements-completed: []"

patterns-established:
  - "Surface URL discipline: `tapestry-plugin://${surface.pluginName}/${surface.entry}` from registry data only; no free-string prop reaches import()"
  - "Same-origin blob trampoline for scheme-hosted module Workers; candidates for a shared spawnSameOriginModuleWorker(url) helper rather than per-plugin copies"
  - "Layer z-order: launcher 8500 < surface layer 9000 < notifications 10000"

requirements-completed: []

coverage:
  - id: D1
    description: "PluginSurfaceLayer and SurfaceLauncher exist, App wires them, global.d.ts mirrors the SDK surface types, typecheck and build:js pass, the scheme literal appears once and the layer imports nothing from three/SDK/Electron"
    requirement: CANV-04
    verification:
      - kind: other
        ref: "cd /Users/kaelencook/Tapestry && npm --prefix app run typecheck && npm --prefix app run build:js (exit 0)"
        status: pass
      - kind: other
        ref: "grep -c 'tapestry-plugin://' app/src/renderer/components/PluginSurfaceLayer.tsx -> 1; grep -n 'zIndex: 9000' -> one line; grep -n \"from 'three'|from '@tapestry/sdk'|from 'electron'\" -> nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "The example plugin registers a surface with no build step and no host edits: spike.wasm is 8 bytes and constructs a WebAssembly.Module, surface.js has a default export with mount, index.js calls registerSurface, the manifest lists contributions.surfaces, and the plugin-host tests still pass with the real example plugin discoverable"
    requirement: CANV-04
    verification:
      - kind: other
        ref: "node -e 'new WebAssembly.Module(fs.readFileSync(plugins/example-plugin/surface/spike.wasm))' -> wasm-module-ok; node --check plugins/example-plugin/index.js; dynamic import of surface.js -> surface-module-ok"
        status: pass
      - kind: unit
        ref: "npm --prefix app test -- src/main/plugin-host.test.ts (passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Inside Tapestry the example surface reports isSecureContext=true, crossOriginIsolated=false, gpu=true, worker=ok, wasm=ok in both the electron-vite dev build and the built (loadFile) app; mounts equal disposes over four open/close cycles; no MIME/CORS/SecurityError console lines"
    requirement: CANV-04
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint, dev build http://localhost:5173 after ea6bc9e: six lines pasted by the human (recorded verbatim below)"
        status: pass
      - kind: manual_procedural
        ref: "Task 3 checkpoint, built app file:///Users/kaelencook/Tapestry/app/out/renderer/index.html: six lines pasted by the human (recorded verbatim below)"
        status: pass
      - kind: automated_ui
        ref: "Chrome DevTools Protocol (--remote-debugging-port=9222) on the built app: four Open/Escape cycles -> [globalThis.__exampleSurfaceMounts, globalThis.__exampleSurfaceDisposes] = [4, 4]"
        status: pass
      - kind: automated_ui
        ref: "CDP Runtime.consoleAPICalled + Log.entryAdded across the four cycles: 1 entry (pre-existing Electron Insecure Content-Security-Policy dev warning), 0 matching Refused to execute script / Failed to fetch dynamically imported module / MIME type / SecurityError / blob: / CORS"
        status: pass
    human_judgment: false

# Metrics
duration: 28h 53m
completed: 2026-09-24
status: complete
---

# Phase 01 Plan 04: CANV-04 Renderer Half Summary

**Full-window PluginSurfaceLayer that imports a registered surface over tapestry-plugin:// and mounts it with balanced dispose, proven by the example plugin's no-build spike surface running a module Worker and a .wasm from the scheme in both Electron load modes**

## Performance

- **Duration:** 28h 53m wall clock (spans the Task 3 human-verify checkpoint wait; the code work itself was the first ~1h and the ~15 min fix)
- **Started:** 2026-09-23T01:47:47Z
- **Completed:** 2026-09-24T06:41:26Z
- **Tasks:** 3 (2 auto + 1 human-verify, resolved PASSED)
- **Files modified:** 8

## Accomplishments

- Tapestry lists every registered surface as an `Open <displayName>` launcher button and opening one mounts a full-window layer that dynamically imports `tapestry-plugin://<pluginName>/<entry>` and calls the module's default `mount(host)`; closing (button or Escape) calls `dispose()` exactly once per mount, StrictMode included.
- The outer example plugin ships a surface with no build step and no host edits: a plain ES module that prints six environment facts, spawns a module Worker and instantiates `spike.wasm` via `instantiateStreaming` (the `application/wasm` MIME proof) from the scheme.
- The RESEARCH [ASSUMED] scheme design is now [VERIFIED] on Electron 32 for both the electron-vite dev build and the built `loadFile` app: `worker=ok`, `wasm=ok`, `[4, 4]` mounts/disposes, no MIME/CORS/SecurityError console lines.
- One platform rule was discovered and worked around on the plugin side: Worker scripts must be same-origin with the document, so the worker is spawned through a same-origin `blob:` module that statically imports the absolute `tapestry-plugin://` worker URL.

## Task Commits

Each task was committed atomically:

1. **Task 1: PluginSurfaceLayer, SurfaceLauncher and App wiring** - `b9afe07` (feat)
2. **Task 2: Example plugin spike surface — module Worker and .wasm over the scheme** - `2d494be` (feat)
3. **Task 2 fix (from Task 3's first dev attempt): spawn the spike worker through a same-origin blob trampoline** - `ea6bc9e` (fix)
4. **Task 3: Verify the scheme spike in Electron** - no commit (human-verify checkpoint, resolved PASSED; evidence below)

**Plan metadata:** see the `docs(01-04)` commits that follow this file.

`git rev-list --count cc9b5dc..HEAD` = 3 (measured from the persisted ledger, `.git/gsd-plan-head-before-01-04`).

## Files Created/Modified

- `app/src/renderer/components/PluginSurfaceLayer.tsx` - `SurfaceInfo`, `SurfaceLauncher` (fixed top-right strip, zIndex 8500, one button per surface with matching `aria-label`), default `PluginSurfaceLayer` (fixed inset-0 layer, zIndex 9000, 40px header with displayName and Close, plugin-owned container below; `useEffect` keyed on `pluginName + entry` with a `cancelled` flag; `host = { container, treeId, onResize via ResizeObserver with immediate callback, close }`; validates `mod.default.mount` is a function; errors rendered in red with the URL and `console.error`; window `keydown` Escape closes)
- `app/src/renderer/App.tsx` - `pluginSurfaces` / `openSurface` state; `refreshPluginContributions` maps `contributions.surfaces`; `<SurfaceLauncher>` after `<ForestBar>`; `<PluginSurfaceLayer>` before `<Canvas>`; StrictMode untouched
- `app/src/renderer/global.d.ts` - `surfaces` record on `getContributions()`; `TapestrySurfaceHost`, `TapestrySurfaceHandle`, `TapestrySurfaceModule` mirrors (commented: kept in lockstep with the SDK because `tsconfig.web` rootDir excludes `sdk/src`)
- `plugins/example-plugin/surface/surface.js` - spike surface: mount counter, `<pre>` with six fact lines, blob-trampoline module Worker, `host.onResize` -> `size=<w>x<h>@<dpr>`, idempotent `dispose()` that terminates the worker, revokes the blob URL, clears the container and increments the dispose counter
- `plugins/example-plugin/surface/surface.worker.js` - module worker: `fetch(new URL('./spike.wasm', import.meta.url))` then `WebAssembly.instantiateStreaming`, posts `{ worker, wasm }`
- `plugins/example-plugin/surface/spike.wasm` - the 8-byte minimal valid module `00 61 73 6d 01 00 00 00`
- `plugins/example-plugin/index.js` - `context.registerSurface({ id: 'example.surface', displayName: 'Example Surface', entry: 'surface/surface.js', placement: 'stage' })` with a `SurfaceContribution` typedef
- `plugins/example-plugin/tapestry.plugin.json` - `"surfaces": ["example.surface"]` under `contributions`

## Decisions Made

- **Blob trampoline (human decision, Kaelen at the Task 3 checkpoint).** The first dev attempt printed `worker=error: Failed to construct 'Worker': Script at 'tapestry-plugin://example-plugin/surface/surface.worker.js' cannot be accessed from origin 'http://localhost:5173'.` Chromium requires a Worker's script URL to be same-origin with the document; CORS headers on the scheme cannot relax this. Options were (a) plugin-side blob trampoline, (b) RESEARCH fallback A1 — serve the surface from the renderer's own origin (host change to `plugin-scheme.ts`/`PluginSurfaceLayer.tsx`), (c) halt. Kaelen chose (a): a `blob:` module created by the document is same-origin with it, its sole statement `import "<absolute worker URL>";` pulls the real worker module over `tapestry-plugin://` with CORS, and the worker's own `import.meta.url` stays the scheme URL so `spike.wasm` resolves as before. Nothing in the SDK contract or the host changed.
- **Launcher zIndex 8500, not 9500.** An open surface layer (9000) should cover its own launcher; notifications (10000) stay on top of both.
- **Default-export validation.** The layer checks the imported module has a default export with a `mount` function before calling it and renders the error state otherwise, so a mis-registered entry fails visibly rather than with an opaque TypeError.

## Deviations from Plan

### Auto-fixed Issues

**1. [Design choice] SurfaceLauncher zIndex 8500 instead of the plan's 9500**
- **Found during:** Task 1 (PluginSurfaceLayer, SurfaceLauncher and App wiring)
- **Issue:** At 9500 the launcher strip would float above an open surface layer (9000), sitting on top of the plugin's content
- **Fix:** Set the launcher to 8500 with a comment; layer 9000 and notifications 10000 unchanged, so the plan's ordering intent (below notifications) holds and an open layer covers its launcher
- **Files modified:** app/src/renderer/components/PluginSurfaceLayer.tsx (~line 62)
- **Verification:** `grep -n "zIndex: 9000"` prints one line; `grep -n "zIndex: 10000" PluginErrorNotification.tsx` still prints
- **Committed in:** b9afe07

**2. [Rule 1 - Bug] Header comment made the scheme grep count 2**
- **Found during:** Task 1 acceptance criteria
- **Issue:** The first draft's header comment contained the literal `tapestry-plugin://`, so `grep -c "tapestry-plugin://"` returned 2 against an acceptance criterion of exactly 1 (T-04-01 relies on that count)
- **Fix:** Reworded the comment; the literal now appears only where the URL is assembled from `surface.pluginName` and `surface.entry`
- **Files modified:** app/src/renderer/components/PluginSurfaceLayer.tsx
- **Verification:** `grep -c "tapestry-plugin://" app/src/renderer/components/PluginSurfaceLayer.tsx` = 1
- **Committed in:** b9afe07

**3. [Rule 2 - Missing critical] Validate the imported module's default export before mounting**
- **Found during:** Task 1
- **Issue:** The plan cast `(await import(url)) as { default: TapestrySurfaceModule }` and called `mount` directly; a plugin whose entry lacks a default export or a `mount` function would throw an opaque TypeError inside the effect
- **Fix:** PluginSurfaceLayer checks `typeof mod?.default?.mount === 'function'` and renders the red error state (with the URL, `console.error`) otherwise
- **Files modified:** app/src/renderer/components/PluginSurfaceLayer.tsx
- **Verification:** typecheck and build:js pass; the error path shares the existing import-failure rendering
- **Committed in:** b9afe07

**4. [Rule 1 - Bug, human decision] Direct `new Worker(tapestry-plugin://...)` is refused cross-origin by Chromium**
- **Found during:** Task 3 (first dev-build attempt of the checkpoint)
- **Issue:** `worker=error: Failed to construct 'Worker': Script at 'tapestry-plugin://example-plugin/surface/surface.worker.js' cannot be accessed from origin 'http://localhost:5173'.` Worker scripts must be same-origin with the document; the scheme's CORS headers do not apply. RESEARCH assumption A2 (module Worker spawned directly from the scheme) is refuted in its literal form. A1 (module import over the scheme) and A12 (`crossOriginIsolated=false`) stand as observed.
- **Fix:** Kaelen chose the plugin-side blob trampoline over RESEARCH fallback A1 and over halting. `surface.js` now builds `new Blob([`import ${JSON.stringify(workerUrl)};`], { type: 'text/javascript' })`, spawns `new Worker(URL.createObjectURL(blob), { type: 'module' })`, and revokes the blob URL on first message, `onerror`, construction catch and `dispose()`. The scheme remains the origin of the worker's module graph and of the `.wasm`.
- **Files modified:** plugins/example-plugin/surface/surface.js
- **Verification:** Dev build after the fix and the built app both report `worker=ok`, `wasm=ok` (fact sheets below); `[4, 4]` mounts/disposes; no `blob:`, MIME, CORS or SecurityError console lines
- **Committed in:** ea6bc9e
- **Plan text now intentionally stale:** Task 2's acceptance line `new Worker(new URL('./surface.worker.js', import.meta.url), { type: 'module' })` no longer exists literally in `surface.js`; the `key_links` pattern `surface.worker.js` still matches (the worker URL is still built with `new URL('./surface.worker.js', import.meta.url)`).

---

**Total deviations:** 4 (1 design choice, 2 Rule 1 bugs — one with a human decision, 1 Rule 2 missing-critical)
**Impact on plan:** Deviation 4 is the plan's own "fallback is triggered with evidence" branch, resolved on the plugin side with no SDK or host change. The others are small correctness/ordering fixes. No scope creep; the data-drawing plugin was not touched.

## Issues Encountered

- The Task 3 checkpoint needed two rounds: the first dev-build attempt failed on the Worker origin rule (deviation 4), the fix landed as `ea6bc9e`, and the checkpoint was re-run and passed for both load modes. Recorded below.

## Task 3 Verification Record (human-verify checkpoint, resolved PASSED)

**Dev build (`npm --prefix app run dev`, document origin http://localhost:5173), FIRST attempt before the fix — six lines pasted by the human:**

```
isSecureContext=true
crossOriginIsolated=false
gpu=true
worker=error: Failed to construct 'Worker': Script at 'tapestry-plugin://example-plugin/surface/surface.worker.js' cannot be accessed from origin 'http://localhost:5173'.
wasm=error: worker failed
size=1200x732@2
```

**Dev build AFTER the fix (commit ea6bc9e) — six lines pasted by the human:**

```
isSecureContext=true
crossOriginIsolated=false
gpu=true
worker=ok
wasm=ok
size=1200x732@2
```

**Built app (`npm --prefix app run build:js` exit 0, then `cd app && ../node_modules/.bin/electron .`, document origin file:///Users/kaelencook/Tapestry/app/out/renderer/index.html) — six lines pasted by the human:**

```
isSecureContext=true
crossOriginIsolated=false
gpu=true
worker=ok
wasm=ok
size=1200x732@2
```

**Mount/dispose check** (built app, driven by the orchestrator over the Chrome DevTools Protocol with `--remote-debugging-port=9222`: clicked "Open Example Surface", dispatched an Escape keydown, four cycles): `[globalThis.__exampleSurfaceMounts, globalThis.__exampleSurfaceDisposes]` = `[4, 4]`.

**Console check** (built app, `Runtime.consoleAPICalled` + `Log.entryAdded` captured over CDP across all four cycles): 1 entry total, the standard Electron "Insecure Content-Security-Policy" development warning (pre-existing, unrelated to this plan); 0 entries matching "Refused to execute script", "Failed to fetch dynamically imported module", "MIME type", "SecurityError", "blob:" or "CORS".

**Resolution:** PASSED for both load modes. RESEARCH A1 and A12 confirmed as observed; A2 holds only via the blob trampoline (deviation 4).

## Known Stubs

None. The spike surface is intentionally a fact sheet, not a placeholder for the data-drawing surface (that is 01-06/01-08); every wired path here is exercised by the checkpoint.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-surface | plugins/example-plugin/surface/surface.js | The document now creates and executes a `blob:` module Worker. Its only statement is a static import of a URL derived from the surface module's own `import.meta.url` (a host-validated `tapestry-plugin://` location), never from user input; the blob URL is revoked on first message, error, construction failure and dispose. Not in the plan's threat register (it assumed a direct scheme Worker); same trust level as T-04-02 (host realm, policy not sandbox). |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CANV-04 renderer half is in place: 01-06 can register `datadrawing.canvas` (`entry: 'surface/dist/surface.js'`) and it will appear as an "Open Data Drawing" launcher and mount through `PluginSurfaceLayer` with no app edits.
- **Follow-up for 01-06 / 01-08 (must do):** `plugins/data-drawing/surface/src/sim-host.ts` line 99 spawns `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`. When that surface is mounted inside Tapestry over `tapestry-plugin://` it will hit the same same-origin Worker refusal seen here. It must adopt the same blob trampoline and resolve `ddsim.wasm` from the worker module's own `import.meta.url`. Suggest a shared `spawnSameOriginModuleWorker(url)` helper (plugin-side, e.g. in the surface package) rather than a second inline copy; note that Vite's `new URL(..., import.meta.url)` worker rewriting must still produce the absolute chunk URL for the trampoline's static import.
- `crossOriginIsolated=false` is confirmed in both load modes, so the design's "no SharedArrayBuffer, transferred ArrayBuffer snapshots" stance stands.
- CANV-04 stays unchecked in REQUIREMENTS.md until 01-06 and 01-08 finish (shared-ID gate).
- Ready for 01-05 (sim behaviour, wave 3) and the surface-in-Tapestry work in 01-06.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-24*

## Self-Check: PASSED

Created files exist on disk (`app/src/renderer/components/PluginSurfaceLayer.tsx`, `plugins/example-plugin/surface/surface.js`, `plugins/example-plugin/surface/surface.worker.js`, `plugins/example-plugin/surface/spike.wasm`); commits `b9afe07`, `2d494be` and `ea6bc9e` are in history; `git rev-list --count cc9b5dc..HEAD` = 3 with code changes, matching `actuals.commits`; `grep -c "tapestry-plugin://" PluginSurfaceLayer.tsx` = 1; launcher zIndex 8500 present.
