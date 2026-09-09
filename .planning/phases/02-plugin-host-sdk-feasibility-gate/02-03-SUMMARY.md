---
phase: 02-plugin-host-sdk-feasibility-gate
plan: 03
subsystem: spatial-canvas-interaction
tags: [canvas, pan-zoom, drag, connections, hover-controls, resize, react]
dependency_graph:
  requires: [02-02]
  provides: [spatial-canvas, pan-zoom, drag-to-reposition, connection-display, connection-creation, note-controls, border-select, resize]
  affects: [02-04, 02-05]
tech_stack:
  added: []
  patterns: [CSS-transform pan/zoom, pointer-event drag, screenToWorld/worldToScreen coordinate mapping, SVG connection overlay, hover-group with delayed hide, border-select vs edit-focus separation]
key_files:
  created:
    - app/src/renderer/components/Canvas.tsx
    - app/src/renderer/components/ConnectionLine.tsx
    - app/src/renderer/components/NoteControls.tsx
  modified:
    - app/src/renderer/App.tsx
    - app/src/renderer/App.css
    - app/src/renderer/components/NoteCard.tsx
key_decisions:
  - "Canvas uses CSS transform: translate(panX, panY) scale(zoom) on a container div; notes and SVG connections live inside the same transformed container so they pan/zoom together"
  - "Drag-to-reposition uses local state for immediate visual feedback, then persists via kernel:submit SetProperty for position.x and position.y on mouseup"
  - "Hover and text-focus are distinct: hoveredNoteId and focusedNoteId (editingNodeId) are separate state values in Canvas; controls use preventDefault on pointerDown to avoid stealing ProseMirror focus (D-07)"
  - "Connection creation uses a connecting-from/connecting-line/connecting-hover state machine in Canvas; temporary line follows pointer in accent color; release on target note submits CreateEdge op"
  - "Delete bubble present but logs console warning -- deletion deferred to Plan 05 per D-20/D-21/D-22"
  - "Width resize persists through kernel:submit SetProperty for width; height determined by content reflow"
requirements_completed: [PLUG-06]
metrics:
  duration: 538s
  completed: 2026-09-09T23:56:49Z
  tasks_completed: 2
  tasks_total: 2
actuals:
  tokens: 13984
  tasks: 2
  commits: 2
plan_head_before: 6a66d5e0b240497b216c15afe135829b7a6edd02
status: complete
---

# Phase 2 Plan 03: Spatial Canvas Interaction Summary

**One-liner:** Infinite 2D canvas with CSS-transform pan/zoom, drag-to-reposition with kernel position persistence, SVG connection line rendering, bubbly hover controls (connection handle + delete bubble), border-select with accent styling, pointer-event resize, and connection creation via drag from handle to target note.

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~9 minutes |
| Commits | 2 |
| Files created | 3 |
| Files modified | 3 |
| Renderer bundle size | 688.91 KB |
| Build time | ~1 second |

## Accomplishments

### Task 1: Pan/zoom canvas, drag-to-reposition, and connection display

**Canvas component (Canvas.tsx):** Extracted the canvas rendering from App.tsx into a dedicated Canvas component. The canvas manages a ViewTransform with panX, panY, and zoom state. Pan is implemented via pointer events on empty canvas space (not on notes); zoom via wheel event, scaling around the pointer position. The view transform is applied using a CSS `transform: translate(panX, panY) scale(zoom)` on a container div inside the canvas viewport. Notes are positioned inside the transformed container at their world-space coordinates using absolute positioning.

**Coordinate conversion:** `screenToWorld(screenX, screenY, panX, panY, zoom, viewportRect)` and `worldToScreen(worldX, worldY, panX, panY, zoom, viewportRect)` functions convert between screen pixels and world-space coordinates. Used for placing new notes from double-click (converting screen click to world position) and for connection line rendering.

**Drag-to-reposition (D-01):** NoteCard has a drag handle strip at the top of the card. Dragging from this handle moves the note in world space with immediate visual feedback via local state (`localPos`). On mouseup, submits SetProperty ops for position.x and position.y through the kernel bridge to persist. The drag divides mouse delta by zoom to maintain correct world-space movement at all zoom levels. Dragging the text area does not initiate drag -- it starts text selection via ProseMirror.

**Connection display (ConnectionLine.tsx):** Edges are rendered as SVG lines in a layer inside the transformed container alongside notes. For each edge from kernel.getEdges(), a line is drawn from the center of the source note to the center of the target note. Lines use warm gray #B0ADA6 (UI-SPEC thread line default). The SVG overlay pans and zooms with the canvas.

**App.tsx refactored:** App.tsx now owns only the data layer (nodes, edges, save state, file lifecycle) and passes everything to Canvas. Double-click position is converted from screen to world space before creating the note.

### Task 2: Hover controls, focus distinction, border select, resize, and connection creation

