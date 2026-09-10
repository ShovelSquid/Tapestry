---
phase: 02-plugin-host-sdk-feasibility-gate
reviewed: 2026-09-10T01:15:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - app/native/addon.cpp
  - app/src/main/index.ts
  - app/src/main/kernel-bridge.ts
  - app/src/main/plugin-host.ts
  - app/src/preload/index.ts
  - app/src/renderer/App.tsx
  - app/src/renderer/App.css
  - app/src/renderer/components/Canvas.tsx
  - app/src/renderer/components/ConnectionLine.tsx
  - app/src/renderer/components/FallbackNodeView.tsx
  - app/src/renderer/components/NoteCard.tsx
  - app/src/renderer/components/NoteControls.tsx
  - app/src/renderer/components/PluginErrorNotification.tsx
  - app/src/renderer/components/SaveIndicator.tsx
  - app/src/renderer/main.tsx
  - app/electron.vite.config.ts
  - app/forge.config.ts
  - sdk/src/index.ts
  - sdk/src/contributions.ts
  - plugins/tapestry-notes/index.ts
  - plugins/example-plugin/index.ts
  - plugins/example-plugin/PropertyPanel.tsx
findings:
  critical: 3
  warning: 9
  info: 2
  total: 14
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-10T01:15:00Z
**Depth:** standard (per-file analysis with language-specific checks)
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 02 implements the Electron plugin host, SDK, note editing, spatial canvas, and packaging for the Tapestry feasibility gate. The architecture is well-structured with proper security boundaries (contextIsolation, sandbox, contextBridge) and clean separation between main/preload/renderer processes. The SDK contract types are well-designed.

Three critical issues were found: (1) the ProseMirror editor does not re-synchronize its content when the underlying node data changes after undo/redo, leaving stale text visible; (2) NoteCard's `stopPropagation` on pointerUp prevents connection creation from completing when the pointer is released over a target note; (3) a race condition in the main process means the renderer may never learn that a file was reopened on launch. Nine warnings cover potential sparse arrays in the C++ addon, IPC listener accumulation, missing path validation, dead plugin lifecycle gaps, and a structurally broken example component.

## Critical Issues

### CR-01: ProseMirror editor shows stale content after undo/redo

**File:** `app/src/renderer/components/NoteCard.tsx:284-355`
**Issue:** The ProseMirror `EditorView` is created in a `useEffect` whose sole dependency is `[node.id]` (line 355). After undo/redo, `refreshAll()` fetches updated node data and React re-renders each NoteCard with new `body` values -- but the ProseMirror editor retains its old internal document state because the effect does not re-run (the node ID has not changed). The user sees stale text in every visible editor until the component is fully unmounted and remounted.

The undo handler in App.tsx (line 507) sets `editingNodeId` to null, which makes the editor non-editable, but the displayed content remains wrong. This is visible whenever notes are on screen during undo/redo.

**Fix:** Add a secondary effect that updates the ProseMirror doc when the external `body` prop diverges from the editor's current state. Guard against feedback loops by comparing before replacing:

```typescript
// After the main ProseMirror init effect, add:
useEffect(() => {
  if (!viewRef.current) return
  const currentBody = JSON.stringify(viewRef.current.state.doc.toJSON())
  if (currentBody === body) return // already in sync
  const newDoc = deserializeBody(body) || noteSchema.node('doc', null, [
    noteSchema.node('paragraph'),
  ])
  const newState = EditorState.create({
    doc: newDoc,
    schema: noteSchema,
    plugins: viewRef.current.state.plugins,
  })
  viewRef.current.updateState(newState)
}, [body])
```

### CR-02: Connection creation fails -- NoteCard stopPropagation blocks Canvas pointerUp

