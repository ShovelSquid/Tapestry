---
spike: 023
idea: desktop-layer
name: edge-tab-layershell
type: standard
validates: "Given the helper is running on KDE Wayland, when the cursor nears the bottom-middle edge, then a tab peeks out, becomes a button on hover, and a note can be dragged out anywhere, written in and saved out of sight, without stealing typing or clicks from other apps"
verdict: VALIDATED
related: [021, 022]
tags: [kde, wayland, layer-shell, edge-tab, desktop-notes, drag, feel]
---

# Spike 023: Edge tab via layer-shell (feel)

## What This Validates

Given the helper runs on KDE Plasma 6.6 Wayland, when the cursor nears the bottom middle of the screen, then:
1. a faint green sliver peeks out, and becomes a "+ new note" button on hover;
2. pressing and dragging pulls a note out that follows the cursor anywhere on screen;
3. dropping places a note there, tagged with the window the user was in, that takes typing only when clicked;
4. Save makes it disappear and stores it; Discard throws it away.

## Research

- **Surfaces:** three layer-shell surfaces from PyQt6/QML (`org.kde.layershell`, as in spike 021). The **tab** is `LayerTop`, anchored bottom only (centred), 260×70, keyboard `None`. The **drag ghost** is a full-screen `LayerOverlay`, input-transparent. Each **note** is `LayerTop`, anchored top-left with margins at the drop point, keyboard `OnDemand`.
- **Dragging out of a small surface:** on Wayland, a pressed button gives the surface an implicit pointer grab, so motion keeps arriving at the tab with coordinates outside its bounds. No full-screen input grab is needed. Global position = tab origin ((screen_w − 260)/2, screen_h − 70) + local position.
- **No global cursor on Wayland:** a client can't see the pointer outside its own surfaces. "Near" can only mean "inside an invisible strip that takes input", which is the trade-off Kaelen found (Results).
- **"On:" tag:** the active window at drop time comes from spike 021's `kwin_windows.js` / `kwin_query.py`. The tab never takes focus, so the active window is still the app the user was in.

## How to Run

```bash
python3 .planning/spikes/023-edge-tab-layershell/edge_tab.py      # 10 minutes; Ctrl+C to stop
```

## What to Expect

Sliver → peek ("+") when the cursor enters the strip → "+ new note" over the tab → press and drag: a pale note follows ("drop anywhere") → release: a note at the drop point showing "On: <window>" → type → Save (it vanishes and goes to `results/notes.jsonl`) or Discard. Dropping back on the tab cancels.

## Observability

Every interaction (`strip.hover`, `drag.start`, `drag.end` with move count, duration and whether it left the tab, `note.placed`, `note.saved` / `note.discarded`) is appended with an ISO timestamp to `results/session-<time>.jsonl` **as it happens**. Saved notes go to `results/notes.jsonl`, which is **gitignored because it holds what the user wrote**.

## Investigation Trail

1. The first smoke run loaded cleanly: logical screen 1694×1059, tab origin (717, 989).
2. **Kaelen's session:** two notes saved, at (313, 317) and (1139, 383), open 8.8 s and 13.1 s, both tagged `org.kde.konsole`, the window in use. Placed notes 3–5 were left open when the session ended.
3. **Pitfall: the session log was lost.** The process was stopped in a way that skipped the exit handler (closed terminal or signal). The log is now appended per event, and SIGTERM/SIGHUP quit cleanly.
4. **Trade-off: hover strip vs desktop clicks.** In Kaelen's words: "when it does get to hovering position, I can't right click on the background, which might be a reason to keep it shy. If it didn't then, I wouldn't mind having it poke out a little sooner." On Wayland, a surface either takes the pointer or passes it through, so a bigger "near" zone always blocks more of the desktop. Candidate: a **wider, shorter strip** (e.g. 360×28 flush with the bottom edge) that catches a sweep along the edge sooner while covering less desktop. Not built yet.
5. **State bug that Kaelen liked:** after a drop, the tab stays in its button state ("I can move my cursor around and click on other things, which is actually kinda cool; maybe if the new note turned into a setting or something and stayed out?"). Cause: `overTab` is only recalculated on motion inside the surface, so the cursor leaving during the drag is missed. Candidate design: **after a drop, the tab stays out as a second button that opens the chronological list of desktop notes** (from the explore session), until dismissed.

## Results

**Verdict: VALIDATED** (Kaelen, 2026-10-02: "it's fantastic … it feels really really good, I LOVE how minimalist it is, the green is nice … almost perfect").

Confirmed by Kaelen:
- The peek, button and drag feel right; "the drag feels super attached to the cursor".
- Typing into a note "works like a charm" and doesn't conflict with other apps' typing (keyboard `OnDemand`).
- The taskbar doesn't interfere (no apps pinned there at the time).
- Slightly too shy, limited by the right-click trade-off above.

Confirmed by logs: drop position, window attribution and saved text land in `notes.jsonl`.

**Electron alone:** can't make the tab on KDE Wayland. It has no layer-shell, no bottom-centre anchoring above other windows, and `setAlwaysOnTop` is unsupported there per the Electron docs (not re-checked). Note *content* could be an Electron or web view inside a helper-owned surface later; this spike used QML text editing.
