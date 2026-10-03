---
spike: 022
idea: desktop-layer
name: region-capture-portal
type: comparison
validates: "Given another app's window on KDE Wayland, when Tapestry captures through the desktop portal, then it gets an image without a dialog every time, fast enough for its use, and crops a region accurately from logical coordinates at fractional scale"
verdict: VALIDATED
related: [021]
tags: [kde, wayland, portal, screenshot, screencast, pipewire, gstreamer, capture]
---

# Spike 022: Region capture via the portal

## What This Validates

Given another app's window, when Tapestry asks the desktop portal for pixels, then:
1. no permission dialog appears on every capture;
2. capture is fast enough for its use: a note's picture anchor (once) or the guide looking at the screen (often);
3. cropping by logical (KWin / overlay) coordinates hits the right physical pixels at 1.7× fractional scale.

## Research

| Approach | Interface | Pros | Cons | Status |
|---|---|---|---|---|
| KWin ScreenShot2 | `org.kde.KWin.ScreenShot2` | Fast, per-window capture | Refused for normal callers (`NoAuthorized`) unless the installed `.desktop` declares `X-KDE-DBUS-Restricted-Interfaces` | Rejected (spike 021 research) |
| Screenshot portal | `org.freedesktop.portal.Screenshot` v2, `interactive=false` | One call, no dialog observed, full screen PNG | ~1–1.4 s per shot; **writes the PNG into `~/Pictures`** | **Use for one-off picture anchors** |
| ScreenCast portal + PipeWire | `org.freedesktop.portal.ScreenCast` v5, `persist_mode=2` + `restore_token`, GStreamer `pipewiresrc` → `appsink` | After one consent: silent start in ~8 ms, frames in memory, 0.1 ms grabs | Chooser dialog once; the token restores whatever was picked (a region, if one was chosen); a screen-sharing indicator shows while running | **Use for the guide** |

Everything used is already installed (PyGObject, GStreamer `pipewiresrc`, `dbus-python`), so nothing is compiled.

## How to Run

```bash
cd .planning/spikes/022-region-capture-portal
python3 portal_shot.py --count 5          # quiet screenshots, timing; deletes each image
python3 crop_check.py 300 200             # test card at logical (300,200) -> capture -> crop -> check colours
python3 screencast.py --grabs 15          # first run shows KDE's chooser; later runs restore silently
```

## What to Expect

- `portal_shot.py`: `code 0`, ~1–1.4 s per shot, 2880×1800, with no dialog after the first call.
- `crop_check.py`: all four colours exact, left edge within 1 physical pixel, a 340×170 crop of the test card only.
- `screencast.py`: the first run shows a chooser (Laptop screen / virtual screen / a region, plus "Allow restoring on future sessions"). Later runs: `start` ~8 ms, `grabs` median ~0.1 ms.

## Observability

Each script logs timestamped events to stdout and to `results/*.json` (`portal-quiet.json`, `crop-*.json`, `screencast-first.json`, `screencast-restore.json`). Screen images are never kept: shots are deleted after measuring, and only crops of the spike's own test card are saved.

## Investigation Trail

1. **Screenshot portal, quiet mode.** The first call took 4,635 ms; Kaelen doesn't recall a dialog. The next six took 980–1,425 ms, all `code 0`, full 2880×1800 physical. **The portal saves each shot as a file in `~/Pictures`.** The spike deletes it immediately, but a real anchor feature must clean up too, or it fills the user's Pictures folder.
2. **Crop accuracy.** A layer-shell test card (4 solid quadrants, 2 px white border) was placed at logical (300, 200) and (1201, 733). Scale = 2880 / 1695 = 1.6991, slightly below the nominal 1.7, so **derive scale from image width / logical width**, not from the configured scale. All quadrant colours were exact, and the left edge landed at 510 / 2042 physical pixels against 510 / 2041 expected (≤ 1 px).
3. **ScreenCast, first comparison.** The chooser shows once (3.4 s including Kaelen's click). With the restore token, `Start` returned in 8 ms with no dialog (Kaelen: "second run, it starts silently"). First frame in ~60 ms.
4. **Pitfall: pulling a fresh sample on demand stalls up to ~0.8 s.** PipeWire only sends a frame when the screen is damaged, so `try-pull-sample` on a still screen waits for the next change (outliers of 766–826 ms). **Fix: cache the newest sample from `new-sample` and read the cache.** Grabs then take 0.09–0.3 ms (1.5–1.8 ms the first time), the newest frame is ≤ 220 ms old on a mostly still screen, and frames arrive at ~11/s while idle.
5. **Pitfall: the token restores exactly what was chosen.** The restored stream was 1265×651, not the full screen: a *region* was evidently picked in KDE's chooser (it offers screen, virtual screen and region). Tapestry must compare the stream size with the screen size and ask again if they differ, or the guide silently sees only part of the screen.
6. Housekeeping mistake: the first ScreenCast runs used relative paths and wrote into the repo root; the cleanup deleted that run's restore token, so the chooser was needed once more. `screencast.py` now `chdir`s to its own folder.

## Results

**Verdict: VALIDATED**, with a clear split:

- **Picture anchors (once per note):** the Screenshot portal, no dialog, ~1–1.4 s, accurate cropping from logical coordinates. Delete the file it drops in `~/Pictures`.
- **The guide (looks often):** the ScreenCast portal with `persist_mode=2`. One consent, then silent 8 ms starts across runs. Keep the newest frame cached; a grab is ~0.1 ms. Check the stream covers the whole screen.
- **Crop maths:** `physical = round(logical × image_width / logical_width)`, accurate to ≤ 1 px at 1.7×.

**Electron alone:** Chromium has a PipeWire capturer for Wayland behind `desktopCapturer` / `getDisplayMedia`, which should go through the same ScreenCast portal. **Not tested here**; whether it supports restore tokens (silent restarts) is unverified. The helper route above is proven.
