# Tapestry core

The Rust workspace for the narrative engine. The design lives on the `ws/writing` branch
(`narrative-engine-core-spec.md` and `log/`).

```
world/rules     The canvas's rule notes, one .tree file each (log 0009). Edit them live.
crates/canvas   Paint with particles (ink, water, trees, fire) that keep living; rule notes (log 0009).
apps/canvas     The canvas app: palette, rule notes, and a timeline of keyframes.
crates/core     The engine: keys, rules, a pure simulate(), history, and the gap report.
crates/dungeon  First demo (log 0008): a rule pack, a world written as keys, perception, a game loop.
apps/dungeon    Play the dungeon in a terminal.
crates/view     WorldView: the boundary. "Every point, at time t." Depends on nothing of ours.
crates/mock     A hand-keyed cup scene (spec §10) standing in for the core. Not simulated.
crates/render   L0 renderer: one ray-cast ellipsoid per point, drawn offscreen with wgpu.
apps/viewer     Window, timeline scrubber, keys and gap report (eframe/egui). Paused for now.
apps/bake       Samples a WorldView into JSON for hosts, keeping only frames where something changes.
blender/        Blender 5.2 add-on: runs tapestry-bake and plays the result as native animation.
demos/blob-hands  Browser toy: a metaball blob you grab with your hands (camera) to drag and tear apart.
```

**The one rule:** everything that shows the world (`render`, `viewer`, `bake`, and through it
Blender) sees it only through `tapestry-view`. When the real
core arrives it implements `WorldView`, replaces the mock, and nothing downstream changes
(spec principle 10, authority vs appearance).

## The canvas (current focus)

```sh
cargo run -p tapestry-canvas-app            # empty sheet
cargo run -p tapestry-canvas-app -- --demo  # an ink cup with water, a row of trees, a fire
```

Paint with ink, water, trees and fire (keys 1–5; scroll to resize). Each stroke is one
keyframe: a set of points laid down from a moment on, recorded with its timing if you paint
while time runs. Materials have a nature: ink blots and dries and holds water like a wall,
water pours and pools, trees sway and settle, fire burns its fuel. How materials act on each
other comes only from the rule notes on the right. Click a note's dot to switch it on from
the playhead on: fire sits among trees doing nothing until "Fire spreads to trees" is on.
"Fire engulfs trees" says nothing definite, so it does nothing. Space plays, the timeline
scrubs (the canvas replays to that moment).

Rule notes are `.tree` files in `world/rules/` (or `--world <dir>`). The first `#` line is the
title, prose says what the rule means, and lines starting with a basic rule say it:

```
# Fire spreads to trees
A tree near fire heats up, and catches.

change tree heat +1.5/s within 18 of fire or flame
convert tree to fire at heat 1 ±60%
```

Edit a note on its card (edit, then save) or in any editor; the app rereads the folder every
half second and the canvas replays under the new rules. A line that doesn't read is shown
in red against its line number and the rest of the note still works; a note with no rule
lines does nothing. "+ new rule" starts a file.

The window is made of panes (canvas, brushes, rules, files, timeline, and a tab per open file).
Drag a tab to move it or split beside another, drag an edge to resize, ▼ to collapse, pull a
tab out to make it its own window, and double-click a tab (or right-click → fill the window)
to have it fill the window; esc comes back.

