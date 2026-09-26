---
tags: [design, plan]
status: ready for autonomy
created: 2026-09-25
inputs: "[[Index First Pass Notes]] · Kaelen's tuned values (below)"
---
# Plan: Line Lab v2, then the UI build

Two parts that run in two different places:

- **Part 1, Line Lab v2** (tasks 1–8): apply Kaelen's tuned values and first-pass feedback to [Line Lab](https://claude.ai/artifact/7Z98pZQhW67Mm5haottzrf) and the spec. Runs as a plain Claude session on the vault.
- **Part 2, the UI build** (waves 0–8): build the look into the Tapestry app on `ws/ui` (`~/Tapestrees/ui`). Runs as a GSD phase under the autonomy driver, after Part 1, because Part 1 settles the numbers and behaviours Part 2 copies.

## Part 1 rules

- **Read-only:** `Design/Index First Pass Notes.md`, `Design/Dump.md` and the images. They're Kaelen's; quote them, never edit them.
- **Source:** `Design/Line Lab/line-lab.src.html`. Build with `python3 "Design/Line Lab/build.py"` (needs Pillow), which writes `line-lab.html` with `strokes.jpg` embedded.
- **Publish:** Artifact tool: first `action: "read"` with `url: https://claude.ai/artifact/7Z98pZQhW67Mm5haottzrf`, then publish `line-lab.html` with that same `url` so the link stays the same. Don't pass `icon`.
- **Check once:** one headless Chrome screenshot before publishing (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=… --window-size=1280,1400 --virtual-time-budget=3000 file://…`). The page is a fragment, so wrap it in `<!doctype html><html><body>…</body></html>` for the screenshot only.
- **Stop at the end of Part 1:** list what changed and anything that couldn't be done. Part 2 is started separately.

---

## Task 1: Make the tuned values the defaults

Kaelen's values (2026-09-25):

| Group | Setting | Value |
|---|---|---|
| Line | weight on screen | **3.5 px** |
| | wobble amount | **2.3 px** |
| | wobble bumps per loop | **3** |
| | width variation | **14%** |
| | corner swell | **46%** |
| | edge grain | **0%** |
| Selection waves | height | 1.2 px |
| | waves per loop | 9 |
| | speed | 0.5 |
| | counter-wave | on |
| Motion | bob keyframes | **1.01, 0.97, 1.015, 0.995, 1** (first value corrected by Kaelen) |
| | bob length | **350 ms** |
| | selection grow | **640 ms** |
| | hover bloom | **770 ms** |
| | move particles | 3 |
| Collapse | circle below | 110 px |
| | dot below | **28 px** |

Bold = changed from the first version's defaults.

- In `line-lab.src.html`, set `DEFAULTS` to these values. "Reset to measured" becomes **"Reset to Kaelen's values"**.
- Bump the `localStorage` key (`lineLab` → `lineLab.v2`) so old saved sliders don't hide the new defaults.
- In `Spec - Notes, Lines and Motion.md`, add a **"Tuned values (2026-09-25)"** table with the same numbers under §2b, set `--tap-line` in §1 to 3.5 px, set the dot threshold in §2a to 28 px, and in §7 set the bob keyframes to `1.01, 0.97, 1.015, 0.995, 1.00` and the length to 350 ms.

**Done when:** a fresh browser shows these numbers, and the spec states them once in a table.

## Task 2: Red button animates back on hover-out

> "when hovering away, it should use an animation on the button to return to normal size"

- Today the red dot snaps back when the pointer leaves. Animate the grow and shrink both ways: keep a 0→1 hover amount that eases toward the target each frame, rather than a start timestamp.
- Use the same easing both ways, so a quick in-and-out doesn't jump.

**Done when:** leaving the red dot mid-grow or after it shrinks smoothly back, with no snap.

## Task 3: Waves on the red button and the selected circle

> "the button should have the same wave as the note, as should small circle note when selected"

- When hovered, the red button's outline gets the selection wave (same height, count and speed; wave count scaled to the button's shorter loop so the wave looks the same size).
- In the collapsed **circle** form, a selected note's blue outline waves too.
- Build both from the same wave function as the note outline, not a copy.

