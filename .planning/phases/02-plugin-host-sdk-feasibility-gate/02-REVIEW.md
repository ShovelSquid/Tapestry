---
phase: 02-plugin-host-sdk-feasibility-gate
reviewed: 2026-09-10T02:48:40Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - app/native/addon.cpp
  - app/src/main/index.ts
  - app/src/main/plugin-host.ts
  - app/src/preload/index.ts
  - app/src/renderer/App.tsx
  - app/src/renderer/components/NoteCard.tsx
  - app/src/renderer/global.d.ts
  - app/tsconfig.node.json
  - plugins/example-plugin/PropertyPanel.tsx
findings:
  critical: 8
  warning: 10
  info: 6
  total: 24
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-09-10T02:48:40Z
**Depth:** standard (incremental re-review of the 9 files changed by fix commits 2fc901c..43b6c11; each file read in full)
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This is a re-review of the files touched while fixing the prior report's CR-01..CR-03 and WR-01..WR-09. Of the twelve prior findings, ten are resolved as described. Two are only partially resolved and one fix introduced a regression:

- **WR-03 (plugin path traversal) is incomplete.** The fix validates `manifest.main` against the plugin directory, but the plugin *name* that arrives over IPC (`plugin:enable`, `plugin:reload`, `plugin:disable`) is still joined into the filesystem path unvalidated, so `../` in the name loads and `require()`s code from anywhere on disk in the main process (CR-03).
- **CR-01 (stale editor after undo/redo) was fixed with an effect that resets the ProseMirror state whenever the `body` prop diverges from the editor.** Because `handleNoteSave` never refreshes `nodes`, the prop is routinely stale, and the next unrelated `refreshNodes()` replaces the editor state, discarding un-debounced keystrokes, the selection, and the ProseMirror undo history (CR-06).
- **WR-05 (selectedNodes) added the IPC plumbing, but nothing in the renderer invokes `executeCommand`**, so commands still cannot receive a selection from the UI (IN-05).

Beyond the fix regressions, this pass found several defects that the prior review did not surface and that were verified by executing the built addon and Electron's bundled Node:

1. The plugin manifests point `main` at `.ts` files and the host `require()`s them directly. Electron 32's Node (20.18.1) rejects them with `SyntaxError: Cannot use import statement outside a module`, so **both bundled plugins fail to load in the running app** and every note renders as `FallbackNodeView` instead of `NoteCard`. The phase verification marked plugin loading "VERIFIED (code)" and the UAT record shows 0 passed / 10 pending; the app has not been exercised (CR-01).
2. Undo followed by any new edit writes a commit that does not apply after the commits it "undid". On the next open, `Kernel::fromJournal` marks the file **Corrupt** and refuses all further submits. Reproduced: create, delete, undo, edit, reopen -> `{"kind":"Corrupt","reason":"commit 3: apply: n1"}` (CR-02).
3. `TapestryAddon::Submit` converts JS fields with unchecked `As<>()` casts under `NAPI_DISABLE_CPP_EXCEPTIONS`. A malformed op such as `[42]` or `{op:'setProperty', target: 5}` causes a second `ThrowAsJavaScriptException` while one is pending and **aborts the whole Electron main process** (`FATAL ERROR: napi_throw`). A non-array `ops` argument writes an **empty commit to the journal** before the exception reaches JS (CR-04).
4. `deserializeBody` builds legacy plain-text bodies with `innerHTML`, so a `.tree` file or plugin-written text property can execute script in the renderer; combined with CR-03 that becomes main-process code execution (CR-05).
5. The crash notification's Restart button sends the plugin's *display name* to `plugin:reload`, so restart always fails and the failure is then hidden as if it succeeded (CR-07).

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Plugins cannot load — host `require()`s TypeScript entry files that Electron's Node cannot parse

**File:** `app/src/main/plugin-host.ts:203` (with `plugins/tapestry-notes/tapestry.plugin.json:5` and `plugins/example-plugin/tapestry.plugin.json:5`, both `"main": "index.ts"`)
**Issue:** `loadPlugin` executes `require(entryPath)` where `entryPath` resolves to `plugins/<name>/index.ts`. There is no transpile hook, `require.extensions` registration, or build step for plugins anywhere in `app/src/main` or the electron-vite config, and `import type` / `module.exports` mixed TypeScript cannot be parsed by Node 20. Verified against the exact runtime the app ships with:

```
$ ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
    -e "require(require('path').resolve('plugins/tapestry-notes/index.ts'))"
electron node 20.18.1
REQUIRE FAILED: SyntaxError Cannot use import statement outside a module
```

Consequence in the app: both plugins land in `status: 'failed'`, `getContributions().nodeViews` is empty, `App.tsx:107-110` produces an empty `pluginNodeViews`, and `Canvas.tsx:499-536` routes every `tapestry.notes/note@1` node to `FallbackNodeView`. The ProseMirror editor, connection handles, delete bubble, and resize handles (`NoteCard`) are unreachable, which defeats the feasibility gate's "editable note plugin" proof. `02-VERIFICATION.md` lines 97/103/115 record this as "VERIFIED (code)" only; `02-UAT.md` shows `passed: 0`, `pending: 10`.
**Fix:** Ship plugins as JavaScript and have the host refuse non-JS entries. Either add a per-plugin build (`tsc -p plugins/tapestry-notes` emitting `index.js`, manifest `"main": "index.js"`), or, for the development loop, register a transpiler before loading:

