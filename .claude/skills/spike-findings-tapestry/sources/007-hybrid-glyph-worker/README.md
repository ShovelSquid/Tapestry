---
spike: 007
idea: thread-rendering
name: hybrid-glyph-worker
type: standard
validates: "Given browser-SDF cells shown at once while MSDF cells generate in a worker, when a 2000-character paste lands on a cold atlas and the thread passes 1024 distinct glyphs, then no frame drops, cells swap without a visible pop, and the atlas pages"
verdict: PARTIAL
related: [003a, 003b, 004, 005]
tags: [webgl, text, msdf, worker, atlas]
---

# Spike 007: A Cheap Glyph Now, a Sharp Glyph a Moment Later

## What This Validates

**Given** the instanced-quad glyph design from 002b, with a browser-SDF cell (003a, ~0.5 ms)
shown the instant a letter is typed and its MSDF cell (003b, ~8 ms, worst 22.6 ms) generated in
a Web Worker,
**when** someone types, pastes 2000 characters onto a cold atlas, and drives the thread past the
atlas's 1024 cells,
**then** no frame drops, the upgrade is invisible except as sharper letters, and the atlas pages.

Both 003 READMEs name this hybrid as the untested next step. 003a is fast and Unicode-complete
but ripples above 120 px; 003b is razor-sharp but too slow for the main thread. Neither is
enough alone for D-19.

## Research

- **The upgrade is not just a texture write.** `003-shared/glyph-layer.js`'s `write()`
  **snapshots** a grapheme's `quad`, `uv` and `dist` into per-instance attributes. An instance
  holds a copy, not a reference to the cache. An MSDF cell has different metrics (`tw`, `th`,
  `x0`, `y0`, `advance`) and a different `dist` triple (kind 0 → 1, edge `1−cutoff` → 0.5), so
  replacing a cell means **rewriting every instance that already drew that grapheme**.
- **That same mechanism is what atlas eviction needs**, so one piece of machinery answers both
  halves of this spike.
- **This spike forks the glyph layer** into `hybrid-glyph-layer.js`. The shader, cell contract
  and atlas geometry are unchanged; what is added is slot allocation, a per-grapheme instance
  list, `upgrade()` and LRU eviction. A fork rather than an import because everything needed is
  private to the shared module, and widening its interface would change measured code that the
  003 verdicts rest on.
