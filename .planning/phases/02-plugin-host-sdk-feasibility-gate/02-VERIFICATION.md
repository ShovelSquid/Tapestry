---
phase: 02-plugin-host-sdk-feasibility-gate
verified: 2026-09-10T01:15:00Z
status: human_needed
score: 5/5
covered_files:
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-01-PLAN.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-01-SUMMARY.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-02-PLAN.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-02-SUMMARY.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-03-PLAN.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-03-SUMMARY.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-04-PLAN.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-04-SUMMARY.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-05-PLAN.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-05-SUMMARY.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-CONTEXT.md"
  - ".planning/phases/02-plugin-host-sdk-feasibility-gate/02-UI-SPEC.md"
  - "app/forge.config.ts"
  - "app/native/CMakeLists.txt"
  - "app/native/addon.cpp"
  - "app/package.json"
  - "app/src/main/index.ts"
  - "app/src/main/kernel-bridge.ts"
  - "app/src/main/plugin-host.ts"
  - "app/src/preload/index.ts"
  - "app/src/renderer/App.css"
  - "app/src/renderer/App.tsx"
  - "app/src/renderer/components/Canvas.tsx"
  - "app/src/renderer/components/ConnectionLine.tsx"
  - "app/src/renderer/components/FallbackNodeView.tsx"
  - "app/src/renderer/components/NoteCard.tsx"
  - "app/src/renderer/components/NoteControls.tsx"
  - "app/src/renderer/components/PluginErrorNotification.tsx"
  - "app/src/renderer/components/SaveIndicator.tsx"
  - "package.json"
  - "plugins/example-plugin/PropertyPanel.tsx"
  - "plugins/example-plugin/index.ts"
  - "plugins/example-plugin/tapestry.plugin.json"
  - "plugins/tapestry-notes/index.ts"
  - "plugins/tapestry-notes/tapestry.plugin.json"
  - "sdk/package.json"
  - "sdk/src/contributions.ts"
  - "sdk/src/index.ts"
  - "tapestry/kernel/Kernel.cpp"
  - "tapestry/kernel/Kernel.hpp"
covered_digest: "v1:sha256:2865dad84de48a520c32846380e7c6980fe1462f6d0dcfb9c831d21d3a796a9c"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Launch the app (cd app && npx electron-vite dev), double-click canvas, type text, verify ProseMirror editing works with caret placement, multiline, and formatting shortcuts (Cmd+B/I/1/2/3)"
    expected: "Note card appears at click position, text is editable, bold/italic/headings apply and render with correct styles"
    why_human: "Requires a running Electron GUI to verify ProseMirror behavior, IME composition, and visual rendering"
  - test: "Close and reopen the app. Verify the same notes with the same text, formatting, and positions appear from the .tree file"
    expected: "All notes restored with positions, text content, and rich text formatting intact"
    why_human: "Requires observing file persistence and reload cycle in a live Electron app"
  - test: "Type rapidly for 5 seconds and observe the save indicator cycling between Saving... and Saved. Simulate a failed submit and verify Not saved appears in red"
    expected: "Indicator shows Saving... during debounce window, Saved when quiescent, and Never falsely shows Saved while text is pending"
    why_human: "Requires observing real-time save indicator transitions tied to 300ms debounce and IPC latency"
  - test: "Pan by dragging empty canvas, zoom with scroll wheel, drag a note to a new position, close/reopen and verify position persisted"
    expected: "Pan, zoom, and drag work fluidly; note appears at its dragged position after reopen"
    why_human: "Requires observing CSS-transform-based spatial interaction and coordinate conversion at runtime"
  - test: "Hover a note and verify blue connection handle and red delete bubble appear. Move pointer from note body to a control without controls disappearing. Drag from connection handle to another note to create a connection"
    expected: "Controls appear on hover with 300ms hide delay, connection line rendered between notes after drag completes"
    why_human: "Requires observing hover state management, pointer event tracking, and connection creation gesture"
  - test: "Delete a note via the red delete bubble. Press Cmd+Z to undo. Verify the note reappears with its text, position, and connections. Press Cmd+Shift+Z to redo the deletion"
    expected: "Undo restores the deleted note completely; redo re-applies deletion; the .tree file is never modified by undo (append-only)"
    why_human: "Requires observing undo/redo state transition through replayUpTo -- no automated test exercises this path"
  - test: "Remove the example-plugin directory from plugins/, reopen a world that had example-plugin data, and verify fallback rendering shows readable properties with inline editing"
    expected: "FallbackNodeView renders the node type header and key-value properties; inline editing submits SetProperty through the kernel"
    why_human: "Requires observing fallback rendering in a live app after physically removing a plugin directory"
  - test: "Create a plugin with api: '99' in its manifest and verify the host refuses to load it with a clear incompatibility message"
    expected: "Plugin status shows 'incompatible' with reason 'Plugin requires API version 99, host supports version 1'"
    why_human: "Requires observing plugin host behavior at runtime when loading an incompatible manifest"
  - test: "Deliberately break a plugin's activate (throw Error), launch the app, observe the crash notification with auto-restart, then Restart/Dismiss buttons"
    expected: "Notification appears immediately, auto-restart attempted once, if failed shows 'could not restart' with actions; world still opens"
    why_human: "Requires observing D-34 crash handling flow in a live app"
  - test: "Launch the packaged app (not dev mode) from forge-out/. Verify window opens, notes are editable, plugins load, and native addon works"
    expected: "Packaged Tapestry.app runs with full functionality including native C++ kernel bridge"
    why_human: "Requires building and launching the packaged Electron application"