**Done when:** the hovered red button and the selected circle both show the same moving wave as the selected note.

## Task 4: Hover bloom leaves toward the exit point

> "the same off hover for the hover bloom, the light should exit to where the cursor exits the hover point"

- On pointer leave, record the exit point. Over the hover bloom duration, the light pulls out toward that point: the centre moves to the exit point while the radius shrinks to zero.
- Re-entering mid-exit starts a new bloom from the new entry point, continuing from the current light rather than resetting it.
- A selected note keeps its light; the exit only runs when not selected.

**Done when:** sweeping the cursor across the note, the light comes in where the cursor enters and leaves where it exits.

## Task 5: Particles on drag velocity changes

> "the move particles shouldn't just be on start stop, they should be on drag velocity change in the direction of change"

- Track drag velocity smoothed over a few frames. When the change in velocity passes a threshold, emit particles along the direction of that change, from the two corners that face it.
- Count scales with how sharp the change is, capped by the "Move particles" slider, with a short cooldown (~120 ms) so a shaky drag doesn't spray.
- Start and stop become the same rule (going from 0 or to 0 is a velocity change) instead of special cases.
- The spec's restraint still holds: mid opacity, few at a time, almost unnoticed.

**Done when:** a sharp turn mid-drag throws a few specks in the turn's direction, and a smooth straight drag throws none.

## Task 6: Blue selection replaces the black border

> "the blue selection should replace the black note border, not be on top"

- While a note is selected, don't draw the pencil outline wherever the blue has reached. As the blue grows out from the click point, it takes over the pencil line segment by segment. At full growth there's no black outline at all.
- Deselecting runs in reverse: the pencil comes back where the blue retreats.
- The same applies to the circle form.

**Done when:** no black line shows under or beside the blue at any point during or after selection.

## Task 7: Carry the behaviours into the spec

In `Spec - Notes, Lines and Motion.md`, update:

- **§4 states table:** selection *replaces* the pencil outline; red button shrinks back with animation and waves while hovered; the circle form waves when selected.
- **§7 motion:** the bloom exits toward the cursor's exit point; particles come from velocity changes in the direction of change, with the cooldown.
- **Answered list:** one line pointing to [[Index First Pass Notes]] as the source.

## Task 8: Publish and report

Build, take one screenshot, fix anything it shows, publish to the same URL, and report back. Update the Line Lab cards on [[Plugin Map]]: the playground card links v2, and add a card "**Build the note look in the app** (values in spec §2b)".

---

# Part 2: The UI build (`ws/ui`)

Build the look from [[Spec - Notes, Lines and Motion]] into the app. Everything here is **render-only** unless a wave says otherwise: nothing reaches the `.tree`, and nothing touches determinism.

## Ground truth (checked 2026-09-25)

- `ws/ui` is clean at `07aeaa4`, the same commit as `ws/mergin`.
- The canvas session on mergin has landed **notes inside notes, stage 1** (`layout/nesting.ts`) and **`world_space_design.md`**: the canvas is a locked note plane in a 3D world. In focus view it's today's DOM canvas; pull-back puts a CSS `matrix3d` on the DOM layer, with one shared WebGL layer behind it. **Consequence:** note outlines must live *in the DOM card* (SVG), so they tilt with the card in pull-back. A separate canvas layer would fall out of sync.
- Notes today: `components/NoteCard.tsx` (755 lines, CSS border + classes `--selected`, `--editing`, `--connect-target`). Connections: `ConnectionLine.tsx` (41 lines, grey 1.5 px SVG line). Knots: `KnotNode.tsx`. Formatting: `FloatingToolbar.tsx`. Styles: `App.css` has 176 hard-coded hex colours and `--tap-*` tokens that are barely used.
- Editor marks come from ProseMirror's basic schema (`strong`, `em`, `code`, `link`) plus textColor and fontFamily. **No underline or strikethrough yet.**
- Nesting draws a nested note narrower than `OUTLINE_BELOW_PX = 64` on screen as an empty outline. The spec's note → circle → dot collapse replaces that rule.

