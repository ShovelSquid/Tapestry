---
spike: 012
idea: npc-minds
name: npc-mind-kernel
type: standard
validates: "Given an NPC mind stored as a Tapestry world of plugin node types, when it accumulates a long game's worth of commits (up to 50k spoken lines plus opinion updates), then it still reopens, stays readable, and assembles a listener's context packet fast enough for dialogue"
verdict: VALIDATED
related: [006]
tags: [kernel, tree, npc, perihelion, performance, context]
---

# Spike 012: An NPC's Mind as a Tapestry World

## What This Validates

Given an NPC mind stored as a Tapestry world of plugin node types, when it
accumulates a long game's worth of commits (up to 50k spoken lines plus
opinion updates), then it still reopens, stays readable, and assembles a
listener's context packet fast enough for dialogue.

## Research

There are no external dependencies. The question is how the repo's own kernel
behaves. The prior art is spike 006, which measured reopening as
**O(commits²)** because `Kernel::fromJournal` copied the whole world per
commit. Commit `7fed53f` ("copy only the nodes and edges a commit touches")
landed after that spike. This spike is the first measurement since.

| Approach | Pros | Cons | Status |
|---|---|---|---|
| NPC types as plugin node types on the generic kernel | No kernel change; opens in Tapestry; provenance comes from the actor line | Every query walks the generic graph | **Chosen** |
| A dedicated NPC store (SQLite, JSON) | Faster indexed queries | A second source of truth; loses readability and history | Rejected by Tapestry's readability constraint |

## How to Run

```bash
cmake -S .planning/spikes/012-npc-mind-kernel -B build/012 -DCMAKE_BUILD_TYPE=Release
cmake --build build/012 && ctest --test-dir build/012

build/012/npc_mind seed rook.tree
build/012/npc_mind context rook.tree player parts      # the speaker's packet
build/012/npc_mind say rook.tree player 900 "Hauler's ready."
build/012/npc_mind bench long.tree 50000               # one JSON line of timings
```

## What to Expect

- `seed` writes `examples/rook.tree` byte for byte (the smoke test checks it).
- `context` prints a JSON packet: who Rook is, Rook's opinions of the listener
  with the facts behind them, facts about the listener, facts matching the
  topic, voice samples, and the last three lines Rook said to them.
- `context` on a damaged file exits 3 and names the last good commit.

## Investigation Trail

1. **Folded in the first pass.** The `unity/` work (CLI, Rook's mind, smoke
   test) moved here unchanged apart from paths.
2. **Bench, first run.** The kernel side was flat: submit p50 0.19 ms at every
   size, and reopening grew linearly (1.6 → 15 → 71 ms for 100 → 1k → 5k
   lines). So `7fed53f` fixed spike 006's quadratic reopen. **But context
   assembly was quadratic:** 0.17 ms → 38 ms → **1,353 ms**. For each node,
   `pointsAt()` rescanned every edge in the world.
3. **Fix: one pass to index edges** by (node, label) at the start of
   assembly. At 5k lines it went 1,353 ms → 2.4 ms, and it now scales
   linearly up to 50k.
4. **Edge cases.**
   - An unknown listener gets `listener_known: false` and no opinions or
     facts; voice samples still flow.
   - A line with quotes and a newline is written as a `<<TEXT` block and
     round-trips exactly.
5. **Surprise: a damaged mind opens silently.** A truncated file and a file
   hand-edited in a text editor both opened `ReadOnly` without error. The
   kernel serves the *verified prefix*, so Rook quietly lost the later
   opinion change and both spoken lines. `context` now checks
   `status()` and refuses (exit 3) rather than speak from a partial mind.

## Results

**VALIDATED.** Measured on a 4-core Intel Xeon @ 2.1 GHz cloud container; see
`results/bench-indexed.json`. Each spoken line is one commit, plus one
opinion commit every tenth line.

| Lines | Commits | File | Submit p50 / p99 | Reopen | Context packet |
|---:|---:|---:|---:|---:|---:|
| 100 | 116 | 0.05 MB | 0.16 / 0.30 ms | 1.4 ms | 0.04 ms |
| 1,000 | 1,106 | 0.51 MB | 0.15 / 0.27 ms | 13 ms | 0.41 ms |
| 5,000 | 5,506 | 2.6 MB | 0.17 / 0.33 ms | 78 ms | 2.7 ms |
| 20,000 | 22,006 | 10.3 MB | 0.16 / 0.43 ms | 286 ms | 11 ms |
| 50,000 | 55,006 | 26 MB | 0.16 / 0.40 ms | 745 ms | 31 ms |

For scale, an NPC who says 20 lines an hour for 100 hours of play reaches
2,000 lines: about 1 MB, a ~25 ms reopen and a ~1 ms packet.

**Signal for the build**

- The generic kernel is enough. No NPC-specific storage is needed.
- Index edges once per query. Never ask the world edge by edge per node, or
  assembly goes quadratic.
- Assembly is still O(mind size) per call: 31 ms at 50k lines. A long-lived
  sidecar should keep its index live and update it as commits land, rather
  than rebuild it per packet.
- Spoken lines dominate the file at ~520 bytes each. That's fine at realistic
  counts; at 50k+, lines would want summarising into facts, which a mind-sim
  pass could do as a normal commit.
- **Always check `status()` before speaking.** A torn or hand-edited mind
  opens with only its verified prefix. Edits go through the kernel or
  Tapestry, never a text editor.
