# Semantic Scroll prototype

A dependency-free local prototype for spatial, connected conversation notes.

## Run

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run:

```bash
node server.js
```

4. Open the URL it prints.

### Port series

Launching does not fail if the port is taken. The server walks an additive
series — 3000, 3001, 3002 … — and binds the first free slot, so earlier
instances keep serving and successive updates can be compared side by side.
Each tab shows its own port as a badge next to the title.

```
$ node server.js
Semantic Scroll running at http://localhost:3002
  series base 3000 · 3000, 3001 still held by earlier instances
```

| Variable | Effect |
| --- | --- |
| `PORT` | Base of the series (default `3000`) |
| `PORT_TRIES` | How many slots to try before giving up (default `50`) |
| `STRICT_PORT=1` | Bind the base exactly and fail if busy — for tooling that must know the port up front |

The newest instance writes its port to `.port`. On a clean shutdown it clears
that file only if it still names itself, so killing an older instance never
erases a newer one's record.

## Included

- Infinite canvas: pan left/right and up/down without limit, scroll to zoom
- `Orient: Reset` button that frames every visible object
- Layers, with per-layer visibility, lock, and active-layer focus
- Blob circles — animated wavy-edged rings that open connections
- Notes that push each other apart when they share a layer
- Full transcript with a composer
- New text illumination and fade
- Letter/word/phrase selection using the browser selection model
- Two-step connection creation with a mouse-following blue feeler
- Persistent animated SVG links between marked passages
- Automatically generated bridge notes between connected passages
- Draggable, resizable notes
- Contained blue wave pulse on note creation and connection
- 60 Hz particle/energy animation
- Draggable neural-field sphere in the upper-left

## Navigating

Everything lives in a world coordinate space; the screen is a window onto it
(`screen = world * k + pan`). Only the top bar, side panel, composer, and orb
are fixed to the screen.

| Action | Input |
| --- | --- |
| Pan | Drag empty space, middle-drag anywhere, arrow keys, or two-finger scroll |
| Zoom | Scroll wheel (zooms at the cursor), pinch, or `+` / `-` |
| Horizontal pan | `Shift` + scroll |
| Frame everything | `Orient: Reset`, or `0` |
| Cancel a connection or proposal | `Esc` |

`Wheel: Zoom` / `Wheel: Pan` in the side panel switches what a plain vertical
scroll does. Trackpad pinches always zoom and horizontal swipes always pan,
regardless of the setting.

## Blobs

Click a blob and a blue connection line extends to a second, dimmer blob whose
waves are fainter and more transparent — a proposal. It trails the cursor while
staying clear of its parent. Click again in open space and the proposal settles
into a real note at that point, on the blob's own layer, with the connection
made permanent. `Esc` withdraws it.

## Layers

Objects only push each other apart when they are on the same layer; different
levels pass straight through one another. Layers can be hidden, locked (locked
objects become immovable walls), and renamed by double-clicking. The transcript
itself is a layer object, so it can be dimmed or hidden, but nothing pushes it.

## Important limits

This is a front-end simulation. The bridge-note text is currently generated locally from a template. To use a real language model, add a server endpoint that calls your chosen model and return the bridge interpretation as JSON. Do not put API keys in `public/app.js`.

The UI is inspired by a dark conversational interface but does not copy ChatGPT's proprietary source code, assets, or exact implementation.
