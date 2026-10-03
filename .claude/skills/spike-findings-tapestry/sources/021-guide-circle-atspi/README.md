---
spike: 021
idea: desktop-layer
name: guide-circle-atspi
type: standard
validates: "Given a real Qt app is open on the current desktop, when the guide is asked for a control by name, then AT-SPI finds it and its path, KWin supplies the window origin, and a green highlight is drawn over it in a layer-shell overlay, following the user step by step"
verdict: VALIDATED
related: [022, 023, 024]
tags: [kde, wayland, at-spi, accessibility, layer-shell, kwin-script, overlay, guide]
---

# Spike 021: Guide circle via AT-SPI

## What This Validates

Given a real Qt app (Kate) is open on the current desktop, when the guide is asked for "Save As…", then:
1. AT-SPI finds the control *and the menu path to it* (File → Save As…), even while the menu is closed;
2. a KWin script supplies the window's screen origin (Wayland apps don't know it);
3. a layer-shell overlay draws a pulsing green highlight over the step to click now, moving to the next step when the menu opens.

## Research

| Approach | Tool | Pros | Cons | Status |
|---|---|---|---|---|
| Accessibility tree | AT-SPI over `gi.repository.Atspi` | Named controls, roles, full menu structure including closed menus, no vision model needed | Only apps that implement accessibility (Qt, GTK, most KDE). Off by default. Positions are window-relative on Wayland | **Chosen** |
| Vision grounding | Screenshot + vision model | Works for any app (games, Electron, custom-drawn UI) | Needs capture (spike 022), slower, can mis-locate | Fallback, not built here |
| KWin ScreenShot2 + OCR | KWin D-Bus | — | Refused for normal callers (`NoAuthorized`) | Rejected |

Overlay: `org.kde.layershell` QML module (layer-shell-qt 6.6.4) from PyQt6 6.10.2, so nothing needs compiling. Window origin: a KWin script loaded through `org.kde.kwin.Scripting.loadScript(path, name)` (the overload needs the explicit D-Bus `signature='ss'`), reporting back with `callDBus` to a tiny Python D-Bus service.

## How to Run

```bash
# Open Kate on the desktop you're looking at, then:
.planning/spikes/021-guide-circle-atspi/run.sh kate "Save As…" 30
# Click File yourself: the highlight should move from "1. File" to "2. Save As…".
```

`run.sh` turns on the session accessibility flag (`org.a11y.Status.IsEnabled`), which stays on afterwards (see Results).

## What to Expect

- A green pill around **File** in Kate's menu bar, labelled "1. File", pulsing.
- When you open the File menu, the pill moves to **Save As…**, labelled "2. Save As…".
- Clicks pass through the overlay to Kate.
- If Kate is on another virtual desktop, the guide prints `guide.notice … open on another desktop` and draws nothing.

## Observability

`guide.py` logs every event (`atspi.path`, `kwin.window`, `guide.notice`, `overlay.shown`, `overlay.target`) with ISO timestamps to stdout and to `results/run*.json` on exit.

## Investigation Trail

