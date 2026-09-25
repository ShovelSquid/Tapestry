# World space — the note plane in a 3D world

A design for how Tapestry's spatial canvas, Mathspace and Data Drawing share
one space. Written 2026-09-24 from Kaelen's description:

> The 2D note space is highly important, but it also rests as a 2D canvas in
> a 3D world. It is locked, so it doesn't get affected by the world physics,
> and we can focus on it to be the main thing we see or a part of the
> window, but it is in the 3D world.

Status: design only, except the floating surface windows (step 1 below),
which are built. Read `mathspace_design.md` and `mathspace_plan.md` for the
engine this builds on.

## The one idea

**There is one 3D world. The note canvas is a locked plane inside it.
Everything else (Mathspace bodies, drawn strokes) lives in the world around
and on that plane, and every view is a camera into it.**

| Thing | What it is |
| --- | --- |
| World | One 3D space per forest. Mathspace runs its physics here. |
| Note plane | The whole spatial canvas (every tree frame, every note) lying flat at z = 0. Locked. |
| Note | A card on the plane. Its world position is its frame origin plus its frame-local position, at z = 0. |
| Body | Anything physical in the world: a Mathspace point or shape, a stroke's particles. Moves by the world's rules. |
| Camera | Where you look from. View state only, never recorded or hashed. |
| Focus | The camera square-on to the plane: exactly today's canvas. |
| Pull back | The camera tilted and moved away: the plane seen as a surface inside the world. |
| Window | A floating panel over the app, holding a plugin surface. A Mathspace window is a second camera into the same world. |

## Why the plane is locked

The note plane is where thinking is arranged: layout is meaning, and a
person (or an agent allowed by the lock model) is the only thing that moves
a note. Physics must never rearrange ideas. So:

- Nothing in the world writes a note's `position.*`. Notes on the plane are
  **anchors**: bodies can be attracted to them, collide with them, spring
  toward them, or orbit them, but anchors have infinite mass and never move.
- The plane is not a special case in the engine. It is a set of anchor
  points in the world space, plus one shape (`z = 0`) that rules may use or
  ignore. A rule that should pass through the plane just doesn't select it.
