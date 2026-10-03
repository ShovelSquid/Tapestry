---
spike: 024
idea: desktop-layer
name: active-window-feed
type: standard
validates: "Given any window gains focus on KDE Wayland, when it changes, then a KWin script pushes title, app id, pid and geometry to the helper within ~100 ms, and the helper can tell which file or folder the window is showing"
verdict: PARTIAL
related: [021, 022, 023]
tags: [kde, wayland, kwin-script, focus, document-identity, at-spi, kactivities, anchors]
---

# Spike 024: Active-window feed and document identity

## What This Validates

1. **Feed:** every focus or title change reaches the helper fast (target ≤ 100 ms).
2. **Document identity:** for the focused window, the helper can name the file or folder it shows, so a note can anchor to *the content* (the explore decision), with a picture plus summary as the fallback.

## Research

KDE Wayland has **no API that maps a window to a document**. Candidates:

| Source | How | Expected strength |
|---|---|---|
| Window title | Parse a file-like name before ` — App` | Many apps put the file name in the title; no directory |
| Open files | `/proc/<pid>/fd` readlinks, filtered to user paths; Kate swap files map back to the document | Exact when the app holds the file open; most apps read and close |
| KDE activity database | `~/.local/share/kactivitymanagerd/resources/database`, `ResourceEvent` by `initiatingAgent` = KWin `resourceClass` | Records which app opened which resource, and when |
| Recent files | `~/.local/share/recently-used.xbel`, newest entry registered by the app | Full path for files opened through KDE dialogs and Dolphin |
| Accessibility tree | AT-SPI (spike 021) | Whatever the app exposes |

## How to Run

```bash
python3 .planning/spikes/024-active-window-feed/feed.py --seconds 120   # then click between windows
```

## What to Expect

One `focus` line per focus or title change: app, title, latency, each guess, and a verdict (`agreed`, `fd-only`, `kactivities-folder`, `title-only`, `none`). Logs stream to `results/feed-<time>.jsonl`, which is **gitignored because it holds window titles and file paths**. Summaries are below.

## Observability

`feed.py` appends every event as it happens (survives being killed). The KWin script stamps each event with KWin's own `Date.now()`, so latency = receive time − KWin time on the same clock.

## Investigation Trail

1. **Feed latency: 0.8–0.9 ms median, 3.1 ms max** over 25 events in two sessions (focus changes plus title changes of the active window). Resolving all four guesses takes 1.2–3.1 ms. The ~100 ms target is beaten by two orders of magnitude.
2. **Title-parse pitfall:** "Unity 6.4" parsed as a file with extension "4". Extensions must now start with a letter.
3. **Session 1 (Kaelen in Unity, switching to Konsole):** no document guesses. Unity's title has no file name, and Unity holds 24–33 files open under `~` (project and editor files). A *project folder* could likely be inferred from those (common ancestor), but this wasn't built.
4. **Session 2 (Kaelen clicked through Dolphin, Gwenview, Firefox):**

   | App | Shown | Result |
   |---|---|---|
   | Gwenview | an image in `~/Downloads` | ✓ **agreed**: the title's file name matched the newest recent-files entry, giving the full path |
   | Dolphin | lib → Pictures → Videos → Music → Downloads | ✗ the activity database is **one folder behind**, and stays stale (it seems to record a folder when you leave it) |
   | Firefox | a web page | none: only profile files are open; needs a browser extension (web pages are out of v1) |
   | Konsole | terminal | none (expected) |

5. **Dolphin through AT-SPI (follow-up):** in Dolphin's accessibility tree, the location bar's **"Go to Location on Path" button carries the exact current path in its description** (`Go to any location on the path '<tt>/tmp/…/crumb/deep/er</tt>'`), and each path segment is its own button. It is exact and current. Tree walk: 469 nodes, 281 ms.
6. **Kate (from spike 021's probe):** Kate doesn't keep the document open, but holds `.<name>.kate-swp` next to it, which gives the exact path (the `fd` guess undoes the swap name).

## Results

**Verdict: PARTIAL.** The feed is solved; document identity has **no single source**, but a per-app layered resolver covers the main KDE cases:

- ✓ **Feed:** a persistent KWin script pushes focus and title changes in under 1 ms (median).
- ✓ **Images and documents opened from Dolphin** (Gwenview, likely Okular): window title plus recent files agree on the full path.
- ✓ **Dolphin:** the AT-SPI location button description gives the exact current folder. **Don't use the activity database for "current"**, because it lags one step.
- ✓ **Kate:** its swap file in `/proc/<pid>/fd`.
- ✗ **Browsers:** need an extension (out of v1). ✗ **Unity, Blender, Electron apps:** no file in the title; a project folder from open files is a guess. These fall back to the **picture plus summary** anchor (spike 022), as planned in the explore session.

**Resolver order for the build:** app-specific AT-SPI fields → title matched against recent files → open files (incl. swap files) → title only → picture plus summary.

**Electron alone:** no access to KWin focus events or other processes' windows on Wayland. It can read `/proc` and the databases from its main process, but the feed needs the KWin script.
