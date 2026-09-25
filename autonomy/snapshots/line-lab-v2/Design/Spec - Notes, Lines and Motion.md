---
tags: [design, spec]
source: "[[Dump]]"
updated: 2026-09-25
status: draft — open questions at the bottom are Kaelen's
---
# Spec: Notes, Lines and Motion

A buildable reading of [[Dump]] and its sketches. Where the dump is the voice, this is the checklist a build window follows. Colours were sampled from the sketches; sizes are proposals to tune.

**Feel in one line:** digital paper, not fake paper. Loose, hand-drawn lines that still draw a clear, tight boundary. Playful, never goofy. Everything moves a little, and everything can be turned down or off.

---

## 1. Tokens

| Token | Value | From |
|---|---|---|
| `--tap-paper`, `--tap-surface` | **keep the app's current values** (warm paper `#F7F5F0`) | Kaelen, 2026-09-25 |
| Note hover | the note's fill lightens a step | sketch 0 vs 1 |
| `--tap-pencil` | `#1C1C1C` (measured from strokes.jpg) | note outline, title rule |
| `--tap-select` | `#489AFE` | selection outline, connection dot, connections |
| `--tap-select-fill` | `#C2DBFA` | text selection |
| `--tap-connect-flash` | `#00FF7F`-ish green, to tune | brief flash when a connection lands |
| `--tap-delete` | `#FC3B02` | red dot |
| `--tap-line` | **constant on screen** at every zoom, ~3 px to tune | outline measured 5 px on a 540 px sketch note |

