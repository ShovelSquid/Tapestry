# NPC Minds and the Story World

## Requirements

- NPC minds are built on the generic kernel with plugin node types only. No kernel change for NPCs, stories or beliefs (Kaelen, 2026-09-30, following Tapestry's plugin constraint).
- The mind-sim and speaker roles run on local models, spiked on Kaelen's Mac rather than in the cloud container (Kaelen, 2026-09-30). Not built yet.
- **One shared story world is the source of truth.** Per-NPC slices in spike 012's schema are generated from it for runtime, never authored by hand (spike 013).
- **Belief is an edge, not a copied node.** A `believes` edge from a character to a fact carries `confidence` and `source`. Canon is a bool on the fact, kept apart from belief (spike 013b).
- **Queries walk outward from the speaker** and never scan the world (spike 013b), and they index edges in one pass rather than asking edge by edge per node (spike 012).
- **A mind is served only when its journal status is Ok.** A torn or hand-edited file opens with only its verified prefix and would silently forget (spike 012).
- **Spoken lines are recorded outcomes.** Replay reads the line; it never asks a model again (Tapestry's History constraint).

## How to Build It

### 1. The story schema (spike 013b)

```
character{name,entity,role,voice,npc} --believes{confidence,source}--> fact{text,canon} --about--> character
character --holds--> opinion{text,stance -1..1} --about--> character
                     opinion --because--> fact
sample{line} --sample-of--> character
character --spoke--> utterance{line,game_time} --said-to--> character
```

Node types are versioned plugin types: `perihelion.story/character@1`, `…/fact@1`, `…/opinion@1`, `…/sample@1`, `…/utterance@1`. `entity` is the game's id (for example `player` or `pilot.kade`), which is how Unity names a listener.

Provenance is the commit's actor:

| Actor | Writes |
|---|---|
| `human designer` | Cast, canon, and who-knows-what at authoring time |
| `plugin perihelion.world` | A game event: a new fact, plus a `believes` edge per witness |
| `plugin perihelion.mind` | The mind-sim: stance changes and new `because` reasons |
| `plugin perihelion.speaker` | A spoken line |
| `system perihelion.clock` | `advance` ops for game time |

### 2. The context packet (spikes 012, 013b)

What the speaker model receives for (speaker, listener, topic). The same shape comes out of the C++ (`ContextPacket` / `toJson`) and the JS (`Mind.context`):

```json
{ "npc", "role", "voice", "listener", "listener_known",
  "opinions_of_listener": [{"text", "stance", "because": [...]}],
  "facts_about_listener": [{"text", "confidence"}],
  "topic_facts": [{"text", "confidence"}],
  "voice_samples": [...], "recent_lines_to_listener": [...] }
```

Rules, which must match exactly between implementations:
- Opinions are the ones the speaker `holds` that are `about` the listener, sorted by |stance| descending (stable).
- Facts are the ones the speaker `believes`: about the listener if so, otherwise matched to the topic by case-insensitive substring. Sorted by confidence descending (stable), limit 6 each. Weight comes from the **edge**, not the fact.
- Samples are in node order, limit 4. Lines are the ones the speaker `spoke` and `said-to` the listener, sorted by `game_time` (stable), last 3.
- An unknown listener gives `listener_known: false` with no opinions, facts or lines. The voice still flows.
- Walk targets in **node-id order** so ties break the same way everywhere.

The walk is outward from the speaker (from `sources/013b-shared-story-world/Story.cpp`):

```cpp
for (const k::Edge* belief : byNode(index.out(*me, "believes"), true)) {
    const k::Node& node = *world.node(belief->to);
    Item item{text(node.props, "text"), real(belief->props, "confidence", 1.0), {}};
    if (who && index.between(belief->to, "about", *who)) packet.factsAboutListener.push_back(item);
    else if (!needle.empty() && lower(item.text).find(needle) != npos) topicFacts.push_back(item);
}
```

### 3. Per-NPC slices for runtime (spikes 012, 013b)

`exportSlice(world, speaker)` writes a standalone world in spike 012's schema (`perihelion.npc/self|person|fact|opinion|sample|utterance@1`, edges `about|because|said-to`). A belief's confidence and source become properties of the slice's fact. That's what a game ships per NPC, and spike 012's assembler reads it. Slices were byte-identical to hand-built per-NPC files under a fixed clock, and packet-identical in every case.

### 4. Commit ids within one commit

To create a node and an edge to it in the same commit, predict the id: take the world's `nextNodeId()` (`getNextIds()` from the addon) and count up in op order. The kernel accepts a non-zero id only when it equals the next one, and the addon always lets the kernel assign. Assert the returned ids against the prediction (see `Batch` in `sources/013-shared/Scenario.hpp` and `Mind.batch()` in `sources/014-mind-bridge/mind.cjs`).

## What to Avoid

- **A world per NPC as the source of truth (013a).** Shared facts are copied with no shared id. A correction fans out across files and can only find "the same fact" by its old text, so a copy that was ever reworded is silently missed. There's also no canon, so false beliefs are invisible.
- **Asking the world edge by edge per node.** Spike 012's first assembler took 1.35 s at 5k lines.
- **Scanning every node and searching the speaker's edges for each.** Spike 013b's first query took 2.7 s at 50k lines.
- **Rebuilding the edge index for every packet in a long-lived process.** It's linear but about 9× slower than a live index (16 ms against 1.2 ms at 5k lines).
- **Editing a `.tree` in a text editor.** It breaks the digest chain, and the kernel then serves only the prefix before the edit.
- **Trusting a zero-mismatch comparison without a negative control.** Break one side on purpose first (013b leaked unbelieved facts and got 24 mismatches).

## Constraints

Measured on a 4-core Xeon @ 2.1 GHz cloud container:

| Measure | Result |
|---|---|
| Submit, any size | 0.15–0.17 ms p50, ≤0.47 ms p99 |
| Reopen | Linear: 13 ms at 1k lines, 78 ms at 5k, 745 ms / 26 MB at 50k |
| Packet, per-NPC file | 0.4 ms at 1k lines, 31 ms at 50k (index rebuilt per call) |
| Packet, shared world with 4 NPCs | 56 ms at 50k total lines (index rebuilt per call) |
| Spoken line on disk | ~520 bytes. A realistic NPC (20 lines/h × 100 h ≈ 2k lines) is ~1 MB with a ~25 ms reopen |

Commit `7fed53f` (copy only what a commit touches) made reopening linear. Spike 006's quadratic reopen no longer holds.

## Origin

Synthesized from spikes: 012, 013a, 013b.
Source files: `sources/012-npc-mind-kernel/`, `sources/013-shared/`, `sources/013a-per-npc-worlds/`, `sources/013b-shared-story-world/`. The copied `CMakeLists.txt` files point at `../../../tapestry` relative to `.planning/spikes/`; build them from there.
