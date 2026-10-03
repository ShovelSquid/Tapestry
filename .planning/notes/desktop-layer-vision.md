---
title: "Desktop layer vision: core file and notes layer, .tree worlds on top"
date: 2026-10-02
context: /gsd-explore session with Kaelen. Not yet reflected in PROJECT.md or ROADMAP.md (see the new-milestone todo).
---

# Desktop layer vision

## Two layers

1. **Core: a file manager and notes app that sits on the desktop.** It is easy to reach from anywhere, works like Obsidian, and shows the real filesystem in 2D or 3D space. The user's own files are the source of truth. AI shows the pathways between things and helps organize them.
2. **Worlds: `.tree` files.** A `.tree` is a special file type for Tapestry worlds. Data drawing, rendering, character creation (NPC minds), branching history and replay all live inside worlds, not in the core.

## Desktop notes (the flow Kaelen described)

1. **Summon.** A small new-note tab sits near the lower middle of the screen. It peeks out a little when the cursor comes within some radius, and becomes a button when the cursor hovers over it.
2. **Place.** The user drags a note out of the tab and drops it anywhere on the screen, over other apps.
3. **Anchor.** The user drags a connection from the note onto a window. Dragging the connection point marks an area: a drag-and-drop selection that becomes the note's reference area.
4. **Write.** The user writes whatever they want. What they write says what the note is for, and can shape what it does later.
5. **Dismiss.** The user saves the note and it disappears. The connection stays.
6. **Return, quietly.** Reopening the anchored thing does *not* reopen its notes. A small side tab, made like the new-note tab, shows that this thing has notes, and lists every note and file linked to it.
7. **Note list.** All desktop notes are kept in a list the user can browse, ordered by when they were made.

### Anchors: strongest available identity, with a fallback that always works

| Strength | Stored | Example |
|---|---|---|
| Strongest | File path plus location | An editor extension reports file and line range. On macOS, the Accessibility document attribute gives the path. |
| Middle | File path | A local file opened in any app, when the path can be found |
| Fallback (always stored) | Screenshot of the marked region, window title and app, and an AI-written summary of what it shows | Anything, and the normal case on KDE Wayland |

Kaelen's priorities for the first version: **anything by picture**, **local files in any app**, **code in an editor**. Web pages were not chosen for v1. When the file can't be found, as on Wayland, use a short summary of what the thing is.

## Guide: AI that looks before it answers, and points

The motivating case: Kaelen asks Claude or ChatGPT where a menu is, and gets told the wrong location because the model knows a different version of the app. Instead, the AI looks at the actual screen and draws a **green circle** over the real menu item, guiding the user step by step through tasks they can't figure out.

- It uses the same pieces as desktop notes: the edge overlay, screen capture, and the active window.
- A guided answer can be saved as an anchored note, so the next time is instant. Pinned notes give the guide context about the user's work.
- On KDE, the accessibility tree (AT-SPI) may give element names and positions more exactly than reading pixels. This is **untested** and belongs to the spike.
- **Model policy: use whatever works best, cloud included,** as long as the user can see and control what is sent. The guide is a plugin. Each screenshot sent to a model is recorded where the user can read it.

## Platform findings (research pass, 2026-10-02)

Machine: Ubuntu 26.04, **KDE Plasma 6.6.6 / KWin 6.6.6 on Wayland** (not GNOME).

**Confirmed on this machine:**
- KWin provides `zwlr_layer_shell_v1`, and `layer-shell-qt` 6.6.4 is installed, so an edge-anchored overlay above other windows is possible from a small Qt helper. (Checked with `wayland-info` and `dpkg`.)
- KWin's `ScreenShot2` D-Bus interface refuses ordinary callers (`ScreenShot2.Error.NoAuthorized`). The KDE portal backend provides `Screenshot`, `ScreenCast`, `GlobalShortcuts` and `InputCapture`, so capture goes through the portal. A global shortcut that summons a note is possible. (Checked with `gdbus` and `kde.portal`.)
- KWin advertises `kde_screen_edge_manager_v1`.

**Unconfirmed (researcher only; the researcher's model tier couldn't be read, so these are held as unconfirmed):**
- Electron `setAlwaysOnTop` is not supported on Wayland, so on KDE the edge tab likely needs a native Qt helper rather than an Electron window. *(Researcher cited the Electron BrowserWindow docs.)*
- `kde_screen_edge_manager_v1` is reserved for KDE's own components ("Regular clients must not use this protocol"). The fallback for sensing the cursor approaching is an invisible input strip around the tab, slightly larger than the tab. *(Researcher cited the protocol spec text.)*
- A KWin script loaded over D-Bus can report the active window's title, class, app id and pid. *(Researcher says it probed this locally; not re-run.)*
- KDE has no reliable way to map a window to a file path. Title parsing, `/proc/<pid>/fd`, `recently-used.xbel` and KActivities are only guesses. *(Unverifiable.)*
- macOS: Electron `setAlwaysOnTop` up to `screen-saver` level plus `setIgnoreMouseEvents(true, {forward: true})` likely covers the tab. ScreenCaptureKit needs the Screen Recording permission. Accessibility `kAXDocumentAttribute` gives the document URL for many apps, though Electron-based apps may not set it.
- A VS Code extension can report the active document and selection on both platforms.

**Likely architecture (to be proven by the spike):** Electron for Tapestry's main UI, plus a small native helper per platform for the edge tabs, capture and window identity, plus editor extensions for exact file anchors.

## Not yet decided

Recorded in `.planning/research/questions.md`: how AI file reorganization proposes, acts and undoes; where layout and connections are stored (sidecars vs a central index); how `.tree` worlds open from the file view.