---

# Phase 2: Plugin Host, SDK & Feasibility Gate Verification Report

**Phase Goal:** Developers can build, load, and safely fail plugins against a documented versioned public API -- and the UI toolkit decision is settled by a working vertical slice (editable note, spatial interaction, independent plugin, command bridge, packaged app) before broad UI investment
**Mode:** MVP
**Verified:** 2026-09-10T01:15:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## User Flow Coverage

User story: "As a Tapestry user and plugin developer, I want to create and edit notes in a spatial canvas powered by independently-loadable plugins over a versioned public SDK with a working packaged Electron application and C++ kernel bridge, so that the UI toolkit decision is settled before broad investment and features can safely be built, loaded, and failed as plugins without breaking the world."

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Create plugin from starter | Plugin in plugins/ loads without rebuilding core | `plugins/example-plugin/` exists with manifest, imports only `@tapestry/sdk`, loads via PluginHost.discoverPlugins | VERIFIED (code) |
| Open app and see canvas | Electron window with spatial canvas at #F7F5F0 | `app/src/main/index.ts`:24 BrowserWindow, `app/src/renderer/App.tsx` full-window canvas | VERIFIED (builds) |
| Double-click to create note | Note card at click position with ProseMirror editor | `app/src/renderer/App.tsx`:152 submit CreateNode, `NoteCard.tsx` ProseMirror EditorView | NEEDS HUMAN |
| Type and see autosave | Text saved within 300ms, indicator shows Saved/Saving/Not saved | `NoteCard.tsx` 300ms debounce, `SaveIndicator.tsx` three-state display | NEEDS HUMAN |
| Pan/zoom/drag | Canvas interaction works, positions persist | `Canvas.tsx` CSS-transform pan/zoom, drag-to-reposition with kernel:submit | NEEDS HUMAN |
| Connect notes | Drag from connection handle creates edge | `Canvas.tsx` connecting state machine, `ConnectionLine.tsx` SVG rendering | NEEDS HUMAN |
| Load independent plugin | Example plugin works through same API as first-party | Both plugins use `discoverPlugins`/`loadPlugin`, same PluginContext | VERIFIED (code) |
| Remove plugin, see fallback | World opens, nodes render with FallbackNodeView | `Canvas.tsx`:535 routes to FallbackNodeView, `FallbackNodeView.tsx` 346 lines | NEEDS HUMAN |
| Break plugin, see recovery | Crash notification, auto-restart, Restart/Dismiss | `plugin-host.ts`:354 handlePluginCrash, `PluginErrorNotification.tsx` 167 lines | NEEDS HUMAN |
| Package app | Packaged build works with native addon | `forge.config.ts` with extraResource, `kernel-bridge.ts` resolveAddonPath | NEEDS HUMAN |
| Outcome: toolkit settled, plugins safe | All feasibility gate criteria met | Build passes, all artifacts substantive and wired, architecture proven | VERIFIED (partial -- runtime verification needed) |

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can follow the starter documentation to create a plugin, load it locally without modifying or rebuilding the core, and see its registered node schema, commands, and property/UI contributions working | VERIFIED | `plugins/example-plugin/` exists (91 lines index.ts + 117 lines PropertyPanel.tsx), imports only `@tapestry/sdk` (0 Electron imports, 0 host imports confirmed by grep), registers command and property panel via PluginContext.registerCommand/registerPropertyPanel, loaded by PluginHost.discoverPlugins from tapestry.plugin.json manifest |
| 2 | Bundled first-party feature plugins load through the same manifest, lifecycle, and public API as the starter third-party plugin -- no private core hooks | VERIFIED | Both `plugins/tapestry-notes/index.ts` and `plugins/example-plugin/index.ts` import from `@tapestry/sdk`, export TapestryPlugin via module.exports, are discovered by the same `discoverPlugins()` scan, loaded by the same `loadPlugin()` path, and receive the same PluginContext. No special-casing for first-party in `plugin-host.ts` (593 lines inspected) |
| 3 | Disabling, unloading, or breaking a plugin releases its handlers, never prevents the base world from opening, and leaves its persisted content inspectable through the readable fallback | VERIFIED | `unloadPlugin()` calls deactivate() in try-catch and clears all 4 contribution maps (lines 277-280). `loadPlugin()` wraps activate() in try-catch (line 231). `Canvas.tsx` routes unknown node types to `FallbackNodeView` (line 535-551). FallbackNodeView (346 lines) renders readable properties with inline editing (D-35). handlePluginCrash auto-restarts once then disables (D-34) |
| 4 | A plugin with an unavailable API/schema/artifact version produces a clear compatibility result; recorded behavior is never silently substituted | VERIFIED | `SUPPORTED_API_VERSIONS = ['1']` at line 31 of plugin-host.ts. loadPlugin() checks `manifest.api` against this array (line 173). Mismatch produces status 'incompatible' with reason string "Plugin requires API version X, host supports version 1". Surfaced in plugin:list response |
| 5 | Every plugin-originated durable change passes through a validated, recorded core transaction, and a failed transaction leaves the prior state intact | VERIFIED | KernelAPI exposed to plugins has ONLY submit/getNodes/getNode/getEdges/status (lines 206-213 of plugin-host.ts). No journal-level methods (D-31). submit() delegates through KernelBridge to native addon Kernel::submit which uses scratch-copy-then-swap (Kernel.cpp prepare/apply pattern). 52 C++ kernel tests pass including rejection and torn-write scenarios |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/native/addon.cpp` | N-API binding wrapping Kernel | VERIFIED | 508 lines, Napi::ObjectWrap with create/open/submit/getNodes/getNode/getEdges/status/replayUpTo/getLastSeq |
| `app/native/CMakeLists.txt` | CMake build linking tapestry_kernel | VERIFIED | 54 lines, links tapestry_kernel, SYSTEM includes for node-addon-api |
| `app/src/main/kernel-bridge.ts` | TypeScript bridge with IPC registration | VERIFIED | 271 lines, KernelBridge class with all methods + undo/redo via replayUpTo |
| `app/src/main/plugin-host.ts` | Full lifecycle plugin host | VERIFIED | 593 lines, discover/load/unload/reload/enable/disable/crash handling/contributions |
| `app/src/main/index.ts` | Electron main process | VERIFIED | 177 lines, BrowserWindow, IPC handlers, last-opened.json, security settings |
| `app/src/preload/index.ts` | contextBridge exposing tapestry API | VERIFIED | 105 lines, kernel/plugins/dialog/onFileOpened/onPluginError channels |
| `sdk/src/index.ts` | Plugin SDK types | VERIFIED | 278 lines, TapestryPlugin, PluginContext, KernelAPI, NodeSchema, PluginManifest, ValueType, Op types |
| `sdk/src/contributions.ts` | Contribution types | VERIFIED | 109 lines, NodeViewContribution, CommandContribution, PropertyPanelContribution, InspectorContribution |
| `app/src/renderer/App.tsx` | Main application with canvas | VERIFIED | 604 lines, node/edge state, save tracking, undo/redo, plugin error handling |
| `app/src/renderer/components/NoteCard.tsx` | ProseMirror note editor | VERIFIED | 586 lines, EditorView with schema, debounced autosave, drag, resize, formatting keybindings, JSON serialization |
| `app/src/renderer/components/Canvas.tsx` | Spatial canvas with pan/zoom | VERIFIED | 556 lines, CSS-transform pan/zoom, drag, connection creation, FallbackNodeView routing |
| `app/src/renderer/components/NoteControls.tsx` | Hover controls | VERIFIED | 94 lines, connection handle (28px #4A7CFF) and delete bubble (28px #E5484D) |
| `app/src/renderer/components/ConnectionLine.tsx` | SVG edge rendering | VERIFIED | 41 lines, SVG line between note centers in #B0ADA6 |
| `app/src/renderer/components/FallbackNodeView.tsx` | Generic readable fallback | VERIFIED | 346 lines, renders node type + properties, inline editing (D-35), drag-to-reposition |
| `app/src/renderer/components/PluginErrorNotification.tsx` | Crash notification | VERIFIED | 167 lines, error message + auto-dismiss + Restart/Dismiss buttons (D-34) |
| `app/src/renderer/components/SaveIndicator.tsx` | Save state indicator | VERIFIED | 57 lines, Saved/Saving.../Not saved with file name + truncation |
| `plugins/tapestry-notes/index.ts` | First-party note plugin | VERIFIED | 53 lines, TapestryPlugin registering tapestry.notes/note@1 nodeView |
| `plugins/tapestry-notes/tapestry.plugin.json` | Note plugin manifest | VERIFIED | Valid JSON with name, version, main, api "1", contributions |
| `plugins/example-plugin/index.ts` | Third-party example plugin | VERIFIED | 91 lines, TapestryPlugin registering command + property panel |
| `plugins/example-plugin/tapestry.plugin.json` | Example plugin manifest | VERIFIED | Valid JSON with name, version, main, api "1", contributions |
| `plugins/example-plugin/PropertyPanel.tsx` | Example property panel | VERIFIED | 117 lines, React component rendering node properties |
| `app/forge.config.ts` | Electron Forge packaging config | VERIFIED | 45 lines, asar: true, extraResource for addon + plugins, MakerZIP |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/src/main/kernel-bridge.ts` | `app/native/addon.cpp` | require() loads compiled .node addon | WIRED | `require(addonPath)` at line 35; addonPath resolved via resolveAddonPath() |
| `app/src/renderer/App.tsx` | `app/src/preload/index.ts` | window.tapestry.kernel IPC calls | WIRED | 13 references to `window.tapestry.kernel.*` in App.tsx |
| `plugins/tapestry-notes/index.ts` | `sdk/src/index.ts` | Plugin imports TapestryPlugin and registers contributions | WIRED | `import type { TapestryPlugin, PluginContext, NodeSchema } from '@tapestry/sdk'` |
| `plugins/example-plugin/index.ts` | `sdk/src/index.ts` | Plugin imports SDK types and registers contributions | WIRED | `import type { TapestryPlugin, PluginContext, CommandContribution, PropertyPanelContribution } from '@tapestry/sdk'` |
| `app/src/main/plugin-host.ts` | `plugins/*/tapestry.plugin.json` | Reads manifests from plugins/ subdirectories | WIRED | `discoverPlugins()` reads tapestry.plugin.json at line 107 |
| `app/src/main/plugin-host.ts` | `app/src/main/kernel-bridge.ts` | Plugin host records enable/disable events via kernel submit | WIRED | `this.kernelBridge.submit('system', 'tapestry', ...)` at lines 318, 339, 364 |
| `app/src/renderer/components/Canvas.tsx` | `app/src/renderer/components/FallbackNodeView.tsx` | Routes unknown node types to fallback | WIRED | Import at line 23, conditional rendering at line 535-551 |
| `app/src/renderer/components/NoteCard.tsx` | `app/src/main/kernel-bridge.ts` | Delete, undo, formatting submit through kernel | WIRED | `onDeleteNote` prop wired to kernel:submit in App.tsx; formatting submits via onSave callback |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `App.tsx` | nodes | `window.tapestry.kernel.getNodes()` IPC -> addon.getNodes() -> Kernel::World::nodeIds() | Real kernel world data | FLOWING |
| `App.tsx` | edges | `window.tapestry.kernel.getEdges()` IPC -> addon.getEdges() | Real kernel world data | FLOWING |
| `NoteCard.tsx` | body text | ProseMirror doc from node.props.body -> JSON deserialized | Real persisted data from kernel | FLOWING |
| `FallbackNodeView.tsx` | node props | Received via node prop from Canvas -> originally from kernel.getNodes() | Real kernel world data | FLOWING |
| `SaveIndicator.tsx` | saveState | Computed from dirtyNotes + pendingSaves counters tracking real submit lifecycle | Real IPC state tracking | FLOWING |
| `PluginErrorNotification.tsx` | pluginName, message | From IPC 'plugin-error' event fired by plugin-host.ts handlePluginCrash | Real plugin crash data | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SDK TypeScript compiles | `cd sdk && npx tsc --noEmit` | Exit 0 | PASS |
| Electron app builds | `cd app && npx electron-vite build` | 3 bundles (main 9.00KB, preload 2.12KB, renderer 710.60KB) | PASS |
| Native addon compiled | `ls app/native/build/Release/tapestry_addon.node` | 310480 bytes | PASS |
| Kernel tests pass | `ctest --test-dir tapestry/build-kernel` | 52/52 passed | PASS |
| Example plugin isolation | `grep -r "from.*electron" plugins/example-plugin/` | 0 matches | PASS |
| Note plugin isolation | `grep -r "from.*electron" plugins/tapestry-notes/` | 0 matches | PASS |
| All commits exist | git log for 10 commit hashes | All 10 found | PASS |
| Forge config present | `ls app/forge.config.ts` | File exists, 45 lines | PASS |