- **A Web Worker needs `nodeIntegrationInWorker`** to `require` msdfgen-wasm. It works
  independently of `nodeIntegration` but is ignored when `sandbox` is true, and Electron's own
  modules are unavailable inside a worker — `fs` and `path` are all msdfgen-wasm needs.
  ([Electron multithreading](https://www.electronjs.org/docs/latest/tutorial/multithreading))
- **Pixels are transferred, not copied**: a cell is 16 KB, and cloning that per message would
  be its own cost.

## How to Run

From the repo root (after `cd .planning/spikes && npm install`):

```sh
node_modules/.bin/electron .planning/spikes/007-hybrid-glyph-worker/main.cjs           # type; Ctrl+1 live, Ctrl+2 side 16 px, Ctrl+3 side 240 px
node_modules/.bin/electron .planning/spikes/007-hybrid-glyph-worker/main.cjs --shots   # placeholder vs upgraded at 240 px
node_modules/.bin/electron .planning/spikes/007-hybrid-glyph-worker/main.cjs --bench   # typing, warm paste, cold paste, and past the atlas limit
```

`--bench` accepts `?cells=` through the page URL to shrink the atlas; the default is 1024.

## What to Expect

Letters appear the moment they are typed and sharpen a few frames later. At 240 px per em the
difference is obvious: the placeholder's strokes ripple and its corners round, the upgraded
glyph has straight diagonals and true corners. The HUD reports cells, MSDF cells, evictions,
worker queue depth and the worst instance-rewrite.

## Observability

`results/shots/` holds the placeholder and upgraded captures; `results/bench-*.json` holds every
phase. The layer reports `evictScanMs`, `evictRewriteMs` and `evictMaxMs` separately from the
transaction's own `txMaxMs`, so a stall can be attributed rather than guessed at.

## Investigation Trail

1. **The worker works first time.** MSDF generation moved off the main thread unchanged from
   003b: 8.0 ms worst generation, 11–15 ms round trip including transfer.
2. **The first screenshots proved nothing.** Both captures were identical, because the worker
   returns a cell in ~11 ms and the "before" shot was taken at +120 ms — I was racing a window
   that had already closed. Fixed by *holding* upgrade requests and releasing them deliberately
   after the placeholder capture. A timing race is not evidence.
3. **The letters were piled on top of each other.** `sendInputEvent` types as fast as it can, so
   four keystrokes landed ~0.015 world units apart while a glyph at 240 px per em is ~0.12 units
   wide. Spacing them fixed it.
4. **Then they were off-screen entirely.** A 700 ms gap put letters 1.05 units apart, wider than
   the ~0.7 units visible at 240 px, so centring on the word's midpoint parked the camera in the
   gap between two letters. 120 ms (~0.18 units) reads as separate letters and fits in frame.
5. **The crop was in the wrong units.** `capturePage(rect)` takes **CSS pixels**, not device
   pixels; a rect starting at y = 850 in a 900 px-tall window clamped to a 50 px sliver. Three
   framing mistakes in a row, each one only visible by looking at the picture.
6. **The comparison, once it was real:** placeholder strokes visibly ripple, upgraded strokes are
   straight with true corners — 003a and 003b side by side on the same letters in the same frame.
7. **The benchmark found a 466 ms stall** on a paste of 2000 never-seen glyphs, and a 283 ms one
   past the atlas limit.
8. **The cause was not what I expected.** The obvious suspect was eviction: an O(cells) LRU scan
   run 2,496 times is 2.5 M iterations. Measured, that scan costs **14 ms in total**, the
   instance rewrites **1 ms in total**, and the worst single eviction **0.5 ms**. The stall is
   the **paste transaction**: 2000 graphemes arrive in one synchronous transaction and each needs
   a placeholder rasterized before the browser can paint — **268 ms**. The identical 2000-character
   paste of *cached* glyphs took **under 10 ms**. The cost is first use, not paste size.

## Results

**Verdict: PARTIAL.** The hybrid pipeline is validated and cheap. **Atlas paging by LRU eviction
is invalidated**, and a paste of thousands of never-seen glyphs stalls.

| Phase | fps | p95 | worst frame | dropped | cells | msdf | evictions | evict scan | evict rewrite | worst transaction | worker backlog |
|---|---|---|---|---|---|---|---|---|---|---|---|
| typing 20/s, cold atlas | 59.9 | 17.3 ms | 17.7 ms | 0 % | 20 | 20 | 0 | — | — | 10 ms / 1 letter | 7 ms |
| paste 2000, warm glyphs | 59.9 | 17.0 ms | 17.6 ms | 0 % | 20 | 20 | 0 | — | — | **< 10 ms / 2000 letters** | 7 ms |
| paste 2000, cold glyphs | 59.9 | 17.0 ms | **466.7 ms** | 0.9 % | 1024 | 54 | 996 | 7 ms total | 1 ms total | **268 ms / 2000 letters** | 4,131 ms |
| past the 1024-cell limit | 59.9 | 17.0 ms | **283.3 ms** | 0.9 % | 1024 | **0** | 2,496 | 14 ms total | 1 ms total | 268 ms / 2000 letters | 8,533 ms |

Swapping a cell costs **0.100 ms** at worst on the main thread, and the texture copy 0.80 ms.
Only 2 frames in ~220 exceeded 25 ms in the bad phases — these are single stalls, not sustained
cost; p95 stayed at 17.0 ms throughout.

**Signal for the build (Phase 2.3):**
- **Ship the hybrid.** A letter appears immediately and sharpens within ~15 ms, which satisfies
  D-19 without the 8 ms-per-glyph cost ever touching a frame. The swap itself is free (0.1 ms),
  and at 240 px the improvement is plainly visible.
- **Rasterize placeholders across frames, not inside the transaction.** A paste of N never-seen
  graphemes costs N × placeholder synchronously — 268 ms for 2000 — because ProseMirror delivers
  the whole paste in one transaction and every letter is placed before the next paint. The letters
  still need positions immediately; what can wait is their *cells*. Place instances with a blank
  cell and fill them over the following frames.
- **LRU eviction is the wrong paging policy.** Its cost is negligible, but under pressure it
  thrashes: 2,496 evictions drove MSDF cells to **zero**, discarding every glyph the worker had
  sharpened, and an evicted letter disappears from the line entirely. A thread in CJK passes
  1024 distinct glyphs quickly. Candidates: a second atlas page (the shader samples one texture,
  so this means an array texture or a second draw call), a larger atlas, or evicting only cells
  with no visible instances.
- **The worker queue needs a policy too.** It reached 8.5 s of backlog because every new glyph
  queues a request. Prioritise graphemes that are actually on screen, and drop requests for
  graphemes whose cell has since been evicted.
- **Not tested:** a second atlas page, prioritised or cancellable worker requests, colour emoji
  under eviction (they have no sharper version to request), the hybrid inside the real app
  (spike 005), and 120 Hz displays.