```typescript
// plugin-host.ts, before the first require(entryPath)
if (!/\.(c?js)$/.test(entryPath)) {
  return { status: 'failed', reason: `Plugin entry must be a .js/.cjs file (got ${manifest.main}); build the plugin first` }
}
```

and update both manifests to point at the built `index.js`. If a live TS loop is wanted, wire `esbuild-register` (or `tsx/cjs`) in the main process behind an explicit dev flag, never in packaged builds. Add a smoke test that launches the built main bundle under `ELECTRON_RUN_AS_NODE=1` and asserts `plugin:list` reports `loaded` for both bundled plugins.

### CR-02: Undo followed by a new edit corrupts the `.tree` file on next open

**File:** `app/native/addon.cpp:476-491` (`ReplayUpTo`), `app/src/renderer/App.tsx:510-532` (`handleUndo`/`handleRedo`), and `app/src/main/kernel-bridge.ts:171-191` (undo/redo drive it)
**Issue:** `replayUpTo(seq)` rebuilds the in-memory world from a fresh `World` (`Kernel.cpp:174-193`), which also resets `m_nextNode`/`m_nextEdge`. `Kernel::submit` then validates the new proposal against that rewound world but appends it at `lastSeq + 1` with `parent = lastDigest` on branch `main` — i.e. after the commits that were "undone". On the next open, `Kernel::fromJournal` (`Kernel.cpp:90-108`) replays every commit in order; the post-undo commit no longer applies and the journal is marked **Corrupt**, after which every `submit` is rejected with `JournalNotClean`. Reproduced with the built addon:

```
create n1 (seq 1) -> deleteNode n1 (seq 2) -> replayUpTo(1) -> setProperty n1 (seq 3 accepted, status Ok)
reopen in a new process:
  status: {"kind":"Corrupt","offset":673,"bytes":0,"lastGoodSeq":2,"reason":"commit 3: apply: n1"}
  nodes after reopen: 0
  submit after reopen threw: Kernel rejected: commit 3: apply: n1
```

The same happens for "create note, undo, create note" (both commits carry `createNode n1` -> `DuplicateId`), and any undone `advance` op makes the new commit's tick fail the decoder's `expectedTick` check (`Journal.cpp:180-219`). This violates the project's History constraint ("Editing the past preserves the original future in a branch") and is user-facing data loss: the file the user was happily editing refuses to open writable next time.
**Fix:** Do not allow `submit` while the world is rewound. Either (a) implement undo as compensating commits — the bridge computes inverse ops (delete the created node, re-create the deleted node with its recorded props, restore prior property values) and submits them as a normal commit, so the journal stays linear and replayable; or (b) make the kernel record a real branch (new branch name, parent = digest of the commit being extended) and make `fromJournal`/`open` follow the branch head. Until one of those lands, hard-fail the unsafe path:

```typescript
// kernel-bridge.ts
submit(actorKind, actorId, message, ops) {
  this.ensureLoaded()
  if (this.currentSeq !== this.instance.getLastSeq()) {
    throw new Error('Cannot commit while history is rewound; redo to the head or discard the undo first')
  }
  ...
}
```

and surface that error in `App.tsx` rather than `console.error`. Add a kernel-level test that reopens a journal after `replayUpTo` + `submit` and asserts `status().kind === 'Ok'`.

### CR-03: Plugin path traversal fix is incomplete — plugin *name* from IPC still escapes `plugins/` and drives `require()`

**File:** `app/src/main/plugin-host.ts:160,193,289,550-560`
**Issue:** The WR-03 fix constrains `manifest.main` to stay inside `pluginDir`, but `pluginDir` itself is `resolve(this.pluginsDir, name)` where `name` comes straight from `ipcMain.handle('plugin:reload' | 'plugin:enable' | 'plugin:disable', (_e, name) => ...)` with no validation. `name = '../../../../tmp/evil'` yields `manifestPath = /tmp/evil/tapestry.plugin.json`; if that file exists with `"main": "index.js"` and `"api": "1"`, line 203 `require('/tmp/evil/index.js')` runs attacker-controlled code in the Electron main process (full Node access, kernel journal access, filesystem). The renderer is sandboxed, but CR-05 below gives an attacker a route into the renderer from a `.tree` file, and `window.tapestry.plugins.enable(name)` is exposed to it by the preload. `unloadPlugin` (line 289) has the same unvalidated join.
**Fix:** Validate the name as a single path segment at the IPC boundary and inside the host, and additionally require that the resolved plugin directory is a direct child of `pluginsDir`:

```typescript
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

private resolvePluginDir(name: string): string | null {
  if (typeof name !== 'string' || !PLUGIN_NAME_RE.test(name)) return null
  const dir = resolve(this.pluginsDir, name)
  const rel = relative(this.pluginsDir, dir)
  if (rel !== name || isAbsolute(rel) || rel.includes(sep)) return null
  return dir
}

async loadPlugin(name: string): Promise<PluginLoadResult> {
  const pluginDir = this.resolvePluginDir(name)
  if (!pluginDir) return { status: 'failed', reason: 'Invalid plugin name' }
  const manifestPath = join(pluginDir, 'tapestry.plugin.json')
  ...
}
```