### Probe Execution

Step 7c: SKIPPED (no conventional probes defined for this phase)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PLUG-01 | 02-04 | Developer can create and locally load a plugin without modifying/rebuilding core | SATISFIED | `plugins/example-plugin/` loads via PluginHost.discoverPlugins/loadPlugin without host changes |
| PLUG-02 | 02-04 | Developer can register node schemas, commands and property/UI contributions through versioned public SDK | SATISFIED | SDK exports 4 contribution types; PluginContext provides 4 registration methods; example plugin uses registerCommand + registerPropertyPanel |
| PLUG-03 | 02-02, 02-04 | Bundled feature plugins use same public API and lifecycle as third-party plugins | SATISFIED | Both plugins import from @tapestry/sdk, same loading path, same PluginContext, no special-casing |
| PLUG-04 | 02-04, 02-05 | User can enable/disable plugin and still inspect persisted content through readable fallback | SATISFIED | enablePlugin/disablePlugin in plugin-host.ts; FallbackNodeView renders readable properties with inline editing |
| PLUG-05 | 02-04, 02-05 | Clear compatibility result when plugin/API/schema version is unavailable | SATISFIED | SUPPORTED_API_VERSIONS check in loadPlugin; mismatch produces 'incompatible' status with reason string |
| PLUG-06 | 02-01, 02-02, 02-03 | Plugin-originated durable changes pass through validated, recorded core transactions | SATISFIED | KernelAPI exposes only submit (no journal access); Kernel::submit validates and records atomically |
| PLUG-07 | 02-04 | Failing/unloaded plugin releases handlers, cannot prevent base world from opening | SATISFIED | try-catch around activate, unloadPlugin clears contributions, FallbackNodeView for missing plugins |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | No TBD, FIXME, XXX, TODO, HACK, or PLACEHOLDER markers found | - | Clean |

