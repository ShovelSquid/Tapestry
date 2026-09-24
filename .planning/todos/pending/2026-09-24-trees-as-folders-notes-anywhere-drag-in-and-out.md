---
created: 2026-09-24T16:42:39.988Z
title: "Trees as folders: notes anywhere, drag in and out"
area: ui
severity: major
files:
  - app/src/renderer/components/Canvas.tsx:299-337
  - app/src/renderer/components/TreeFrame.tsx
  - app/src/main/trees/registry.ts
  - app/src/main/commands/notes.ts
---

## Problem

Kaelen (2026-09-24) first asked for "tapestry worlds need to be resizeable", then refined it: "we need to be able to make notes anywhere in this space, these just need to be folders, and we should be able to drag notes in/out of these spaces."

So the request has three parts:

1. **Notes anywhere in the space.** Today every note belongs to a tree, and a new note can only be made inside a tree's frame.
2. **Trees behave like folders.** Each frame is a region you can resize. Today a frame's rect is recomputed every render from its content bounds (`computeFrameBounds` in `Canvas.tsx`), so there is no user-set size.
3. **Drag notes into and out of trees.** A note dropped into or out of a frame changes which tree it belongs to.

Severity `major` is assumed: Kaelen replaced the question with the reframed request instead of choosing a severity.

## Solution

TBD — this is phase-sized, not a quick task, and it overlaps planned work.

- **Phase 2.6 (Placement Edges & Forest Tree, branch `ws/spatial-canvas`, planning only so far) already covers the foundation.** It plans one always-open Tapestry tree for the whole space, which is the natural home for notes outside any folder. It also plans each frame as a `placement` edge carrying `origin.*` and `size.*`, which is where a resizable frame's size would live. Feed this todo into 2.6's planning, or into a phase right after it.
- **The hard part is moving a note between trees.** Each tree is its own `.tree` file with its own history. A cross-tree move is a delete in one file plus a create in the other, and it needs a decision on how provenance and history follow the note: does the note keep its id, is there a "moved from" record, and do edges to it survive the move? This needs a discuss step with Kaelen, and it touches the readability and history constraints in CLAUDE.md.
- **Locks.** An agent moving a note between trees would need `lock.layout`, and probably a new check on the destination tree.
- Resizing a frame without moving notes between trees could ship first as a smaller slice once 2.6's `size.*` exists.