Apply the same helper in `unloadPlugin` and reject early in each `ipcMain.handle('plugin:*')` handler.

### CR-04: `Submit` aborts the Electron main process on a malformed op, and writes an empty commit when `ops` is not an array

**File:** `app/native/addon.cpp:155-223` (`jsToOp`), `app/native/addon.cpp:326-336` (`Submit`), `app/native/addon.cpp:143` (`jsPropsToMap`), `app/native/addon.cpp:116-127` (`parseTarget`)
**Issue:** The addon is compiled with `NAPI_DISABLE_CPP_EXCEPTIONS` (`app/native/CMakeLists.txt:57`), so every `x.As<Napi::String>().Utf8Value()` / `As<Napi::Number>()` / `As<Napi::Array>().Length()` on a wrongly-typed value does *not* throw a C++ exception; it sets a pending JS exception and returns a default (`""`, `0`). The code then keeps going and calls `ThrowAsJavaScriptException()` a second time, which is a fatal N-API error. Reproduced with the built addon:

```
k.submit('human','local','non-object op', [42])
FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw
 3: Napi::Error::Error(...)  4: Napi::Error::ThrowAsJavaScriptException()  5: ...TapestryAddon::Submit
```

Paths that double-throw: any array element that is not an object (`verb == ""` -> line 221 throws while pending); `{op:'setProperty', target: <non-string>}` (line 167 -> `parseTarget("")` throws at 124); `{op:'createEdge', from: <non-string>}` (line 180 -> 183); `{op:'deleteNode', id: <non-string>}`; a `props` entry `{type: <non-string>, value: ...}` (line 143 -> `jsToValue(env, "")` throws at 87). Any renderer bug, any plugin passing a bad op through `context.kernel.submit`, or any XSS (CR-05) takes down the whole app — the main process, not just the renderer.

Separately, when `ops` is not an array the loop guard `Length()` returns 0 and execution proceeds to `m_kernel->submit(proposal)` with **zero ops**, durably appending a commit before the exception reaches JavaScript:

```
lastSeq start 0
threw: An array was expected           lastSeq after non-array ops 1
threw: An array was expected           lastSeq after undefined ops 2
```

The caller sees an error, `KernelBridge.afterCommit` never runs (so `currentSeq` drifts from `lastSeq`), and the user's readable history contains phantom commits.
**Fix:** Validate every JS value before casting, and never touch the kernel while an exception is pending:

```cpp
// helpers
static bool requireString(Napi::Env env, Napi::Object o, const char* key, std::string& out) {
    Napi::Value v = o.Get(key);
    if (!v.IsString()) {
        Napi::TypeError::New(env, std::string("Expected string field '") + key + "'").ThrowAsJavaScriptException();
        return false;
    }
    out = v.As<Napi::String>().Utf8Value();
    return true;
}

// Submit
if (!info[0].IsString() || !info[1].IsString() || !info[2].IsString() || !info[3].IsArray()) {
    Napi::TypeError::New(env, "submit(actorKind: string, actorId: string, message: string, ops: Op[])")
        .ThrowAsJavaScriptException();
    return env.Null();
}
auto jsOps = info[3].As<Napi::Array>();
for (uint32_t i = 0; i < jsOps.Length(); i++) {
    Napi::Value el = jsOps.Get(i);
    if (!el.IsObject()) {
        Napi::TypeError::New(env, "op must be an object").ThrowAsJavaScriptException();
        return env.Null();
    }
    proposal.ops.push_back(jsToOp(env, el.As<Napi::Object>()));
    if (env.IsExceptionPending()) return env.Null();
}
```

Inside `jsToOp`/`jsPropsToMap`/`jsToValue`, use `requireString`-style checks (and `IsNumber()`/`IsBoolean()` for numeric/bool fields) and `return` immediately after the first throw. As a belt-and-braces guard, wrap every `ThrowAsJavaScriptException()` site in `if (!env.IsExceptionPending())`. Add addon tests for each malformed-input case asserting a JS exception is thrown and `getLastSeq()` is unchanged.

### CR-05: HTML injection in `deserializeBody` — a `.tree` file or plugin-written text executes script in the renderer

**File:** `app/src/renderer/components/NoteCard.tsx:128-133`
**Issue:** When a note body is not a ProseMirror JSON document (any note created by a plugin via `setProperty body text`, a hand-edited `.tree` file, or a legacy plain-text note), the fallback does:

```ts
element.innerHTML = lines.map((line) => `<p>${line || '<br>'}</p>`).join('')
```

