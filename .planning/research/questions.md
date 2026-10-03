# Open Research Questions

## From /gsd-explore: desktop layer vision (2026-10-02)

Context: `.planning/notes/desktop-layer-vision.md`. These are the file-manager decisions the exploration did not reach.

1. **AI file reorganization: propose or act, and how to undo.** If the AI moves or renames many real files, does it propose a layout first for the user to approve, or act and leave a readable log the user can undo? File operations likely need their own readable history, separate from `.tree` history. How does the lock model (`lock.layout` and the other lock aspects) carry over to real files?
2. **Where the core's own data lives.** Spatial positions, AI-suggested connections and desktop-note anchors need a home outside the user's files. Small readable sidecar files next to folders, one central Tapestry index, or both (readable sidecars as the truth, plus a rebuildable index)? The readability constraint points toward sidecars.
3. **How `.tree` worlds open from the file view.** Is a `.tree` a file you open into a full world view, a frame inside the spatial file view, or both? Which existing features (kernel, Phase 3 branching, data drawing, NPC minds) belong to worlds only?
4. **Element finding for the guide.** On KDE, how much of real apps' menus can AT-SPI see with names and screen positions, compared with vision-model grounding on screenshots? (Covered by the KDE desktop-layer spike.)