- Later, the lock toggle (Phase 2.4's `lock.layout`, once Decision Register
  #19 names the keys) can **release** one note from the plane into the
  world as a body, and **pin** a body back onto the plane as a note. That is
  an explicit, recorded action, never a side effect of physics.

## Notes, not trees

Kaelen, 2026-09-24: *"I don't think we should have trees, I think we should
just have notes, and they can contain notes within them, to create a
recursive folder-like structure."* So the core concept is the note. Every
note has its text and a 2D surface, and other notes can sit anywhere on
that surface, to any depth. The note plane is the root surface.

A tree does three jobs today, and only one of them goes away:

| Job | Today | Notes-only |
| --- | --- | --- |
| Container on the canvas | Tree frame | A top-level note holding notes. Goes away as its own concept. |
| History (undo, branches, threads) | One journal per tree | Stays, underneath: the boundary becomes a note and everything inside it. |
| File on disk | One `.tree` per tree | Stays as storage: a note can be stored in its own file. Vaults and workspaces become nested notes. |

**Stage 1 (built, `layout/nesting.ts`)** works inside today's trees:

- A note records its container on itself as `set n5 inside ref n2`. Its
  `position.*` is then measured from the container's top-left.
- Drop a note on another note to put it inside, and drag it out to lift it.
  Right-click a note for **New note inside** and **Zoom into note**.
- A container is drawn big enough to hold its contents. Its stored size is
  never overwritten, so emptying it lets it shrink.
- Zoomed out, a nested note narrower than 64 screen px draws as an empty
  outline at its real place and size, and nothing inside it is drawn.
  Double-clicking an outline zooms into it.
- Deleting a note deletes everything inside it, in one commit that one undo
  restores.
- Agents' `look` and `place` measure nested notes where they are drawn.
  `place` keeps a note inside its container.

Tunable values, all exported from `layout/nesting.ts` except the last:

| Value | Setting | Why |
| --- | --- | --- |
| `CHILD_TOP` | 56 px | Contents start below the container's title row, so a note never hides the title of the note it is in. |
| `CONTAINER_PADDING` | 24 px | Room to the right of and below a container's contents. |
| `OUTLINE_BELOW_PX` | 64 screen px | Below this width, a card's text is unreadable anyway. |
| `MAX_NESTING_DEPTH` | 32 | A bound on every walk. Deeper chains, and cycles, fall back to the top level. |
| `ZOOM_FIT_SHARE` (Canvas) | 0.85 | Zoom into note leaves a margin around the note. |

The rules I chose:

- A drop lands in the deepest note under the dragged card's centre.
- Only `tapestry.notes/note@1` nests in this stage. Threads, knots and
  plugin nodes stay at the top level.
- Workspace folders keep their own path-based nesting (02.7) until stage 2.
- A malformed `inside` (a missing target, a non-note target, a cycle) leaves
  the note at the top level and never breaks the tree.

**Stage 2:** tree frames become top-level notes, and vault and workspace
folders become ordinary nested notes. **Stage 3:** storage and history
follow notes. That means choosing default file boundaries (one file for
everything, or one per top-level note) and moving undo, agent tools and
threads from tree ids to note ids. Still to do in stage 1: `create_note`
for agents has no `inside` argument yet.

## Coordinates

One world unit is one canvas unit (a CSS pixel at zoom 1), so the plane
needs no scale factor and every existing position is already a world
position.

- **x** to the right and **y** down the plane, exactly as the canvas draws
  them, so a note at canvas `(x, y)` is at world `(x, y, 0)`.
- **z** is height off the plane, toward the default camera. Positive z is
  "in front of" the canvas.
- These axes are left-handed. A renderer that wants right-handed axes
  (three.js) maps world `(x, y, z)` to `(x, −y, z)`. That conversion lives in
  one function, next to the camera, and nowhere else.
- A note's world position is `frame origin + frame-local position`, where a
  nested note's frame-local position adds up its containers' (see *Notes,
  not trees*). Frame
  origins belong to the forest (Phase 2.6), note positions to their tree
  (02.2 D-15). Neither changes.
- Numbers crossing into Mathspace follow its rule: a `real` is accepted only
  if `r · 2^32` is an exact integer below 2^53 (`mathspace_plan.md`,
  "Numeric type"). The usable range, about ±2 million units, covers any
  realistic canvas.

## Where the world lives

The world is **its own tree in the forest** (kind `world`, one per forest,
created on first use). Its nodes are the world's Space, its Rules, its
Views and its bodies. Notes stay in their own trees.

- The world's history (a simulation run, a drawn stroke) is its own
  journal. Undo in a note tree never rewinds physics, and a long simulation
  never floods a note tree's history.
- Mathspace reads note positions from every open tree **read-only**, to
  place the anchors. It writes only to the world tree.
- This needs one SDK addition: a read-only way for a plugin to list the
  forest's trees and read a tree's nodes (`kernel.getNodes(treeId)` or
  similar). Writes stay scoped to the plugin's own tree.

## Views

**Focus** is the canvas as it is today: DOM cards, ProseMirror editing, the
camera's pan, zoom and roll (`layout/camera.ts`). Nothing about editing
changes. Focus is an orthographic camera looking down −z at the plane, and
the existing camera state maps onto it one to one.

**Pull back** tilts that camera and moves it off the plane:

- The DOM canvas layer is given the camera's 3D transform with CSS
  (`matrix3d`), the approach three.js's CSS3DRenderer uses, so notes stay
  real, selectable, editable text at an angle rather than becoming
  textures.
- One WebGL layer, drawn with the same view-projection matrix, draws the
  world's bodies behind and in front of the plane. Where a body sits in front
  of the plane, it draws over the cards.
- Pointer hits on the plane at an angle go through a ray-plane intersection.
  Data Drawing already has one (`plugins/data-drawing/surface/src/plane.ts`,
  `rayPlane`), so the canvas and the drawing agree on what "this spot on the
  plane" means.
- Going between focus and pull back is an animated camera move. Text editing
  is available in focus and within a small tilt of it. Beyond that, a click
  on a card focuses it first.

**Windows** are other cameras. A Mathspace window can look at the world
from anywhere, including views of more than three dimensions through its
View notes. Camera and window rects are view state. They are stored per
person (localStorage), never in a tree, never hashed.

**Mathspace View notes vs. cameras.** A `mathspace/view@1` node is in the
document: it says *how* a space is drawn (the projection `project(x)`, for
example 4D to 3D). A camera is not in the document: it says *where you are
looking from*. A window shows one camera through one View.

## Data Drawing in the world

Data Drawing already paints onto a plane in 3D: a stroke records a
`PlaneFrame` (origin, right, up) and the sim computes
`pos3 = origin + u·right + v·up` (`plane.ts`). So:

- **Drawing on the note plane** uses the frame origin `(0, 0, 0)`, right
  `(1, 0, 0)`, up `(0, −1, 0)` (up is −y because the canvas's y runs down). The ink lands
  in the same coordinates as the cards and appears in the canvas's WebGL
  layer, drawn over the plane.
- **Drawing in the air** uses any other frame: a plane the person tilts in
  pull back.
- Strokes today live only in the surface's in-memory action log. In the
  world they become world-tree nodes (a stroke and its particles as bodies
  with the brush's spring rule, as `mathspace_design.md` §3 already
  describes), so they are saved, replayed, and seen by every camera.

## What changes in existing code

1. **Mathspace's implicit space.** Today a note with `position.*` and no
   `space` ref lives in "the implicit 2D space of its tree", and the runner
   writes new positions back to notes (`plugins/mathspace/image.js`,
   `IMPLICIT_SPACE_ID`). Under this design those notes are anchors at
   `(x, y, 0)` in the world space, with inverse mass zero, and the runner
   never emits a `position.*` set for a note. Presets that moved notes
   (`gravity-field`, `nbody`, `spring-to-anchor`) move bodies instead. Their
   goldens change and are regenerated deliberately, as one commit that
   says so.
2. **Data Drawing's private sim world** becomes world-tree state (above).
   Its surface keeps its brush panel. Its stage becomes a window onto the
   shared world instead of a world of its own.
3. **The canvas** gains the pull-back camera and the WebGL world layer.
   Focus mode is unchanged code.
4. **The SDK** gains read-only multi-tree reads for plugins (above). A
   surface gets the camera it is showing, so a window can follow or detach
   from the main view.

## Invariants

- Physics never writes a note's position. A test replays a Mathspace run
  and checks that no commit from the plugin touches `position.*` on a note
  in a note tree.
- Camera, focus, pull back and window rects never enter a tree or a hash.
- The note plane at focus looks and behaves exactly like today's canvas.
  Existing canvas tests keep passing unchanged.
- One coordinate convention. The canvas, Mathspace and Data Drawing convert
  through the same functions, and a test pins a round trip for each.
- Mathspace's own invariants carry over unchanged: fixed-point only, fixed
  loop bounds, id-order iteration, Debug/Release goldens.

## Build order

1. **Floating windows.** *Done*, commits `91d2720` and `1d14320`. Every
   plugin surface opens in a movable, resizable, maximizable window. Several
   can be open at once, and each window remembers its rect.
2. **The world and the locked plane.** A world tree, 3D world Space,
   notes as anchors, Mathspace writing only to the world. Read-only
   multi-tree SDK reads. Presets and goldens moved to bodies. Done when a
   gravity preset orbits bodies around a note that never moves.
3. **Pull back.** Camera model with focus and pull back, CSS 3D transform
   on the DOM canvas, a shared WebGL world layer, ray-plane picking. Done
   when you can tilt away from the canvas, see Mathspace bodies around it,
   and focus back to edit.
4. **Data Drawing in the world.** Strokes as world-tree bodies, drawing
   on the note plane or on a tilted plane. Done when a stroke drawn on the
   plane is visible from the canvas, from a Mathspace window, and after a
   reopen.
5. **Release and pin.** Once Decision Register #19 is answered, the lock
   toggle releases a note into the world and pins a body back.

## Open questions, with the answer I would take

- **One world per forest, or per tree?** Per forest. The canvas is one
  plane holding all trees, so the world around it is one world.
- **Is the plane always at z = 0?** Yes. Moving the plane would move every
  note's world position, and the point of the lock is that nothing does.
  Pull back moves the camera, never the plane.
- **Can there be more than one plane?** Not now. A second plane (a tilted
  whiteboard in the air) is a Data Drawing frame, not a note plane. Revisit
  if trees want to live on separate planes.
- **Do bodies cast onto the plane (shadows, ink under the cards)?** Draw
  order only for now: bodies at z > 0 draw over the cards, z < 0 under.
  Lighting waits.
- **Mathspace's "problems" on plain notes.** Opening Mathspace on an
  ordinary tree reports problems (seen: 7 notes, 15 problems) because
  notes carry reals that don't cross exactly or fields it doesn't know.
  Once notes are anchors, only `position.*` crosses and the rest of a note
  is ignored, which should clear these. Check when step 2 lands.