The body text is interpolated raw. `<img src=x onerror="...">` inside `innerHTML` fires `onerror` even on a detached element, so a shared `.tree` file (the project's core readability/interchange format) becomes an XSS vector. The renderer is sandboxed, but the preload exposes `window.tapestry` with full kernel write access and `plugins.enable(name)`; chained with CR-03 that is arbitrary code execution in the main process from opening a file. This is the only `innerHTML` use in the codebase (verified by grep).
**Fix:** Never parse user text as HTML. Build the document with the schema directly:

```ts
function plainTextToDoc(body: string) {
  const paragraphs = body.split('\n').map((line) =>
    line ? noteSchema.node('paragraph', null, [noteSchema.text(line)]) : noteSchema.node('paragraph'),
  )
  return noteSchema.node('doc', null, paragraphs)
}
// in deserializeBody, replace the innerHTML block with:
return plainTextToDoc(body)
```

Also add a `Content-Security-Policy` meta tag to `src/renderer/index.html` (`default-src 'self'; script-src 'self'; img-src 'self' data:`) so a future sink cannot load remote resources.

### CR-06: Regression from the CR-01 fix — body-sync effect discards in-progress edits, selection, and editor history on any node refresh

**File:** `app/src/renderer/components/NoteCard.tsx:357-372`, with `app/src/renderer/App.tsx:355-398` (`handleNoteSave` does not refresh `nodes`)
**Issue:** The new effect replaces the entire `EditorState` whenever `JSON.stringify(view.state.doc.toJSON()) !== body`. But the `body` prop is only as fresh as the last `refreshNodes()`, and `handleNoteSave` (App.tsx:365-389) never refreshes after a debounced save. So the normal sequence is: user types "hello" -> debounce saves "hello" to the kernel -> `nodes` state still holds the pre-typing body. The next time *anything* calls `refreshNodes`/`refreshAll` (dragging or resizing any note, creating a note by double-click, deleting a note, a plugin-triggered refresh, `file-opened`), the prop jumps to "hello", which differs from the editor's current doc if the user has typed anything in the last 300 ms -> `EditorState.create(...)` throws away those keystrokes, the caret/selection, and the ProseMirror `history()` plugin state. The still-pending debounce timer then serializes the *reset* view and saves it, so the lost keystrokes are gone durably. Even when no keystrokes are pending, every refresh after typing wipes the in-editor undo stack (Mod-z inside a note stops working after moving it), because `EditorState.create` starts fresh history.

Concrete reproduction: type "hello world" quickly, and within 300 ms of the last keystroke double-click the canvas to create a second note. The first note snaps back to the last saved prefix.
**Fix:** Keep the prop in sync with what was saved, and only reset the editor when the *kernel* value actually differs from what this editor last emitted:

```ts
// NoteCard: remember the last body this editor produced
const lastEmittedBodyRef = useRef<string>(body)
// in the debounce callback and unmount save, after serializeDoc:
lastEmittedBodyRef.current = newBody

useEffect(() => {
  const view = viewRef.current
  if (!view) return
  if (body === lastEmittedBodyRef.current) return          // echo of our own save
  if (debounceRef.current) return                          // user is mid-edit; do not clobber
  const currentBody = JSON.stringify(view.state.doc.toJSON())
  if (currentBody === body) return
  const newDoc = deserializeBody(body) || noteSchema.node('doc', null, [noteSchema.node('paragraph')])
  // Replace the document via a transaction so plugins/history are preserved
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content)
  view.dispatch(tr.setMeta('addToHistory', false))
  lastEmittedBodyRef.current = body
}, [body])
```

And in `App.tsx` `handleNoteSave`, update the saved node in local state after a successful submit (`setNodes(prev => prev.map(n => n.id === nodeId ? {...n, props: {...n.props, body: {type:'text', value: body}, title: {...}}} : n))`) so the prop stops lagging the kernel. Note `dispatchTransaction` marks the doc dirty on `tr.docChanged`; use the `addToHistory: false` meta and a guard flag so the sync transaction does not trigger a save.

### CR-07: Plugin "Restart" always fails and the failure is hidden — display name is used as the plugin id

**File:** `app/src/main/plugin-host.ts:366-367,386-387,398-403` (sends `displayName`), `app/src/main/index.ts:115-119`, `app/src/renderer/App.tsx:448-459`, `app/src/renderer/components/PluginErrorNotification.tsx:53-55`
**Issue:** `handlePluginCrash` deliberately resolves `displayName` (e.g. "Example Property Inspector") and passes it as the first argument of `onPluginError`. The renderer stores it as `pluginError.pluginName`, `PluginErrorNotification` calls `onRestart(pluginName)`, and `App.handlePluginRestart` calls `window.tapestry.plugins.reload('Example Property Inspector')`. `reloadPlugin` -> `loadPlugin` looks for `plugins/Example Property Inspector/tapestry.plugin.json`, which does not exist, and returns `{ status: 'failed', reason: 'Manifest not found ...' }` — it does not throw. `handlePluginRestart` ignores the returned status, calls `setPluginError(null)`, and the notification disappears as though the restart succeeded. The D-34 Restart action is therefore non-functional and misleading.
**Fix:** Carry both the identifier and the display name through the channel, and honour the returned status:

```typescript
// plugin-host.ts
onPluginError: ((pluginName: string, displayName: string, error: string, canRestart: boolean) => void) | null
// handlePluginCrash: this.onPluginError(name, displayName, message, canRestart)

// index.ts
mainWindow.webContents.send('plugin-error', pluginName, displayName, message, canRestart)

// App.tsx
const handlePluginRestart = useCallback(async (pluginName: string) => {
  const result = await window.tapestry.plugins.reload(pluginName)
  if (result.status === 'loaded') { setPluginError(null); await refreshPluginContributions() }
  else setPluginError(prev => prev && { ...prev, message: `${prev.displayName} could not restart: ${result.reason}`, canRestart: true })
}, [refreshPluginContributions])
```

Update the preload signature, `global.d.ts`, and `PluginErrorNotification` props accordingly.

### CR-08: A malformed manifest field aborts world opening (D-33 violation) and leaves main/renderer state inconsistent

**File:** `app/src/main/plugin-host.ts:193-198` (outside the `try`), `app/src/main/plugin-host.ts:289`, `app/src/main/plugin-host.ts:514-532`, `app/src/main/index.ts:128-137,141-150,167-185`
**Issue:** `discoverPlugins` only checks that `name`, `version`, `main` are truthy, not that they are strings. `resolve(pluginDir, manifest.main)` at line 194 and `join(this.pluginsDir, name, ...)` at line 160 run *before* the `try` block, so a manifest with `"main": 1` or `"name": {"x":1}` throws a `TypeError [ERR_INVALID_ARG_TYPE]` out of `loadPlugin`. `discoverAndLoadAll` has no per-plugin catch, so the rejection propagates:

- In the `kernel:open`/`kernel:create` handlers, `bridge.open(path)` has already succeeded and `currentFilePath`/`last-opened.json` are already written when the handler rejects; the renderer reports "failed to open" for a world that is open.
- At startup (`index.ts:169-184`) the `catch` sets `currentFilePath = null` while the kernel still has the world open and locked, so the renderer shows "no file loaded" and the next double-click prompts to create a *new* world, while `getNodes` still returns the old world's nodes.

"A broken plugin never prevents the world from opening" is a stated core constraint (D-33); a single bad manifest currently does exactly that.
**Fix:** Type-check manifest fields at discovery, move the path resolution inside the `try`, and isolate each plugin in `discoverAndLoadAll`:

```typescript
// discoverPlugins
if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || typeof manifest.main !== 'string') { warn; continue }

// discoverAndLoadAll
for (const manifest of manifests) {
  try { await this.loadPlugin(manifest.name) }
  catch (err) { console.error(`[PluginHost] ${manifest.name} threw during load`, err) }
}
```

In `index.ts`, separate the kernel open from plugin loading so a plugin failure cannot be mistaken for a missing file:

```typescript
bridge.open(lastFile); currentFilePath = lastFile
try { await pluginHost.discoverAndLoadAll(bridge) } catch (err) { console.error('plugin discovery failed', err) }
```

and do the same in both IPC handlers.

## Warnings

### WR-01: Addon has no `close()`; the journal lock is held until V8 garbage-collects the old wrapper

**File:** `app/native/addon.cpp:229-253,504` (no dispose method), used by `app/src/main/kernel-bridge.ts:95-106`
**Issue:** `PosixSink` holds `flock(LOCK_EX)` for its lifetime and releases it only in the destructor (`Sink.cpp:26-28`). `KernelBridge.create/open` simply overwrite `this.instance`; the previous `TapestryAddon` wrapper (and its `unique_ptr<Kernel>`) stays alive until V8 decides to collect it. Reproduced: dropping the JS reference and immediately calling `TapestryAddon.open(sameFile)` fails with `Kernel::open failed: another process holds the journal lock`. In the app, opening world B then world A again (or `kernel:open` on the currently open file) will fail nondeterministically. Today only the preload API can reach this (App.tsx never calls `kernel.open`), but it will surface as soon as an Open command exists, and it also means a crashed-then-relaunched instance cannot reopen its own file until the OS reclaims the fd.
**Fix:** Add an explicit `close()` instance method that resets `m_kernel`, and call it from the bridge before replacing the instance:

```cpp
Napi::Value Close(const Napi::CallbackInfo& info) { m_kernel.reset(); return info.Env().Undefined(); }
// register: InstanceMethod<&TapestryAddon::Close>("close"),
```

```typescript
// kernel-bridge.ts
open(path: string): void {
  const next = TapestryAddon.open(path)   // open first so failure keeps the old world
  this.instance?.close()
  this.instance = next
  this.syncCurrentSeq()
}
```

Also call `close()` in `app.on('will-quit')` so the lock is released deterministically at exit.

### WR-02: `int` values are silently truncated or saturated

**File:** `app/native/addon.cpp:75-77` (`jsToValue` "int" branch), `app/native/addon.cpp:217` (`advance.ticks`), `app/native/addon.cpp:488` (`replayUpTo`)
**Issue:** `Int64Value()` on a fractional or out-of-range number does not fail; it truncates or saturates. Verified: `{type:'int', value: 1.75}` is stored as `1`; `{type:'int', value: 1e30}` is stored as `9223372036854775807`. The user's readable history then contains a value they never entered, and a plugin that round-trips the property sees a different number. The `advance` op has the same conversion (negative ticks become a huge unsigned count that the kernel rejects with an opaque overflow message).
**Fix:** Validate integrality and range before converting:

```cpp
} else if (typeStr == "int") {
    if (!jsVal.IsNumber()) { throw TypeError "int value must be a number" }
    double d = jsVal.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(d) || std::floor(d) != d || d < -9007199254740992.0 || d > 9007199254740992.0) {
        Napi::RangeError::New(env, "int value must be a safe integer").ThrowAsJavaScriptException();
        return Value::ofText("");
    }
    return Value::ofInt(static_cast<int64_t>(d));
}
```

(Values above 2^53 cannot be represented losslessly by a JS `number` anyway; if the kernel's full int64 range must be reachable, accept `BigInt` via `IsBigInt()`.) Apply the same `IsNumber()` + range check to `advance.ticks` (`ticks >= 0`) and `replayUpTo(seq)` (`seq >= 0`).

### WR-03: Any command-handler error is treated as a plugin crash and triggers unload/reload

**File:** `app/src/main/plugin-host.ts:587-595`
**Issue:** `plugin:executeCommand` wraps `cmd.handler(context)` and routes *every* rejection to `handlePluginCrash`, which records a "crashed" journal entry, deactivates the plugin, clears its contributions, re-`require`s it, and shows "X stopped working. Restarting...". A command that legitimately fails — a kernel `Rejection` thrown from `context.kernel.submit` because of a validation error, an invalid node id, or a plugin's own input validation — is indistinguishable from a crash. The renderer also gets `{ ok: false, error }` only after the full restart cycle. Plugins have no way to report a recoverable error.
**Fix:** Distinguish command failure from plugin failure. Return the error to the caller and only escalate when the plugin is actually broken (e.g. `TypeError`/`ReferenceError`, or the handler is missing after reload):

```typescript
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : String(err)
  const isCrash = err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError
  if (isCrash) await host.handlePluginCrash(loaded.manifest.name, errorMsg)
  return { ok: false, error: errorMsg, crashed: isCrash }
}
```

Better: define a `CommandError` class in the SDK that plugins throw for expected failures and treat everything else as a crash.

### WR-04: Enable/disable are recorded inaccurately and are not durable within the session

**File:** `app/src/main/plugin-host.ts:321-352`, `app/src/main/plugin-host.ts:514-532`, `app/src/main/plugin-host.ts:49`
**Issue:** (a) `enablePlugin` records `enabled plugin X` in the journal even when `loadPlugin` returned `failed` or `incompatible`, so the readable history asserts something that did not happen. (b) `disablePlugin` records `disabled plugin X` even if `X` was never loaded or does not exist (`unloadPlugin` returns silently). (c) `disablePlugin` deletes the entry from `this.plugins`, so the plugin vanishes from `plugin:list`, and the next `discoverAndLoadAll` (which runs on every `kernel:open`/`kernel:create`) silently re-enables it. (d) `PluginStatus` has a `'disabled'` member that is never assigned anywhere — the state the design (D-32/D-35) describes does not exist in code.
**Fix:** Keep a `disabled` set, make it authoritative for discovery, and only journal real transitions:

```typescript
private disabled = new Set<string>()

async enablePlugin(name) {
  this.disabled.delete(name)
  const result = await this.loadPlugin(name)
  if (result.status === 'loaded') await this.recordEvent(`enabled plugin ${name}`)
  return result
}
async disablePlugin(name) {
  const wasLoaded = this.plugins.get(name)?.status === 'loaded'
  await this.unloadPlugin(name)
  this.disabled.add(name)
  this.plugins.set(name, { manifest, instance: null, status: 'disabled', contributions: this.createEmptyRegistry() })
  if (wasLoaded) await this.recordEvent(`disabled plugin ${name}`)
}
// discoverAndLoadAll: skip names in this.disabled
```

Persisting `disabled` across launches (e.g. in `userData/plugins.json`) is needed for D-35 to be meaningful.

### WR-05: `enablePlugin`/`loadPlugin` on an already-loaded plugin activates it twice without deactivating

**File:** `app/src/main/plugin-host.ts:154-263`
**Issue:** `loadPlugin` never checks whether `name` is already `loaded`. `plugin:enable` on a loaded plugin (or two rapid enable calls) re-`require`s the entry (served from `require.cache`, so it is the same module object), calls `activate(context)` a second time, and overwrites the map entry. The first instance's `deactivate` is never called, so any timers, subscriptions, or listeners it created leak, and any state the module kept at top level is shared between "instances".
**Fix:** Short-circuit or unload first:

```typescript
async loadPlugin(name: string): Promise<PluginLoadResult> {
  const existing = this.plugins.get(name)
  if (existing?.status === 'loaded') return { status: 'loaded' }
  ...
}
```

and have `enablePlugin` call `reloadPlugin` when the plugin is already loaded.

### WR-06: `unloadPlugin` only evicts the entry module from `require.cache`; reload runs stale submodules

**File:** `app/src/main/plugin-host.ts:288-294`
**Issue:** D-29 makes explicit reload the developer loop. `delete require.cache[require.resolve(entryPath)]` drops only the entry file. Any module the entry `require`s from inside the plugin directory (e.g. `./PropertyPanel`, `./commands`) stays cached, so after editing a helper file and pressing reload the developer runs old code without any indication. The example plugin already has a second file.
**Fix:** Evict every cached module that lives under the plugin directory:

```typescript
const prefix = resolve(this.pluginsDir, name) + sep
for (const key of Object.keys(require.cache)) {
  if (key.startsWith(prefix)) delete require.cache[key]
}
```

### WR-07: Save dialog permits locations that `validateTreePath` rejects, and the user gets no feedback

**File:** `app/src/main/index.ts:80-93,128-131,153-161`, `app/src/renderer/App.tsx:152-165`
**Issue:** The WR-07 fix restricts `kernel:create`/`kernel:open` to paths under `app.getPath('home')` ending in `.tree`. `dialog:showSave` lets the user choose any location (an external volume, `/tmp`, a network mount, a corporate-managed Documents folder that is a symlink outside `$HOME`). When they do, `kernel:create` throws `Invalid .tree file path`, `App.handleCanvasDoubleClick` catches it, logs to the console, and returns — the double-click does nothing visible and no note is created. The same path also fails for `Journal::create` on an existing file (`SinkMode::CreateNew` -> exists) after the dialog's "Replace?" confirmation. `readLastOpened` bypasses the validator entirely, so a `last-opened.json` edited to point outside home is still opened.
**Fix:** Make the two agree and surface errors. Either drop the home restriction (the path is user-chosen through a native dialog; keep only the `.tree` + absolute + no-`..` checks) or pass `defaultPath`/`properties` to the dialog and validate its result in main before returning it. In the renderer, set `saveState` to `error` and show the message:

```typescript
} catch (err) {
  console.error('Failed to create world:', err)
  setSaveState('error')
  setPluginError({ pluginName: 'Tapestry', message: `Could not create world: ${(err as Error).message}`, canRestart: false })
  return
}
```

and route `readLastOpened()` through `validateTreePath` for consistency.

### WR-08: Directory name and manifest `name` are conflated; a mismatch makes discovery silently fail

**File:** `app/src/main/plugin-host.ts:104-132,160,517-531`
**Issue:** `discoverPlugins` reads the manifest from `plugins/<dirName>/` but returns only the manifest; `discoverAndLoadAll` then calls `loadPlugin(manifest.name)`, which looks for `plugins/<manifest.name>/tapestry.plugin.json`. If the directory is `my-plugin-v2` and the manifest says `"name": "my-plugin"`, or the directory name differs in case on a case-sensitive filesystem, the load fails with `Manifest not found`. Nothing in D-30's "drop a folder in plugins/" model requires the two to match, and the error message points at the wrong path. This also means `manifest.name` — a value under the plugin author's control — is used as a filesystem path component (see CR-03).
**Fix:** Key everything by the directory name and treat `manifest.name` as metadata:

```typescript
interface DiscoveredPlugin { dir: string; manifest: PluginManifest }
discoverPlugins(): DiscoveredPlugin[]  // push({ dir: entry.name, manifest })
// discoverAndLoadAll: loadPlugin(discovered.dir); map keyed by dir
// list(): include both `id: dir` and `name: manifest.name`
```

### WR-09: Contribution collisions between plugins are resolved silently by iteration order

**File:** `app/src/main/plugin-host.ts:436-446,570-573`
**Issue:** `getContributions` writes `result.nodeViews[type] = contrib` and `result.commands[id] = ...` in `Map` insertion order, so two plugins registering the same node type or command id silently overwrite each other, and `plugin:executeCommand` executes whichever plugin happens to be first in the map. There is no warning, no deterministic precedence, and the losing plugin has no way to know. With the "plugins from the beginning" constraint this is a foreseeable conflict (two note-type plugins, two `notes.createNote` commands).
**Fix:** Detect duplicates at registration and reject or namespace them:

```typescript
registerCommand: (contribution) => {
  const owner = this.findCommandOwner(contribution.id)
  if (owner && owner !== name) throw new Error(`Command ${contribution.id} is already registered by ${owner}`)
  contributions.commands.set(contribution.id, contribution)
},
```

At minimum, `console.warn` on collision and document which plugin wins.

### WR-10: `handlePluginCrash` and `plugin:executeCommand` mutate `host.plugins` while iterating it

**File:** `app/src/main/plugin-host.ts:570-597`, `app/src/main/plugin-host.ts:380-381`
**Issue:** The `for (const [, loaded] of host.plugins)` loop `await`s `host.handlePluginCrash(...)`, which calls `unloadPlugin` (deletes the map entry) and `loadPlugin` (re-inserts it), then `return`s. Today the immediate `return` avoids visiting mutated entries, but the pattern is fragile: any future change that continues the loop (e.g. running the command in several plugins, or logging after the crash) will iterate over a re-inserted entry and either double-run the handler or skip plugins. `loaded` also refers to the *old* record after the reload, so `loaded.manifest.name` is stale if the manifest changed on disk between crash and reload.
**Fix:** Resolve the owning plugin first, then act outside the loop:

```typescript
const owner = [...host.plugins.entries()].find(([, p]) => p.status === 'loaded' && p.contributions.commands.has(commandId))
if (!owner) return { ok: false, error: `Command ${commandId} not found` }
const [pluginName, loaded] = owner
const cmd = loaded.contributions.commands.get(commandId)!
try { ... } catch (err) { ... await host.handlePluginCrash(pluginName, msg) ... }
```

## Info

### IN-01: World name derivation is non-portable and can yield an empty token

**File:** `app/src/renderer/App.tsx:157-158`
**Issue:** `result.filePath.split('/')` assumes POSIX separators; on Windows the whole `C:\Users\...` path becomes the world name (`C__Users_..._foo`). A file literally named `.tree` produces an empty string, which `Kernel::create` rejects (`isToken("")` is false) and the failure is only logged. The fallback `?? 'untitled'` can never trigger because `split().pop()` is never `undefined`.
**Fix:** Derive the name in the main process with `path.basename(filePath, '.tree')` and fall back to `'untitled'` when the sanitized result is empty; the renderer should not be doing path parsing at all.

### IN-02: `global.d.ts` hand-duplicates the preload and SDK types, and both drift

**File:** `app/src/renderer/global.d.ts:1-83`, `app/src/preload/index.ts:114`
**Issue:** The preload exports `TapestryAPI = typeof tapestryAPI` but the renderer never uses it; `global.d.ts` re-declares every method by hand, with `any` for `submit` ops, `getEdges`, `status`, `plugins.reload/enable/disable/executeCommand`. The WR-02 fix had to be applied in three places (preload, `global.d.ts`, App) because of this duplication, and CR-07's signature change will need the same. `refreshPluginContributions` (App.tsx:108) then casts `(contrib as any).component` even though the declared type already has `component`.
**Fix:** `declare global { interface Window { tapestry: import('../preload/index').TapestryAPI } }` in `global.d.ts`, and type the preload with the SDK's `Op`, `NodeData`, `EdgeData`, `JournalStatus`, `CommitResult` instead of `any`. Remove the `as any` in App.tsx.

### IN-03: `tsconfig.node.json` `rootDir: ".."` is a workaround with dead emit settings

**File:** `app/tsconfig.node.json:7-8,14`
**Issue:** `rootDir` was widened to the repository root solely so `../../../sdk/src/contributions` is inside the program. `outDir: "dist"`, `declaration: true` and `rootDir` are all irrelevant because the only consumer is `tsc --noEmit` (electron-vite does the real build), and if emit were ever enabled the output would land in `dist/app/src/main/...`. The main process also imports the SDK source rather than the `@tapestry/sdk` workspace package that plugins use, so the host and plugins can disagree about the contract.
**Fix:** Use the workspace package (`import type {...} from '@tapestry/sdk'`) with a `paths` mapping for type resolution (`"paths": { "@tapestry/sdk": ["../sdk/src/index.ts"] }`), restore `rootDir: "src"`, and drop `outDir`/`declaration` from this config.

### IN-04: `PropertyPanel.tsx` is not covered by any tsconfig or build and declares no React dependency

**File:** `plugins/example-plugin/PropertyPanel.tsx:13,31-87`
**Issue:** The WR-06 fix converted the component to JSX, but no tsconfig includes `plugins/` (`tsconfig.web.json` includes only `src/renderer/**`), `plugins/example-plugin` has no `package.json`, and there is no build step, so the file is never type-checked or compiled and `react/jsx-runtime` is not declared as a dependency. The header comment says it "imports ONLY from the SDK package", which is now untrue in spirit (JSX requires React at build time). The host still has no mechanism to resolve `component: 'ExamplePropertyPanel'` to this module, so the panel remains unreachable (as noted in the prior review).
**Fix:** Give the example plugin a `package.json` (`peerDependencies: { react }`) and a `tsconfig.json` with `jsx: react-jsx` that is run by the root `typecheck`, and track the component-resolution mechanism as an explicit open item for the SDK.

### IN-05: WR-05 is only partially resolved — nothing in the renderer invokes `executeCommand`

**File:** `app/src/preload/index.ts:70-75`, `app/src/renderer/App.tsx` (no caller), `app/src/renderer/components/Canvas.tsx:159` (`selectedNoteId` is local to Canvas)
**Issue:** The IPC now accepts `selectedNodes`, but no UI calls `window.tapestry.plugins.executeCommand`, and the current selection lives in `Canvas` state that App cannot read. The example plugin's `example.inspect` command therefore remains unreachable from the application, and the feasibility gate's "command bridge" proof is exercised only by hand from DevTools.
**Fix:** Lift `selectedNoteId` to App (or expose it through a callback), add a minimal command invoker (a context-menu entry or keyboard shortcut listing `getContributions().commands`), and pass `[selectedNoteId]` through `executeCommand`.

### IN-06: Dimension-registration effect runs on every render (carried over from prior IN-01)

**File:** `app/src/renderer/components/NoteCard.tsx:233-238`
**Issue:** Unchanged from the prior review: the effect has no dependency array and calls `getBoundingClientRect()` after every render of every card.
**Fix:** Use a `ResizeObserver` on `cardRef` or depend on `[node.id, zoom, effectiveWidth, body]`.

---

_Reviewed: 2026-09-10T02:48:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
