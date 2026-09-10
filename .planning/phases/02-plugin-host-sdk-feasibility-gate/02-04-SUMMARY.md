---
phase: 02-plugin-host-sdk-feasibility-gate
plan: 04
subsystem: plugin-sdk-lifecycle-safety
tags: [plugin-sdk, contributions, lifecycle, fallback, crash-handling, example-plugin, version-check]
dependency_graph:
  requires: [02-03]
  provides: [plugin-sdk-contributions, plugin-lifecycle, fallback-rendering, crash-handling, example-plugin, version-compatibility]
  affects: [02-05]
tech_stack:
  added: []
  patterns: [contribution registration surface, plugin discover/load/unload/reload/enable/disable lifecycle, FallbackNodeView for missing plugins, PluginErrorNotification with auto-restart, API version gate]
key_files:
  created:
    - sdk/src/contributions.ts
    - app/src/renderer/components/FallbackNodeView.tsx
    - app/src/renderer/components/PluginErrorNotification.tsx
    - plugins/example-plugin/tapestry.plugin.json
    - plugins/example-plugin/index.ts
    - plugins/example-plugin/PropertyPanel.tsx
  modified:
    - sdk/src/index.ts
    - app/src/main/plugin-host.ts
    - app/src/main/index.ts
    - app/src/preload/index.ts
    - app/src/renderer/global.d.ts
    - app/src/renderer/App.tsx
    - app/src/renderer/components/Canvas.tsx
    - plugins/tapestry-notes/index.ts
key_decisions:
  - "Plugin contribution surface uses four typed registration methods: registerNodeView, registerCommand, registerPropertyPanel, registerInspector"
  - "PluginHost is a full lifecycle class with discover, load, unload, reload, enable, disable, and crash handling"
  - "Enable/disable events recorded as journal entries with system actor via kernel.submit (D-32)"
  - "API version check against SUPPORTED_API_VERSIONS array; Phase 2 supports only version '1' (PLUG-05)"
  - "FallbackNodeView renders readable key-value properties with inline editing for disabled/missing plugin nodes (D-33, D-35)"
  - "PluginErrorNotification shows immediate crash message, auto-restart once, then Restart/Dismiss actions (D-34)"
  - "Canvas conditionally routes nodes to NoteCard or FallbackNodeView based on pluginNodeViews map"
  - "Example plugin imports only from @tapestry/sdk — same loading path as first-party tapestry-notes (PLUG-01, PLUG-03)"
requirements_completed: [PLUG-01, PLUG-02, PLUG-04, PLUG-05, PLUG-07]
metrics:
  duration: 720s
  completed: 2026-09-10T00:17:42Z
  tasks_completed: 2
  tasks_total: 2
actuals:
  tokens: 17185
  tasks: 2
  commits: 2
plan_head_before: cd60ff34e8ceb413f5ef805cae1cbe8f3dc84f4d
status: complete
---

# Phase 2 Plan 04: Plugin SDK, Lifecycle, Safety & Example Plugin Summary

**One-liner:** Full plugin SDK contribution surface with four registration types, lifecycle management (discover/load/unload/reload/enable/disable), FallbackNodeView for missing plugins, crash notification with auto-restart, API version gating, and a working third-party example plugin using only the public SDK.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~12 minutes |
| Commits | 2 |
| Files created | 6 |
| Files modified | 8 |
| Renderer bundle size | 704.32 KB |
| Build time | ~1 second |

## Accomplishments

### Task 1: Plugin SDK contribution surface, directory loading, reload, and recorded effects

**SDK contribution types (sdk/src/contributions.ts):** Four typed contribution interfaces: NodeViewContribution (nodeType, displayName, component), CommandContribution (id, displayName, handler with CommandContext), PropertyPanelContribution (nodeType, displayName, component), InspectorContribution (id, displayName, component). CommandContext provides kernel, selectedNodes, and arguments.

**PluginContext expansion (sdk/src/index.ts):** Added registerCommand, registerPropertyPanel, registerInspector methods. Updated registerNodeView to accept a NodeViewContribution object instead of separate arguments. Re-exports all contribution types from contributions.ts so plugins import from a single package.

