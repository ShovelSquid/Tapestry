---
created: 2026-10-02T00:00:00.000Z
title: "New milestone: reframe around core desktop layer and .tree worlds"
area: planning
severity: major
priority: high
files:
  - .planning/PROJECT.md
  - .planning/ROADMAP.md
  - .planning/notes/desktop-layer-vision.md
  - .planning/research/questions.md
---

## Problem

On 2026-10-02 Kaelen reframed Tapestry. The core becomes a desktop-layer file manager and notes app: edge tabs, desktop notes anchored to things on screen, a spatial 2D/3D filesystem view, and an AI guide that points at the real screen. `.tree` files become a special world file type that holds data drawing, rendering and character creation. `PROJECT.md` and `ROADMAP.md` still describe the `.tree` journal as the one source of truth for the whole app.

## Solution

After the KDE desktop-layer spike reports, run `/gsd-new-milestone` with `.planning/notes/desktop-layer-vision.md` as input:

- Rewrite the project description and core value around two layers: the core layer, where the user's files are the truth, and `.tree` worlds.
- Make the remaining Phase 2.2 plans (folder groups, watcher, write-back, moves) the first core phase, widened from an Obsidian vault to any folder.
- Fold in `2026-09-24-trees-as-folders-notes-anywhere-drag-in-and-out.md`.
- Add phases for the edge tabs and desktop notes, and for the guide.
- Move Phases 3, 5 and 6–7 and the data-drawing and NPC-mind spikes under worlds, or re-scope them.
- Settle the open questions in `.planning/research/questions.md` during discuss steps.
