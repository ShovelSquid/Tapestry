---
created: 2026-09-25
status: for review
plan: "[[Plan - Line Lab v2]]"
---

# UI Build Review

The note look from [[Plan - Line Lab v2]] Part 2 (waves 0–7), as built on `ws/ui`. Each state of the dev app sits next to the sketch from [[Dump]] that it answers. The sketch is always on the left. Every shot was retaken on 2026-09-25 from one build, after wave 7 and a merge of `ws/mergin`, so the states all show the same code. The notes under each pair say where the app and the sketch differ.

Retake them with `autonomy/checks/line-lab-v2/wave8-shoot-all.sh` in `~/Tapestrees/ui`. It uses a scratch space, never your data.

## Sketch 0: basic note

![[UI Build Review/sketch0-basic-note.jpg]]

"Orbit rules" is the note at rest. It has a pencil outline seeded by its id, a set title, an ink rule and a body. No buttons show until you hover or select.
- **Differs:** the sketch's lines are a thick brush, while the app uses your tuned 1 px at 100% zoom. The weight scales with zoom (Task 7b).

## Sketch 1: hovering

![[UI Build Review/sketch1-hover.jpg]]

"Hovered" has the bloom in from the pointer's entry point, plus the red delete dot and blue connect dot on the corner.
- **Differs:** a still frame can't show the bloom well. It is a soft lightening, so check it live. The green dot from the sketch is dropped, as the spec says.

## Sketch 2: clicked, format icon added

![[UI Build Review/sketch2-clicked.jpg]]

First app frame: "Selected" at rest, with the blue line in place of the pencil and the `f` and settings buttons. Second frame: a selection mid-grow on "Orbit rules" (the blue eating the pencil from the click point), with the red dot hovered on "Selected" and its ✕ showing.
- **Differs:** the settings button (✱ glyph) sits beside `f`, which the sketch doesn't have. The plan added it in wave 3.

## Sketch 3: select text, the format pill

![[UI Build Review/sketch3-format.jpg]]

First app frame: "some" is selected and bold applied through the pill `f i b u ✱`. Second frame: the settings face (colour, collapse thresholds).
- **Differs:** `u` (underline) and strikethrough are disabled until the mark names are approved (gate 1, REVIEW #6). The thresholds are read-only (gate 2, REVIEW #8). While the pill is open the red dot hides, whereas the sketch shows it next to the pill. The pill is also drawn with a thin line, not the sketch's heavy one.

## Sketch 4: starting a connection

![[UI Build Review/sketch4-connection.jpg]]

The app frames show a drag from Source's blue dot (the live blue line ending in a dot), then the landing on Right (the green flash), then at rest (blue waving lines, with the knot "because" as a small note).
- **Differs:** the drag starts from the blue dot here. Starting from selected text works the same way but isn't posed. The resting lines are faint at this zoom.

## Strokes: line feel

![[UI Build Review/strokes-line-feel.jpg]]

The pencil quality next to your strokes sheet.
- **Differs:** this is the biggest gap. Your strokes are much heavier than the tuned 1 px. If the notes should read like the strokes, the line weight in `look/values.ts` is the one number to raise.

## States with no sketch

**Zoom collapse** (wave 5): at 29%, Beds, Tap and Seeds are circles, and Seeds is selected (blue). At 10%, circles become dots.

![[UI Build Review/08-collapse-circles.jpg]]

**Motion panel** (wave 6): "Motion" in the bar, with a switch and a slider per effect.

![[UI Build Review/09-motion-panel.jpg]]

**Entered note** (wave 7): after double-clicking Beds' circle. The card flew from the chip to fill the view.

![[UI Build Review/10-entered-note.jpg]]

- **Worth a look:** in the entered view the line weight is about 4 px because it scales with the zoom (392%), and the parent Garden's body text shows behind Beds' top-left corner. Nothing hides the parent's contents while you're inside a child.

## Not built

- The chunky cursor and grab-hand set is parked until the drawings are in `Design/` (gate 3).
- The feel check, tuning the look values in the running app, is queued for you (gate 5).