**PluginHost restructure (app/src/main/plugin-host.ts):** Full lifecycle class with:
- `discoverPlugins()`: scans plugins/ for tapestry.plugin.json manifests, validates required fields (T-02-10)
- `loadPlugin(name)`: validates API version (PLUG-05), loads entry, constructs PluginContext, calls activate with try-catch (D-34)
- `unloadPlugin(name)`: calls deactivate, removes all contributions, clears require cache
- `reloadPlugin(name)`: unload then load (D-29, explicit)
- `enablePlugin(name)`: load + record journal event via kernel.submit with system actor (D-32)
- `disablePlugin(name)`: unload + record journal event (D-32)
- `handlePluginCrash(name)`: notify, auto-restart once, then disable with Restart/Dismiss (D-34)
- `getContributions()`: returns full registry across all loaded plugins
- `discoverAndLoadAll(bridge)`: bulk discover and load at startup

**KernelAPI restriction (D-31):** The kernel surface exposed to plugins includes only submit, getNodes, getNode, getEdges, and status. No journal-level methods (no raw read, write, truncate, repair, or saveAs).

**Preload expansion:** Added plugin:getContributions, plugin:reload, plugin:enable, plugin:disable, plugin:executeCommand IPC channels. Added onPluginError listener for crash notifications.

**Note plugin updated:** registerNodeView call updated to use NodeViewContribution object format.

### Task 2: Missing/broken plugin safety, fallback, crash handling, version check, and example plugin

**FallbackNodeView (app/src/renderer/components/FallbackNodeView.tsx):** Generic readable fallback for nodes whose plugin is missing or disabled (D-33). Shows the node type as a muted header with "(unavailable)", each property as a key-value pair with type-appropriate formatting (text as quoted string, numbers as-is, booleans as true/false, refs and times as strings). Same card styling as regular notes (white background, border, shadow). Inline property editing through click-to-edit values (D-35). Drag-to-reposition via header handle.

**PluginErrorNotification (app/src/renderer/components/PluginErrorNotification.tsx):** Implements D-34 crash notification flow with UI-SPEC copywriting:
1. Immediate: "[Plugin name] stopped working. Restarting..."
2. Auto-restart succeeds: brief success message, auto-dismiss after 3 seconds
3. Auto-restart fails: "[Plugin name] could not restart. Your work is safe." with Restart and Dismiss action buttons
Error icon SVG, destructive border color, fixed positioning at viewport top center.

**Canvas integration:** Canvas now receives a `pluginNodeViews` map and routes each node to NoteCard (if plugin loaded) or FallbackNodeView (if plugin missing/disabled). Also passes `onPropertyEdit` for fallback inline editing.

**App.tsx integration:** Fetches plugin contributions on load and after file open via plugins.getContributions(). Maintains pluginNodeViews state. Handles plugin error events via onPluginError listener. Provides handlePluginRestart and handlePluginErrorDismiss callbacks.

**Version compatibility (PLUG-05):** loadPlugin checks manifest.api against SUPPORTED_API_VERSIONS (["1"] for Phase 2). Mismatch produces PluginLoadResult with status "incompatible" and a clear reason string (e.g. "Plugin requires API version 2, host supports version 1"). Surfaced in plugin:list response.

**Example plugin (plugins/example-plugin/):**
- tapestry.plugin.json: name "example-plugin", version "1", displayName "Example Property Inspector", api "1", one command "example.inspect"
- index.ts: TapestryPlugin that registers a command "example.inspect" (reads selected node properties via kernel.getNode, logs to console) and a PropertyPanelContribution for all node types ("*" wildcard)
- PropertyPanel.tsx: React component rendering node properties as a styled list with type tags

**Import isolation (PLUG-03):** Example plugin imports only from @tapestry/sdk. Verified: 0 Electron imports, 0 host imports.

**Public API parity (PLUG-03):** Both tapestry-notes (first-party) and example-plugin (third-party) load through the same discoverPlugins/loadPlugin path, receive the same PluginContext, and register through the same contribution methods. No special-casing in the host.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | b64830c | feat(02-04): add full plugin SDK contribution surface, lifecycle management, and recorded effects |
| 2 | bb697d8 | feat(02-04): add fallback rendering, crash handling, version check, and example plugin |

