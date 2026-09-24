# Persistence and Replay

Writing keystrokes into readable `.tree` history, reading them back identically, and rebuilding the document as it was at any moment.

## Requirements

From the `thread-rendering` idea (MANIFEST.md):

- Keystrokes are recorded as ordinary `set` properties, never `x-` extension lines: the codec supports extension lines but the addon's only path to the journal is `submit(ops)` (spike 006)
- Each keystroke's time offset is measured from its batch anchor, never from the previous keystroke; cumulative deltas re-accumulate rounding and drift with batch length (spike 006)
- Opening a world is quadratic in its commit count, because `Kernel::fromJournal`, `replayUpTo` and `submit` each copy the whole world per commit; threads are the first feature to make that visible (spike 006)
- The commit window is a user-facing tradeoff between crash exposure, file size and reopen time (⅓ s: 8.0 MB and 23 s at 8 h; 5 s: 1.2 MB and 237 ms) — Kaelen's call, not a silent default (spike 006)
- The document at a past moment is rebuilt in the renderer from keystroke records, never through the kernel's `replayUpTo`, which is quadratic in commit count (spike 008)
- Document snapshots every ~1000 edits are kept as derived data — 2.6 MB and 108 ms for an 8 h thread — so a scrub costs 0.2 ms and leaves the frame free for the thread's rendering (spike 008)
- Scrubbing must survive a real ProseMirror document, not just characters: formatting, links and passages have to rebuild too for D-18's read-only view (spike 008, untested)

## How to Build It

**Keystrokes are ordinary `set` properties.** This is settled, not chosen: the codec implements `x-` extension lines (the Encoder writes `record.extensionLines` verbatim and the Decoder preserves them) but the addon exposes no way to attach or read one and there is no `getCommits()`. The only path from JS to the journal is `submit(ops)`.

**The encoding, verified exactly round-tripping through the real kernel:**
```text
set n1 keys.000123 text <<TEXT
@ 12345.678
+0.000 T
+0.117 h
+0.049 r
TEXT
```
`@` is the batch's anchor in seconds from the thread's start; each `+` line is an offset **from that anchor**, then the grapheme. Sessions are their own properties (`session.000001`). The file stays readable at every commit window — a person can read the typing in a text editor without Tapestry.

**Anchor every offset to the batch.** Spike 006 first wrote deltas from the *previous* keystroke at three decimals; the decoder re-accumulated them and rounding compounded with batch length — harmless at ~2.4 keystrokes per batch, **2.03 ms of drift at ~27**. Anchor-relative offsets bound the error at half a millisecond however long the batch, and read better.

**Rebuild a past document in the renderer, over the keystroke records — never through `replayUpTo`.** Keep the document text every ~1000 edits and seek from the nearest snapshot at or before the target:

| Strategy | median | p95 | worst |
|---|---|---|---|
| snapshot every 1000 edits | **0.2 ms** | 0.7 ms | 1.2 ms |
| naive replay from the start | 3.6 ms | 14.9 ms | 14.9 ms |

Snapshots are **derived data and must never be the only copy** — they rebuild from the records in 108 ms, which keeps them on the right side of Tapestry's rule that meaning lives in the readable history. The interval is a knob worth exposing, not a constant: a much longer thread should widen it or keep snapshots only near where the user is looking.

**Note the reason the naive path is even viable:** a random seek replays half the history on average, against a document that is shorter for most of its life. It still costs a 14.9 ms p95 — an entire 16.7 ms frame, in a frame that must also carry the thread's WebGL rendering. Snapshots buy headroom, not possibility.

## What to Avoid