**File:** `app/src/renderer/components/NoteCard.tsx:525-528` and `app/src/renderer/components/Canvas.tsx:249-267`
**Issue:** Every NoteCard unconditionally calls `e.stopPropagation()` on its root div's `onPointerUp`. The Canvas's `handlePointerUp` (which contains the connection-creation logic at lines 257-265) is registered on the parent viewport div. When the user releases the pointer over a target note during connection mode, the NoteCard's stopPropagation prevents the Canvas from ever receiving the event. The `onEdgeCreate` call never fires, and the connecting state (`connectingFrom`, `connectingLine`, `connectingHover`) is never cleared -- leaving the user stuck in connecting mode.

This means the "drag from connection handle to target note" interaction documented in the plan summary cannot work as described.

**Fix:** Replace the blanket stopPropagation with conditional logic that only stops propagation when NOT in connecting mode, or lift the connection-completion logic into the NoteCard itself:

```tsx
// In NoteCard, replace the current onPointerUp:
onPointerUp={(e) => {
  if (isConnecting) {
    // Let the event propagate to Canvas so it can complete the connection
    return
  }
  e.stopPropagation()
}}
```

### CR-03: Race condition -- file-opened event missed on launch

**File:** `app/src/main/index.ts:143-162`
**Issue:** The main process calls `createWindow()` at line 143, which starts loading the renderer page. Then it synchronously calls `bridge.open(lastFile)` and `await`s `pluginHost.discoverAndLoadAll(bridge)` (line 151). Only after plugin discovery completes does it register the `did-finish-load` listener at line 154. If the window's renderer page finishes loading before plugin discovery completes (likely in development with HMR or when loading from cache), the `did-finish-load` event fires before the listener is attached, and the `file-opened` event is never sent to the renderer. The renderer shows an empty canvas even though a file was successfully opened in the kernel.

**Fix:** Register the `did-finish-load` listener before starting the async work, or use `webContents.send` directly after the async work completes, checking whether the page has already loaded:

```typescript
const lastFile = readLastOpened()
if (lastFile) {
  try {
    bridge.open(lastFile)
    currentFilePath = lastFile
    await pluginHost.discoverAndLoadAll(bridge)
    // Send to renderer -- works whether page is already loaded or not
    if (mainWindow) {
      const send = () => mainWindow?.webContents.send('file-opened', lastFile)
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', send)
      } else {
        send()
      }
    }
  } catch {
    currentFilePath = null
  }
}
```

## Warnings

### WR-01: C++ addon produces sparse arrays when nodes are skipped

**File:** `app/native/addon.cpp:364-385` (GetNodes) and `app/native/addon.cpp:419-441` (GetEdges)
**Issue:** The Napi::Array is pre-allocated with `ids.size()` elements but the loop uses `continue` to skip null nodes/edges without adjusting the array index. Skipped indices become `undefined` holes in the JavaScript array. While `world.nodeIds()` should not return IDs for non-existent nodes under normal conditions, if it ever does (e.g., during concurrent modification, future kernel changes), downstream `.map()` calls in the renderer would receive `undefined` elements, causing property access errors.

**Fix:** Use a separate output index counter:

```cpp
uint32_t outIdx = 0;
for (size_t i = 0; i < ids.size(); i++) {
    const auto* node = world.node(ids[i]);
    if (!node) continue;
    // ...
    arr.Set(outIdx++, obj);
}
// Optionally: arr.Set("length", Napi::Number::New(env, outIdx));
```

### WR-02: IPC event listeners accumulate without cleanup

**File:** `app/src/preload/index.ts:82-96` and `app/src/renderer/App.tsx:120-138`
**Issue:** `onFileOpened` and `onPluginError` use `ipcRenderer.on()` to register listeners but provide no removal mechanism. App.tsx calls these inside a `useEffect` with no cleanup function that removes the listeners. In React 18 StrictMode (used in `main.tsx` line 13), effects are double-invoked in development, causing duplicate listeners. Each duplicate listener would fire the callbacks multiple times per event.

**Fix:** Return a removal function from the preload API and use it in the effect cleanup:

