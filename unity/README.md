# Perihelion ↔ Tapestry: NPC minds

An exploration of running Perihelion's NPCs on Tapestry worlds: each NPC's
facts, opinions, voice samples and spoken lines live in a `.tree` file, a
mental-simulation model updates them, and a speaking model turns a bounded
slice of them into a line for whoever the NPC is talking to.

## The shape

```
Unity (Perihelion)                 sidecar (localhost)                 .tree per NPC
------------------                 -------------------                 --------------
NPC meets listener  ── context ──▶  assembleContext(listener, topic) ◀── Tapestry kernel
                    ◀── packet ───  (JSON, bounded size)
speaker model reply ── say ──────▶  recordUtterance  ───────────────▶  commit, actor plugin perihelion.speaker
game event          ── observe ──▶  mind-sim model proposes ops ────▶  commit, actor plugin perihelion.mind
sidecar down        → fall back to the existing Ink barks
```

- **No kernel changes.** Every concept is a plugin node or edge type
  (`perihelion.npc/fact@1`, `opinion@1`, `sample@1`, `utterance@1`, edges
  `about`, `because`, `said-to`).
- **Provenance is the actor line.** Designer-authored truth is `human`, the
  mind sim and speaker are `plugin`, game time passing is `system`. Why Rook
  distrusts the player is readable in the file.
- **Replay never re-asks a model.** A spoken line is a recorded outcome, as
  Tapestry's history rules require.
- **Open the file in Tapestry** to inspect or hand-edit a mind.

## The spike

`npc_mind/` is a headless CLI on `tapestry_kernel` (built from
`phase-2-implementation-v1`, no SDL/GL):

```bash
cmake -S unity/npc_mind -B build/npc_mind && cmake --build build/npc_mind
ctest --test-dir build/npc_mind            # seed matches examples/rook.tree byte for byte

build/npc_mind/npc_mind context unity/examples/rook.tree player parts
build/npc_mind/npc_mind say     some-copy.tree player 900 "Hauler's ready."
```

`examples/rook.tree` is Rook, a hangar mechanic, with two opinions of the
player, each linked to the fact that caused it, one of them hardened by a
later mind-sim commit.

## Not built yet

- The sidecar and the Unity client (a `UnityWebRequest` to localhost, with
  Ink as the fallback).
- Local models: the mind-sim role and the speaker role, for example via
  llama.cpp or Ollama.
- Retrieval beyond graph walks and substring topic matching.

## Where this is heading

Opinions, facts, dialogue and relationships aren't specific to NPCs. The same
primitives are what Tapestry's companion phases (6–7) need for user memory. The
proposed next step is a general **story plugin**:

- characters hold beliefs through `believes` edges, with confidence and source
  on the edge;
- canon (what is true) is kept separate from belief (what a character thinks);
- relationships are property-carrying edges between characters;
- events sit on the timeline, so knowledge spreads by witnessing or being told.

Authoring happens in one shared story world, and each NPC's slice is exported
for runtime. This spike's one-world-per-NPC files are that slice.
