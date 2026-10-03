# Edge Tab and Desktop Notes (KDE Plasma Wayland)

A faint green sliver at the bottom middle of the screen peeks out when the cursor nears, becomes "+ new note", and lets the user drag a note anywhere, write, and save it out of sight. Kaelen: "it's fantastic … I LOVE how minimalist it is, the green is nice … almost perfect".

## Requirements

- The new-note tab is a faint green sliver at the bottom middle that peeks out, then becomes a "+ new note" button; minimal and green, as Kaelen loved it (spike 023)
- Notes are dragged out of the tab with Wayland's implicit pointer grab, never a full-screen input grab; placed notes take the keyboard only on click (`OnDemand`) so other apps' typing is never stolen (spike 023)
- The hover strip blocks desktop clicks inside it, so "near" stays small (Kaelen: keep it shy rather than lose right-click on the background); a wider, shorter strip is the candidate for poking out sooner (spike 023)
- A saved note records the window the user was in when it was dropped (spike 023)
- Logs that may hold what the user wrote are gitignored; only counts and positions are committed (spike 023)
- Anchors are the content (file, document, region), not the window or app (explore, 2026-10-02)

## How to Build It

Sources: `sources/023-edge-tab-layershell/` (`edge_tab.py`, `tab.qml`, `ghost.qml`, `note.qml`). The "On:" tag reuses `sources/021-guide-circle-atspi/kwin_query.py` and `kwin_windows.js`.

Three kinds of layer-shell surface (PyQt6 + QML, `org.kde.layershell`):

| Surface | Layer | Anchors | Keyboard | Size |
|---|---|---|---|---|
| Tab (and its hover strip) | `LayerTop` | `AnchorBottom` only, so it's centred | `None` | 260×70; the whole surface is the hover strip |
| Drag ghost | `LayerOverlay`, `WindowTransparentForInput` | all four (full screen) | `None` | — |
| Placed note | `LayerTop` | `AnchorTop \| AnchorLeft` + `margins.left/top` = drop point | **`OnDemand`** | 240×150 |

1. **Tab states** (animate width, height, bottom margin and colour, 140 ms `OutCubic`):
   - idle: 56×6 sliver, `#882ecc71`, 2 px from the edge
   - near (cursor in the strip): 90×18 with "+", `#cc2ecc71`
   - over the tab: 150×40 "+ new note", `#2ecc71`
   - dragging: "drop anywhere"
2. **Drag out:** on press inside the tab, start the drag. While the button is held, Wayland's implicit grab keeps sending `positionChanged` to the tab surface with coordinates **outside its bounds**. Global position = tab origin `((screen_w − 260)/2, screen_h − 70)` + local position. Draw the ghost note there on the full-screen overlay.
3. **Drop:** released within 60 px of the tab = cancel. Otherwise:
   - ask KWin for the active window (the tab never takes focus, so it's still the app the user was in)
   - clamp the note to the screen
   - create a note surface at the drop point with "On: <window title>"
   - focus its `TextArea`
4. **Save / Discard:** close the surface. Save appends `{id, text, at, on: {caption, resourceClass, pid, client}, created, open_s}` to the notes store.
5. **Logging:** append one JSON line per event as it happens (`strip.hover`, `drag.start/end`, `note.placed/saved/discarded`), and quit cleanly on SIGINT/SIGTERM/SIGHUP. A session killed through an exit handler lost its log once.

## What to Avoid

- **A full-screen input grab for dragging.** It's unnecessary (the implicit grab works) and would block the desktop.
- **Keyboard `Exclusive` or `OnDemand` on the tab.** The tab must never take focus, or "On:" would name Tapestry instead of the user's app.
- **A bigger hover strip to make the tab less shy.** On Wayland a surface either takes the pointer or passes it through, so a bigger strip blocks more of the desktop. Kaelen: "when it does get to hovering position, I can't right click on the background, which might be a reason to keep it shy."
- **Committing the notes store or session logs**: they hold what the user wrote.

## Constraints

- **No global cursor position on Wayland.** "Near" can only mean "inside a surface that takes input".
- The taskbar didn't interfere on Kaelen's setup (no apps pinned).
- **The tab stays out after a drop.** `overTab` is only recalculated on motion inside the surface, so the cursor leaving during the drag is missed. Kaelen liked this ("actually kinda cool … maybe if the new note turned into a setting or something and stayed out?"). Candidate design: after a drop, the tab stays out as a second button that opens the chronological list of desktop notes, until dismissed. Undecided.
- Candidate for poking out sooner without blocking the desktop: a wider, shorter strip (e.g. 360×28 flush with the bottom edge). Not built.
- Electron can't make the tab on KDE Wayland: no layer-shell, and `setAlwaysOnTop` is unsupported on Wayland per the Electron docs (not re-checked). Note *content* could later be an Electron or web view inside a helper-owned surface.

## Origin

Synthesized from spike 023.
Source files: `sources/023-edge-tab-layershell/`.
