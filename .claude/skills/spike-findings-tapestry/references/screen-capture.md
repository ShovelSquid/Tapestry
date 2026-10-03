# Screen Capture (KDE Plasma Wayland)

Two consumers: **picture anchors** (a note pinned to a region captures it once) and **the guide** (looks at the screen often, e.g. for a vision fallback when an app has no accessibility tree).

## Requirements

- Anchors are the content (file, document, region), not the window or app; the fallback anchor is a picture plus an AI-written summary (explore, 2026-10-02)
- Picture anchors capture through the Screenshot portal (no dialog, ~1–1.4 s) and delete the file it writes into `~/Pictures` (spike 022)
- The guide sees the screen through the ScreenCast portal with `persist_mode=2`: one consent, then silent restores; it caches the newest PipeWire frame, because frames only arrive on screen damage (spike 022)
- After restoring a ScreenCast session, check the stream covers the whole screen and ask again if not; the token restores exactly what was picked, a region included (spike 022)
- Crop with `physical = round(logical × image_width / logical_width)`; the effective scale (1.6991) is not the configured one (1.7) (spike 022)

## How to Build It

Sources: `sources/022-region-capture-portal/` (`portal_shot.py`, `screencast.py`, `crop_check.py`, `pattern.qml`).

### One-off capture (picture anchors): Screenshot portal

1. Call `org.freedesktop.portal.Screenshot.Screenshot('', {'handle_token': token, 'interactive': False})` on `org.freedesktop.portal.Desktop` at `/org/freedesktop/portal/desktop` (version 2 here).
2. Subscribe *before* calling to `org.freedesktop.portal.Request.Response` at `/org/freedesktop/portal/desktop/request/<sender with . → _, no leading :>/<token>`.
3. `code 0` → `results['uri']` is a `file://` PNG of the whole screen in physical pixels (2880×1800).
4. **Move or delete that file at once.** The portal saves it into `~/Pictures`.
5. Crop the anchor region from logical coordinates: `s = image.width / logical_screen_width`, `box = round(x·s), round(y·s), round((x+w)·s), round((y+h)·s)`. Accurate to ≤ 1 physical px.

### Live capture (the guide): ScreenCast portal + PipeWire

1. `CreateSession` → `SelectSources(session, {'types': 1 (monitor), 'multiple': False, 'cursor_mode': 1, 'persist_mode': 2, 'restore_token': <saved>})` → `Start(session, '', {})`. Each is request/response, like above.
2. Save `results['restore_token']` from every `Start`. It's refreshed each time. Keep it out of git.
3. `OpenPipeWireRemote(session, {})` returns an fd. Then:
   ```python
   pipe = Gst.parse_launch(f'pipewiresrc fd={fd} path={node} do-timestamp=true keepalive-time=1000 ! '
                           'videoconvert ! video/x-raw,format=RGB ! appsink name=sink max-buffers=1 drop=true sync=false')
   ```
4. **Cache the newest sample** from the `new-sample` signal (`emit-signals=True`). A grab reads the cache.
5. **Validate the stream size** against the screen. If KDE's chooser was used to pick a region or a virtual screen, the token silently restores that every time.
6. Close the session (`org.freedesktop.portal.Session.Close`) when done. A screen-sharing indicator shows while it runs.

## What to Avoid

- **KWin `ScreenShot2`**: `NoAuthorized` for normal callers. It works only for apps whose installed `.desktop` file declares `X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2`.
- **Pulling a fresh frame on demand** (`try-pull-sample`): on a still screen it waits for the next change, 766–826 ms.
- **Using the configured scale (1.7) for cropping**: the effective scale is 2880/1695 = 1.6991.
- **Relative output paths in capture scripts**: one run wrote into the repo root, and the cleanup deleted the restore token.
- **Keeping or viewing captures of the user's screen** in tests. Check crops with the helper's own test card (`pattern.qml`: four solid quadrants, 2 px white border).

## Constraints

| Path | First use | Later | Per capture |
|---|---|---|---|
| Screenshot portal (`interactive=false`) | 4.6 s, no dialog Kaelen recalls | no dialog | 0.98–1.43 s |
| ScreenCast + restore token | KDE chooser: screen / virtual screen / region, "Allow restoring on future sessions" | silent `Start` in 8–9 ms; first frame ~35–60 ms | cached grab 0.1 ms (1.5–1.8 ms first); newest frame ≤ 220 ms old while idle, ~11 frames/s on a still screen |

- Everything is already installed: PyGObject, GStreamer `pipewiresrc`, `dbus-python`, Pillow. KDE's portal backend lists `Screenshot`, `ScreenCast`, `GlobalShortcuts`, `InputCapture`.
- Electron's `desktopCapturer` / `getDisplayMedia` should use the same ScreenCast portal through Chromium's PipeWire capturer. **Untested**, including whether it keeps restore tokens.

## Origin

Synthesized from spike 022.
Source files: `sources/022-region-capture-portal/`.