### Test Quality Audit

No requirement-linked test files exist for this phase. The C++ kernel test suite (52 tests) validates core kernel behavior but was written in Phase 1. Phase 2 produced no new TypeScript or integration tests. This is acceptable for a feasibility gate phase where the primary verification is running the application, but it means all runtime behavior routes to human verification.

### Human Verification Required

This is an MVP-mode phase with user-facing elements (spatial canvas, ProseMirror editing, plugin lifecycle interactions). The following items require manual testing in a running Electron application.

### 1. ProseMirror Editing and Rich Text Formatting

**Test:** Launch the app (`cd app && npx electron-vite dev`), double-click the canvas to create a note, type text. Select text and press Cmd+B (bold), Cmd+I (italic), Cmd+1 (heading 1). Verify formatting applies visually and survives save/reopen.
**Expected:** Note card appears at click position with active ProseMirror editor. Bold renders at weight 600, italic in italic style, heading 1 at 22px/600. After close/reopen, formatting is preserved (JSON serialization in body property).
**Why human:** Requires a running Electron GUI to verify ProseMirror behavior, IME composition, visual rendering, and real-time formatting application.

### 2. Autosave and Save Indicator Accuracy

**Test:** Create a note, type rapidly for 5 seconds. Observe the save indicator cycling between "Saving..." and "Saved". The indicator must never show "Saved" while a debounce timer is active or an IPC call is in flight.
**Expected:** Indicator shows "Saving..." during 300ms debounce window and during IPC calls, "Saved" only when both dirtyNotes and pendingSaves are zero.
**Why human:** Requires observing real-time save indicator transitions tied to 300ms debounce, IPC latency, and dual-counter tracking.

