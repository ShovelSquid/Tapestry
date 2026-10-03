# Window Feed and Document Identity (KDE Plasma Wayland)

Desktop notes anchor to *the content* a window shows. The helper must know which window is focused (fast) and, where possible, which file or folder it shows.

## Requirements

- Focus and title changes come from a persistent KWin script stamped with KWin's clock (<1 ms median to the helper); never poll (spike 024)
- Which file a window shows is resolved per app, in order: app-specific AT-SPI fields (Dolphin's location button) → title matched against recent files → open files incl. editor swap files → title only → picture plus summary (spike 024)
- KDE's activity database is never used for an app's *current* document or folder: it lags one step behind (spike 024)
- Window titles and file paths from the feed are gitignored like note text; READMEs carry summaries (spike 024)
- Anchors are the content (file, document, region), not the window or app; the fallback anchor is a picture plus an AI-written summary (explore, 2026-10-02)

## How to Build It

Sources: `sources/024-active-window-feed/` (`feed.py`, `kwin_feed.js`); Dolphin's AT-SPI probe is in this file's step 3.

1. **Feed.** A persistent KWin script calls `send()` on `workspace.windowActivated`, and on `captionChanged` of the active window. Wire it on existing windows and on `windowAdded`. Payload: `{kind, ts: Date.now(), caption, resourceClass, desktopFile, pid, client}`. Latency = receive time − `ts` (same clock).
2. **The app id is the join key.** KWin's `resourceClass` (`org.kde.dolphin`) equals the activity database's `initiatingAgent`.
3. **Resolver, first hit wins:**
   1. **App-specific AT-SPI field.** Dolphin: the `button` named "Go to Location on Path" has the exact current path in its description: `Go to any location on the path '<tt>/full/path</tt>'`. Its sibling buttons are the path segments. Tree walk: 469 nodes, 281 ms; cache per window and refresh on `captionChanged`.
   2. **Title matched against recent files.** Parse a file name from the title before ` — App` with `([\w\-. ()\[\]]+\.[A-Za-z][A-Za-z0-9]{0,7})`; the extension must start with a letter. Then find the newest `~/.local/share/recently-used.xbel` bookmark registered by that app whose basename matches. Gwenview, `Scotland.jpg` → `/home/kaelen/Downloads/Scotland.jpg`.
   3. **Open files.** Read `/proc/<pid>/fd` links, keeping regular files under the user's paths (skip `/usr /proc /sys /dev /run /var /opt /snap`, `~/.cache`, `~/.local/share`). Map **Kate's `.<name>.kate-swp`** back to `<name>` in the same folder. A single remaining file counts as a hit.
   4. **Title only:** a name without a folder. Store it as a weak anchor.
   5. **Picture plus summary** (see `screen-capture.md`) for everything else.
4. Resolving all guesses costs 1.2–3.1 ms (plus the AT-SPI walk when used).

## What to Avoid

- **KDE's activity database (`ResourceEvent`) for "what is open now".** Dolphin's entries were one folder behind on every step (showing `lib` while the database said its parent; showing `Downloads` while it said `Videos`), and stayed stale. It records history, not the present.
- **Loose title parsing.** "Unity 6.4" parsed as a file with extension "4".
- **Expecting apps to hold their document open.** Most read and close; Kate holds only its swap file.
- **Committing feed logs**: they hold window titles and file paths.

## Constraints

- **Feed latency: 0.8–0.9 ms median, 3.1 ms max** over 25 events in two sessions.

| App | Result |
|---|---|
| Dolphin | ✓ exact folder via AT-SPI (activity database ✗) |
| Gwenview (image opened from Dolphin) | ✓ title + recent files agree on the full path |
| Kate | ✓ swap file in `/proc/<pid>/fd` |
| Firefox | ✗ only profile files; needs a browser extension (web pages are out of v1) |
| Unity, Blender, Electron apps | ✗ no file in the title; Unity holds 24–33 project files open, so a *project folder* (common ancestor) is a plausible guess, not built |
| Konsole | none (expected) |

- Okular (PDFs) was not exercised; it likely behaves like Gwenview.
- Electron alone gets no KWin focus events on Wayland. It can read `/proc` and the databases from its main process, but the feed needs the KWin script.

## Origin

Synthesized from spike 024, with the window-matching pieces from spike 021.
Source files: `sources/024-active-window-feed/`, `sources/021-guide-circle-atspi/`.
