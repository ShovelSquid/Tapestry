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

## Closed

(none)
