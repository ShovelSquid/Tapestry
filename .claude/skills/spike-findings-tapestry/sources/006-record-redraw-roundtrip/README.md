---
spike: 006
idea: thread-rendering
name: record-redraw-roundtrip
type: standard
validates: "Given live typing captured as readable .tree keystroke and session records (D-06), when the world is closed and reopened, then the line redraws identically from records alone — same letters, same positions, same dashes — and a person can read the typing in a text editor"
verdict: PARTIAL
related: [001, 005]
tags: [tree, persistence, replay, readability, kernel]
---

# Spike 006: Keystrokes into `.tree` and Back Out Again

## What This Validates

**Given** a thread's typing recorded as `.tree` commits the way D-06 specifies — small commits
as you type, each listing letters with their time offsets —
**when** the world is closed and reopened through the real kernel,
**then** every letter comes back at the time it was typed, the line can be redrawn from records
alone, and a person can read the typing in a text editor without Tapestry.

This is the first spike that touches storage. Spikes 001–005 generated history from a seeded
function in memory; nothing was ever written or read back.

## Research

- **The native addon loads under plain Node.** `require('app/native/build/Release/tapestry_addon.node')`
  returns `TapestryAddon`, with static `create(path, world)` / `open(path)` and instance
  `submit`, `getNode(s)`, `status`, `replayUpTo`, `getLastSeq`, `getHistoryIndex`, `close`. So
  this spike drives the **real `.tree` writer and reader**, not a JavaScript imitation of them.
  That is the difference between "my encoder agrees with my decoder" and "the kernel wrote it
  and the kernel read it back".
- **Op verbs from JS are camelCase** and differ from the verbs written in the file:
  `createNode`, `setProperty` (`{target, key, type, value}`), `unsetProperty`, `createEdge`,
  `deleteNode`, `deleteEdge`, `advance`.
- **The format allows only seven verbs and six value types** (`text`, `int`, `real`, `bool`,
  `ref`, `time`); plugins compose everything from them and never add a verb. Property keys match
  `[A-Za-z_][A-Za-z0-9_.:-]*`. Text longer than 80 bytes or containing a line feed becomes a
  `<<TEXT` block. `recorded` is **whole-second UTC**, so sub-second keystroke timing cannot live
  there — it has to be property data, which is what D-06 already assumes.
- **`x-` extension lines are implemented in the codec but unreachable from the app.** The
  Encoder writes `record.extensionLines` verbatim and the Decoder preserves them, but the addon
  exposes no way to attach or read one, and there is no `getCommits()`. The only path from JS to
  the journal is `submit(ops)`. **So keystrokes-as-extension-lines is not a design option for
  2.3 without new C++ surface; keystrokes must be ordinary properties.**

### The encoding this spike tests

One property per commit, keyed in order, holding a readable block:

```text
set n1 keys.000123 text <<TEXT
@ 12345.678
+0.000 T
+0.117 h
+0.049 r
TEXT
```

`@` is the batch's anchor in seconds from the thread's start; each `+` line is an offset **from
that anchor**, then the grapheme. Sessions are their own properties (`session.000001`).

## How to Run

From the repo root:

```sh
node .planning/spikes/006-record-redraw-roundtrip/roundtrip.cjs                          # 1 h and 8 h
node .planning/spikes/006-record-redraw-roundtrip/roundtrip.cjs --hours 8 --keep         # keep the .tree to read
node .planning/spikes/006-record-redraw-roundtrip/roundtrip.cjs --hours 8 --commit-seconds 5
```

It needs no Electron and no `npm install`: the addon is already built at
`app/native/build/Release/tapestry_addon.node`.

## What to Expect

A table per run: keystrokes, commits, properties, file size, bytes per keystroke, write time,
reopen time, read time, redraw time, journal status, and whether the redrawn keystrokes are
identical to what was typed. Then an excerpt of a real commit from the file.

## Investigation Trail

1. **A smoke test first**, before writing the spike: create a world, submit a `createNode` and a
   keystroke property, close, reopen, read it back. It worked first time, and the bytes were
   already the shape D-06 describes. That made the real questions scale and fidelity rather than
   feasibility.
2. **1 h: everything fine.** 5,396 keystrokes, 2,268 commits, 0.7 MB, reopen 176 ms, redraw
   2 ms, identical.
3. **8 h: reopening takes 22.7 seconds.** Same code, same encoding, still identical and still
   `Ok` — but 26,814 commits took **22,668 ms** to reopen against 176 ms for 2,268.
4. **Measured the curve rather than extrapolating it.** 2 h and 4 h fill in: 5,058 commits →
   785 ms, 12,333 → 4,647 ms. Each step of ~2.2–2.4× in commits costs ~4.5–5.9× in time. Four
   points, exponent ≈ 2.0. **Reopen is quadratic in commit count.**