```typescript
// preload/index.ts
onFileOpened: (callback) => {
  const handler = (_event, filePath) => callback(filePath)
  ipcRenderer.on('file-opened', handler)
  return () => ipcRenderer.removeListener('file-opened', handler)
},

// App.tsx useEffect
useEffect(() => {
  const removeFile = window.tapestry.onFileOpened(...)
  const removeError = window.tapestry.onPluginError(...)
  return () => { removeFile(); removeError() }
}, [])
```

### WR-03: Plugin `main` field allows path traversal outside plugin directory

**File:** `app/src/main/plugin-host.ts:193`
**Issue:** The plugin entry path is resolved with `resolve(this.pluginsDir, name, manifest.main)`. Since `manifest.main` is read from user-supplied plugin JSON, a value like `"../../app/src/main/index"` would resolve outside the plugins directory. Although plugins already run in the main process and have full Node.js access, validating the resolved path stays within the plugin's own directory is a defense-in-depth measure that catches misconfiguration and limits the surface for future sandboxing.

**Fix:** Validate the resolved path starts with the expected plugin directory:

```typescript
const entryPath = resolve(this.pluginsDir, name, manifest.main)
const pluginDir = resolve(this.pluginsDir, name)
if (!entryPath.startsWith(pluginDir + '/') && entryPath !== pluginDir) {
  return { status: 'failed', reason: `Plugin entry path escapes plugin directory` }
}
```

### WR-04: require.cache cleanup throws on deleted plugin files

**File:** `app/src/main/plugin-host.ts:284-285`
**Issue:** `require.resolve(entryPath)` throws `MODULE_NOT_FOUND` if the plugin's files have been deleted from disk. This unhandled exception would crash the `unloadPlugin` method and prevent plugin lifecycle cleanup.

**Fix:** Wrap in try-catch:

```typescript
try {
  const resolved = require.resolve(entryPath)
  delete require.cache[resolved]
} catch {
  // Plugin files already removed -- nothing to clear from cache
}
```

### WR-05: Command context `selectedNodes` is always empty

**File:** `app/src/main/plugin-host.ts:563`
**Issue:** When executing a plugin command via `plugin:executeCommand`, the `CommandContext.selectedNodes` is hardcoded to an empty array. The renderer never passes the currently selected node(s) through the IPC call, making commands that depend on selection (like `example.inspect`) non-functional.

**Fix:** Pass the selected node IDs from the renderer through the IPC call:

```typescript
// preload
executeCommand: (commandId, args, selectedNodes) =>
  ipcRenderer.invoke('plugin:executeCommand', commandId, args || {}, selectedNodes || []),

// plugin-host handler
ipcMain.handle('plugin:executeCommand', async (_event, commandId, args, selectedNodes) => {
  // ...
  const context = {
    kernel: { ... },
    selectedNodes: selectedNodes || [],
    arguments: args || {},
  }
```

### WR-06: ExamplePropertyPanel returns a plain object instead of a React element

**File:** `plugins/example-plugin/PropertyPanel.tsx:34-113`
**Issue:** The component function returns a plain JavaScript object (`{ type: 'div', props: { ... } }`) instead of a React element (JSX or `React.createElement`). React components must return `ReactNode`. If this component is ever rendered in the React tree, it will throw a runtime error. The component is currently unreachable because the host has no mechanism to resolve component name strings to actual components, but it will crash when that mechanism is built.

**Fix:** Use JSX or `React.createElement`:

```tsx
import React from 'react'

function ExamplePropertyPanel({ node }: ExamplePropertyPanelProps) {
  const entries = Object.entries(node.props)
  return (
    <div style={{ padding: '12px', ... }}>
      <div style={{ fontWeight: 600, ... }}>Properties ({entries.length})</div>
      {entries.map(([key, prop]) => (
        <div key={key} style={{ ... }}>
          <span>{key}</span>
          <span>[{prop.type}] {String(prop.value)}</span>
        </div>
      ))}
    </div>
  )
}
```

