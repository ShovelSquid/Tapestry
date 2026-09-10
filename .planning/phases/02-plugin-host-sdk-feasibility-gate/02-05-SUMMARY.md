---
phase: 02-plugin-host-sdk-feasibility-gate
plan: 05
subsystem: deletion-undo-formatting-packaging
tags: [deletion, undo-redo, prosemirror, rich-text, electron-forge, packaging, feasibility-gate]
dependency_graph:
  requires: [02-04]
  provides: [content-vs-structure-deletion, undo-redo, rich-text-formatting, packaged-application, feasibility-gate-evidence]
  affects: []
tech_stack:
  added: ["@electron-forge/cli", "@electron-forge/maker-zip", "@electron-forge/shared-types"]
  patterns: [Kernel.replayUpTo for undo/redo navigation, ProseMirror JSON serialization for rich text, extraResource for native addon packaging, toggleMark/setBlockType keybindings]
key_files:
  created:
    - app/forge.config.ts
  modified:
    - tapestry/kernel/Kernel.hpp
    - tapestry/kernel/Kernel.cpp
    - app/native/addon.cpp
    - app/src/main/kernel-bridge.ts
    - app/src/preload/index.ts
    - app/src/renderer/global.d.ts
    - app/src/renderer/App.tsx
    - app/src/renderer/App.css
    - app/src/renderer/components/Canvas.tsx
    - app/src/renderer/components/NoteCard.tsx
    - app/package.json
    - .gitignore
key_decisions:
  - "Undo/redo implemented as Kernel.replayUpTo(seq) rebuilding in-memory world from journal commits; journal is never modified (D-22, T-02-12)"
  - "KernelBridge maintains undoStack of CommitSeq values; new commits clear redo stack"
  - "ProseMirror doc serialized as JSON in body property for rich text persistence; plain text fallback for pre-rich-text notes"
  - "toggleHeading command toggles between heading level and paragraph (not just setBlockType)"
  - "World-level undo/redo when no ProseMirror editor is focused; ProseMirror handles text-level undo when editor is focused"
  - "Native addon loaded from process.resourcesPath in packaged mode; native/build/Release/ in development"
  - "Forge extraResource includes tapestry_addon.node and plugins/ directory"
  - "Forge outDir set to forge-out/ to avoid conflict with electron-vite's out/ directory"
requirements_completed: [PLUG-04, PLUG-05]
metrics:
  duration: 1075s
  completed: 2026-09-10T00:42:49Z
  tasks_completed: 3
  tasks_total: 3
actuals:
  tokens: 6686
  tasks: 3
  commits: 3
plan_head_before: a816fd25eaac0f97c07c28ed3ac857fb3fcb45c1
status: complete
---

# Phase 2 Plan 05: Deletion, Undo/Redo, Rich Text & Packaging Summary

**One-liner:** Content-vs-structure deletion with cascading edges, undo/redo through kernel journal replay without erasing evidence, ProseMirror bold/italic/headings via keyboard shortcuts with JSON serialization, and Electron Forge packaging with native addon and plugins as extraResources.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~18 minutes |
| Commits | 3 |
| Files created | 1 |
| Files modified | 12 |
| Renderer bundle size | 710.60 KB |
| Package size (darwin-arm64) | 241 MB |
| Native addon size | 320 KB |

## Accomplishments

### Task 1: Content-vs-structure deletion and undo/redo through event history

**Content vs structure deletion (D-20):** Clearing note text (selecting all and pressing Delete with ProseMirror focused) results in an empty note card that remains on the canvas with its position and connections. The note still exists in the kernel with an empty body property. Deleting the note structure (via delete bubble or keyboard) submits a DeleteNode op that cascades to all touching edges.

**Delete bubble and keyboard (D-21):** The red delete bubble now calls `onDeleteNote` which submits a DeleteNode op through the kernel. When a note is border-selected (not text-editing) and Delete/Backspace is pressed, the Canvas component handles the key event and submits DeleteNode. When ProseMirror has focus (text editing), Delete/Backspace keys are handled by ProseMirror for text editing only -- the Canvas keyboard handler checks `editingNodeId` and skips when an editor is active.

**Undo/redo (D-22):** Implemented as navigation through the kernel's commit history via a new `Kernel::replayUpTo(CommitSeq)` method. This method resets the in-memory World and replays journal commits up to the given seq. The journal is never modified (T-02-12 mitigated).

The KernelBridge maintains:
- `currentSeq`: tracks the seq the world is currently displaying
- `undoStack`: array of CommitSeq values that have been undone (for redo)