## Coordination with the canvas session

- The canvas session owns `Canvas.tsx`, `TreeFrame.tsx`, `layout/camera.ts`, `layout/nesting.ts` and the world-space steps. `ws/ui` changes them only through small, named hooks, each listed in the wave that needs it.
- Rebase `ws/ui` onto `ws/mergin` at the start of every wave. If a rebase conflicts in a canvas-owned file, keep mergin's side and re-apply the hook.
- Merge `ws/ui` into mergin at the end of each wave that passes, not all at the end.

## Waves

Each wave is one autonomy session. Tests stay green (`npm --prefix app run build:js`, `typecheck`, `test`) and every wave ends with a screenshot of the dev app next to the matching sketch.

### Wave 0: Foundations

- **Token pass.** Route every hard-coded colour in `App.css` and inline styles through `--tap-*` tokens. Add the spec's tokens: `--tap-pencil #1C1C1C`, `--tap-select #489AFE`, `--tap-select-fill #C2DBFA`, `--tap-connect-flash`, `--tap-delete #FC3B02`, `--tap-line 3.5px`. Keep the current paper colours. No visual change except the pencil colour.
- **Look values module** `renderer/look/values.ts`: every tuned number from Part 1 in one typed object, the only place they live in code.
- **Motion core** `renderer/look/motion.ts`: one rAF scheduler, eased 0→1 amounts that move toward a target (used for every hover and shrink-back), keyframe playback for the bob, and a per-effect strength with an off switch. OS "reduce motion" starts every effect at off. Motion settings are per person (localStorage), like camera state.
- **Done when:** the app looks the same, but `grep` finds no hex colour outside the token block, and the motion core has unit tests.

### Wave 1: The ink line renderer

- Port Line Lab's algorithm to `renderer/look/ink.ts`: resample, seeded noise, wobble, width variation, corner swell, and the selection wave. **Output an SVG path of the filled outline** (both sides of the line plus round caps), not per-segment strokes.
- **Constant screen weight:** the path is built for the current zoom (width = weight ÷ zoom in world units). It's rebuilt when zoom settles, and per frame only for animated lines (selected notes, hovered buttons).
- `<InkLine>` React component: an SVG overlay with a pencil or blue colour, a grow mask (from a start point, per-side speeds) and an optional wave.
- **Done when:** unit tests show the same seed gives the same path, the screen width holds within ±0.5 px across zoom 0.1–3, and a closed wave meets itself without a seam. A 200-note space holds 60 fps with 3 notes selected.

### Wave 2: The note restyle

Hooks needed: none outside `NoteCard.tsx`, `App.css` and `look/`.

- Pencil outline seeded by the note's id, replacing the CSS border. Fonted title, ink rule under it, body.
- **Hover bloom** from the entry point; on leave it exits toward the exit point.
- **Click:** blue grows from the click point and **replaces** the pencil line as it goes, then the bob plays (`1.01, 0.97, 1.015, 0.995, 1` over 350 ms). Deselect runs the reverse.
- **Corner cluster:** the red delete dot grows on hover, gets the wave, shows ✕, animates back on leave, and uses the existing delete path. The blue dot starts the existing connect flow.
- Editing, connect-target and resize states keep working; restyle them in the same language.
- **Done when:** sketches 0–2 and Line Lab's note match the app side by side, and the existing NoteCard tests pass.

### Wave 3: The format bar and note settings

- Replace `FloatingToolbar` with the `f` button: it expands into the pill `f i b u ✱`, each icon expands in place, `✱` opens more symbols, and the icon at the end goes back.
- **Add underline and strikethrough marks.** ⚠ **Gate:** new marks change what the `.tree` records, so the exact mark names need Kaelen's approval before any file is written with them. Until then, build the UI and keep the two buttons disabled.
- **Settings button** to the right of `f`: it flips the note's contents to that note's settings. The first settings shown are the collapse thresholds (wave 5) and the note's colour.
- **Done when:** sketch 3 matches, and formatting round-trips through save and reopen.