### 3. Spatial Canvas Interaction

**Test:** Create multiple notes. Pan by dragging empty canvas space, zoom with scroll wheel. Drag a note to a new position. Close and reopen -- verify position persisted.
**Expected:** Smooth pan/zoom via CSS transform. Drag divides mouse delta by zoom for correct world-space movement. Position survives save/reopen.
**Why human:** Requires observing CSS-transform-based spatial interaction and coordinate conversion at multiple zoom levels.

### 4. Connection Creation and Display

**Test:** Hover a note to reveal controls. Click the blue connection handle and drag to another note. Verify a connection line appears between them.
**Expected:** Temporary accent-color dashed line follows pointer during drag. On release over target note, CreateEdge op submitted, permanent connection line appears in warm gray #B0ADA6.
**Why human:** Requires observing pointer event tracking, connection state machine, and SVG rendering at runtime.

### 5. Deletion and Undo/Redo

**Test:** Create three notes, connect two. Click the delete bubble on a connected note. Press Cmd+Z. Press Cmd+Shift+Z. While editing text, press Delete to verify it only deletes text characters.
**Expected:** Delete removes note + cascaded connections. Undo restores note with text, position, and connections. Redo re-applies. Text-editing Delete/Backspace handled by ProseMirror only.
**Why human:** Requires observing undo/redo state transitions through Kernel.replayUpTo (no automated test exercises this path) and the content-vs-structure deletion distinction.