Undo pushes `currentSeq` onto `undoStack`, decrements `currentSeq`, and calls `replayUpTo`. Redo pops from `undoStack` and replays to that seq. New commits clear the undo stack (new edit after undo discards redo per D-22).

Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z are handled at the window level. When a ProseMirror editor is focused, the key events pass through to ProseMirror for text-level undo. When no editor is focused, world-level undo/redo handles committed changes.

### Task 2: ProseMirror bold, italic, and headings via keyboard shortcuts

**Schema (D-23):** The ProseMirror schema already includes bold (strong) and italic (em) marks and heading node type from prosemirror-schema-basic. These were active but had no keyboard bindings.

**Keyboard shortcuts:** Added keymap bindings using prosemirror-commands:
- Mod-b: `toggleMark(schema.marks.strong)` -- toggles bold
- Mod-i: `toggleMark(schema.marks.em)` -- toggles italic
- Mod-1/2/3: Custom `toggleHeading(level)` that toggles between heading and paragraph

The formatting keymap is added before the history and base keymaps so it takes precedence.

**Rich text serialization:** Note body is now serialized as ProseMirror JSON (`doc.toJSON()` / `schema.nodeFromJSON()`) instead of plain text. The `deserializeBody` function tries JSON parsing first; if it fails (plain text from before rich text), it creates paragraphs from newline-split text. This ensures backward compatibility with pre-rich-text notes.

**CSS styling per UI-SPEC:**
- Bold: font-weight 600
- Italic: font-style italic
- Heading 1: 22px, weight 600, line-height 1.25
- Heading 2: 18px, weight 600, line-height 1.3
- Heading 3: 16px, weight 600, line-height 1.4
- Body: 16px, weight 400, line-height 1.5

### Task 3: Package the Electron application and collect feasibility evidence

**Electron Forge configuration (forge.config.ts):**
- `asar: true` for the app bundle
- `extraResource`: native addon (`tapestry_addon.node`) and `plugins/` directory placed in `.app/Contents/Resources/`
- Custom `ignore` array overrides Forge's default `/out/` exclusion (electron-vite builds to `out/`)
- `outDir: forge-out/` to separate Forge output from electron-vite output
- MakerZIP for cross-platform distribution

**Native addon path resolution:** `kernel-bridge.ts` updated with `resolveAddonPath()` that checks `process.resourcesPath` first (packaged mode), falling back to the development path.

**Package.json updates:**
- `main` field corrected to `out/main/index.js` (matching electron-vite output)
- Added `package` and `make` scripts
- Added Forge devDependencies

**Feasibility gate evidence:**

| Gate criterion | Status | Evidence |
|---------------|--------|----------|
| 1. Editable note plugin | PASS | ProseMirror editor with IME, multiline, rich text shortcuts, save/reload |
| 2. Spatial interaction | PASS | Pan/zoom canvas, drag-to-reposition, connection creation (Plan 03) |
| 3. Independent plugin | PASS | Example plugin loads from plugins/ without host modification (Plan 04) |
| 4. Command bridge | PASS | Note editing submits ops through native addon; 300ms debounce; rejected edits return errors |
| 5. Offline removal/replay | PASS | Missing plugin shows FallbackNodeView; world opens without plugin (Plan 04) |
| 6. Packaged application | PASS | electron-forge package produces 241MB app with native addon and plugins |

**Package measurements:**
- Package size: 241 MB (darwin-arm64, includes Chromium)
- Native addon size: 320 KB
- Build time: ~2 seconds (electron-vite build)

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | b381067 | feat(02-05): content-vs-structure deletion and undo/redo through event history |
| 2 | 32a5084 | feat(02-05): ProseMirror bold, italic, and headings via keyboard shortcuts |
| 3 | 69bba0d | feat(02-05): package Electron application with Forge and native addon |

## Files Created

| File | Purpose |
|------|---------|
| `app/forge.config.ts` | Electron Forge packaging config with asar, extraResource, and makers |

## Files Modified