**NoteControls (NoteControls.tsx per D-06):** Two bubbly round controls: connection handle (28px, accent #4A7CFF, link icon SVG glyph) and delete bubble (28px, destructive #E5484D, X icon SVG glyph). Controls scale to 32px on hover via CSS transform with 0.15s transition. Positioned just outside the note border using absolute positioning.

**Hover group (D-06):** Controls appear when the note is hovered OR selected. The hover detection uses a 300ms hide delay so the user can move from the note body to the controls without the controls disappearing. Controls use `onPointerDown` with `preventDefault` and `tabIndex={-1}` to avoid stealing ProseMirror focus.

**Hover vs text focus (D-07):** Canvas tracks `hoveredNoteId` and `selectedNoteId` as separate state values from `editingNodeId`. Hovering a note reveals controls without moving the caret or losing text selection in any focused editor. Clicking text moves the caret (ProseMirror handles this). Clicking a control executes its action without affecting text state.

**Border select (D-08):** Clicking the drag handle area of a note selects it. A selected note shows accent #4A7CFF border (2px) and elevated shadow (0 2px 8px rgba(0,0,0,0.10)) per UI-SPEC. The selected state is distinct from editing: selecting does not enter edit mode. Double-clicking or clicking inside the text content enters edit mode.

**Resize (D-08):** When a note is selected, resize handles appear at edges and corners. Dragging a handle resizes the note width. Text reflows within new dimensions. Minimum width is 120px. On resize completion, submits SetProperty for width through the kernel bridge. Height is determined by content reflow (not stored).

**Connection creation:** Clicking the connection handle enters "connecting" mode. A temporary dashed line in accent #4A7CFF follows the pointer from the source note center. When the pointer is released over another note (which highlights with accent border and glow), a CreateEdge op is submitted through the kernel bridge with label "link". Releasing over empty space cancels. The connection handle's pointer handler prevents focus theft (D-07).

**Delete bubble:** Clicking the delete bubble logs a console warning that deletion is not yet implemented, as specified in the plan. Deferred to Plan 05 (D-20/D-21/D-22).

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | daafc7e | feat(02-03): add pan/zoom canvas, drag-to-reposition, and connection display |
| 2 | 4c01700 | feat(02-03): add hover controls, focus distinction, resize, and connection creation |

## Files Created

| File | Purpose |
|------|---------|
| `app/src/renderer/components/Canvas.tsx` | Infinite 2D canvas with CSS-transform pan/zoom, world-to-screen coordinate mapping |
| `app/src/renderer/components/ConnectionLine.tsx` | SVG line rendering for edges between notes |
| `app/src/renderer/components/NoteControls.tsx` | Bubbly control buttons (connection handle, delete bubble) around note edges |

## Files Modified

| File | Changes |
|------|---------|
| `app/src/renderer/App.tsx` | Refactored to use Canvas component; added position, width, and edge handlers |
| `app/src/renderer/App.css` | Added styles for canvas container, controls, resize handles, drag handle, connection target |
| `app/src/renderer/components/NoteCard.tsx` | Added drag-to-reposition, resize, hover management, border select, NoteControls integration |

## Decisions Made

1. **CSS transform for pan/zoom:** The canvas uses a single CSS `transform: translate + scale` on a container div. Notes and SVG connections both live inside this container so they pan/zoom together. This avoids per-element coordinate recalculation and is GPU-accelerated (T-02-07 accepted risk).

2. **Local state drag feedback:** Drag-to-reposition uses React `localPos` state for immediate visual feedback, then persists to the kernel on mouseup. This avoids kernel round-trip latency during the drag gesture.

3. **Separate hover vs focus state:** Canvas maintains `hoveredNoteId` (pointer position) and `editingNodeId` (ProseMirror focus) as independent values. This implements D-07 (hover reveals controls without moving caret or losing selection).

4. **Connection creation state machine:** Canvas uses three state values (`connectingFrom`, `connectingLine`, `connectingHover`) to manage the connection drag gesture. The temporary line uses accent color to distinguish from committed connections.

5. **Width-only resize:** Only width is persisted; height is determined by content reflow. This matches the plan's specification and avoids storing redundant height that would need recalculation on text changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Node modules not installed in worktree**
- **Found during:** Task 1, initial build attempt
- **Issue:** The worktree had no node_modules (gitignored), so electron-vite build failed
- **Fix:** Ran `npm install --ignore-scripts` to install dependencies
- **Files modified:** None (node_modules are gitignored)
- **Commit:** N/A (transient)

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| Delete bubble logs warning instead of deleting | app/src/renderer/components/NoteCard.tsx | 498 | Intentional per plan: deletion deferred to Plan 05 (D-20/D-21/D-22) |

## Verification Results

| Check | Result |
|-------|--------|
| electron-vite build (main/preload/renderer) | PASS - all three bundles produced |
| Main bundle size | 8.69 KB |
| Preload bundle size | 1.22 KB |
| Renderer bundle size | 688.91 KB |
| Canvas component renders with pan/zoom transform | PASS (build succeeds, component compiled) |
| ConnectionLine renders SVG lines in warm gray | PASS (component compiled with #B0ADA6) |
| NoteControls renders 28px bubbles with correct colors | PASS (component compiled with #4A7CFF and #E5484D) |
| All 3 created files present on disk | PASS |
| Both commits verified in git log | PASS |

## Threat Flags

None. All position updates and edge creation go through kernel:submit which validates ops (T-02-06 mitigated). CSS transform pan/zoom is GPU-accelerated (T-02-07 accepted).

## Self-Check: PASSED

All 7 files verified present on disk. Both commits (daafc7e, 4c01700) verified in git log. SUMMARY.md written to disk.