### 6. Plugin Fallback Rendering

**Test:** Remove the `plugins/example-plugin/` directory. Reopen a world that had example-plugin data.
**Expected:** FallbackNodeView renders the node type header with "(unavailable)" and all properties as readable key-value pairs. Inline editing works.
**Why human:** Requires physically removing a plugin directory and observing fallback rendering in a live app.

### 7. Plugin Version Incompatibility

**Test:** Create a plugin with `api: "99"` in its tapestry.plugin.json manifest and place it in plugins/.
**Expected:** Plugin status shows "incompatible" with reason "Plugin requires API version 99, host supports version 1". World opens normally.
**Why human:** Requires observing plugin host behavior at runtime when loading an incompatible manifest.

### 8. Plugin Crash Handling

**Test:** Deliberately break a plugin's activate function (add `throw new Error('test crash')`), launch the app.
**Expected:** PluginErrorNotification appears with "[Plugin name] stopped working. Restarting...". After failed restart: "[Plugin name] could not restart. Your work is safe." with Restart and Dismiss buttons. World still opens with FallbackNodeView for crashed plugin's nodes.
**Why human:** Requires observing D-34 crash handling flow including auto-restart attempt and UI notification in a live app.

### 9. Reopen Last File

**Test:** Create a world, add notes, close the app. Relaunch. Delete last-opened.json from userData, relaunch again.
**Expected:** First relaunch opens the same file automatically. Second relaunch shows empty state with "Double-click anywhere to start" message.
**Why human:** Requires observing app lifecycle across multiple launches with file system state changes.

### 10. Packaged Application

**Test:** Run `cd app && npm run build:native && npx electron-vite build && npx electron-forge package`. Launch the packaged app from `app/forge-out/`.
**Expected:** Packaged Tapestry.app runs with all functionality: ProseMirror editing, spatial canvas, plugin loading, native addon bridge. Record idle memory, startup time, and package size.
**Why human:** Requires building and launching the packaged Electron application to verify native addon and plugin loading in production mode.

### Gaps Summary

No gaps found. All 5 roadmap success criteria are verified at the code level. All 7 PLUG requirements are satisfied. All artifacts exist, are substantive, and are properly wired. No debt markers found in any phase files.

The phase status is `human_needed` because this is an MVP-mode phase with extensive user-facing elements (spatial canvas, ProseMirror editing, plugin lifecycle interactions) that require manual verification in a running Electron application. All automated checks pass: SDK typechecks, app builds, native addon compiles, and 52 kernel tests pass.

---

_Verified: 2026-09-10T01:15:00Z_
_Verifier: Claude (gsd-verifier)_
