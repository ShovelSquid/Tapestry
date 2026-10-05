# Tapestry Narrative Engine: Core Spec

**Status:** Draft 0.3 · 2026-10-05
**Scope:** The core simulation only. This covers how the spatial and temporal world works, how it changes, and how it reports what it doesn't know. Text extraction, companions, gap-filling policies, rendering and narrative time are deliberately out of scope (see [Deferred](#11-deferred)).

---

## 1. Purpose

Tapestry turns writing into a world you can play back, inspect and shape. The core is a **representational space**: points in nested frames of space and time that carry meaning, change according to rules, and change only when something causes them to.

Text, direct manipulation in the world, and companions are all *authors*. They produce **keys**. The engine turns keys into a world history and reports the **gaps**: everything that is unexplained, unplaced or contradictory.

```
            ┌────────── authors ──────────┐
            text      direct edits     companions (plugins)
              \            |            /
               ▼           ▼           ▼
                     ┌───────────┐
                     │   KEYS    │  causes · states · rules · order
                     └─────┬─────┘
                           ▼
                     ┌───────────┐
       points, frames│ SIMULATE  │ rules (physics = meaning)
                     └─────┬─────┘
                           ▼
              world history  +  gap report
```

---

## 2. Principles

1. **One system for physics and meaning.** `position`, `temperature`, `fear` and `trust` are all properties. Rules that move cups and rules that move feelings have the same form and run in the same loop.
2. **Nothing changes without a cause.** A value with no cause acting on it stays as it is. This applies to a cup at rest and equally to a character's mood. Change without a cause is an *unexplained change*, never something the engine quietly papers over.
3. **The simulation never cheats.** Keys describing what the world should look like are *checked*, not enforced. The engine does not pull, blend or force the world toward them.
4. **The engine is neutral.** It does not judge what is interesting. Gaps are gaps, and it reports them without ranking. Deciding what to ask, explore or fill belongs to users and companions.
5. **Unspecified is not the same as changed.** Filling in something nobody had said (the walls are yellow) is not a change and needs no cause. Only a change away from a *known* value needs one.
6. **Detail has no limit, in either direction.** Space and time can be zoomed in or out indefinitely. Two steps across a kitchen can hold as much story as ten thousand years.
7. **Units are optional.** Frames are unitless by default. Units are annotations that are added when something, such as a physical rule, needs them.
8. **Deterministic.** The same keys and rules always produce the same world history.
9. **Readable and traceable.** Every key records where it came from. Every gap points at the keys involved.
10. **Authority vs appearance.** The authoritative simulation decides what happens. Everything else, including GPU previews, render styles and neural rendering, decides only how it looks and never feeds back into the world. Simulation detail is authored; rendering detail may depend on the view. *(Log 0004.)*

---

## 3. Vocabulary

| Term | Meaning |
|---|---|
| **Point** | A thing in the world that can carry meaning: an entity, a part of an entity, a splat, or an abstract presence. |
| **Property** | A named value on a point (`position`, `color`, `fear`, `is`). Properties have histories over time. |
| **Spatial frame** | A local coordinate system. Every point defines one for its children. |
| **Span** | A local frame of *time*, nested inside a parent span. |
| **Key** | A single authored statement placed in spacetime. It is the only way anything enters the world. |
| **Rule** | A deterministic function that reads part of the world and produces changes. |
| **Source** | A cause that needs no further cause, such as an agent's intention, an external event, an initial condition or the author's fiat. |
| **Gap** | Something the engine cannot resolve from the keys it has. |
| **Open surface** | The unspecified detail of any point or span. It is unbounded and examined only on request. |

---

## 4. Frames: nested space and time

Space and time share one structure: **nested local frames**. This is what allows unbounded zoom without running out of numeric precision. A 10²⁴ ratio between picoseconds and millennia is impossible on a single global clock, but easy when every frame is local.

### 4.1 Spatial frames