### WR-07: No IPC path validation for kernel:create and kernel:open

**File:** `app/src/main/index.ts:113-129`
**Issue:** The overridden `kernel:create` and `kernel:open` IPC handlers accept arbitrary file paths from the renderer without validation. While the renderer is sandboxed, a future XSS vulnerability in the renderer could allow an attacker to create or open `.tree` files at arbitrary filesystem paths. At minimum, validate that paths end with `.tree` and do not traverse outside the user's home directory.

**Fix:** Add basic path validation:

```typescript
function validateTreePath(filePath: string): boolean {
  const normalized = path.resolve(filePath)
  return normalized.endsWith('.tree') && normalized.startsWith(app.getPath('home'))
}
```

### WR-08: Unsafe int64 to double conversion -- potential undefined behavior

**File:** `app/native/addon.cpp:99-102`
**Issue:** The `jsToValueInferred` function compares a double value against `static_cast<double>(INT64_MAX)`. Since INT64_MAX (2^63 - 1) cannot be exactly represented as a double, the cast rounds up to 2^63. A double value equal to 2^63 would pass the range check but `static_cast<int64_t>(d)` would be undefined behavior because the value exceeds int64_t range. In practice this is extremely unlikely for user-supplied property values, but it is technically UB.

**Fix:** Use a safe upper bound:

```cpp
// 2^63 cannot be represented as int64_t; use (2^63 - 1024) as safe bound
// (the largest double that is <= INT64_MAX)
constexpr double kMaxSafeInt64 = 9223372036854774784.0; // 2^63 - 1024
if (std::floor(d) == d && d >= static_cast<double>(INT64_MIN)
    && d <= kMaxSafeInt64) {
    return Value::ofInt(static_cast<int64_t>(d));
}
```

### WR-09: discoverAndLoadAll does not unload plugins removed from disk

**File:** `app/src/main/plugin-host.ts:505-516`
**Issue:** `discoverAndLoadAll` scans the plugins directory and loads newly discovered plugins, but never unloads plugins that were previously loaded but whose directories have since been deleted. Stale plugin entries remain in the `plugins` map with status `loaded`, and their contributions remain registered. This means removing a plugin folder has no effect until the app restarts.

**Fix:** Before loading new plugins, identify and unload plugins not found in the current scan:

```typescript
async discoverAndLoadAll(kernelBridge: any): Promise<void> {
  this.kernelBridge = kernelBridge
  const manifests = this.discoverPlugins()
  const discoveredNames = new Set(manifests.map(m => m.name))

  // Unload plugins no longer on disk
  for (const [name, loaded] of this.plugins) {
    if (!discoveredNames.has(name) && loaded.status === 'loaded') {
      await this.unloadPlugin(name)
    }
  }

  for (const manifest of manifests) {
    if (this.plugins.has(manifest.name) && this.plugins.get(manifest.name)!.status === 'loaded') {
      continue
    }
    await this.loadPlugin(manifest.name)
  }
}
```

## Info

### IN-01: Dimension registration effect runs on every render

**File:** `app/src/renderer/components/NoteCard.tsx:233-238` and `app/src/renderer/components/FallbackNodeView.tsx:178-183`
**Issue:** The `useEffect` that calls `onRegisterDims` has no dependency array, so it runs after every render of every note card, calling `getBoundingClientRect()` each time. While the callback stores to a ref (no re-renders), this is wasteful computation. Consider adding a dependency array or using `ResizeObserver` for change-driven updates.

### IN-02: tapestry-notes plugin uses `as any` to bypass SDK enum types

**File:** `plugins/tapestry-notes/index.ts:22-27`
**Issue:** The `defaultProperties` values are typed as `ValueType` (an enum), but the plugin uses string literals with `as any` casts instead of `ValueType.Real` and `ValueType.Text`. This bypasses type safety. Use the enum values directly: `'position.x': ValueType.Real`.

---

_Reviewed: 2026-09-10T01:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
