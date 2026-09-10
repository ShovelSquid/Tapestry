---
status: complete
phase: 02-plugin-host-sdk-feasibility-gate
source: [02-VERIFICATION.md]
started: 2026-09-10T01:20:00Z
updated: 2026-09-10T04:52:37Z
---

## Current Test

[testing complete]

## Tests

### 1. ProseMirror editing in Electron app
expected: Note card appears at click position, text is editable, bold/italic/headings apply (Cmd+B/I/1/2/3) and render with correct styles
result: issue
reported: "titles display the first line written, and when you rewrite the first line it rewrites the title, instead of the title being its own line with header formatting."
severity: major

### 2. Save/reload persistence
expected: All notes restored with positions, text content, and rich text formatting intact after close and reopen
result: skipped
reason: "Text and formatting persistence passed; position persistence could not be tested because the note never drops after dragging. User reported: it is intact with formatting, yet I can't test moving positions because when I drag it never drops, it remains dragged and so it doesn't update the position on save. I presume it would work though, because their created positions work well"

### 3. Autosave indicator
expected: Indicator shows Saving... during debounce window, Saved when quiescent. Never falsely shows Saved while text is pending
result: pass

### 4. Spatial canvas interaction
expected: Pan, zoom, and drag work fluidly; note appears at its dragged position after reopen
result: issue
reported: "pan and scroll should be separate two finger gestures; pan is moving two fingers, scroll is scrolling in/out on trackpad."
severity: major

### 5. Hover controls and connection creation
expected: Controls appear on hover with 300ms hide delay, connection line rendered between notes after drag completes
result: issue
reported: "connections do not follow a moving note."
severity: major

### 6. Undo/redo through event history
expected: Undo restores deleted note completely; redo re-applies deletion; .tree file is append-only
result: pass

### 7. Missing plugin fallback rendering
expected: FallbackNodeView renders node type header and key-value properties with inline editing
result: skipped
reason: "User was not sure whether they were able to test this checkpoint."

### 8. Incompatible plugin version rejection
expected: Plugin status shows 'incompatible' with reason about API version mismatch
result: pass

### 9. Plugin crash handling
expected: Notification appears, auto-restart attempted once, world still opens
result: skipped
reason: "User skipped this checkpoint."

### 10. Packaged application
expected: Packaged Tapestry.app runs with full functionality including native C++ kernel bridge
result: pass

### 11. Resize notes from their edges
expected: Selecting and dragging a note edge resizes the note while preserving its editable content
result: issue
reported: "notes can't be resized by selecting the edges."
severity: major

### 12. Release or cancel a note drag
expected: Releasing the pointer ends a note drag, and Escape cancels any active drag so the note no longer follows the cursor
result: issue
reported: "after moving a note, it will stay attached to the cursor and will not let go even when clicking or hitting escape."
severity: major

## Summary

total: 12
passed: 4
issues: 5
pending: 0
skipped: 3
blocked: 0

## Gaps

- gap_id: G-02-1
  truth: "A note title is its own heading-formatted line and can be edited independently from the first line of body content"
  status: failed
  reason: "User reported: titles display the first line written, and when you rewrite the first line it rewrites the title, instead of the title being its own line with header formatting."
  severity: major
  test: 1
  artifacts: []
  missing: []

- gap_id: G-02-4
  truth: "Trackpad panning and zooming use separate two-finger gestures without one gesture triggering the other"
  status: failed
  reason: "User reported: pan and scroll should be separate two finger gestures; pan is moving two fingers, scroll is scrolling in/out on trackpad."
  severity: major
  test: 4
  artifacts: []
  missing: []

- gap_id: G-02-5
  truth: "Connection lines remain anchored to their notes and update while either connected note moves"
  status: failed
  reason: "User reported: connections do not follow a moving note."
  severity: major
  test: 5
  artifacts: []
  missing: []

- gap_id: G-02-11
  truth: "Selecting and dragging a note edge resizes the note while preserving its editable content"
  status: failed
  reason: "User reported: notes can't be resized by selecting the edges."
  severity: major
  test: 11
  artifacts: []
  missing: []

- gap_id: G-02-12
  truth: "Releasing the pointer ends a note drag, and Escape cancels any active drag so the note no longer follows the cursor"
  status: failed
  reason: "User reported: after moving a note, it will stay attached to the cursor and will not let go even when clicking or hitting escape."
  severity: major
  test: 12
  artifacts: []
  missing: []