| File | Changes |
|------|---------|
| `tapestry/kernel/Kernel.hpp` | Added replayUpTo(CommitSeq) and lastSeq() for undo/redo |
| `tapestry/kernel/Kernel.cpp` | Implemented replayUpTo: rebuild world from journal up to given seq |
| `app/native/addon.cpp` | Added ReplayUpTo and GetLastSeq instance methods |
| `app/src/main/kernel-bridge.ts` | Added undo/redo logic with undoStack, currentSeq tracking, afterCommit/syncCurrentSeq helpers; resolveAddonPath for packaged mode |
| `app/src/preload/index.ts` | Added kernel:undo and kernel:redo IPC channels |
| `app/src/renderer/global.d.ts` | Added undo() and redo() to TapestryKernelAPI |
| `app/src/renderer/App.tsx` | Added handleDeleteNote, handleUndo, handleRedo; Cmd+Z/Cmd+Shift+Z keyboard handler; passes onDeleteNote to Canvas |
| `app/src/renderer/App.css` | Added strong/em CSS; refined heading line-heights per UI-SPEC |
| `app/src/renderer/components/Canvas.tsx` | Added onDeleteNote prop, keyboard Delete/Backspace handler for selected notes |
| `app/src/renderer/components/NoteCard.tsx` | Wired delete bubble to onDeleteNote; added toggleMark/setBlockType keybindings; JSON serialization for rich text |
| `app/package.json` | Added Forge deps, package/make scripts, fixed main entry path |
| `.gitignore` | Added app/forge-out/ |

## Decisions Made

1. **Kernel.replayUpTo for undo:** Rather than maintaining a separate undo buffer or modifying the journal, undo/redo rebuilds the world by replaying journal commits up to a target seq. This preserves the journal's immutability (T-02-12) and ensures undo never erases historical evidence (D-22).

2. **ProseMirror JSON for body serialization:** Switched from plain text to ProseMirror JSON for the body property. This preserves formatting marks (bold, italic) and heading structure across save/reopen. The kernel stores the JSON as a text value in the .tree file. Plain text fallback ensures backward compatibility.

3. **World-level vs text-level undo separation:** When ProseMirror is focused, Cmd+Z goes to ProseMirror for text-level undo (uncommitted changes within the editor session). When no editor is focused, Cmd+Z triggers world-level undo through the kernel bridge.

4. **Native addon as extraResource:** Rather than trying to include the .node file inside the asar (which requires unpacking), the addon is placed directly in Resources/ via extraResource. The kernel-bridge resolves the path using `process.resourcesPath` in packaged mode.

5. **Forge outDir separation:** Set to `forge-out/` to avoid conflict with electron-vite's `out/` directory. Forge defaults to ignoring `/out/` which would exclude the electron-vite build output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Electron Forge ignores /out/ by default**
- **Found during:** Task 3, first packaging attempt
- **Issue:** Forge hardcodes `ignore: [/^\/out\//g]` which excludes electron-vite's build output
- **Fix:** Overrode the ignore array in forge.config.ts; set custom outDir to forge-out/
- **Files modified:** app/forge.config.ts
- **Commit:** 69bba0d

**2. [Rule 1 - Bug] package.json main entry pointed to wrong path**
- **Found during:** Task 3, packaging validation
- **Issue:** main field was `dist/main/index.js` but electron-vite builds to `out/main/index.js`
- **Fix:** Updated main field to `out/main/index.js`
- **Files modified:** app/package.json
- **Commit:** 69bba0d

**3. [Rule 3 - Blocking] Native addon not found in packaged asar**
- **Found during:** Task 3, first packaging validation
- **Issue:** The .node file inside the native/ directory was excluded by ignore patterns
- **Fix:** Moved native addon to extraResource instead of relying on asar inclusion; updated kernel-bridge to resolve from process.resourcesPath
- **Files modified:** app/forge.config.ts, app/src/main/kernel-bridge.ts
- **Commit:** 69bba0d

## Known Stubs

None. All components are fully wired end-to-end. The previous delete bubble stub (Plan 03) has been resolved.

## Verification Results

| Check | Result |
|-------|--------|
| electron-vite build (main/preload/renderer) | PASS -- all three bundles produced |
| Main bundle size | 9.00 KB |
| Preload bundle size | 2.12 KB |
| Renderer bundle size | 710.60 KB |
| Kernel test suite (cmake build + ctest) | PASS -- 52/52 tests |
| electron-forge package | PASS -- Tapestry.app produced |
| Package size (darwin-arm64) | 241 MB |
| Native addon in Resources/ | PASS -- tapestry_addon.node (320 KB) |
| Plugins in Resources/ | PASS -- tapestry-notes/ and example-plugin/ |
| All files present on disk | PASS |
| All 3 commits verified in git log | PASS |

## Threat Flags

None. Security boundaries match the plan's threat model:
- T-02-12: Undo replays from the immutable journal; the journal is never modified by undo
- T-02-13: Accepted for Phase 2 (small worlds); snapshot optimization deferred to Phase 3
- T-02-14: No auto-update mechanism in the packaged app (explicitly deferred)

## Self-Check: PASSED

All 13 created/modified files verified present on disk. All 3 commits (b381067, 32a5084, 69bba0d) verified in git log. SUMMARY.md written to disk.
