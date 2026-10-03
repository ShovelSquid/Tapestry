# Desktop Overlay and Guide (KDE Plasma Wayland)

The guide answers "where is X?" by highlighting the real control on screen, not by describing it from memory of a different app version. Proven on Kaelen's machine (Kubuntu 26.04, Plasma/KWin 6.6.6, Wayland, fractional scale 1.7).

## Requirements

- On KDE Wayland the overlay is a layer-shell surface from a helper; Electron cannot make one (spike 021)
- Named controls come from AT-SPI first; on Wayland its positions are window-relative, and the window origin comes from a KWin script matched by pid (spike 021)
- Window state is pushed by a persistent KWin script, never polled; the helper never moves the user between desktops or raises windows on its own (spike 021)
- A layer-shell overlay shows on every virtual desktop, so the guide clears its highlight when the target window is not on the current desktop or is minimised (spike 021)
- Never screenshot a desktop the user is using for automated checks; verify visually with the user, keep only crops around the target (spike 021)
- The guide uses whatever model works best, cloud included, as long as the user can see and control what is sent (explore, 2026-10-02)

## How to Build It

Sources: `sources/021-guide-circle-atspi/` (`guide.py`, `overlay.qml`, `kwin_follow.js`, `kwin_query.py`, `probe_tree.py`, `run.sh`).

1. **Turn on accessibility for the session.** Apps publish their trees only while `org.a11y.Status.IsEnabled` is true. Setting it at runtime wakes apps that are already running:
   ```bash
   gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
     --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled '<true>'
   ```
   The setting lasts until logout. Tell the user it's on.
2. **Find the control and its route** with `gi.repository.Atspi`. Walk the app (`Atspi.get_desktop(0)` → the child whose name matches), match by exact name, then collect ancestor `menu item`s up to the frame. The result is the click path, e.g. `File → Save As…`. Closed menus are already in the tree. Kate: 996 nodes, path found in 100–210 ms.
3. **Match the app to its window by pid.** Use `Atspi.Accessible.get_process_id()`, which equals KWin's `window.pid`.
4. **Get the window origin from KWin.** AT-SPI on Wayland returns *window-relative* extents for both `SCREEN` and `WINDOW` coordinate types; sizes are right, origins are missing.
   - Load a script with `org.kde.kwin.Scripting.loadScript(path, plugin)`. In dbus-python, pass `signature='ss'`, because the method is overloaded.
   - `run()` the returned `/Scripting/Script<N>`.
   - The script reports with `callDBus("org.tapestry.Guide", "/guide", "org.tapestry.Guide", "event", JSON.stringify(...))`.
   - `unloadScript(plugin)` on exit.
5. **Screen position** = `clientGeometry.(x, y)` + the item's window-relative extents.
   - Popup items are relative to their popup. Approximate the popup origin as the parent item's bottom-left (`ox += parent.x; oy += parent.y + parent.h`).
   - Overlay coordinates are KWin logical coordinates, 1:1.
6. **Keep it live with a persistent script** (`kwin_follow.js`).
   - Connect `clientGeometryChanged`, `minimizedChanged`, `desktopsChanged` on each normal window, plus `workspace.windowAdded/Removed/Activated`.
   - On `currentDesktopChanged`, push *every* window, because each one's `onCurrent` may have changed.
   - `onCurrent = w.onAllDesktops || w.desktops.indexOf(workspace.currentDesktop) >= 0`.
7. **Draw with a full-screen layer-shell overlay** (`overlay.qml`):
   ```qml
   import org.kde.layershell 1.0 as LayerShell
   Window {
       color: "transparent"
       flags: Qt.FramelessWindowHint | Qt.WindowTransparentForInput
       LayerShell.Window.layer: LayerShell.Window.LayerOverlay
       LayerShell.Window.anchors: LayerShell.Window.AnchorTop | LayerShell.Window.AnchorBottom
                                  | LayerShell.Window.AnchorLeft | LayerShell.Window.AnchorRight
       LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
       LayerShell.Window.exclusionZone: -1
   }
   ```
   Draw a pulsing green (`#2ecc71`, 4 px) ring with a "N. Label" chip under it. Use a **circle when `w < 1.8·h`, otherwise a pill** (rounded rect, `radius = h/2`) so wide menu items don't get huge circles.
8. **Track the step.** Every 250 ms, the deepest chain node that is `SHOWING` and `VISIBLE` is the step to click now. When the user opens File, the target moves from "1. File" to "2. Save As…" within one tick.
9. **Hide by clearing targets.** When the window isn't on the current desktop or is minimised, set targets to `[]`. The overlay surface itself stays on every desktop.
10. **D-Bus inside Qt:** the GLib-integrated `dbus-python` session bus dispatches inside `QGuiApplication.exec()`, because Qt's Linux loop runs on GLib. No Qt main-loop adaptor is needed. Register each service object once per process.

## What to Avoid

- **KWin's `ScreenShot2`** for anything: it refuses normal callers (`NoAuthorized`).
- **Trusting KWin's window list without desktop filtering.** It covers every virtual desktop. The highlight was drawn over wallpaper while Kate sat on another desktop.
- **Raising or activating windows from the helper.** `workspace.activeWindow = w` plus `raiseWindow` doesn't switch desktops, and it disrupts the user. Announce instead ("Kate is open on Alpha Centauri").
- **Returning early from the redraw when the window is gone.** That left a stale highlight on other desktops. Always clear.
- **Querying KWin once at startup.** The highlight then doesn't follow when the window moves.
- **Sizing a ring to `max(w, h)`**: 295 px across for a 275×29 menu item.
- **Reading the overlay's size right after `show()`**: it reports 500×500 at DPR 2.0 until KWin's configure arrives.
- **Screenshotting the live desktop to check alignment.** It captured the user's other work. Ask the user instead.

## Constraints

- AT-SPI covers Qt, GTK and most KDE apps. Games, Electron and custom-drawn UIs need a vision fallback on a ScreenCast frame (see `screen-capture.md`); that fallback is not built yet.
- **During KWin's desktop-swipe, Overview and minimise animations, the highlight does not move with the window.** Geometry only changes when the animation ends. Fix options: fade the highlight during desktop switches (cheap), or draw it inside KWin as an effect (exact).
- While dragging a window, the highlight follows **one frame behind**. Kaelen: "that's fine".
- `QT_WAYLAND_SHELL_INTEGRATION=layer-shell` is not needed; the QML attached properties are enough (layer-shell-qt 6.6.4, PyQt6 6.10.2).
- Kaelen's verdict: "it's a green circle around the file with a label called file … it displays in front of everything"; "the save as works!!"; "it does hide".

## Origin

Synthesized from spike 021.
Source files: `sources/021-guide-circle-atspi/`.