### Wave 4: Connections and knots

Hooks needed: `Canvas.tsx` passes the drag state and a "landed" event to `ConnectionLine`.

- Connections become ink lines: blue, waving, constant weight. Dragging from selected text or the blue dot shows a live blue line ending in a blue dot (sketch 4). On landing it **flashes green, then rests blue**.
- `KnotNode` restyled as a small note in the same language.
- UI copy says "connection" and "knot", never "thread".
- **Done when:** sketch 4 matches, and a connection made, saved and reopened looks the same.

### Wave 5: Zoom collapse

Hooks needed: `layout/nesting.ts` swaps its `OUTLINE_BELOW_PX` rule for a call into `look/collapse.ts`.

- Note → **circle** (a fixed-size chip with the title's first letter, waving when selected) → **node dot** as it shrinks on screen. Defaults: circle below 110 px, dot below 28 px. Crossfade between forms; line weight never changes.
- Per-note thresholds in note settings. ⚠ **Gate:** storing them on the note is a new record shape (like `look.collapse.circle`), so the names need Kaelen's approval first. Until then, use the defaults for every note and keep the settings fields read-only.
- Double-click on a circle or dot zooms into it, the same as the stage 1 outline did.
- **Done when:** zooming from 250% to 8% goes note → circle → dot with no size jump in the lines, and nested notes collapse the same way.

### Wave 6: Motion flourishes

- **Move particles** on drag velocity changes, in the direction of the change, with the cooldown (Part 1 task 5).
- **Rifling:** things nearby drift slightly from the cursor and settle; text bobs so little it's barely noticed. Both start on at low strength, as the spec says; whether writers should get them off by default is gate 4.
- **Buttons** swell like paper on hover and pick up the pencil edge.
- **Motion settings panel** behind a fun settings button in the toolbar: one strength slider and off switch per effect.
- **Done when:** every effect can be turned off in the panel, and turning all of them off leaves a still app.

### Wave 7: Entering a note

Hooks needed: the camera's existing "Zoom into note" (`zoomToFrameRect`) gains an optional shared-element callback.

- Double-click enters a note: the camera lerps in, and the title and each part of the note fly from their collapsed spots to their full-view spots.
- **Done when:** entering and leaving a note never cross-fades text, and holds 60 fps.

### Wave 8: Icons, cursors and the feel check

- ⚠ **Needs Kaelen:** the chunky cursor and grab-hand set (Aseprite-like, not retro). Park the task until the drawings are in `Design/`, then wire them in as SVG cursors.
- A full screenshot set of every state, next to every sketch, into `Design/UI Build Review.md`. Queue the feel check in `autonomy/REVIEW.md`: tune the look values in the running app.

## Not in this build

Brush dock and tools (they need the tool host from the canvas work), value dots and the rules code window (Mathspace), describe-a-brush, drawing on notes, and dark theme. Each stays a card on [[Plugin Map]].

## Gates for Kaelen (collected)

1. Underline and strikethrough mark names (wave 3).
2. Per-note collapse settings record shape (wave 5).
3. Cursor and hand drawings (wave 8).
4. Rifling and text bob default on or off for writers (wave 6).
5. The final feel check (wave 8).

Under the autonomy protocol, a session never stops at these: it takes the reversible option written above, queues the item in `autonomy/REVIEW.md`, and moves on.

## How to start Part 2

GSD phases need a roadmap entry and plan files, and none exist for this yet. In `~/Tapestrees/ui`:

1. Insert a phase after 2.8, for example **"2.9: Note Look"**, with this Part 2 as its context (`gsd-phase` to insert, then `gsd-plan-phase 2.9`, which reads this file and writes one PLAN per wave).
2. Copy `run.sh`, `watch.py` and `PROTOCOL.md` from `autonomy/windows/` into `autonomy/ui/`, and write a `PROMPT.md` naming `ws/ui` and phase 2.9.
3. Start the driver.