- Every point defines a spatial frame. Its children are positioned relative to it.
- A frame's origin, orientation and **scale relative to its parent** are properties of the point, so they can change over time and can be unknown.
- A galaxy contains a planet, which contains a kitchen, which contains a crumb. Each of those is a frame, and none needs to know its absolute size unless a rule needs it.

### 4.2 Spans (time frames)

- A **span** is a stretch of time with its own local clock.
- A span is placed inside a parent span. Its **start and length in the parent's terms** are values that may be known, partially known or unknown.
- Spans nest indefinitely: *Mara's life* contains *that morning*, which contains *two steps*, which contains *the hesitation*, and so on.
- Times inside a span are relative to that span. Zooming in means opening a span, or creating one.
- Points persist across spans. Spans organize *when*, while points organize *what* and *where*.
{Kaelen Note: Not sure about this, don't know why but it feels off. It could be fully right, not denying it at all, but something about a morning belonging to a character feels weird; yet, I think there's a lot of verity there, I think that for example in memory we remember mornings a certain way, and have a list of events within our lives that contain important dates or events that other people do not carry. So relative timelines is very much a thing, and I think that the core concept is integral enough to the simulation to be interesting and carry a place in its core. So spans, I think might be good, but I wanted to place a note here to make my voice heard and known and just to express a little bit of healthy skepticism. After all, we're working through this in the here and now, who's to say what's right and what isn't at this stage in our world creation process. Man it feels good to be a G. Which in this place, us OGs are just Omnipotent Gods, living in a G's paradise.}

### 4.3 Units

- A frame's units default to blank, where `1` is just `1`.
- A frame may be annotated with a unit, for example "1 = 1 second" or "1 = 1 meter".
- When a rule requires units that a frame lacks, that is a **gap** (missing unit), reported like any other.

---

## 5. Points

```
Point
  id
  parent      → point (spatial frame), may change over time
  properties  → { name: history of values }
  shape       → optional reference to a shape asset (splats)
```

### 5.1 Hierarchy

- An **entity** (Mara, the lantern, the town) is a point.
- A **part** (Mara's hand, the lantern's flame) is a point parented to the entity. Parts carry their own meaning, such as "her clenched hand".
- **Splats** are leaf points that only carry shape: local position, ellipsoid shape and orientation, color and opacity. They carry no meaning. If a piece of shape needs meaning, it becomes a part.
- Reparenting (the cup moving from Mara's hand to the floor) is a change to the `parent` property. Like any change, it needs a cause.

### 5.2 Extent: matter, light and meaning are the same kind of thing

There is no special "aura" type. A point's spatial presence is the set of child points it has, together with the properties those children carry:

- A **lantern frame** has children with `solid` and a small extent.
- A **lantern's light** is a part whose children carry `light` and a large extent.
- **Dread over the town** is a point whose children carry `dread` across the whole town.

How each of these behaves (collides, spreads, fades, is blocked) depends entirely on which **rules** act on the properties involved. A rule may use grids, closed-form falloff or particles internally. That choice belongs to the rule; it is not part of the world model.

### 5.3 Shapes are assets

- Splat collections are stored as **shape assets** and referenced by points (`shape: mug_v2`). Many points can share one shape.
- A change in shape, such as the cup shattering, is a change to the `shape` reference, or the creation of new child points for the pieces. That change needs a cause.
- The coarsest shape of anything is **a single ellipsoid at its point**. A world in which every object is a single blob is a complete, valid world.

### 5.4 Properties

- Property names are open. Anything can be attached.
- Value types: number, vector, text, boolean, reference to a point, reference to a shape.
- Optional **schemas** can declare that a property has a type, a range or a unit, for rules and renderers to rely on.
- Each property is a **history**: values over time, produced by simulation from keys.

---

## 6. Keys

Keys are the single authoring primitive. Everything that text, a user or a companion says about the world becomes keys.

```
Key
  id
  kind        → cause | state | rule
  target      → point/property, rule, or frame
  when        → placement in time (see 6.2)
  where       → optional spatial region (rules, area causes)
  value       → what is asserted, applied or activated
  source      → where it came from: text span, user edit, companion, …
```

### 6.1 Kinds

| Kind | Meaning | Example | What the engine does |
|---|---|---|---|
| **Cause** | Something acts. | "Mara bumped the table." | Feeds it into the simulation as an input. |
| **State** | Something is true at a moment or over a span. | "The cup lay on the floor." · "The walls were yellow." | **Checks** it against the simulation. If the value was previously unspecified, the key fills it in (principle 5). If it differs from a known prior value, that difference must be explained by a cause. |
| **Rule** | A law is in effect over a region of spacetime. | "In this house, grief makes it rain." · "Gravity." | Activates the rule wherever and whenever the key applies. |

Notes:

- **Sources** are causes that need no explanation: an agent's intention ("Mara walks to the window"), an external event ("an earthquake"), initial conditions, and the author's fiat ("and then the walls were blue"). Fiat is legal, but it is recorded as fiat.
- **Parameters of a cause can be unspecified.** "Mara bumped the table" doesn't say how hard. An unspecified parameter is a gap.
- **Not every key moves the story forward.** Description, flair, color and rules are all keys. They don't need to sit at a dramatic moment, or at any particular moment.

### 6.2 Placement in time

A key's `when` is one of:

- **Instant:** a single time within a span.
- **Interval:** a start and end within a span.
- **Always:** the whole lifetime of a span.
- **Unplaced:** no position yet, only **order constraints** relating it to other keys or spans, such as `before`, `after`, `during`, `overlaps` or `same-time-as`.

**Order resolves the same way as gaps do.** "Before she left" means *before*, and nothing more. The engine does not guess a position. An unplaced key:

- is stored with its constraints;
- **does not take part in simulation** until it is placed;
- is reported as an *unplaced* gap;
- still participates in contradiction checks, so if "A before B" and "B before A" both exist, that is reported.

Placing it later is just another edit to the key.

### 6.3 Reauthoring

Adding, editing and deleting keys are the core authoring actions, not exceptions.

- **Deleting a cause** makes any outcome that depended on it unexplained again, and the corresponding gap reappears automatically.
- **Deleting a state key** removes the expectation. The world simply does whatever its causes produce.
- **Dependency query:** before a key is changed, the engine can list every outcome that depends on it.
- Keys are never erased from history. Edits go into the branching history (`.tree`), so earlier versions remain available as branches.

---

## 7. Rules

```
Rule
  id
  reads       → which properties, on which points (self, children, parent,
                overlapping points, linked points)
  writes      → which properties it changes
  requires    → optional: units / parameters it needs
  apply(state, region, dt) → changes
```

- Rules are **deterministic** and have no hidden state.
- **Physics and meaning are not distinguished.** `gravity`, `heat diffuses`, `fear rises in darkness`, `rumors spread like smoke` and `trust decays without contact` all use the same rule format.
- Rules act only where a **rule key** makes them active. A world with no rule keys does nothing except what its causes and sources directly do.
- Rules may cross between domains freely. Fear can produce motion, and light can lower dread.
- A rule's `requires` declares what it needs. If a frame lacks a required unit or parameter, the rule reports a gap rather than assuming one.
- Natural-language rules compile to this form. That compilation is out of scope here.

---

## 8. Simulation

Simulation is a **pure function**:

```
simulate(points, frames, keys, rules) → world history
```

### 8.1 Inertia makes continuous time affordable

- If nothing is acting on a value, there is nothing to compute. A cup at rest for ten thousand years costs nothing.
- Motion that nothing acts on is evaluated in closed form, without stepping.
- Stepping happens **only where causes or active rules are changing something**, at a resolution set by those causes and rules.
- **Resolution depends on authored content only, never on viewing.** Zooming in to watch must not change what happens. Authoring detail can, because it is a new key.

### 8.2 Checking

After simulating, the engine compares every **placed state key** with the simulated history:

- **Satisfied:** the simulation produces it, or the value was unspecified and the key fills it in.
- **Unexplained:** the simulation produces a different value from a known prior state, and no cause accounts for the difference.

Unexplained state keys are not enforced. The world shows what the causes produced, and the expectation can be displayed alongside as a **ghost**.

### 8.3 Scrubbing

- The state at any time is computed by replaying from the nearest snapshot.
- Snapshots are a cache. They are never the source of truth.

### 8.4 Determinism contract

*(Decided in log 0002.)*

- **The history stores inputs:** keys and rules, never simulated outputs.
- **Simulation math uses deterministic IEEE floats.** That means no FMA contraction, no fast-math, a deterministic math library for transcendental functions, fixed iteration and reduction order, and no GPU for authoritative results.
- **Key times are exact rationals.** Nested frames keep simulation values local.
- **Snapshots** are verified by state hash and can be regenerated at any time.
- **Rule versions** are recorded in the history, so that replay uses the rules that produced it.
- **Baked rules** are the exception: a rule too costly to make deterministic may store its outputs as a cache, while staying scrubbable.

### 8.5 Preview and settle

*(Decided in log 0004.)*

- A GPU **preview simulation** may run ahead of the authoritative one and be shown immediately. When the authoritative result arrives, the view blends into it.
- The preview is appearance: it is never recorded and never feeds back.
- **Simulation resolution is authored**, as a property of points or rules. It never depends on the view.

---

## 9. Gaps

The engine reports gaps. It never ranks them and never fills them on its own.

| Gap | Arises when | Bounded? |
|---|---|---|
| **Unexplained change** | A placed state key differs from the simulated value and no cause accounts for it. | Yes, can be listed |
| **Unplaced key** | A key has only order constraints. | Yes |
| **Unspecified parameter** | A cause or rule is missing a value it needs to act ("bumped, but how hard?"). | Yes |
| **Missing unit** | A rule requires units that a frame lacks. | Yes |
| **Contradiction / conflict** | Order constraints form a cycle, two state keys disagree at the same time, incompatible causes coincide, or a placement violates its constraints. Can be dismissed (log 0003). | Yes |
| **Open surface** | Anything unspecified: a point's unset properties, a span with no authored detail, a relationship nobody has defined. | **No.** Only examined on request. |

Notes:

- Bounded gaps form a **gap report** that can be listed in full and is recomputed on every edit.
- Open surfaces are **queried lazily**, for example "what is unspecified about Mara between these two keys?" Every new point or span adds new open surface. This is how each new element of a story opens new things to explore.
- **Placeholders are presentation, not keys.** A renderer may draw an unspecified shape as a blob, or an unplaced key as a ghost. Those placeholders never enter the world history.
- An **answer to a gap is just a new key or an edited key**, whether it comes from the user or a companion.

---

## 10. Worked example

The notation below is illustrative only. It is **not** the `.tree` syntax.

**Text:** *"The cup sat on the table. Later, it lay shattered on the floor."*

```
span    morning            in: root   placement: unknown   units: blank
point   kitchen
point   table              parent: kitchen
point   cup                parent: kitchen   shape: blob

k1  state   cup.position = on(table)              when: morning@0
            source: text "The cup sat on the table."
k2  state   cup.position = on(floor)
            cup.intact   = false                   when: unplaced, after k1
            source: text "Later, it lay shattered on the floor."
```

**Gap report:**

```
unplaced      k2 — after k1, position unknown
```

The user places k2 at `morning@40`:

```
unexplained   k2 — cup.position differs from on(table) at morning@40; no cause
```

`cup.intact` is not reported. It was never stated before, so `false` simply fills it in (principle 5). Only the position needs a cause. If the text had earlier said *"the cup was intact,"* the shattering would also be unexplained.

The user answers *"Mara bumped into the table."*

```
point   mara               parent: kitchen
k3  cause   mara → push(table)                     when: morning@35
            strength: unspecified
            source: user answer to gap on k2
k4  rule    gravity, rigid-contact                 where: kitchen   when: always
```

**Gap report:**

```
unspecified   k3.strength — push strength unknown
missing unit  k4 gravity — kitchen frame has no length/time units
```

The user says the kitchen is in meters and seconds, and that it was a hard bump. Simulation then pushes the table, the cup slides off and falls, and it reaches the floor before `@40`. **k2's position is now satisfied.**

The new point `mara` also brings a new **open surface**: where she was before `@35`, why she bumped the table, how each step landed. None of this is reported as a problem. It is simply available to explore, and every answer adds more.

---

## 11. Deferred

These are recognized and intentionally postponed until the core is settled:

- **Narrative time vs simulation time:** the order of telling (flashbacks, "meanwhile") as a separate layer over simulation time.
- **Extraction:** turning text into keys, including coreference, role labeling and source spans.
- **Gap-filling:** who fills gaps and how, including companions, guessing policies, defaults, parameter fitting and question selection.
- **Placement resolution:** turning order constraints into positions. For now this is filled the same way as any other gap.
- **Direction layer:** camera, shots, lighting and render style.
- **Materials library:** concrete rules for rigid, soft, fluid and gas matter, light, sound and the like.
- **Natural-language rule compilation.**
- **`.tree` syntax** for points, keys and history.

---

## 12. Open questions

1. ~~**Numeric representation.**~~ Resolved in log 0002: deterministic floats for simulation, exact rationals for key times. See §8.4.
2. **Span length when unitless.** If a child span's length in its parent is unknown, can rules that cross the boundary still run, or is that always a gap?
3. **Neighborhoods.** How do rules find the points that overlap or link to the point they're acting on, efficiently, across nested frames? *Proposal in log 0003: rules declare a filter and a relation; sparse-set storage; relations ranked implicit grid, then links, then spatial index; a BVH per frame and per overlap channel; field grids for large auras.*
4. **Competing causes.** Partly resolved in log 0003. Overlapping causes combine. Incompatible ones are conflicts, shown as dismissable errors. *Proposed:* dismissal is a key; each property declares how effects combine (add, or a deterministic tie-break).
5. **Agents.** What exactly can an intention cause directly (moving their own body, changing their own properties) and what must go through the physical world?
6. **State-key granularity.** Must a state key always name one property, or can it describe a whole situation ("the room was in chaos") that then breaks down into properties?
7. **Rule locality.** Can a rule key be limited to a region of space as well as an interval of time, and how does a rule behave at the boundary?
8. **Painting on the preview.** Strokes are made while looking at the preview, but applied to the authoritative state. How should a visible difference between the two be handled? *(Log 0004.)*
9. **Tolerance for emergent results.** How closely must a state key about an emergent result (such as a crack's path) match to count as satisfied? *(Log 0005.)*
10. **Promoting overlays.** Can a per-object overlay on a shared shape become a new shared shape? *(Log 0005.)*
11. **Identity of created points.** How do points created by rules (shards, droplets, grown branches) keep stable IDs across replays and upstream edits? Leading idea: structural-path IDs, never counters. *(Log 0005.)*

---

## 13. Implementation

*(Decided in log 0002.)*

- **Language:** Rust. Physics and geometry build on Dimforge (Rapier with `enhanced-determinism`, parry, nalgebra). Plugin rules run as deterministic WASM.
- **Layers:**
  - `core`: pure, with no I/O, required threads or GPU;
  - `render`: a splat renderer on wgpu;
  - `hosts`: per-platform shells.
- **First host:** undecided. The web is recommended because of uniform stylus input.
