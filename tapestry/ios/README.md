# Tapestry for iOS

A native iPhone / iPad build of the Tapestry workspace, using the desktop app's
current UI: the dark grid with pinned coordinate labels, page cards with kind
accent dots, minimize buttons and resize handles, the settings page, vector ink,
and the header with File / Edit / View menus and the A · H · Z · brush · S tools.

SwiftUI for the chrome, a UIKit view drawing with Core Graphics for the canvas.
`Canvas/Renderer.swift` is a port of `render/Grid.cpp`, `render/Pages.cpp` and
`render/Strokes.cpp` — same metrics, same colours, same LOD thresholds.

## Build

CI compiles the app on a macOS runner for every push that touches `ios/`
(`.github/workflows/ios-build.yml`, simulator SDK, no signing), so the build
is checked without a Mac.


Requires Xcode 16 or newer (the project uses synchronized folders) and iOS 17.

1. Open `ios/Tapestry.xcodeproj`.
2. Select the **Tapestry** target → *Signing & Capabilities* → pick your team.
3. Run on a simulator or device.

Any `.swift` file added under `ios/Tapestry/` is picked up automatically.

## Documents

The app reads and writes the same `.tapestry` format as desktop
(`Model/Document.swift` ports `core/Document.cpp` line for line): a baseline
snapshot followed by per-field deltas, so a file can move between Mac and
iPhone and keep its whole history.

- The default document is `workspace.tapestry` in the app's Documents folder,
  visible in the Files app under *On My iPhone → Tapestry*.
- **File → Open…** opens any `.tapestry` file in place (iCloud Drive, etc.);
  the app reopens it next launch.
- **File → Save** appends a delta; the app also saves automatically when it
  goes to the background. Saving an unchanged workspace writes nothing.
- **File → Share…** saves and hands the file to the share sheet.
- A document saved on a big desktop window may open with nothing on a phone
  screen; the app frames the pages in that case.

## Touch controls

| Action | Input |
| --- | --- |
| Pan | Two-finger drag (any tool); one-finger drag on empty space with **A**, or anywhere with **H** |
| Zoom | Pinch (any tool); **Z** tool: tap to zoom in, drag up/down |
| Select / move a page | **A** tool, drag the page |
| Resize | Select a page, drag a corner handle |
| Edit text | Tap an already-selected page — title bar edits the title, body edits the text |
| Minimize / restore | The button at the page's top right |
| New note | Double-tap empty space, or the **+** button |
| Draw | Brush tool; Apple Pencil pressure sets the width (fingers use the desktop's 55% mouse fallback) |
| Settings page | **S** — brings it forward, restores it, and centres it on screen |
| Frame all / reset view | **View** menu |
| Rename the document | Tap the title in the header |

Two fingers always navigate, so a pinch never leaves a stray mark or moves a
page. On a phone the tools live in a palette at the bottom of the screen; on
iPad they sit at the right of the header as on desktop.

Page text is edited in a sheet styled as the page card rather than in place:
on a phone the keyboard would otherwise cover the page being edited. Edits
apply live — the page updates behind the sheet as you type. The sheet's menu
also changes a page's kind, minimizes it, or deletes it.

## Layout

```
Tapestry/
  TapestryApp.swift, Workspace.swift   app entry; session state, documents, actions
  Model/    Page, World, Camera, Document — ports of core/
  Canvas/   CanvasView (touch → drag modes), Renderer (Core Graphics), Theme (palette)
  UI/       ContentView, HeaderBar, ToolPalette, PageEditorView
```

## Differences from desktop, for now

- No undo/redo (desktop doesn't have it yet either); **Edit** offers *Remove Last
  Stroke* and *Clear Ink* instead.
- The world tick count advances from wall-clock time at save rather than from a
  running 16 ms loop — nothing simulates yet, so an idle loop would only burn
  battery. Deltas stay tick-stamped the same way as desktop's.
