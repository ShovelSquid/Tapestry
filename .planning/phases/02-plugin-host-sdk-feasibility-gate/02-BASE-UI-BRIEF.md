# User-supplied Base UI & Cognitive Protocol Brief

Source: `.context/attachments/zc6QvP/Tapestry_Base_UI_Brief.docx`. Text extracted in document order; table cells are separate paragraphs. Preserved here because the attachment is gitignored. Later user decisions in `02-CONTEXT.md` refine this brief; its suggested JSON representation does not replace the established .tree contract.

Tapestry

Base UI & Cognitive Protocol Brief

Purpose: give a coding agent enough conceptual clarity to build the smallest useful Tapestry UI without prematurely building the entire vision.

1. Essence

Tapestry is a persistent, visual cognitive environment where things can be remembered, associated, changed, and communicated. It should feel less like a conventional mind-map app and more like a small world made of thought.

Core thesis: language, drawings, events, agents, and simulations can share one underlying relational structure instead of living in separate files and tools.

The four cognitive primitives

Primitive

Question

Meaning in Tapestry

Memory

What remains?

A note, object, event, state, history, model, or artifact can persist.

Association

What connects?

Any thing can relate to any other thing; relationships carry meaning.

Change

What evolves?

Objects, links, positions, properties, and interpretations can change through time.

Communication

What crosses boundaries?

Humans, AIs, Mimics, files, and machines can exchange selected cognitive structure.

2. Base UI: build this first

The first version should prove one thing: a user can create a persistent spatial structure of ideas and manipulate it fluidly.

Infinite 2D canvas: pan, zoom, and select without mode confusion.

Create a note at the cursor. A note needs only: id, text, x, y, created_at, updated_at.

Connect two notes by dragging or selecting source → target. A link initially needs only: id, from, to, optional label.

Move notes freely. Position is meaningful but not sacred; it is user-authored semantic geometry.

Edit note text in place. Keyboard-first, minimal chrome.

Save and reopen exactly the same structure.

Undo/redo every user-visible mutation through an event history.

Recommended layout

Canvas occupies almost the entire window.

Top-left: tiny file/project name + save state.

Top-right: search, history/undo, settings/debug.

Bottom or floating tool strip: select, note, connect, draw (draw can be placeholder initially).

Selection inspector appears only when needed; do not permanently reserve a giant properties panel.

3. Interaction philosophy

Creation must be faster than organization. Double-click / tap empty space → type → Enter.

Connections should feel direct, not form-driven. Avoid modal dialogs for ordinary links.

The canvas is not a hierarchy. Trees, clusters, cycles, isolated notes, and spatial arrangements are all valid.

Coordinates are first-class data because spatial arrangement can become part of meaning.

History is first-class data. Prefer event-sourced mutations so the structure can be replayed and branched later.

Never force AI organization. AI should propose, connect, summarize, or navigate using the same primitives available to the human.

Connection does not imply merger. Later, agents and people should be able to expose selected structure while retaining private structure.

4. Minimal data model

TreeFile  metadata    version    created_at    modified_at  nodes[]    id    type        // note for v0    text    x, y    created_at    updated_at  links[]    id    from    to    label?    created_at  events[]    id    time    actor       // human | ai | system | mimic    action    target    payload

Important: the .tree format should remain human-readable and versioned. JSON is fine internally at first; the conceptual contract matters more than inventing syntax prematurely.

5. Give AI the same tiny toolset

A first AI integration should not be a magical “organize my brain” button. Give the model primitive actions and observe what structures it creates.

create_note(text, x, y)

connect(a, b, relation?)

move_note(id, x, y)

edit_note(id, text)

get_neighbors(id)

get_nearby(x, y, radius)

focus(ids) — define the currently shared field of attention

Experiment to run early: give a model a conversation plus these tools and let it construct a map with minimal organizational instructions. Compare its geometry, clusters, and links with a human-built version.

6. Path from Tapestry to Mimics

Do not build Mimics first. Build the substrate that makes them unsurprising.

A Mimic is an agent with private memory, local state, behavior, and selected communication boundaries.

Multiple Mimics can expose pieces of their graphs to a shared space without collapsing into one database.

The shared graph can accumulate ideas that belong to the interaction itself rather than to either participant alone.

Later, this enables “collective individuality”: distinct agents forming higher-order cognitive structures while remaining distinct.

7. Explicitly defer

3D world rendering and neural rendering.

Full physics simulation.

Distributed compute across the internet.

Complex permissions / cryptography / federation.

Continuous audiovisual AI perception.

Automatic ontology generation or rigid semantic schemas.

NPC neural training and evolving brains.

Polished collaboration / multiplayer.

Perfect custom .tree syntax.

8. First milestone: “Tapestry exists”

A user can open Tapestry, create five notes, arrange them spatially, connect them, edit them, close the app, reopen it, and see the same structure. Every mutation is replayable from history.

Only after this feels good should drawing, agents, semantic AI tools, physics, or Mimics become the next layer.

9. Design sentence for coding agents

“Build Tapestry as a fast, spatial, persistent editor for connected thought. Favor direct manipulation, tiny primitives, readable state, replayable history, and an architecture where humans and AI can eventually operate on the same semantic objects.”
