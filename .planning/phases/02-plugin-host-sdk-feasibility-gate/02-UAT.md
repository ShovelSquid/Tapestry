---
status: testing
phase: 02-plugin-host-sdk-feasibility-gate
source: [02-VERIFICATION.md]
started: 2026-09-10T01:20:00Z
updated: 2026-09-10T01:20:00Z
---

## Current Test

number: 1
name: ProseMirror editing in Electron app
expected: |
  Note card appears at click position, text is editable, bold/italic/headings apply and render with correct styles
awaiting: user response

## Tests

### 1. ProseMirror editing in Electron app
expected: Note card appears at click position, text is editable, bold/italic/headings apply (Cmd+B/I/1/2/3) and render with correct styles
result: [pending]

### 2. Save/reload persistence
expected: All notes restored with positions, text content, and rich text formatting intact after close and reopen
result: [pending]

### 3. Autosave indicator
expected: Indicator shows Saving... during debounce window, Saved when quiescent. Never falsely shows Saved while text is pending
result: [pending]

### 4. Spatial canvas interaction
expected: Pan, zoom, and drag work fluidly; note appears at its dragged position after reopen
result: [pending]

### 5. Hover controls and connection creation
expected: Controls appear on hover with 300ms hide delay, connection line rendered between notes after drag completes
result: [pending]

### 6. Undo/redo through event history
expected: Undo restores deleted note completely; redo re-applies deletion; .tree file is append-only
result: [pending]

### 7. Missing plugin fallback rendering
expected: FallbackNodeView renders node type header and key-value properties with inline editing
result: [pending]

### 8. Incompatible plugin version rejection
expected: Plugin status shows 'incompatible' with reason about API version mismatch
result: [pending]

### 9. Plugin crash handling
expected: Notification appears, auto-restart attempted once, world still opens
result: [pending]

### 10. Packaged application
expected: Packaged Tapestry.app runs with full functionality including native C++ kernel bridge
result: [pending]

## Summary

total: 10
passed: 0
issues: 0
pending: 10
skipped: 0
blocked: 0

## Gaps
