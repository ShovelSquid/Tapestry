# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 2: approved`, or the issues you saw); the next session acts on it.

## Open

### 1. Publish Line Lab v2 to the existing artifact (Plan - Line Lab v2, Task 8)

Built and screenshotted, not published: unattended sessions have no
Artifact tool, so the publish step can't run here. The built page is
`~/Tree/Design/Line Lab/line-lab.html` (screenshot:
`autonomy/checks/line-lab-v2/screenshot-2026-09-25.png`).

To check: in a Claude session that has the Artifact tool, `action: "read"`
on `https://claude.ai/artifact/7Z98pZQhW67Mm5haottzrf`, then publish
`line-lab.html` with that same `url` (no `icon`). Open the link in a fresh
browser. The sliders should show 1 px / 1.4 / 3 / 14% / 46% / 0%, 1.2 / 2 /
0.35, 350 / 670 / 770 ms, 110 / 28 px, and the button should say "Reset to
Kaelen's values". Then write `item 1: approved` (or the issues) in
`autonomy/RESPONSE`. The next session ticks Task 8.
If no: the pre-plan page is at
`autonomy/snapshots/line-lab-v2/Design/Line Lab/line-lab.src.html`.

### 2. Feel of the Line Lab v2 behaviours (Plan - Line Lab v2, tasks 2-7b)

Choices the plan left open, made by the unattended session:
- **Particle direction.** Particles fly *in* the direction of the velocity
  change, from the two corners facing it. So starting a drag right throws
  specks forward-right, and stopping throws them backward. That is the
  literal reading of your note, and the opposite of v1's trailing dust on
  start. A change must pass 0.45 px/ms (smoothed over ~70 ms against a ~¼ s
  reference). The burst waits for the change's peak, then throws
  round(peak / 0.45) specks, capped at 3, with a 120 ms cooldown.
- **Red dot:** a linear 180 ms 0→1 amount shown through smoothstep, so
  in and out follow the same curve. Its wave uses the note's wave with counts
  scaled to the dot's loop length (at least 1).
- **Deselect** replays the grow backwards (the pencil returns last where
  the blue started).
- **Static weight in the page too.** Task 7b only named the spec, but the
  page said "line weight stays the same on screen", so the lab now scales
  the note's lines (and wave height) with zoom too. The circle and dot stay
  fixed. The weight slider is relabelled "Weight at 100% zoom".
- Not changed, because the plan didn't name them: Plugin Map cards
  "Hand-drawn line renderer" and "Semantic zoom" still say "constant
  (screen) weight".

To check: open the page (item 1), drag the note in a sharp zigzag, sweep
across it, select and deselect, hover and leave the red dot, zoom to the
circle and select it. Write `item 2: approved` or what feels wrong in
`autonomy/RESPONSE`.
If no: the snapshot above undoes the page, and
`autonomy/snapshots/line-lab-v2/Design/Spec - Notes, Lines and Motion.md` the spec.


### 3. Wave 0 (Foundations): merge into mergin, and a look with notes on screen (Plan - Line Lab v2, Part 2)

Done on `ws/ui` in 70f1436 and cc76bb7 (`git merge ws/mergin` was already up to date at 07aeaa4).
- **Token pass.** Every hex colour in `App.css` rules and renderer inline styles now reads a `--tap-*` token
  from the `:root` block. The spec's six tokens are added (`--tap-pencil`, `--tap-select`, `--tap-select-fill`,
  `--tap-connect-flash` = `#00FF7F` to tune, `--tap-delete`, `--tap-line: 1px`), but nothing uses them yet:
  the pencil only has somewhere to go once wave 2 draws the outline, so "no visual change except the pencil
  colour" came out as no visual change at all. Near-duplicate greys kept their own tokens rather than being
  merged, so the app stays pixel-identical.
- **One exception:** the text-colour palette in `editor/schema.ts` keeps its hex values, because those strings
  are written into the `.tree` as mark attributes. They're data, not styling.
