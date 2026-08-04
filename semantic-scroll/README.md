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

## Deterministic updates and replay

This version adds an append-only history layer for continuity, model tracking,
and reproducible semantic-state replay.

### What is logged

Meaningful actions produce immutable events containing:

- **what** changed (`note.created`, `object.moved`, `connection.created`, etc.)
- **when** it changed (ISO timestamp and monotonic performance time)
- **why** it changed (a human-readable cause)
- **where** it changed (object, layer, coordinates, or screen location)
- **who** caused it (`human`, `system`, or later an AI/model actor)

Events are stored locally in the browser under `semantic-scroll-history-v1`.
Use **Updates → Export** to save the complete JSON history outside the browser.

### Significant updates

After three significant mutations, or at the selected timer interval, the app:

1. captures a deterministic semantic checkpoint;
2. summarizes events since the previous checkpoint;
3. creates an update note on the **Updates** layer;
4. records the checkpoint-to-note relationship in the event log.

The threshold is kept in `history.js` as `significanceThreshold` and can later
be exposed as another UI control.

### Replay boundary

**Replay latest** restores:

- transcript content;
- notes, blobs, layers and positions;
- note dimensions and text;
- object-to-object links;
- camera transform;
- model-orb screen location;
- seeded procedural geometry state.

Decorative energy particles and exact animation frames are intentionally not
checkpointed because they depend on display timing. The replay is deterministic
at the semantic/model-state layer, not a video recording. For stricter physical
replay, the next step is a fixed-timestep simulation whose inputs are recorded
as events and whose state hashes are validated at checkpoints.

### Model events

The schema already accepts `actor: "model"`. A future model runner should log:

```js
semanticHistory.record('model.decision', {
  modelId: 'mimic-research',
  promptId: 'prompt-42',
  action: 'create_connection',
  confidence: 0.78
}, {
  actor: 'model',
  where: { layerId: 'layer-2', x: 120, y: -80 },
  why: 'The two notes share a causal dependency.'
});
```

That makes mimic branches, merges, movement, prompts, and decisions replayable
through the same event stream.