## Files Created

| File | Purpose |
|------|---------|
| `sdk/src/contributions.ts` | Contribution types: NodeViewContribution, CommandContribution, PropertyPanelContribution, InspectorContribution |
| `app/src/renderer/components/FallbackNodeView.tsx` | Generic readable fallback for nodes whose plugin is missing or disabled |
| `app/src/renderer/components/PluginErrorNotification.tsx` | Plugin crash notification with Restart/Dismiss actions |
| `plugins/example-plugin/tapestry.plugin.json` | Third-party example plugin manifest |
| `plugins/example-plugin/index.ts` | Example plugin registering command and property panel via SDK |
| `plugins/example-plugin/PropertyPanel.tsx` | Example property panel component demonstrating custom UI |

## Files Modified

| File | Changes |
|------|---------|
| `sdk/src/index.ts` | Added registerCommand/registerPropertyPanel/registerInspector to PluginContext; re-exports contribution types |
| `app/src/main/plugin-host.ts` | Restructured into full PluginHost class with lifecycle, crash handling, version check |
| `app/src/main/index.ts` | Updated to use discoverAndLoadAll; wired onPluginError to renderer |
| `app/src/preload/index.ts` | Added getContributions, reload, enable, disable, executeCommand, onPluginError IPC |
| `app/src/renderer/global.d.ts` | Added TapestryPluginsAPI methods and onPluginError type |
| `app/src/renderer/App.tsx` | Added plugin contributions state, error notification, property edit handler |
| `app/src/renderer/components/Canvas.tsx` | Conditional NoteCard vs FallbackNodeView routing based on plugin availability |
| `plugins/tapestry-notes/index.ts` | Updated registerNodeView to use NodeViewContribution object format |

## Decisions Made

1. **Four contribution types:** NodeView, Command, PropertyPanel, and Inspector cover the extension points needed for Phase 2. Additional contribution types (themes, behaviors, etc.) can be added in future phases without breaking the existing surface.

2. **Contribution registry keyed by plugin name:** Each plugin's contributions are tracked separately so unload/disable can precisely remove only that plugin's registrations without affecting others.

3. **System actor for lifecycle events:** Enable/disable/crash events use actor kind "system" and actor id "tapestry" with an empty ops array -- the event itself is the journal record, per D-32.

4. **FallbackNodeView with inline editing:** Rather than showing read-only data, the fallback allows clicking any value to edit it inline and submit a SetProperty through the kernel. This satisfies D-35's requirement that disabled plugin content remains editable.

5. **Plugin error notification via IPC:** Crash notifications flow from the main process (plugin-host.ts) through an IPC channel to the renderer (App.tsx), decoupling the plugin system from React rendering.

6. **Canvas uses pluginNodeViews map:** Rather than hardcoding which component renders which node type, the Canvas receives a map of node types to component names from loaded plugins. Unknown types fall through to FallbackNodeView.

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None. All components are fully wired end-to-end.

## Verification Results

| Check | Result |
|-------|--------|
| electron-vite build (main/preload/renderer) | PASS -- all three bundles produced |
| Main bundle size | 8.69 KB |
| Preload bundle size | 2.00 KB |
| Renderer bundle size | 704.32 KB |
| TypeScript --noEmit typecheck | PASS -- no errors |
| Example plugin has no Electron imports | PASS (0 matches) |
| Example plugin has no host imports | PASS (0 matches) |
| All 14 files present on disk | PASS |
| Both commits verified in git log | PASS |

## Threat Flags

None. All threat model mitigations are in place:
- T-02-08: Plugins receive only PluginContext; no journal/file handles exposed (D-31)
- T-02-09: try-catch around activate, auto-restart once, then disable (D-34)
- T-02-10: JSON.parse in try-catch; missing required fields skip the plugin
- T-02-11: Version check against SUPPORTED_API_VERSIONS; mismatch prevents loading (PLUG-05)

## Self-Check: PASSED

All 14 created/modified files verified present on disk. Both commits (b64830c, bb697d8) verified in git log. SUMMARY.md written to disk.