1. **Accessibility is off for the session** (`org.a11y.Status.IsEnabled = false`). With it off, a freshly started Kate is invisible to AT-SPI.
2. **Turning it on at runtime works for running apps.** Konsole, KWin, plasmashell and the portals joined the tree straight away, with no restart.
3. **Kate's tree: 996 nodes, read in ~0.57 s cold.** The path lookup (File → Save As…) takes 100–210 ms. It exposes the **whole menu structure, including closed submenus**, with roles and names, so the guide knows the route before anything is open.
4. **On Wayland, AT-SPI "screen" coordinates equal window coordinates.** The frame reports (0, 0, 640, 480). The size is right (it matches KWin's client geometry exactly), but there is no screen origin. Top-level menu items are window-relative (File at 0,0 41×30). Popup menu items are relative to their popup surface (Save As… at 4,217).
5. **A KWin script supplies the missing origin.** `clientGeometry` for Kate was (1096, 246, 640, 480), reported in 11–19 ms. App and window are matched by **pid** (`Atspi.Accessible.get_process_id()` = KWin `window.pid`). Screen position = client origin + window-relative extents. A popup's origin is approximated as the parent item's bottom-left corner.
6. **The overlay is full-screen and above everything** (screenshot run 2). It reported 500×500 at DPR 2.0 when first shown, before KWin's configure arrived, then covered the whole 1695×1059 logical screen at fractional scale 1.7. Logical KWin coordinates map 1:1 to overlay coordinates. `QT_WAYLAND_SHELL_INTEGRATION=layer-shell` was not needed; the QML attached properties were enough.
7. **Step tracking works.** Opening File via AT-SPI's `ShowMenu` action moved the target from "1. File" (1096, 246) to "2. Save As…" (1100, 493) within one 250 ms tick, and back when the menu closed.
8. **Pitfall: KWin's window list covers every virtual desktop.** Kate was on "Alpha Centauri" while Kaelen was on "Desktop 5", so the highlight was drawn over wallpaper. `workspace.activeWindow = w` plus `raiseWindow` did not switch desktops. The guide now filters to `onAllDesktops || desktops ∋ currentDesktop` and announces when the app is elsewhere. Stacking order (`workspace.stackingOrder`) is now reported too, for occlusion checks later.
9. **Pitfall: a circle sized to `max(w, h)` is huge for menu items** (295 px across for Save As…). Wide targets now get a pill-shaped rounded rectangle; only square-ish targets get a circle.
10. **Following the window (Kaelen's check 1: "it does not follow the window when I move it").** The first version asked KWin for the position once. Replaced by a **persistent KWin script** (`kwin_follow.js`) that connects `clientGeometryChanged`, `minimizedChanged`, `desktopsChanged`, `windowActivated`, `windowAdded/Removed` and `currentDesktopChanged`, and pushes JSON to `org.tapestry.Guide /guide` over `callDBus`. Qt's Linux event loop runs on GLib, so the GLib-integrated `dbus-python` session bus dispatches inside `QGuiApplication.exec()` with no Qt main-loop adaptor. Kaelen: it follows, "a frame behind while dragging but that's fine".
11. **Hiding on other desktops (check 2: "it still stays present").** A layer-shell surface belongs to the output, not a virtual desktop, so it shows on every desktop. The bug was `tick()` returning early without clearing targets when the window left. Now it clears them, and a desktop switch pushes every window's new `onCurrent`. Kaelen: "it does hide".
12. **Limitation: mid-swipe, the highlight doesn't move with the sliding desktop.** KWin animates the desktop slide (and Overview, minimise) inside the compositor. Window geometry only changes when the animation ends, so an external overlay can't follow. Options: fade the highlight during desktop switches (cheap), or draw it inside KWin as an effect (exact, more work).
13. **Never screenshot a desktop the user is using.** Runs 2–4 captured Kaelen's live desktop (another desktop, System Settings). Only crops around the target are kept as evidence. Automated visual checks need a dedicated desktop or the user's eyes, hence the checkpoint.

## Results

**Verdict: VALIDATED** (Kaelen, 2026-10-02: "it's a green circle around the file with a label called file … it displays in front of everything"; "the save as works!!"; "it does hide").

Confirmed by Kaelen on screen:
- The highlight lands exactly on Kate's **File** menu, above every window, with clicks passing through.
- Opening File moves it to **Save As…** (a pill shape for the wide item).
- It follows the window while dragging (one frame behind, acceptable) and hides when the window is on another desktop.

Not solved: following the window *during* KWin's desktop-swipe animation (item 12).

Confirmed by logs:
- AT-SPI finds named controls and their menu path in a real KDE app, with closed menus included.
- KWin supplies the window origin by pid, and the combined coordinates matched Kate's real menu-bar position in screenshot run 2.
- A layer-shell overlay from PyQt6/QML is full-screen, above all windows, input-transparent, and needs no compiling.

**Electron alone:** cannot do this on KDE Wayland. It has no layer-shell surface (`setAlwaysOnTop` is unsupported on Wayland per the Electron docs, which wasn't re-checked here), no window origins and no AT-SPI client. Electron can host the guide's logic and talk to a helper. The overlay and KWin script must live in a helper.

**Side effects to know about:** the session accessibility flag is now **on** (`IsEnabled = true`) and stays on until logout or until it's turned off with `gdbus … Set org.a11y.Status IsEnabled '<false>'`. A test Kate window is open on "Alpha Centauri".