- **D-06's ⅓ s commit window at multi-hour scale, without fixing the kernel.** Reopening is **quadratic in commit count**. Measured across four points (2,268 → 5,058 → 12,333 → 26,814 commits giving 176 ms → 785 ms → 4,647 ms → 23,214 ms), the exponent is ≈ 2.0. The cause is in the kernel, not the format: `Kernel::fromJournal` does `World scratch = kernel->m_world;` — a full copy of the world — **once per commit**, so a commit that will not apply leaves the world at the previous commit rather than half-applied. With one node accumulating 26,840 properties over 26,814 commits that is n²/2 property copies. `replayUpTo` and `submit` carry the same pattern, which is also why write cost per commit drifted from 4.2 ms to 5.0 ms as the world grew.
- **Treating the commit window as the fix.** It shifts the curve without changing its shape: a 5 s window is 98× faster at 8 h, and a thread four times longer lands back at 23 s. The real fix is applying ops to the live world with an undo log, or copying only the nodes a commit touches.
- **Calling `replayUpTo` from a scrubber.** Out of the question at 23 s per open. D-18's reconstruction belongs in the renderer.
- **Benchmarking reconstruction against append-only history.** If every keystroke landed at the end, the document at time *t* would be the first *k* characters and a prefix index would answer in constant time — the question evaporates. Real writing inserts and deletes in the middle, so the generator must give every edit a position and delete some of the time (~6 %). Spike 008's reconstructed text reads as garbled prose for exactly this reason; that is the generator, not a defect.
- **Reasoning from the snapshot build time to the seek time.** Spike 008 predicted ~110 ms per naive seek from the 108 ms snapshot build — one full pass over the history. Measured: 3.6 ms. The build is dominated by 59 `join()` calls over a growing string, not by the edits.
- **Writing sub-second timing into `recorded`.** It is whole-second UTC. Sub-second keystroke timing has to be property data.

## Constraints

- **The native addon loads under plain Node** — no Electron, no `npm install`: `require('app/native/build/Release/tapestry_addon.node')` gives `TapestryAddon.create(path, world)` / `.open(path)` plus `submit`, `getNode(s)`, `getEdges`, `status`, `replayUpTo`, `getLastSeq`, `getHistoryIndex`, `close`.
- **Op verbs from JS are camelCase** and differ from the verbs written in the file: `createNode`, `setProperty` (`{target, key, type, value}`), `unsetProperty`, `createEdge`, `deleteNode`, `deleteEdge`, `advance`.
- **The format allows seven verbs and six value types** (`text`, `int`, `real`, `bool`, `ref`, `time`); plugins compose everything from them and never add a verb. Property keys match `[A-Za-z_][A-Za-z0-9_.:-]*`. Text over 80 bytes or containing a line feed becomes a `<<TEXT` block.
- **Round-trip is exact at every commit window tested** — identical letters, times and dashes.

Scaling at D-06's ⅓ s window:

| History | Keystrokes | Commits | File | Write | Reopen | Read | Redraw |
|---|---|---|---|---|---|---|---|
| 1 h | 5,396 | 2,268 | 0.7 MB | 9.4 s | 176 ms | 1 ms | 2 ms |
| 2 h | 12,273 | 5,058 | 1.5 MB | 19.9 s | 785 ms | 4 ms | 4 ms |
| 4 h | 29,956 | 12,333 | 3.7 MB | 55.0 s | 4,647 ms | 9 ms | 8 ms |
| 8 h | 64,552 | 26,814 | 8.0 MB | 137.1 s | **23,214 ms** | 31 ms | 17 ms |

The commit window at 8 h (64,552 keystrokes in every row):

| Window | Commits | File | Bytes/key | Write | Reopen |
|---|---|---|---|---|---|
| ⅓ s (D-06) | 26,814 | 8.0 MB | 129 | 137.1 s | 23,214 ms |
| 2 s | 5,823 | 2.2 MB | 35 | 24.5 s | 1,078 ms |
| 5 s | 2,430 | 1.2 MB | 20 | 9.3 s | **237 ms** |

- Writing is not the problem: 4–5 ms per commit is comfortable when commits arrive every ⅓ s in real time; the 137 s figure is an hour of typing replayed as fast as the disk allows.
- D-06's small commits make the file about **ten times the size of the text it records** — two 71-byte digests plus parent, branch, recorded, tick and actor wrap roughly 2.4 keystrokes.
- Scrubbing measured at 8 h: 58,304 positioned edits, a 46,229-character document, 59 snapshots at 2.6 MB built in 108 ms; a 300-step drag held 60 fps with 0 dropped frames.
- Untested: deletions and undo markers on the line (only the encoding slot exists — D-03/D-04 are the unrun spike 009), more than one thread in a world, a world that also holds ordinary notes, concurrent writers, reconstruction with the thread rendering in the same frame, and a real ProseMirror document rather than a character buffer.

## Origin

Synthesized from spikes: 006 (PARTIAL), 008 (VALIDATED).
Source files available in: `sources/006-record-redraw-roundtrip/`, `sources/008-scrub-to-any-moment/`