- `renderer/look/values.ts` (your JSON key for key, plus Line Lab's untuned constants) and `renderer/look/motion.ts`
  (scheduler, eased amounts, bob, per-effect strength and off switch, reduce motion starts everything at off,
  and a saved choice wins after that), with 16 unit tests. The full suite passes: 1148 tests.
- Check: the empty-state screenshot `autonomy/checks/line-lab-v2/app-wave0-2026-09-25.png` is pixel-identical
  to the same build from 379c07f. The headless run couldn't create a note, so **please open the dev app with a few
  notes, a selection, the toolbar and a plugin error, and check nothing changed colour.**
- **Merge `ws/ui` wave 0 into `ws/mergin`** (sessions can't merge there).

Answer `item 3: approved` or the issues in `autonomy/RESPONSE`.
If no: `git revert cc76bb7 70f1436` on ws/ui.

### 4. Wave 1 (the ink line renderer): merge into mergin, and a look at the line (Plan - Line Lab v2, Part 2)

Done on `ws/ui` in aa12cda. Nothing in the app draws with it yet (wave 2 wires it into NoteCard), so the app itself doesn't change.
- `renderer/look/ink.ts` ports Line Lab's line (seeded noise, resample, wobble, width variation, corner swell, selection
  wave, the blue's two-sided grow) and outputs **one filled SVG outline path** in world units: both sides of the line
  plus round caps. A whole loop is two rings. `renderer/look/InkLine.tsx` draws it at the card's (0, 0), in pencil or
  blue. With `takeover`, the blue grows from a click point and *replaces* the pencil, then waves. Only animated lines
  request frames.
- Choices: round caps are drawn as short polylines (6 steps) rather than SVG arcs. The minimum width is a quarter of
  the weight. A small note's corner radii are clamped to half its shorter side. Note seeds come from the note id
  through FNV-1a (`seedFromId`).
- Checks: 16 new unit tests (the same seed gives the same path, no seam at any wave time, the blue and pencil never
  overlap, the markup is identical at 8%, 100% and 250% zoom, 3 waving outlines per frame fit the budget). Full suite:
  1164 tests. Electron bench: 200 notes with 3 selected hold 60 fps at 50% and 200% (p95 17.4 ms).
  See `autonomy/checks/line-lab-v2/ink-bench/`.
- **To check:** open `autonomy/checks/line-lab-v2/ink-bench/ink-wave1-zoom200.png` next to Line Lab's note. Does the
  pencil wobble and weight read like the lab?
- **Merge `ws/ui` wave 1 into `ws/mergin`** (sessions can't merge there).

Answer `item 4: approved` or the issues in `autonomy/RESPONSE`.
If no: `git revert aa12cda` on ws/ui, and untick wave 1 in the plan.

### 5. Wave 2 (the note restyle): merge into mergin, and a look at the notes (Plan - Line Lab v2, Part 2)

Done on `ws/ui` in f31d66c (code), with screenshots in a1094a8.
- `NoteCard` now draws its own paper, hover bloom and pencil outline (`look/NoteInk.tsx`), seeded by the note id and
  built once per size, never per zoom. The CSS box is invisible in every state (a `tapestry-note-card--ink` modifier;
  vault, workspace and thread cards keep the old look). Title at 26 px in a font, then an ink rule, then the body.
- Hover bloom comes in from the entry point and drains toward the exit point (`look/bloom.ts`, tested). A blue note
  keeps its light.
- Selected, editing or connect-target: the blue grows from the last pointer point and replaces the pencil, then the
  bob (a transform on the card; the dims reported for connections divide it back out). Deselecting reverses.
- `look/CornerCluster.tsx` replaces the two bubbles on note cards: the red dot on the top-left corner (grows, whitens,
  waves, shows ✕, eases back; delete on press as before) and the small blue dot on the top edge (starts the
  connection as before). They still show only on hover or selection, as the old controls did.
- **Choices to check:** the rest fill is Line Lab's paper `#FBFAF7` (new token `--tap-note`), not the spec's grey;
  the bloom lightens to `--tap-surface` white. The line is your tuned 1 px, so it reads much lighter than the thick
  sketch strokes. Resize still uses the same invisible edge strips; the only change to it is the look.
- Checks: 10 new tests, full suite 1174 green, typecheck and build clean. Screenshots:
  `autonomy/checks/line-lab-v2/wave2-side-by-side-2026-09-25.png` (sketches 0-2 above, the app below: rest, selected,
  hovered; then a selection mid-grow with the red dot hovered).
- **To check in the dev app:** hover across a note (light in and out), click a note's top strip and a note's text (the
  blue grows from the click, then the bob), hover and leave the red dot, drag the blue dot to another note, resize.
- **Merge `ws/ui` wave 2 into `ws/mergin`** (sessions can't merge there).

Answer `item 5: approved` or the issues in `autonomy/RESPONSE`.
If no: `git revert f31d66c` on ws/ui, and untick wave 2 in the plan.

### 6. Wave 3 (format bar and note settings): gate 1, merge into mergin, and a look (Plan - Line Lab v2, Part 2)

Done on `ws/ui` in b720a75.
- A blue note shows two pencil circles top-right, Line Lab's `f` at (w-62, 22) and settings at (w-28, 22).
  `look/FormatBar.tsx` replaces `FloatingToolbar` (deleted) on notes and knots. While editing, a text selection
  or the pointer on the `f` opens the pill `f i b u ✱` on the note's top edge (sketch 3). `i` and `b` toggle.
  `f` opens the fonts, `u` opens underline and strikethrough, and `✱` opens headings, lists, alignment and
  colour, which covers everything the old toolbar did. A section opens in place when pressed or after the
  pointer rests on it for 250 ms, and the `‹` at the end goes back. Hovering the red dot folds the pill back
  to `f`. Pressing `f` on a selected note that isn't being edited starts editing it.
- **⚠ Gate 1: underline and strikethrough mark names.** The buttons are shown disabled. The marks are **not**
  in the schema yet, because a paste of `<u>`/`<s>` would otherwise write them into a `.tree`. Proposed
  names: `underline` and `strikethrough` (ProseMirror mark names with no attrs, parsed from
  `<u>`/`text-decoration: underline` and `<s>`/`<del>`/`<strike>`). Answer with the names, or `approved`
  to use these. On approval the next session adds the two marks to `editor/schema.ts` and enables the two items in
  `look/format-bar.ts`.
- **Settings face:** the settings button flips the note (a 260 ms turn, the new `noteFlip` motion effect)
  to show its colour (Paper) and its collapse thresholds (110 / 28 px). Both are **read-only**. Storing
  either on the note is a new record shape (gate 2 for the thresholds). I treated the note's colour the same
  way, because no colour prop exists on notes yet. Suggested names, if you want them: `look.color`,
  `look.collapse.circle`, `look.collapse.dot`. Escape or the button flips it back, and so does deselecting.
- Also: text selected in notes and knots now uses `--tap-select-fill` (it was the OS highlight, which showed pink).
- Checks: 14 model tests and a round-trip test through the real kernel. In that test, italic, bold, font,
  colour, heading, list and alignment are written to a temp `.tree`, the tree is closed and reopened, and the
  doc comes back identical. Full suite 1189 green, typecheck and build clean. In the app: bold was pressed in
  the pill and the kernel body held `strong`. Screenshots:
  `autonomy/checks/line-lab-v2/wave3-side-by-side-2026-09-25.png` (sketch 3, the pill, the settings face).
- **To check in the dev app:** select text in a note (pill opens), rest on `✱` then `H`, press `‹`, bold some
  text, then reload and see it's still bold. Hover the red dot (the pill folds). Press the settings circle
  and press it again.
- **Merge `ws/ui` wave 3 into `ws/mergin`** (sessions can't merge there).

Answer `item 6: approved` (with or without mark names) or the issues in `autonomy/RESPONSE`.
If no: `git revert b720a75 2bea1d6` on ws/ui, and untick wave 3 in the plan.

### 7. Wave 4 (connections and knots): merge into mergin, and a look (Plan - Line Lab v2, Part 2)

- **What changed:** connections are blue ink lines (`look/connection.ts`, `ConnectionLine`) at the notes'
  static weight. They sag a little like sketch 4 (8% of the length, 40 px at most) and wave with their ends
  held still (0.8 × the selection wave, off with the selection-wave motion setting). The live line while
  dragging from the blue dot ends in a small blue dot. The line that lands flashes `--tap-connect-flash`
  (#00FF7F) for about 270 ms, then fades to blue over 900 ms. Knots are small notes with the same paper and
  pencil outline, taken over by blue on hover and edit. The error copy "Failed to create edge" now says
  "connection". Other "thread" copy in the app names time threads, which D-26 keeps.
- **A bug fixed on the way:** the connections SVG was `100%` of an unsized parent, a 0 × 0 SVG, which Chrome
  doesn't draw even with overflow visible. It's 1 px now. Before this change the grey lines may not have shown
  at all on this branch. Worth a look on mergin too.
- **My calls (taste):** the sag amount, the wave strength, and the flash timing. The live line still starts at
  the source note's centre and runs over the note, as before. Sketch 4 starts it at the selected text, but a
  connection from a text range isn't in the record shape (edges join notes), so I left it.
- Checks: 6 new tests (shape, pinned ends, flash window, markup). Full suite 1194 green, typecheck and build
  clean. Save and reopen in the app with motion off gives identical connection paths (`same: true`; see
  `autonomy/checks/line-lab-v2/README.md`). Screenshots:
  `autonomy/checks/line-lab-v2/wave4-side-by-side-2026-09-25.png` (sketch 4, drag, land, rest).
- **To check in the dev app:** select a note, drag from its blue dot onto another note, watch the green flash,
  reload, and see the line is the same. Hover a note that has a knot.
- **Merge `ws/ui` wave 4 into `ws/mergin`** (sessions can't merge there).

Answer `item 7: approved` or the issues in `autonomy/RESPONSE`.
If no: `git revert 529442f` on ws/ui (and the wip before it), and untick wave 4 in the plan.

### 8. Wave 5 (zoom collapse): gate 2, merge into mergin, and a look (Plan - Line Lab v2, Part 2)

Done on `ws/ui` in 595cfdf (code) and f71416e (checks).
- `look/collapse.ts` decides the form from the note's width on screen: note, then a **circle** below 110 px,
  then a **dot** below 28 px. It applies to every note now, **top-level ones too**, not only nested ones (the
  stage 1 outline was nested-only); a collapsed note hides what is inside it. The hook in `layout/nesting.ts`:
  `OUTLINE_BELOW_PX` and `isOutlined` are gone and `outlineState` calls `collapseForm` (it returns
  `collapsed` forms instead of an `outlined` set). The `.tapestry-note-outline` look is replaced.
- `look/CollapsedNote.tsx`: the circle (44 px, paper fill, the title's first letter, a pencil edge built once
  from the note's seed) and the dot (1.4 px radius) sit at the note's centre, fixed on screen. A selected circle
  is taken over by the blue and waves; a selected dot turns blue. Click selects, double-click zooms in.
- Form changes crossfade over `formCrossfadeMs` (220 ms; the `collapseFade` effect turns it off). A note that
  disappears into a collapsing container fades out too.
- **⚠ Gate 2 (per-note thresholds):** not stored. Every note uses the defaults (`thresholdsFor` in
  collapse.ts), and note settings shows them read-only, as wave 3 left it. To open it, approve a record shape,
  e.g. `look.collapse.circle` and `look.collapse.dot` (real, screen px) on the note.
- **My calls (taste):** the dot is Line Lab's 1.4 px radius, so it is very faint (its hit area is 16 px); the
  circle's letter is 17 px semibold. Connections end at the note's centre, so they meet a circle or dot.
- **Note:** the canvas floor is 10% zoom (`MIN_ZOOM` in Canvas.tsx, canvas-owned), so the plan's "250% to 8%"
  sweep runs 100% to 10%; a 260 px note is already a dot at 10%.
- Checks: 13 new tests (forms, thresholds, the fade tracker, what draws), full suite 1207 green, typecheck and
  build clean. In the app, zooming out gives only note → circle → dot changes, each with both forms on screen
  mid-fade; double-click on a circle zooms 29% → 392%. Screenshots:
  `autonomy/checks/line-lab-v2/wave5-side-by-side-2026-09-25.png` and `app-wave5-*.png`.
- **To check in the dev app:** make a note inside a note, zoom out slowly with the trackpad and watch the
  handoffs, select a note and zoom out (the circle waves), double-click a circle.
- **Merge `ws/ui` wave 5 into `ws/mergin`** (sessions can't merge there; `layout/nesting.ts` is canvas-owned,
  so check the hook against mergin's copy).

Answer `item 8: approved` or the issues in `autonomy/RESPONSE`.
If no: `git revert f71416e 595cfdf` on ws/ui, and untick wave 5 in the plan.

### 9. Line Lab v2 wave 6: motion flourishes (gate 4 open), and a CSS fix to look at

- **Move particles** (`look/particles.ts`, `look/MoveParticles.tsx`): Line Lab's tracker ported as pure code.
  A dragged note throws up to 3 pencil specks from the two corners facing each velocity change, with the 120 ms
  cooldown. They're drawn in the card's own px at a fixed screen size, and the loop runs only while the note is
  dragged and until the last speck fades.
- **⚠ Gate 4, rifling and text bob** (`look/rifle.ts`): notes within 140 screen px of a moving cursor drift away
  from it (at most 4 px × strength) and settle once it stops. The text of the note under the cursor shifts at
  most 1.2 px × strength. Both are on at strength 0.3 (the spec's "low"), which in the app measured a 0.6 px
  nudge and a 0.2 px text shift. The effects use CSS `translate`, so they never touch a position or the `.tree`.
  A note being dragged, resized or **edited** is left still, so a writer's text never moves under them. The
  question for you: should writers get these two off by default? To turn them off by default, change
  `defaultMotionSettings` in `look/motion.ts`.
- **Button swell** (CSS at the end of `App.css`): the chrome buttons (forest bar, dialog buttons, icon, chat
  and agent-menu buttons) swell 5% with a 0.8° tilt and a small overshoot, and take a pencil edge: bordered
  buttons get a pencil border, borderless ones a 1 px pencil inset ring. **My call (taste):** the edge is a
  plain CSS line, not an ink line. An ink outline on every button seemed too heavy for this wave. The
  "grow and centre when you enter their space" part of rifling is not built; the bob already scales the card.
- **Motion panel** (`look/MotionPanel.tsx`), shown in the forest bar as "Motion": its glyph is a wave as tall as
  the average motion strength, flat when everything is off, and it wiggles on hover. The panel has a switch and
  a 0–100 slider per effect (11 of them) and an "All off / All on" button. Settings are per person in
  localStorage and apply live: a waving selection stops as soon as its switch goes off.
- **Fix to check:** wave 0's token pass (70f1436) dropped the closing `}` of
  `.tapestry-ask-claude-button:focus-visible`. Every rule after it in `App.css` was nested and dead from wave 0
  until now: the 02.3 thread scrubber and nav focus rings, `.tap-thread-past-stage`, the author underlay, and
  the `prefers-reduced-motion` block. Wave 6 restores the brace, so those rules apply again as 02.3 wrote them.
  Check that the time-threads side view looks as it did before wave 0.
- Checks: 23 new tests (particles, rifle, panel and settings). The full suite (1230 tests), typecheck and
  build are clean. In the app (`wave6-pose.js`), with motion on the drag threw 3 specks, and the nudge and text
  shift settled back. After "All off" there were 0 specks, no nudge, and **0 animation frames** over the whole
  drag and cursor sequence. Screenshot: `autonomy/checks/line-lab-v2/app-wave6-2026-09-25.png`. No sketch
  covers wave 6, so there's no side-by-side.
- **To check in the dev app:** drag a note hard and turn it sharply, then drop it. Wave the cursor past notes,
  hover the forest-bar buttons, open Motion, press "All off" and do it all again.
- **Merge `ws/ui` wave 6 into `ws/mergin`.** It touches `NoteCard.tsx`, `ForestBar.tsx`, `App.css` and `look/`.

Answer `item 9: approved` (and for gate 4, `rifling on` or `rifling off for writers`), or the issues, in `autonomy/RESPONSE`.
If no: `git revert 87f5348 4df67b5` on ws/ui (keep the `}` fix), and untick wave 6 in the plan.

### 10. Wave 7 (entering a note): merge into mergin, and a look (Plan - Line Lab v2, Part 2)

- **What it does:** double-clicking a note enters it. That works on a card, a circle or a dot, and "Zoom
  into note" in the context menu does the same. The camera glides in until the note fills 85% of the view.
  The note is a shared element: the card grows out of whatever form it was drawn in, scaled with a CSS
  `scale` that runs from the circle's (or dot's) size on screen to the full view, so the title and body fly
  from the chip's spot to their places. Any other note whose form changes on the way (e.g. a circle
  becoming a card) is drawn as its card the whole way too. No text crossfades during a flight. **Escape**
  flies back to where the camera was before you entered: the first Escape stops editing, the second leaves.
  The flight's progress is read off the camera's zoom, so it can't drift from the glide
  (`look/enter.ts`, hook in `Canvas.zoomToFrameRect`).
- **My calls (taste):**
  1. "Full view" means the note fitted to the viewport by the camera. The note's layout doesn't change, so
     inside a card its parts keep their relative places and fly by scaling. A reflowed reading layout would
     be a new feature, so I didn't build one.
  2. Leaving is Escape.
  3. At the start the chip becomes the card at the chip's width, so the circle's round edge snaps to the
     card's rounded rectangle on the first frame.
  4. A double-click inside a note you were already writing in still selects a word; it doesn't enter.
  5. A nested note that is hidden at one end of the glide (inside a collapsed container) switches form
     with no fade instead of flying.
- **Checks:** 7 new tests; the full suite (1237), typecheck and build are clean. In the app (`wave7-pose.js`):
  in 44 → 1020 px and out 1020 → 44 px, both monotonic. There were 0 frames with any crossfade and 0 frames
  with the circle and card drawn together. Frame time median 16.7 ms, p95 16.8 ms, none over 25 ms.
  Double-clicking a full card enters it and creates no note (`wave7-card.js`). Frames:
  `autonomy/checks/line-lab-v2/wave7-flight-2026-09-25.png`. No sketch covers entering.
- **To check in the dev app:** zoom out until notes are circles, double-click one, and watch it grow into
  the view. Press Escape (twice if you were typing). Also double-click a full note.
- **Merge `ws/ui` wave 7 into `ws/mergin`.** It touches `Canvas.tsx`, `TreeFrame.tsx`, `NoteCard.tsx` and `look/`.

Answer `item 10: approved`, or the issues, in `autonomy/RESPONSE`.
If no: `git revert cd23bfc 4d7a907` on ws/ui, and untick wave 7 in the plan.

### 11. Gate 3: the cursor and grab-hand set, parked (Plan - Line Lab v2, Part 2 wave 8)

- **Status:** parked. The drawings aren't in `~/Tree/Design/` yet. [[Dump]] describes the set ("thick and chunky,
  almost like the aseprite icons, yet not too retro"), but no cursor drawings exist. Nothing was built, and the
  app still uses the system cursors.
- **To unpark:** put the cursor and hand drawings in `~/Tree/Design/`. Include at least the pointer, the open
  hand and the closed (grabbing) hand, plus text and connect if you want them. Then answer
  `item 11: drawings in` and the next session wires them in as SVG cursors in `App.css` and ticks the box.
- **Undo:** nothing to undo.

### 12. Gate 5: the feel check, plus the UI Build Review (Plan - Line Lab v2, Part 2 wave 8)

- **What to look at first:** `~/Tree/Design/UI Build Review.md` holds every app state next to the sketch it
  answers (sketches 0–4 and strokes), plus the collapse, Motion panel and entered-note states, each with a
  note on where the two differ. All states were retaken from one build (commit 23abde7).
- **Differences I'd look at first (my read):**
  1. Line weight. The sketches and `strokes.jpg` are much heavier than the tuned 1 px. If notes should read
     like the strokes, raise `LOOK.line.weightPx` in `app/src/renderer/look/values.ts` (it's in Line Lab too).
  2. While the format pill is open the red delete dot hides, whereas sketch 3 shows it beside the pill.
  3. Inside an entered note, the parent's body text shows behind the child's corner, and the line is about 4 px
     at 392%.
- **The feel check:** run the dev app (`npm --prefix app run dev` in `~/Tapestrees/ui`), then hover, click,
  drag, connect, zoom out to circles and dots, double-click in, and press Escape. Tune the numbers in
  `look/values.ts` (the one place they live) or the Motion panel sliders, and write what you want changed.
- **Merge `ws/ui` into `ws/mergin`.** Wave 8 changes no app code: it's the ws/mergin merge plus
  check scripts and images, so it is safe to take along with wave 7 (item 10).

Answer `item 12: approved`, or the values and issues, in `autonomy/RESPONSE`. Answering this closes the plan's
last gate; the plan is `parked` only because of Task 8's publish (item 1) and the cursor set (item 11).
If no: `~/Tree/Design/UI Build Review.md` and `~/Tree/Design/UI Build Review/` are new files from this
session; delete them if you don't want them.

## Closed

(none)