Every line (outline, selection, connection, title rule, node wires) shares **one weight**, `--tap-line`. The Droids sheet (the red lines, especially the bottom figure's dot-and-beam) is the reference: solid, round-capped and inky, like a Blender/Photoshop pen, not a 1 px vector line.

**Type:** titles, body text and icon symbols are **set in fonts**, not hand-lettered. The sketches' lettering is just sketch style. The lines stay loose; the type stays clean.

## 2. Lines

- Round caps and joins everywhere, at a weight that feels like a pen.
- **Pencil outline (notes):** slightly asymmetric, and **still**: it doesn't move at rest. Its wobble comes from the note's id as the seed, so each note has its own shape, and it's the same every time you open it.
- **Selection outline (blue):** traces the note's edge and has a slow **wave** travelling around it. The outline is a closed loop, so waves wrap around and can meet themselves (sum of a few sines with periodic boundary). Render-only.
- **Connections:** blue, with the same wavy life as the selection. See §6.
- **Constant weight at every zoom.** Lines never get thinner or thicker as you zoom. When a note gets very small it collapses to a fixed-size icon chip (like the `f` button), or to a node dot, and doesn't shrink below that. See §2a.

## 2a. Zoom behaviour

- Line weight, dot size and icon size are fixed **in screen pixels**. Shapes (the wobble of an outline, a note's proportions) are fixed **in world space**, so they scale with zoom.
- Zooming out, a note shrinks until it reaches a minimum on-screen size, then **collapses** to one of:
  - an **icon chip** the size of the `f` button, which never shrinks further, or
  - a **node dot**.
- Order as you zoom out: **note → circle → node dot**. The thresholds are **per note, in note settings** (Kaelen, 2026-09-25). Defaults to tune in [Line Lab](https://claude.ai/artifact/7Z98pZQhW67Mm5haottzrf): circle below 110 px on screen, dot below 48 px.

## 2b. How the hand-drawn look is built

Render-only; nothing here reaches the `.tree`. Four layers, each with a tunable strength:

1. **Path wobble.** Low-frequency noise pushes the path in and out along its normal, seeded by the note's id, so each outline has its own stable shape. Corner radii vary a little per corner. The wobble lives in world space, so it stays put when you zoom.
2. **Width variation.** The stroke is a filled outline, not a fixed-width line: it swells and thins slightly along its length, like pen pressure. The *average* width stays at `--tap-line` on screen. [perfect-freehand](https://github.com/steveruiz/perfect-freehand) (MIT, the tldraw author's library) generates exactly this outline from a point list.
3. **Grainy edges.** In a shader, each line is drawn as a distance field; noise nudges the alpha cut-off at its edge, giving the slightly toothy edge of the sketch brush. The grain is sized in screen pixels, so it looks the same at every zoom.
4. **Live waves.** For selection outlines and connections: a sine displacement travelling along arc length. On a closed outline the wavelength divides the loop length evenly, so the wave meets itself without a seam.

Dots use the same distance field and grain, with a slight ellipse irregularity. Text is never roughened: fonts stay crisp.

**Measured from [[strokes.jpg]] (2026-09-25)**, which "should look almost exactly like this":

| Property | Measured | Means |
|---|---|---|
| Colour | `#1C1C1C`, flat | `--tap-pencil` becomes `#1C1C1C` |
| Width | 7–9 px on a 1000 px canvas | nearly monoline: width variation ~10% |
| Corners | up to 18 px where the pen turns | **corner swell** is the main character, not grain |
| Edges | crisp, ~1 px anti-alias | **edge grain is off** by default |
| Path | the "straight" line drifts 7 px over 220 px | wobble is a gentle, low-frequency bow |
| Dots | 9 px, same as the line | node dots = line weight × ~2.8 diameter |

So layer 3 (grain) defaults to zero, and layer 2 is mostly corner swell. Tune all of it in **[Line Lab](https://claude.ai/artifact/7Z98pZQhW67Mm5haottzrf)**, which draws your sample shapes beside the renderer's.

**Original request for samples:** a few sample strokes exported at 100% (a straight line, a circle, a sharp corner, a dot), plus the app and brush name. Width variation and edge grain get measured from those, and the grain texture can be sampled straight from them.

## 3. Nodes (value dots)

- A dot the same thickness as `--tap-line` × ~2 diameter, dark grey by default. **Colour is a field on the node** (any colour).
- A value inside a note reads `● value`: dot on the left, value to the right.
- Dots are ports: drag from one to another to wire them (node-based editing). See §8.

## 4. The note

Anatomy, from the sketches:

- Rounded rectangle, paper fill, pencil outline.
- **Title**: large, set in a font, then a pencil **rule** under it, then the body.
- **Top-left cluster**: red dot (delete), then a small **blue dot (start a connection)** on the outline's corner. The green dot from the sketches is dropped.
- **Top-right, when selected:** the format button `f` in a small pencil circle, and to its right the **settings button**.

### States

| State | What changes |
|---|---|
| Rest | Grey fill, pencil outline, no motion |
| Hover | A **brightness bloom** spreads in a circle from the exact point the cursor entered; fill lightens toward `#F8F8F8` |
| Click / selected | Blue outline **grows from the click point** around the edge in a slightly irregular circle (not a perfect circle); the **bob** (§7) plays; the `f` button appears top-right |
| Text selected | `f` expands into a pill of formatting icons along the top: `f i b u ✱`. `✱` is an overflow ("etc.") that opens the rest of the symbols; it isn't a formatting command itself |
| Connecting | Drag from selected text or the blue dot: a **blue** line follows the cursor, ending in a blue dot (sketch 4). When it lands on a target it **flashes green**, then settles back to blue |
| Settings | The settings button **flips the note's contents** to show that note's settings in place; pressing it again flips back |
| Double-click | You **enter** the note (§7, "Entering") |
| Hover the red dot | Only the red dot grows, into a bright, whitened red button with a red outline (same weight as selection) and an ✕. The blue dot stays small. The format bar collapses back to `f` in the corner |

### Formatting

Per-letter: font, italic, bold, colour, underline, strikethrough, plus block formatting. Toolbar behaviour: hovering an icon expands it into its own options inside the same bar; the icon at the end of the bar takes you back. This replaces today's `FloatingToolbar`.

## 5. Buttons

Papery. On hover they **swell** fluidly and pick up the pencil edge line. Destructive buttons follow the red-dot pattern in §4.

## 6. Connections and knots

**Names:** a line joining two things is a **connection**. The **knot** is the small editable note at a connection's centre, holding text about the relationship (2.1, `KnotNode.tsx`); its two halves are **knot-ties**. **Thread** means only a time thread (2.3's z-axis writing history). This matches decision 02.3 D-26 in the code.

A connection joins **a piece of text to another piece of text** (passage to passage), made by a person or an agent: the "assembly jump". Blue, wavy, constant weight. It flashes green when it lands, then rests blue. Built on the existing passage anchors (2.1) and `ConnectionLine.tsx`, which today draws a thin grey 1.5 px line.

## 7. Motion

**Principle:** quick, organic, watery, blob-like, but the shapes stay concrete. Everything settles.

- **Bob on click:** scale on x and y through *up → down → slight up → very slight down → rest*. Proposed default keyframes, ~350 ms total: `1.06, 0.97, 1.015, 0.995, 1.00` (x and y can differ for squash). **The curve lives in a note inside Tapestry**, a real data structure anyone can edit, with no lock. (The World Contains Its Controls.)
- **Entering a note (double-click):** a smooth lerp to fullscreen. The title and each part of the document fly from where they sit in the small note to where they sit in the full view (shared-element transition), not a crossfade.
- **Rifling:** moving the cursor over the canvas nudges things slightly, as if you're riffling through them. Things drift a little away from the cursor, then settle, and grow and centre when you enter their space.
- **Text bob:** text shifts *barely noticeably* as the cursor passes. Must never bother a writer; off is one click away.
- **Move particles:** dragging a note leaves a few wind-like vector particles at its corners, mostly on start and stop (think N++). Medium opacity, only a few at a time, almost invisible.
- **Settings:** every motion has a strength slider and an off switch. On by default, but the OS "reduce motion" setting starts everything at off. The settings button in the toolbar should be a fun thing to touch in its own right.

**Engineering rule:** all of this is render-only. None of it is written to the `.tree` and none of it touches determinism, except the settings note itself, which is ordinary content.

## 8. Rules on notes

A note can hold natural-language rules for how its nodes interact, with a **code window beneath** it.

**Proposed answer to "compile or not":** the natural language is what you write, and the compiled expression shown in the code window is what runs and what the `.tree` records. Replay must never call a model again (HIST-05), so the language can't be the thing that runs. You can edit either side; editing the language re-compiles and shows the diff. This maps onto mathspace, where every note is already fields plus expressions: value rows are fields, dots are ports, wires are bindings.

## 9. Drawing on notes

Notes can be drawn on, with fine control over brush size. Preset brushes, plus **describe the brush you want** and get one made (scope and approach to be sketched: likely an agent turning the description into a brush spec: mass, radius, spacing, curve).

---

## Answered (Kaelen, 2026-09-25)

- **Paper:** keep the app's current paper colour.
- **Corner dots:** keep blue, which starts a thread. Drop green. On red hover the blue dot doesn't grow ("same size as the red, but I don't like that look").
- **Links vs threads:** the same thing. Blue while dragging, green once dropped.
- **`✱`:** an "etc." overflow for more symbols, not a 1:1 command.
- **Settings:** its own button right of `f`; it flips the note to show its settings.
- **Type:** titles and symbols are set in fonts; the lettering was sketch style.

- **Names:** connections are not threads. A connection's centre note is its knot.
- **Landing a connection:** a green flash, then back to blue.
- **Zoom:** constant line weight at every scale; notes collapse note → circle → node dot, with thresholds in each note's settings.

## Open questions

- **Q8 — Typeface.** Which fonts for titles and body? Keep what the app uses now until chosen?

Related: [[Design Review - One Canvas]] · [[Plugin Map]]
