---
spike: 014
idea: npc-minds
name: mind-bridge
type: standard
validates: "Given the shared story world (013b) behind the kernel's Node addon, when a localhost sidecar serves context, say, observe and shift to a game, then a page standing in for Unity can talk to NPCs, see their minds change, and every packet matches 013b's C++ while the journal stays Ok"
verdict: VALIDATED
related: [012, 013b, 006]
tags: [npc, bridge, sidecar, node, addon, http, ui]
---

# Spike 014: The Mind Bridge

## What This Validates

Given the shared story world (013b) behind the kernel's Node addon, when a
localhost sidecar serves context, say, observe and shift to a game, then a
page standing in for Unity can talk to NPCs, see their minds change, and
every packet matches 013b's C++ while the journal stays Ok.

## Research

| Approach | Pros | Cons | Status |
|---|---|---|---|
| Node sidecar on the Tapestry addon (`app/native`) | The path Tapestry plugins use; no new native code; the addon already exposes `submit`, `getNodes`, `getEdges`, `getNextIds` and `status` | The context logic is ported to JS, so it must be proven equal to the C++ | **Chosen** |
| C++ sidecar (kernel plus 013b's assembler in one process, small HTTP server) | Reuses the C++ exactly | Needs an HTTP library or a hand-rolled server; not the plugin path | Fallback |
| Node spawning spike 012's CLI per request | Trivial | Reopens the world every call, the opposite of what 012 asked for | Rejected |

For Unity: `UnityWebRequest` against `http://127.0.0.1:<port>`, with the
existing Ink barks as the fallback when the sidecar isn't up. The C# client
isn't built in this spike; the page stands in for it.

## How to Run

```bash
# once: build the kernel addon the app uses
(cd app && npm run build:native)          # or set TAPESTRY_ADDON to a built tapestry_addon.node

node .planning/spikes/014-mind-bridge/server.cjs      # open the URL it prints

# checks
STORY_COMPARE=build/013/story_compare node .planning/spikes/014-mind-bridge/parity.cjs
node .planning/spikes/014-mind-bridge/bench.cjs
```

The server works on a scratch copy of `examples/story.tree` (the 013b hangar
story, seeded with `story_compare seed`), so the example stays clean. To keep
changes, pass a path: `node server.cjs my-story.tree`.

## What to Expect

- **Conversation.** Pick a speaker and a listener and you get the packet a
  speaker model would receive, with a round-trip time. Type or pick the line
  and **Say it**, and it becomes a commit by `plugin perihelion.speaker`.
- **Mind of X.** What X believes (a belief canon calls false is flagged
  NOT CANON), and X's opinions with sliders. Moving a slider is the
  mind-sim's move, a commit by `plugin perihelion.mind`, and can cite a
  believed fact as the new reason.
- **Something happens.** A game event with who it's about and who learns it.
  It's a commit by `plugin perihelion.world` that adds the fact and a
  `believes` edge per witness.
- **The .tree file.** The newest records, verbatim, updated after each
  action. **Check mirror vs kernel** proves the live index equals a fresh
  reload, and **Export log** downloads the forensic event log.

## Observability

`GET /api/log` holds every request with an ISO time, category, duration and
POST body, plus a summary (counts, p50/p99 ms, errors). The page's **Export
log** button downloads it. `GET /api/check` reports the journal status and
the mirror comparison.

## Investigation Trail

1. **The addon won't link on Linux.** The kernel library isn't compiled as
   position-independent code, and macOS doesn't need it to be, so
   `npm run build:native` fails on Linux with "recompile with -fPIC". The
   spike builds with `--CDCMAKE_POSITION_INDEPENDENT_CODE=ON`. The repo fix is
   one line (`POSITION_INDEPENDENT_CODE ON` on `tapestry_kernel`), left for a
   real change rather than made here.
2. **Ids have to be predicted.** The addon always lets the kernel assign ids,
   but a new line needs an edge to its listener in the same commit. The
   bridge reads `getNextIds()` and predicts, and `commit()` asserts the
   kernel handed out the same ids. It never disagreed.
3. **Parity.** The JS port of 013b's `assembleFor` was compared with the C++
   (`story_compare packet`) for 4 speakers × 6 listeners × 5 topics:
   **120/120 identical** on the seeded story, and **120/120 again** after
   the bridge itself wrote a line, an event two NPCs witnessed, and an
   opinion shift citing it. So the C++ reads what the JS wrote and agrees.
4. **One writer per world, enforced.** Opening a second writer on the same
   file fails with "another process holds the journal lock", and the addon has
   no read-only open. Exactly one bridge owns a story. Anything else (the
   Tapestry app, a checker) must go through it or read a copy. `verifyMirror`
   reloads a byte copy, which is always complete because the kernel syncs
   every commit.
5. **A false alarm in the mirror check.** It first reported a mismatch, but
   only property *key order* differed: the kernel returns keys sorted, the
   mirror keeps them in set order. With a canonical comparison, the live
   mirror equals a fresh reload after writes.
6. **Over HTTP** (`results/bench-http.json`, 4-core Xeon @ 2.1 GHz):

   | Spoken lines | Say p50 / p99 | Context p50 / p99 | 60 simultaneous requests (50 reads, 10 writes) |
   |---:|---:|---:|---:|
   | 10 | — | 0.64 / 3.4 ms | 44 ms wall; journal Ok, mirror matches |
   | 1,010 | 1.2 / 3.4 ms | 0.70 / 1.1 ms | 31 ms wall; journal Ok, mirror matches |
   | 5,010 | 1.2 / 3.1 ms | 1.2 / 3.2 ms | 58 ms wall; journal Ok, mirror matches |

   The live index beats 013b's per-query index: **1.2 ms** at 5k lines over
   HTTP, against 16 ms in-process when the index is rebuilt for each packet.
   A burst queues on Node's single thread (27 ms p50 per read inside the
   burst at 5k), and nothing is lost or reordered.
7. **Looked before trusting.** `shots.cjs` drives the page through a full
   loop: Rook → Vesper, Ines's false belief, an event, an opinion shift
   citing it, then a new line. See `results/shots/`. No console errors; no
   horizontal overflow at 390 px.

## Results

**VALIDATED**, with one hand check left for Kaelen: whether the loop *feels*
like talking to someone once a real speaker model writes the lines.

- A sidecar on the addon is enough. The JS packet is identical to the C++
  one, the journal stays Ok under concurrent requests, and context costs
  about a millisecond end to end.
- Keep the index live in the sidecar, updated by replaying each accepted
  commit. Never rebuild it per packet.
- One process owns a story world. The kernel's journal lock enforces it.
  The Tapestry app and the game can't both open the file for writing, so
  one of them serves the other.
- Predict ids with `getNextIds()` and assert them after `submit`, or give
  the addon a way to reference ids created in the same commit.
- Fix `tapestry_kernel`'s position-independent code before anyone builds the
  addon on Linux or Windows CI.
