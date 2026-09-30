---
spike: 013b
idea: npc-minds
name: shared-story-world
type: comparison
validates: "Given the same four NPCs, when the story is one shared world with believes-edges (confidence and source on the edge), canon kept apart from belief, and per-NPC slices exported for runtime, then every packet matches 013a's, slices match 013a's files, and corrections and false beliefs are first-class"
verdict: WINNER
related: [012, 013a]
tags: [npc, tree, story, comparison, canon, belief]
---

# Spike 013b: One Shared Story World

## What This Validates

Given the same four NPCs, when the story is one shared world with
`believes` edges (confidence and source on the edge), canon kept apart from
belief, and per-NPC slices exported for runtime, then every packet matches
013a's, slices match 013a's files, and corrections and false beliefs are
first-class.

## The Schema

```
character --believes{confidence,source}--> fact{text,canon} --about--> character
character --holds--> opinion{text,stance} --about--> character
                     opinion --because--> fact
sample --sample-of--> character
character --spoke--> utterance{line,game_time} --said-to--> character
```

Types are `perihelion.story/*@1`. There are no kernel changes.

## How to Run

See `../013-shared/` (the same binary as 013a).

## What to Expect

`verify` prints `packets: 96 checked, 0 mismatched` (before and after a
correction), `slice files byte-identical … 4 of 4`, and lists the false
beliefs.

## Investigation Trail

1. **Packets.** For all 4 speakers × 6 listeners (including a stranger) × 4
   topics, the packet was built three ways: from 013a's file, from the
   shared world through the speaker's beliefs, and from an exported slice.
   **96 of 96 were identical.**
2. **Negative control.** Making the shared query ignore belief (so a speaker
   "knows" every fact about the listener) gave 24 mismatches. Restored, it
   gave 0. The comparison does catch leaks.
3. **Slices are 013a files.** A slice exported from the shared world is
   **byte-identical** to the hand-built per-NPC file, digests included, for
   all four NPCs. This holds because the export mirrors 013a's builder commit
   for commit under a fixed clock.
4. **Canon vs belief.** `falseBeliefs()` finds that Ines (0.5, told by Oda) and
   Oda (0.4, rumor) believe "Vesper pulled out of the ridge before the
   extraction", which canon marks false. 013a can't express this.
5. **Correction.** Changing the ridge fact is 1 commit. Re-exported slices
   match the corrected 013a files: 96/96 again.
6. **Surprise: the first shared query was quadratic.** It scanned every node
   and searched the speaker's edge list for each: 6 ms at 4k total lines,
   448 ms at 20k, **2.7 s at 50k**. Rewritten to walk outward from the
   speaker (beliefs, held opinions, samples, spoken lines), sorted by node id
   so tie order matches 012, it takes **56 ms at 50k** (see
   `../013-shared/results/bench-scale-scan.json` vs `bench-scale.json`).
7. **Remaining cost.** About 9× 013a's per-packet time at 50k, because each
   query still indexes every edge in the story. A live sidecar would keep the
   index or, better, serve exported slices.

## Results

**WINNER** as the source of truth. Measured on a 4-core Xeon @ 2.1 GHz:

| Extra lines per NPC | Total lines | 013a files | 013b file | Reopen: one 013a NPC / 013b | Packet: 013a / 013b |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 4,004 | 1.9 MB | 2.0 MB | 13 / 62 ms | 0.37 / 2.8 ms |
| 5,000 | 20,004 | 9.4 MB | 10.2 MB | 67 / 293 ms | 2.4 / 16 ms |
| 12,500 | 50,004 | 23.5 MB | 25.6 MB | 181 / 811 ms | 6.0 / 56 ms |

**Signal for the build**

- Author in one shared story world, and ship per-NPC slices generated from
  it. The slice format *is* spike 012's schema, so 012's assembler, bench and
  `status()` rule all carry over.
- Belief is an edge property, not a copied node. Confidence and source
  describe the holder's relationship to a fact, so one fact can be held
  differently by many characters.
- Keep canon separate from belief. It costs one bool and gives false
  beliefs, rumors and dramatic irony for free.
- Perspective queries walk out from the speaker and never scan the world.
- Slices can be byte-identical to a hand-built file only because commits
  are deterministic under a fixed clock. A real export stamps a real time,
  so compare slices by packet, not by bytes.