**files** is a small spatial IDE. It opens any folder (type a path, or click a pinned one;
*pin* keeps the folder you're in) as note cards: folders are frames you double-click to step into,
files are cards you double-click to open: the card grows to fill the surface, with save,
*back* (or esc) and *own tab* to pull it out into a pane of its own, and Markdown `[[wikilinks]]` are drawn as
ink lines between cards, so an Obsidian vault reads as a web. Drag cards around; scroll to
zoom. Moved cards and pins are remembered in `~/.local/state/tapestry/`. **+ terminal** opens a real shell in the folder you're in, as a card: click it to type into
it (every key goes to it, Ctrl+C and Shift+Tab included; click the surface to give the
keyboard back), double-click to grow it, scroll over it for history. Run `claude` in one to
work with an agent beside the notes it's working on. Saving a rule file changes the canvas
at once. Saving the engine's own source offers
**rebuild**, then **restart into it**.

The timeline has a lane per brush and one for rule switches. Click a keyframe to pick it
(what it made stays bright on the canvas), drag it to another time, delete to remove it;
ctrl+Z takes back the last add, move or delete. A scene heavier than real time plays in
slow motion rather than freezing; `cargo run --release -p tapestry-canvas --example stress`
times a big forest fire.

## The dungeon (first demo)

```sh
cargo run -p tapestry-dungeon-cli
```

With `ANTHROPIC_API_KEY` set, Claude narrates: write anything in plain English. Claude can
only act through the engine's verbs, and every refusal comes back for it to tell as story.
Under each turn a trace shows what the AI understood and what the core decided, so a mistake
can be pinned on one or the other (`!trace` hides it). Model `claude-opus-5-5`; set
`TAPESTRY_EFFORT` (default `low`) for slower, more careful turns.

Without a key, or after `!typed`, play with typed commands (`take key`, `unlock door`, `n`,
`attack guard`). Author commands
start with `!`: `!state guard.alive = true` says something is true (it holds, but if nothing
caused it, it's flagged), `!why door.locked` traces a value to the key that caused it,
`!gaps`, `!undo`. The rules refuse anything that isn't possible: things that aren't there,
verbs nothing gives a meaning to, a locked door, a guard in the way.

## Blender (the main host for now)

Blender is appearance only. It runs the core as a separate program and plays back what it
writes. Blender keyframes are a regenerable cache of the world's history, not Tapestry keys:
editing them doesn't change the story.

1. `cargo build --release -p tapestry-bake`
2. Link the add-on: `ln -s $PWD/blender/tapestry ~/.config/blender/5.2/extensions/user_default/tapestry`
3. In Blender: Preferences → Add-ons → enable **Tapestry**.
4. 3D View sidebar (N) → **Tapestry** → **Rebake**. Keys appear as timeline markers.

Each point becomes an object parented like the point, so nested frames are Blender's parent
hierarchy. Blobs are meshed once and only moved. The world is Y-up; a `Tapestry` root empty
turns it Z-up.

## Run

```sh
cargo run -p tapestry-viewer                                      # the window
cargo run -p tapestry-render --example snapshot -- out 35.5 40    # headless PNGs at given times
cargo test
```

Viewer: drag to orbit, right-drag to pan, scroll to zoom, space to play. Hover a key on the
timeline to read it.

## Blob hands (browser toy)

```sh
cd demos/blob-hands && python3 -m http.server 8765   # then open http://localhost:8765
```

A soft body of metaball particles; springs snap when stretched, so a fast yank tears a piece off
and pushing pieces together merges them. **Start hand tracking** turns each hand into a cursor
aimed by turning it: your right hand facing the camera is the right edge, turned 45° the left
edge (left hand mirrored), tilt for up/down, and moving the hand pans on top. Both add up;
**Hand tuning** sets the start point, turning and moving sensitivity per axis, and mirroring
(saved per browser), with presets for turn + move, turn only and move only. `C` recenters.
**Calibrate** (`K`) walks through four held poses (facing the camera, turned, tilted up, tilted
down); after it, the turn is read from how the palm outline foreshortens in the 2D image, which
is far steadier than MediaPipe's depth estimate (`aim.js`, pure JS, runs under node). The cursor
holds still while the fingers curl, so grabbing and letting go don't knock the aim. **Aim with: Head** points the cursor where your nose points (the face model's head pose);
a fist on either hand, or holding `Space`, grabs. **Hand pointing** (the default) gives each hand a leash around where it
points: a ray from the palm centre along the rigid palm's facing direction, so moving the hand
shifts it and turning swings it, independently per hand. Inside the leash, palm travel moves the
cursor relatively (slow motion finer than fast). **Head + hands** (`fusion.js`) is the same with
the leash around where the head points.
Every source ends in the same physics: a dead zone sized to that input's own jitter (a still
hand gives a dead-still cursor), then a critically damped spring. A fist grabs, an open hand lets go. Mouse and multi-touch work without a camera.
Three renderers of the same smooth-min SDF: `1` ray-marched, `2` gaussian surface splats, `3` a
surface-nets mesh built in a worker with procedurally wobbling vertices (`W` wireframe).
`blob.js` is pure JS and runs under node.
