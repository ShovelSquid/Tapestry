---
phase: 02-plugin-host-sdk-feasibility-gate
plan: 02
subsystem: electron-renderer-plugin-ui
tags: [electron, react, prosemirror, plugin-host, autosave, contextBridge, vite]
dependency_graph:
  requires: [02-01]
  provides: [electron-shell, plugin-host, note-plugin, prosemirror-editor, autosave, reopen-last-file]
  affects: [02-03, 02-04, 02-05]
tech_stack:
  added: ["@vitejs/plugin-react"]
  patterns: [contextBridge IPC, plugin discovery from manifest, debounced autosave, ProseMirror EditorView]
key_files:
  created:
    - app/tsconfig.web.json
    - app/src/main/plugin-host.ts
    - app/src/renderer/main.tsx
    - app/src/renderer/App.tsx
    - app/src/renderer/App.css
    - app/src/renderer/global.d.ts
    - app/src/renderer/components/NoteCard.tsx
    - app/src/renderer/components/SaveIndicator.tsx
    - plugins/tapestry-notes/tapestry.plugin.json
    - plugins/tapestry-notes/index.ts
  modified:
    - app/electron.vite.config.ts
    - app/src/main/index.ts
    - app/src/preload/index.ts
    - app/src/renderer/index.html
    - app/tsconfig.json
    - package.json
    - package-lock.json
    - .gitignore
key_decisions:
  - "Plugin host uses require() to load plugin entries from plugins/ directories at startup"
  - "ProseMirror dispatchTransaction with 300ms debounce for autosave; dual-counter tracking (dirtyNotes + pendingSaves) ensures indicator accuracy"
  - "contextBridge exposes kernel, plugins, dialog, and onFileOpened channels — no nodeIntegration in renderer"
  - "Last-opened.json persisted in Electron userData for reopen-last-file (D-03)"
  - "@vitejs/plugin-react v4 chosen for Vite 5 compatibility with electron-vite"
requirements_completed: [PLUG-03, PLUG-06]
metrics:
  duration: 776s
  completed: 2026-09-09T23:41:49Z
  tasks_completed: 2
  tasks_total: 2
actuals:
  tokens: 24864
  tasks: 2
  commits: 2
plan_head_before: 4311dd7eb232f9e5934f448d033684bf2e847473
status: complete
---

# Phase 2 Plan 02: Electron Shell, Renderer, Note Plugin & Canvas with ProseMirror Summary

**One-liner:** Electron main process with secure BrowserWindow, plugin host discovering tapestry-notes from manifests, contextBridge preload for IPC, React renderer with full-window canvas, ProseMirror note editing with 300ms debounced autosave, and reopen-last-file on launch.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~13 minutes |
| Commits | 2 |
| Files created | 10 |
| Files modified | 8 |
| Renderer bundle size | 665.83 KB |
| Build time | ~1 second |

## Accomplishments

### Task 1: Electron shell, renderer, note plugin, and canvas with ProseMirror editing

