---
spike: 013a
idea: npc-minds
name: per-npc-worlds
type: comparison
validates: "Given four NPCs who share events, when each NPC's mind is its own .tree world holding its own copy of every fact it believes, then context packets are right, corrections are safe and cost stays acceptable"
verdict: PARTIAL
related: [012, 013b]
tags: [npc, tree, story, comparison]
---

# Spike 013a: One World per NPC

## What This Validates

Given four NPCs who share events, when each NPC's mind is its own `.tree`
world holding its own copy of every fact it believes, then context packets
are right, corrections are safe and cost stays acceptable.

## How to Run

Shared with 013b; see `../013-shared/`.

```bash
cmake -S .planning/spikes/013-shared -B build/013 -DCMAKE_BUILD_TYPE=Release && cmake --build build/013
build/013/story_compare verify out/            # packets, slices, false beliefs, a correction
build/013/story_compare bench out/ 12500       # cost at 12,500 extra lines per NPC
```

## What to Expect

`verify` builds `out/013a/{rook,kade,ines,oda}.tree` from the hangar scenario
in `013-shared/Scenario.hpp` and compares them with 013b.

## Investigation Trail

1. Built with spike 012's schema and builder style. Every packet matches
   013b's packets (see 013b).
2. **Correction.** Changing the ridge fact meant 3 commits in 3 files, one
   per believer. With no id shared across files, "the same fact" can only be
   found by matching its old text. That's fragile: a copy that was ever
   reworded in one file (by a designer or a mind-sim pass) is silently
   missed, and the NPCs drift apart. It wasn't measured here because the copies
   start identical; it follows from having no shared id.
3. **No canon.** A per-NPC file stores what the NPC believes and nothing
   else. It can't say that Ines and Oda believe something false; there is no
   truth to compare against.
4. **Cost.** The cheapest at runtime: 6 ms for a packet and 181 ms to reopen
   one NPC at 12,500 lines each. Only the NPC in the scene has to be loaded.

## Results

**PARTIAL.** It's the right *runtime* format and the wrong *source of truth*.
Packets are correct and cost is lowest, but shared facts are duplicated with
no shared id, corrections fan out across files by text match, and there's
no canon to check beliefs against. 013b's exported slices are byte-identical
to these files, so this format survives as what the game loads, generated
rather than authored.