5. **Found the cause in the kernel, not guessed at it.** `Kernel::fromJournal` — the open path —
   does this once per commit:

   ```cpp
   World scratch = kernel->m_world;   // a full copy of the world
   for (const Op& original : commit.ops) { … scratch.apply(op); }
   kernel->m_world = std::move(scratch);
   ```

   The whole world is copied per commit so that a commit which will not apply leaves the world
   at the previous commit rather than half-applied. With a node accumulating 26,840 properties
   over 26,814 commits, that is n²/2 property copies. `replayUpTo` and `submit` carry the same
   pattern — which also explains why write cost per commit drifted from 4.2 ms to 5.0 ms as the
   world grew.
6. **The commit window is the available lever, and it is only a lever.** At 8 h: a 2 s window
   gives 5,823 commits and a 1,078 ms reopen; a 5 s window gives 2,430 commits and **237 ms** —
   98× faster than ⅓ s, with the file shrinking 8.0 MB → 1.2 MB. The quadratic prediction is
   near-exact: 4.60× fewer commits, 21.1× faster, and 4.60² = 21.2.
7. **A fidelity failure that was mine, not the kernel's.** Both wide-window runs first reported
   `identical: NO — time at 12: 1.524 vs 1.52196`. The encoder wrote each offset as a delta from
   the *previous* keystroke at three decimals, and the decoder re-accumulated them, so rounding
   compounded with batch length: harmless at ~2.4 keystrokes per batch, 2.03 ms of drift at ~27.
   Rewritten to anchor-relative offsets, error is bounded at half a millisecond however long the
   batch — and the format reads better. Every window is identical after the fix.

## Results

**Verdict: PARTIAL.** The encoding is right and the round-trip is exact. The **commit rate D-06
specifies does not scale**, and the wider commit window shifts the curve without changing its
shape.

### Scaling at D-06's ⅓ s commit window

| History | Keystrokes | Commits | Properties | File | Bytes/key | Write | Reopen | Read | Redraw | Identical |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 h | 5,396 | 2,268 | 2,271 | 0.7 MB | 130 | 9.4 s | 176 ms | 1 ms | 2 ms | ✓ |
| 2 h | 12,273 | 5,058 | 5,063 | 1.5 MB | 128 | 19.9 s | 785 ms | 4 ms | 4 ms | ✓ |
| 4 h | 29,956 | 12,333 | 12,345 | 3.7 MB | 128 | 55.0 s | 4,647 ms | 9 ms | 8 ms | ✓ |
| 8 h | 64,552 | 26,814 | 26,840 | 8.0 MB | 129 | 137.1 s | **23,214 ms** | 31 ms | 17 ms | ✓ |

### The commit window, at 8 h (64,552 keystrokes in every row)

| Window | Commits | File | Bytes/key | Write | Reopen | Identical |
|---|---|---|---|---|---|---|
| ⅓ s (D-06) | 26,814 | 8.0 MB | 129 | 137.1 s | 23,214 ms | ✓ |
| 2 s | 5,823 | 2.2 MB | 35 | 24.5 s | 1,078 ms | ✓ |
| 5 s | 2,430 | 1.2 MB | 20 | 9.3 s | **237 ms** | ✓ |

Writing is not the problem: 4–5 ms per commit is comfortable when commits arrive every ⅓ s in
real time. The 137 s figure is only an hour of typing replayed as fast as the disk allows.
Reading back is cheap too — 31 ms to fetch the node, 17 ms to rebuild 64,552 keystrokes.

**Signal for the build (Phase 2.3):**
- **Keystrokes are ordinary `set` properties.** Extension lines are unreachable from the
  application, so this is settled, not chosen.
- **Anchor keystroke offsets to the batch**, never to the previous keystroke. Cumulative deltas
  re-accumulate their rounding on the way back in, and the error grows with batch length.
- **The real fix is in the kernel, not the format.** Copy-per-commit makes opening any world
  quadratic in its commit count. A 5 s window buys one order of magnitude; a thread four times
  longer lands back at 23 s. Threads are simply the first feature that makes a single node
  accumulate tens of thousands of properties, so this would surface eventually regardless.
  Candidates: apply ops to the live world with an undo log instead of copying, or copy only the
  nodes a commit touches.
- **The commit window is a real user-facing tradeoff**: crash exposure against reopen time and
  file size. ⅓ s loses at most a moment and costs 8.0 MB and 23 s; 5 s loses at most five
  seconds and costs 1.2 MB and 237 ms. Worth putting to Kaelen rather than deciding silently.
- **The file stays readable at every setting** — a commit is a `<<TEXT` block of `+offset
  grapheme` lines — but D-06's small commits make the file about ten times the size of the text
  they record, because two 71-byte digests plus parent, branch, recorded, tick and actor wrap
  roughly 2.4 keystrokes.
- **Not tested:** deletions and undo markers on the line (only the encoding slot exists, D-03
  and D-04 are spike 009), more than one thread in a world, a world that also holds ordinary
  notes, `replayUpTo` as a scrubbing primitive (spike 008), and concurrent writers.