**Main process (app/src/main/index.ts):** BrowserWindow with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` (T-02-03 mitigated). Registers IPC handlers via KernelBridge.registerHandlers() and PluginHost.registerHandlers(). Handles app lifecycle (activate, window-all-closed), last-opened.json persistence, and save dialog for new .tree files.

**Plugin host (app/src/main/plugin-host.ts):** Scans plugins/ directory for subdirectories containing tapestry.plugin.json. Parses manifest, loads entry via require(), calls activate() with PluginContext providing kernel API and registerNodeView callback. Per D-30 (Minecraft-mods model) and D-33 (broken plugin never prevents world open).

**Preload (app/src/preload/index.ts):** contextBridge.exposeInMainWorld('tapestry') exposing kernel (create, open, submit, getNodes, getNode, getEdges, status, getFilePath), plugins (list), dialog (showSave), and onFileOpened event listener. Full type declarations in global.d.ts.

**Note plugin (plugins/tapestry-notes/):** tapestry.plugin.json manifest declaring tapestry.notes/note@1 node type. index.ts exports a TapestryPlugin that registers the note schema and NoteCard view. Uses only SDK types, no Electron/Node imports (D-27 public API parity).

**Renderer:** React 18 with @vitejs/plugin-react v4. App.tsx renders full-window canvas at #F7F5F0 (dominant color from UI-SPEC). Double-click creates note at click position (D-04). NoteCard positions absolutely at world-space coordinates. ProseMirror EditorView with prosemirror-schema-basic schema, history plugin, and base keymap. Enter inserts newline, Escape/click-outside ends editing (D-04).

**Empty state:** Centered heading "Double-click anywhere to start" and body text "Create notes, connect ideas, and build your world of thought." per UI-SPEC copywriting contract.

### Task 2: Autosave, save indicator, and reopen-last-file

**Debounced autosave (D-02):** ProseMirror dispatchTransaction buffers changes and submits SetProperty ops after 300ms of inactivity. Dual-counter tracking: `dirtyNotesRef` (Set of node IDs with active debounce timers) and `pendingSavesRef` (count of in-flight IPC calls). Save indicator shows "Saved" ONLY when both counters are zero. Never implies unsaved text was saved.

**Save indicator (SaveIndicator.tsx):** Top-left corner beside file name (D-05). Three states: "Saved" (13px/400 neutral), "Saving..." (13px/400 neutral), "Not saved" (13px/400 destructive #E5484D). File name truncated at 200px with ellipsis, full path in tooltip.

**Reopen-last-file (D-03):** On app ready, reads last-opened.json from Electron userData. If file exists and is accessible, opens it via kernel:open. Sends file-opened event to renderer on did-finish-load. If missing/unreadable, shows empty canvas.

**First launch:** No last-opened.json exists. Empty state displayed. Double-click prompts for save location via dialog.showSaveDialog with .tree filter, then creates world via kernel:create.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 45eda9e | feat(02-02): wire Electron shell, renderer, note plugin, and canvas with ProseMirror editing |
| 2 | e2888eb | feat(02-02): add precise autosave tracking, debounce-aware save indicator, and reopen-last-file |

## Files Created

| File | Purpose |
|------|---------|
| `app/tsconfig.web.json` | Renderer TypeScript config (DOM, ESNext, react-jsx) |
| `app/src/main/plugin-host.ts` | Plugin discovery from plugins/ via tapestry.plugin.json manifests |
| `app/src/renderer/main.tsx` | React 18 entry point rendering App into #root |
| `app/src/renderer/App.tsx` | Full-window canvas with note cards and save state tracking |
| `app/src/renderer/App.css` | Visual values from UI-SPEC (colors, spacing, typography) |
| `app/src/renderer/global.d.ts` | Ambient type declarations for window.tapestry API |
| `app/src/renderer/components/NoteCard.tsx` | ProseMirror note editor with 300ms debounced autosave |
| `app/src/renderer/components/SaveIndicator.tsx` | File name + save state indicator (Saved/Saving.../Not saved) |
| `plugins/tapestry-notes/tapestry.plugin.json` | Plugin manifest for tapestry.notes/note@1 |
| `plugins/tapestry-notes/index.ts` | First-party note plugin using SDK TapestryPlugin contract |

## Decisions Made

1. **Dual-counter save state tracking:** Separate tracking of debounce timers (dirtyNotesRef) and in-flight IPC calls (pendingSavesRef) ensures the save indicator never shows "Saved" while text is still pending. The NoteCard communicates its debounce lifecycle via onMarkDirty/onMarkClean callbacks.

2. **Plugin loading via require():** The plugin host uses Node.js require() to load plugin entries from the plugins/ directory. This matches the D-30 Minecraft-mods model and works with CommonJS modules. The note plugin exports via module.exports for this reason.

3. **@vitejs/plugin-react v4:** Chosen for compatibility with Vite 5 (used by electron-vite 2.3). Version 6 requires Vite 8 which is incompatible with electron-vite.

4. **contextBridge exposure pattern:** The preload exposes a flat tapestry object with kernel, plugins, dialog, and onFileOpened sub-objects. This keeps the IPC channel names readable and type-safe via global.d.ts declarations.

5. **Last-opened.json in userData:** Simple JSON file storing the last .tree file path. Written on every successful create/open. Read on launch with fallback to empty canvas if missing or unreadable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @vitejs/plugin-react version compatibility**
- **Found during:** Task 1, first build attempt
- **Issue:** @vitejs/plugin-react v6 (latest) requires Vite 8 and rolldown, but electron-vite 2.3 requires Vite 4 or 5
- **Fix:** Installed @vitejs/plugin-react@^4.0.0 (v4.7.0) which is compatible with Vite 5
- **Files modified:** package.json, package-lock.json
- **Commit:** 45eda9e

**2. [Rule 2 - Missing critical] Removed Node.js path import from renderer**
- **Found during:** Task 1, code review before build
- **Issue:** SaveIndicator imported `{ basename } from 'path'` which is unavailable in the sandboxed renderer process
- **Fix:** Removed the import; the file already had a polyfill function getFileName()
- **Files modified:** app/src/renderer/components/SaveIndicator.tsx
- **Commit:** 45eda9e

**3. [Rule 2 - Missing critical] Added app/out/ to .gitignore**
- **Found during:** Task 1, post-build
- **Issue:** electron-vite build outputs to app/out/ which should not be committed
- **Fix:** Added app/out/ to .gitignore
- **Files modified:** .gitignore
- **Commit:** 45eda9e

## Known Stubs

None. All components are fully wired end-to-end.

## Verification Results

| Check | Result |
|-------|--------|
| electron-vite build (main/preload/renderer) | PASS - all three bundles produced |
| Main bundle size | 8.69 KB |
| Preload bundle size | 1.22 KB |
| Renderer bundle size | 665.83 KB |
| nodeIntegration: false, contextIsolation: true, sandbox: true | PASS |
| Plugin manifest discoverable at plugins/tapestry-notes/tapestry.plugin.json | PASS |
| Note plugin uses SDK TapestryPlugin contract only | PASS |
| contextBridge exposes kernel/plugins/dialog APIs | PASS |
| All 13 created files present on disk | PASS |
| Both commits (45eda9e, e2888eb) verified in git log | PASS |

## Threat Flags

None. Security boundaries match the plan's threat model: renderer has no Node.js access (T-02-03), plugin receives only KernelAPI with no file handles (T-02-02).

## Self-Check: PASSED

All 13 created files verified present. Both commits (45eda9e, e2888eb) verified in git log. SUMMARY.md written to disk.
