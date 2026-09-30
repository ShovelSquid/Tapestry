# The Mind Bridge (Game ↔ Story World)

## Requirements

- **One process owns a story world.** The kernel's journal lock refuses a second writer, and the addon has no read-only open. The game, the Tapestry app and any checker go through the owner or read a byte copy (spike 014).
- **The owner keeps a live index**, updated by replaying each accepted commit's ops with the ids the kernel returned. Never rebuild it per packet (spikes 013b, 014).
- **Never answer a context request from a damaged mind.** Check `status().kind === 'Ok'` first, and return 503 otherwise (spikes 012, 014).
- The game falls back to the existing Ink barks when the bridge isn't running (design, not yet built).

## How to Build It

1. **Build the addon the app already uses:** `cd app && npm run build:native`. On Linux, add `--CDCMAKE_POSITION_INDEPENDENT_CODE=ON` until `tapestry_kernel` sets `POSITION_INDEPENDENT_CODE ON`. Without it the link fails with "recompile with -fPIC".
2. **Load it with no Electron:** `const { TapestryAddon } = require('.../tapestry_addon.node')`. The calls used are `open(path)`, `submit(actorKind, actorId, message, ops)`, `getNodes()`, `getEdges()`, `getNextIds()`, `status()` and `close()`. Ops are `{op:'createNode', type, props}`, `{op:'createEdge', from:'n3', to:'n5', label, props}` and `{op:'setProperty', target, key, type, value}`. Props are `{key: {type, value}}`.
3. **Mirror and index** (`sources/014-mind-bridge/mind.cjs`): on open, fill `nodes`/`edges` maps from `getNodes`/`getEdges`, plus `out`/`in` maps keyed `${id}|${label}`. `commit()` is the only write path. It calls `submit`, then replays the ops into the mirror, asserting each returned node id equals the one predicted from `getNextIds()`.
4. **HTTP on `127.0.0.1` only**, with no dependencies (`sources/014-mind-bridge/server.cjs`):

   | Route | Does | Actor |
   |---|---|---|
   | `GET /api/context?speaker=&listener=&topic=` | The speaker model's packet | — |
   | `POST /api/say {speaker, listener, line}` | Records a line | `plugin perihelion.speaker` |
   | `POST /api/observe {text, canon, about[], witnesses[{name,confidence,source}]}` | A game event | `plugin perihelion.world` |
   | `POST /api/shift {opinion, stance, because?}` | The mind-sim's move | `plugin perihelion.mind` |
   | `GET /api/mind?npc=`, `/api/cast`, `/api/tree`, `/api/check`, `/api/log` | Inspection and forensics | — |

5. **The Unity side** (not built): a `UnityWebRequest` per context request, then the speaker model's line, then `say`. Game events go to `observe`. When the bridge doesn't answer, fall back to Ink.
6. **Prove parity** whenever the JS or C++ assembler changes: `parity.cjs` compares `Mind.context` with `story_compare packet` across every speaker × listener × topic, before and after the bridge writes, and checks the live mirror against a reload of a byte copy.

## What to Avoid

- **Opening the story file from a second process for writing.** It fails with "another process holds the journal lock". The Tapestry app and the game can't both own it.
- **Comparing the mirror to the kernel with plain `JSON.stringify`.** The kernel returns properties in key order and the mirror in set order. Compare canonically, or you'll chase a false mismatch.
- **Shelling out to a CLI per request.** It reopens the world every call.
- **Trusting numbers without looking.** `shots.cjs` walks the page through a full loop and screenshots it.

## Constraints

Measured over HTTP on a 4-core Xeon @ 2.1 GHz:

| Spoken lines | Say p50 / p99 | Context p50 / p99 |
|---:|---:|---:|
| 10 | — | 0.64 / 3.4 ms |
| 1,010 | 1.2 / 3.4 ms | 0.70 / 1.1 ms |
| 5,010 | 1.2 / 3.1 ms | 1.2 / 3.2 ms |

- 60 simultaneous requests (50 reads, 10 writes) complete in 31–58 ms wall time. The journal stays Ok and the mirror equals a reload. Requests queue on Node's single thread (27 ms p50 per read inside a burst at 5k lines); nothing is lost or reordered.
- The JS and C++ packets were identical in 240 of 240 cases.
- **Open:** Kaelen's hand check on whether the loop feels like conversation once a real local speaker model writes the lines. The local-model spike itself hasn't been run.

## Origin

Synthesized from spike: 014 (building on 012 and 013b).
Source files: `sources/014-mind-bridge/`. The screenshots and `bench-http.json` stay in `.planning/spikes/014-mind-bridge/results/`.
