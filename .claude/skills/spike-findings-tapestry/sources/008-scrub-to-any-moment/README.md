---
spike: 008
idea: thread-rendering
name: scrub-to-any-moment
type: standard
validates: "Given 58 k edits of history, when the user drags along the line or the date scrubber, then the document as it was at that moment appears in the text window at interactive rate with that letter highlighted (D-17, D-18)"
verdict: VALIDATED
related: [001, 006]
tags: [replay, performance, navigation, prosemirror]
---

# Spike 008: The Document as It Was at Any Moment

## What This Validates

**Given** eight hours of editing history — 58,304 position-bearing edits producing a 46,229
character document — in the repo's Electron on Kaelen's M4 MacBook Air,
**when** the user clicks a point on the line or drags the date scrubber along the bottom,
**then** the document as it was at that moment appears in the text window, read-only, with that
letter highlighted (D-18), fast enough that dragging feels continuous (D-17).

## Research

- **This is only a real question because writing is not append-only.** If every keystroke landed
  at the end, the document at time *t* would be the first *k* characters and a prefix index would
  answer in constant time. Real writing inserts and deletes in the middle, so the document at *t*
  is the result of applying every edit up to *t*. The history this spike generates therefore
  carries a position per edit: mostly appending, sometimes jumping back into the text, and
  deleting a few characters about 6 % of the time.
- **Not through the kernel.** `replayUpTo(seq)` exists on the addon, but spike 006 measured what
  it costs: `Kernel` copies the whole world once per commit, so replay is quadratic in commit
  count and an 8 h thread takes 23 s to open. A scrubber calling it per frame is out of the
  question. D-18's reconstruction belongs in the renderer, over the keystroke records.
- **Two strategies measured:** *naive*, replaying every edit from the beginning on each seek; and
  *snapshot*, keeping the document text every 1000 edits and seeking from the nearest snapshot
  at or before the target.
- **D-03 matters here twice.** Deleted letters stay on the line but leave the document, so the
  line and the document diverge: the line grows forever, the document does not. This spike
  reconstructs the document; the line's own letters are spikes 001–007.

## How to Run

From the repo root (after `cd .planning/spikes && npm install`):

```sh
node_modules/.bin/electron .planning/spikes/008-scrub-to-any-moment/main.cjs           # drag the scrubber; Ctrl+N naive, Ctrl+S snapshot
node_modules/.bin/electron .planning/spikes/008-scrub-to-any-moment/main.cjs --shots   # the document at three moments
node_modules/.bin/electron .planning/spikes/008-scrub-to-any-moment/main.cjs --bench   # random seeks and a continuous drag, both strategies
```

The page accepts `?hours=` and `?snapshot=` to change the history length and the snapshot
interval.

## What to Expect

A text window showing the document as it was, with the letter at the scrubbed moment highlighted
and the text after it faded. Dragging the scrubber along the bottom — ticked by the hour — walks
the document forward and backward. The readout under it reports the moment, which edit it is,
how long the document is, and how long the rebuild took.

**The reconstructed text reads as garbled prose.** That is the generator, not a defect: it
inserts at random positions inside existing text to make reconstruction genuinely
position-dependent. Real writing would read normally; what is being measured is the cost of
applying tens of thousands of positioned edits, not the sentences.

## Observability

`results/bench-*.json` holds every phase; the HUD carries running medians and p95s for both
strategies, so switching between them with Ctrl+N and Ctrl+S is directly comparable.

## Investigation Trail

1. **The history had to be made harder on purpose.** The first design reused spike 006's
   generator, which only appends — and against append-only history the whole question evaporates,
   because the document at *t* is just a prefix. The generator here gives every edit a position
   and deletes about 6 % of the time.
2. **Both strategies work, and I predicted that wrongly.** I expected naive replay to cost about
   110 ms per seek, reasoning from the 108 ms it takes to build the snapshots — which is one full
   pass over the history. Measured, a naive random seek is **3.6 ms**. The build's time is
   dominated by 59 `join()` calls over a growing string, not by the edits; and a random seek
   replays half the history on average, against a document that is shorter for most of its life.
3. **Snapshots are still worth it, for headroom rather than possibility.** 0.2 ms against 3.6 ms
   at the median, and 1.2 ms against 14.9 ms at the worst.

## Results

**Verdict: VALIDATED.** Scrubbing to any moment is comfortably interactive at eight hours of
history, by either strategy, and no frames were dropped.

8 h · 58,304 edits · final document 46,229 characters
Snapshots every 1000 edits: 59 kept, **2.6 MB**, built in **108 ms**

| Phase | Seeks | Rebuild median | p95 | worst | Frame median | Frame worst | Dropped |
|---|---|---|---|---|---|---|---|
| random seeks, snapshot | 200 | **0.2 ms** | 0.7 ms | 1.2 ms | — | — | — |
| random seeks, naive | 20 | 3.6 ms | 14.9 ms | 14.9 ms | — | — | — |
| drag across, snapshot | 300 | **0.4 ms** | 1.7 ms | 3.8 ms | 16.7 ms | 17.7 ms | 0 % |
| drag across, naive | 30 | 4.8 ms | 18.8 ms | 20.2 ms | 16.6 ms | 20.6 ms | 0 % |

**Signal for the build (Phase 2.3):**
- **Reconstruct in the renderer from keystroke records, not through `replayUpTo`.** The kernel's
  replay is quadratic in commit count (spike 006); this is 0.2 ms.
- **Keep snapshots, for headroom rather than feasibility.** Naive works today, but its 14.9 ms p95
  fills an entire 16.7 ms frame on its own — and in the real app that frame also carries the
  thread's WebGL rendering, which this spike does not include. Snapshots leave the frame
  essentially untouched at 1.2 ms worst, for 2.6 MB held in memory and 108 ms at load.
- **The snapshot interval is a knob worth exposing**, not a constant: 1000 edits gives 59
  snapshots and 2.6 MB for an 8 h thread. A much longer thread should either widen the interval
  or keep snapshots only near where the user is looking.
- **Snapshots are derived data and must never be the only copy** — they rebuild from the records
  in 108 ms, which keeps them on the right side of Tapestry's rule that meaning lives in the
  readable history.
- **Not tested:** reconstruction with the thread rendering in the same frame (spike 005 showed the
  canvas and thread coexist, but not this on top), a real ProseMirror document rather than a
  character buffer — formatting marks, links and passages all have to survive the rebuild for
  D-18's "read-only, with that letter highlighted" — deleted letters shown on the line beside the
  document (D-03, spike 009), and a thread long enough for snapshot memory to matter.
