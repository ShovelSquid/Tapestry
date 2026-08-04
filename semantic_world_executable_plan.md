# Semantic World Engine — Executable Development Plan

## Goal

Build a deterministic simulation engine in C++ where:

- the world is constructed through semantic particles and brush strokes;
- materials and regions define physical parameters and rules;
- physical laws can change over time and space;
- all user and system changes are recorded as events;
- the same seed and event log always reproduce the same world state;
- rendering is separate from authoritative simulation state;
- neural rendering can be added later without controlling world truth.

The first prototype is intentionally small:

- 2D integer grid
- sand, water, and stone
- one simple entity type
- gravity and material movement rules
- semantic painting tools
- append-only event log
- deterministic replay
- state hashing
- timeline scrubbing

---

# Phase 0 — Technical Baseline

## Language and build system

Use:

- C++20
- CMake
- SDL2 for the first renderer and input layer
- Catch2 or GoogleTest for automated tests
- JSON initially for readable event logs
- binary snapshots later

## Supported first targets

1. Desktop Linux
2. Windows
3. Raspberry Pi Linux
4. Nintendo Switch Linux, after the desktop version is stable

## Initial repository

```text
semantic-world/
├── CMakeLists.txt
├── README.md
├── assets/
│   └── sprites/
├── app/
│   └── main.cpp
├── core/
│   ├── Types.hpp
│   ├── World.hpp
│   ├── World.cpp
│   ├── Grid.hpp
│   ├── Grid.cpp
│   ├── Particle.hpp
│   ├── Entity.hpp
│   ├── FixedPoint.hpp
│   ├── StateHash.hpp
│   └── StateHash.cpp
├── materials/
│   ├── MaterialDefinition.hpp
│   ├── MaterialLibrary.hpp
│   └── MaterialLibrary.cpp
├── rules/
│   ├── SimulationRule.hpp
│   ├── RulePipeline.hpp
│   ├── RulePipeline.cpp
│   ├── GravityRule.hpp
│   ├── GravityRule.cpp
│   ├── SandRule.hpp
│   ├── SandRule.cpp
│   ├── WaterRule.hpp
│   └── WaterRule.cpp
├── commands/
│   ├── Command.hpp
│   ├── CommandQueue.hpp
│   └── CommandProcessor.cpp
├── events/
│   ├── Event.hpp
│   ├── EventLog.hpp
│   ├── EventLog.cpp
│   ├── Replay.hpp
│   └── Replay.cpp
├── snapshots/
│   ├── Snapshot.hpp
│   ├── SnapshotStore.hpp
│   └── SnapshotStore.cpp
├── rendering/
│   ├── Renderer.hpp
│   ├── SDLRenderer.hpp
│   └── SDLRenderer.cpp
├── serialization/
│   ├── JsonEventCodec.hpp
│   └── JsonEventCodec.cpp
└── tests/
    ├── DeterminismTest.cpp
    ├── ReplayTest.cpp
    ├── SnapshotTest.cpp
    └── MaterialRuleTest.cpp
```

## Completion criteria

Phase 0 is complete when:

- the project configures with CMake;
- a blank SDL window opens;
- tests compile and run;
- the same repository builds on desktop Linux and Raspberry Pi Linux.

---

# Phase 1 — Authoritative World State

## Objective

Create a minimal world representation that contains no rendering logic.

## Core types

```cpp
using Tick = std::uint64_t;
using ParticleId = std::uint64_t;
using EntityId = std::uint64_t;
using MaterialId = std::uint32_t;
using WorldSeed = std::uint64_t;

struct Vec2i {
    std::int32_t x {};
    std::int32_t y {};
};

struct Particle {
    ParticleId id {};
    MaterialId material {};

    Vec2i position {};
    Vec2i velocity {};

    std::uint32_t ageTicks {};
    std::int32_t temperature {};
    std::uint16_t damage {};
    std::uint32_t semanticFlags {};
};
```

## World requirements

The `World` class must own:

- current tick;
- world seed;
- fixed-size grid;
- particles;
- entities;
- material library;
- active rule pipeline;
- global parameters such as gravity;
- deterministic ID counters or address-based ID generation.

## Rules

- Do not use wall-clock time in the simulation.
- Do not use unseeded random functions.
- Do not mutate world state from the renderer.
- Do not use unordered iteration for authoritative updates unless keys are sorted before processing.
- Do not use floating-point values for the first prototype.

## Completion criteria

Phase 1 is complete when:

- particles can be inserted and removed;
- the world advances by an empty tick;
- particle IDs remain stable;
- serial iteration order is deterministic;
- two worlds built from the same seed have identical hashes.

---

# Phase 2 — Material Library

## Objective

Separate semantic identity from physical parameters.

## Material definition

```cpp
struct MaterialDefinition {
    MaterialId id {};
    std::string name;

    std::int32_t density {};
    std::int32_t friction {};
    std::int32_t cohesion {};
    std::int32_t flowRate {};
    std::int32_t thermalConductivity {};

    bool affectedByGravity {};
    bool canFlow {};
    bool immovable {};
};
```

## First materials

### Stone

```text
density: high
friction: high
cohesion: high
flow: none
affected by gravity: false
immovable: true
```

### Sand

```text
density: medium-high
friction: medium
cohesion: low
flow: granular
affected by gravity: true
immovable: false
```

### Water

```text
density: medium
friction: low
cohesion: medium
flow: high
affected by gravity: true
immovable: false
```

## Completion criteria

Phase 2 is complete when:

- particles reference materials by stable ID;
- changing a material definition changes simulation behavior;
- material definitions are versioned;
- replay records which material-library version was used.

---

# Phase 3 — Deterministic Rule Pipeline

## Objective

Make physical laws explicit, ordered, replaceable, and versioned.

## Rule interface

```cpp
class SimulationRule {
public:
    virtual ~SimulationRule() = default;

    virtual std::string_view name() const = 0;
    virtual std::uint32_t version() const = 0;

    virtual void apply(
        World& world,
        Tick tick
    ) = 0;
};
```

## Initial pipeline

```text
1. ApplyCommandsRule
2. GravityRule
3. SandSettlingRule
4. WaterFlowRule
5. EntityRule
6. AgingRule
7. DamageRule
8. StateValidationRule
```

## Deterministic update policy

For each tick:

1. Gather commands assigned to the tick.
2. Sort commands by stable sequence number.
3. Apply commands.
4. Gather particles in stable ID order.
5. Evaluate rules in configured order.
6. Resolve movement conflicts using stable priority rules.
7. Commit changes.
8. Increment age.
9. Hash authoritative state.
10. Append significant events.

## Conflict resolution example

If two particles attempt to move into the same cell:

1. Lower tick-local priority value wins.
2. If equal, lower stable particle ID wins.
3. Losing particle remains in place.

No result may depend on thread scheduling.

## Completion criteria

Phase 3 is complete when:

- sand falls;
- water flows laterally when blocked;
- stone remains stationary;
- repeated runs produce identical hashes;
- changing rule order produces a deliberately different, versioned result.

---

# Phase 4 — Commands and Events

## Objective

Ensure all external changes enter through explicit commands and become recorded events.

## Command examples

```cpp
struct PaintMaterialCommand {
    Tick tick {};
    std::uint64_t sequence {};
    Vec2i position {};
    MaterialId material {};
    std::int32_t radius {};
};

struct SetGravityCommand {
    Tick tick {};
    std::uint64_t sequence {};
    Vec2i gravity {};
};

struct ChangeMaterialParameterCommand {
    Tick tick {};
    std::uint64_t sequence {};
    MaterialId material {};
    ParameterId parameter {};
    std::int32_t value {};
};
```

## Event examples

```text
CreateWorld
PaintMaterial
EraseMaterial
SetGravity
ChangeMaterialParameter
CreateEntity
DestroyEntity
CreateRuleRegion
ReplaceRulePipeline
AddSemanticTag
DamageParticle
CreateScar
```

## Rule

The UI must never directly mutate the world.

```text
Input
  ↓
Command
  ↓
Validation
  ↓
Event
  ↓
World mutation
```

## Event log requirements

Every event records:

- tick;
- sequence number;
- event type;
- schema version;
- author or source;
- payload;
- optional causal parent event;
- optional affected spatial region.

## Example log

```text
Tick 0:
    CreateWorld(seed=84921)

Tick 12:
    PaintMaterial(material=sand, x=30, y=15, radius=4)

Tick 18:
    PaintMaterial(material=water, x=45, y=10, radius=3)

Tick 500:
    SetGravity(x=1, y=0)

Tick 700:
    ChangeMaterialParameter(
        material=water,
        parameter=flowRate,
        value=10
    )
```

## Completion criteria

Phase 4 is complete when:

- painting creates commands;
- commands create events;
- events mutate the world;
- the full world can be regenerated from seed and event log;
- gravity changes at an exact recorded tick.

---

# Phase 5 — State Hashing and Replay

## Objective

Prove deterministic behavior before adding complex features.

## State hash contents

The hash must include:

- current tick;
- seed;
- rule-pipeline versions and order;
- material definitions and versions;
- global parameters;
- particles sorted by ID;
- entities sorted by ID;
- active rule regions;
- pending authoritative events.

Do not include:

- renderer state;
- window size;
- camera position;
- frame time;
- UI selection;
- temporary debug information.

## Required test

```cpp
World runSimulation(
    WorldSeed seed,
    const std::vector<Event>& events,
    Tick finalTick
);

TEST_CASE("Replay produces identical state") {
    const auto events = loadEvents("test-world.json");

    const World worldA =
        runSimulation(84921, events, 10'000);

    const World worldB =
        runSimulation(84921, events, 10'000);

    REQUIRE(hashWorld(worldA) == hashWorld(worldB));
}
```

## Failure reporting

When hashes differ, report:

- first mismatching tick;
- first mismatching subsystem;
- first mismatching particle or entity ID;
- expected value;
- actual value.

## Completion criteria

Phase 5 is complete when:

- 100 consecutive replays produce the same final hash;
- replay works after restarting the application;
- the earliest divergence tick can be identified automatically.

---

# Phase 6 — Snapshots and Timeline Scrubbing

## Objective

Avoid replaying from tick zero every time.

## Snapshot contents

A snapshot stores:

- tick;
- authoritative world state;
- material-library version;
- rule-pipeline version;
- event-log position;
- state hash.

## Snapshot schedule

Start with:

```text
one snapshot every 1,000 ticks
```

Later support:

- global snapshots;
- regional snapshots;
- chunk snapshots;
- entity snapshots.

## Restore algorithm

```text
requested tick
    ↓
find nearest earlier snapshot
    ↓
load snapshot
    ↓
verify snapshot hash
    ↓
replay subsequent events
    ↓
arrive at requested tick
```

## Completion criteria

Phase 6 is complete when:

- the simulation can scrub backward and forward;
- replay from a snapshot matches replay from tick zero;
- snapshot restoration produces the same final hash.

---

# Phase 7 — Rendering and Semantic Brushes

## Objective

Display the world without allowing rendering to affect simulation.

## First renderer

Use SDL2 sprites or colored rectangles:

```text
stone: gray
sand: yellow
water: blue
entity: white
```

## Renderer interface

```cpp
class Renderer {
public:
    virtual ~Renderer() = default;
    virtual void draw(const WorldView& view) = 0;
};
```

The renderer receives a read-only `WorldView`, not a mutable `World`.

## First semantic brushes

```text
Material brush
Erase brush
Heat brush
Damage brush
Entity egg brush
Gravity-region brush
Semantic-tag brush
```

## Brush-stroke representation

```cpp
struct SemanticBrushStroke {
    Tick tick {};
    BrushId brush {};
    std::vector<Vec2i> path;

    MaterialId material {};
    std::int32_t radius {};
    std::int32_t strength {};
    SemanticTag role {};
};
```

A brush stroke is converted into one or more commands. The original stroke may also be preserved as compact construction history.

## Completion criteria

Phase 7 is complete when:

- the user can paint sand, water, and stone;
- brush strokes are recorded and replayed;
- zooming and camera movement do not affect simulation hashes;
- the renderer can be disabled without changing results.

---

# Phase 8 — First Entity

## Objective

Add one persistent actor that observes and modifies the world.

## Minimal entity state

```cpp
struct Entity {
    EntityId id {};
    Vec2i position {};
    Vec2i velocity {};

    std::int32_t energy {};
    std::int32_t health {};
    std::uint32_t ageTicks {};

    SensorState sensors;
    MemoryState memory;
    BehaviorState behavior;
};
```

## First behavior

The entity should:

1. detect nearby water;
2. move toward water;
3. lose energy each tick;
4. gain energy when reaching water;
5. remember the last detected water position;
6. leave a recorded movement trail or event summary.

## Perspective model

Keep separate:

```text
true world state
entity observation
entity memory
entity belief
rendered entity perspective
```

The entity must not automatically know the complete world.

## Completion criteria

Phase 8 is complete when:

- the entity behaves identically during replay;
- its decisions use deterministic randomness;
- its memory is persistent;
- the world can be viewed from the entity’s limited perspective.

---

# Phase 9 — Spatial Rule Regions

## Objective

Allow different regions to obey different physical laws.

## Region definition

```cpp
struct RuleRegion {
    RegionId id {};
    Shape shape {};
    RuleSetId ruleSet {};
    std::int32_t priority {};
    Tick createdAt {};
};
```

## First region behaviors

- sideways gravity;
- reversed gravity;
- reduced water flow;
- accelerated aging;
- increased cohesion;
- no-collision zone.

## Rule resolution

```cpp
RuleSet resolveRules(
    const World& world,
    Vec2i position,
    Tick tick
);
```

Overlapping regions resolve through:

1. explicit priority;
2. creation tick;
3. stable region ID.

## Completion criteria

Phase 9 is complete when:

- a painted region changes local physics;
- entering and leaving the region is deterministic;
- region creation and deletion replay correctly.

---

# Phase 10 — Semantic-to-Physical Compilation

## Objective

Prepare the architecture for 3D objects and more detailed materials.

## Compiler responsibility

Convert semantic descriptions into physical parameters:

```text
semantic material
structural role
manufacturing history
age
damage
temperature
grain direction
    ↓
density
mass
stiffness
friction
yield threshold
fracture threshold
thermal response
```

## First compiled object

Build a simple 2D sword-like object from strokes:

```text
blade stroke
grip stroke
guard stroke
material assignment
edge semantic tag
```

Derive:

- total mass;
- center of mass;
- moment of inertia;
- collision shape;
- structural regions;
- damage state.

## Completion criteria

Phase 10 is complete when:

- changing the grip material changes balance;
- removing blade material changes mass and inertia;
- damage becomes persistent semantic history;
- the same stroke program regenerates the same physical object.

---

# Phase 11 — 3D Expansion

Do not begin this phase until the 2D replay system is stable.

## Replace or extend

- 2D grid → sparse 3D chunks
- `Vec2i` → fixed-point `Vec3`
- 2D brushes → 3D spatial paths
- cells → volumetric samples or implicit fields
- sprite renderer → mesh, volume, or neural renderer
- simple particles → rigid bodies, rods, deformables, or MPM samples

## 3D semantic stroke

```cpp
struct SemanticStroke3D {
    StrokeId id {};
    BrushType brush {};
    SpatialPath3D path {};
    CrossSection profile {};

    MaterialId material {};
    StructuralRole role {};

    Fixed radius {};
    Fixed strength {};
    Fixed falloff {};

    ConstraintSet constraints {};
    IntentTag intent {};
};
```

## Completion criteria

Phase 11 is complete when:

- a 3D semantic stroke program regenerates the same object;
- its mass properties are deterministic;
- it can be exported to a conventional mesh;
- the mesh is treated as compiled output, not source truth.

---

# Phase 12 — Neural Rendering

The neural renderer is deliberately late.

## Input conditioning

The renderer may receive:

- spatial semantic field;
- material composition;
- structural roles;
- age;
- scars;
- damage;
- lighting;
- observer state;
- scale;
- camera;
- stable render seed;
- renderer-model version.

## Hard boundary

The neural renderer may determine:

- texture;
- micro-detail;
- softness;
- visual style;
- bounded perceptual wobble;
- observer-dependent emphasis.

It may not determine:

- authoritative geometry;
- collisions;
- mass;
- material identity;
- whether damage occurred;
- entity decisions;
- event history.

## Completion criteria

Phase 12 is complete when:

- disabling the neural renderer does not change simulation hashes;
- the same semantic state can be rendered by multiple renderers;
- all interaction is converted back into semantic commands before changing the world.

---

# First Four-Week Build Schedule

## Week 1 — Kernel

### Tasks

- create CMake project;
- open SDL window;
- define `World`, `Particle`, and `Grid`;
- add world seed and tick;
- implement stable iteration;
- create basic state hash;
- add deterministic unit test.

### Deliverable

A blank deterministic world that advances ticks and hashes consistently.

---

## Week 2 — Materials and Movement

### Tasks

- implement material library;
- add stone, sand, and water;
- create ordered rule pipeline;
- implement gravity;
- implement sand settling;
- implement simple water flow;
- add conflict-resolution rules.

### Deliverable

A small falling-sand simulation that produces the same state hash every run.

---

## Week 3 — Commands, Events, and Replay

### Tasks

- add command queue;
- convert mouse input into commands;
- define event schema;
- serialize event log;
- replay from seed and events;
- add gravity-change command;
- add divergence diagnostics.

### Deliverable

Paint a scene, change gravity, save the log, restart, and reproduce the exact result.

---

## Week 4 — Snapshots and Timeline

### Tasks

- implement snapshots;
- restore from nearest snapshot;
- add timeline controls;
- scrub backward and forward;
- verify snapshot replay against full replay;
- package Raspberry Pi build.

### Deliverable

A deterministic 2D semantic sandbox with replay, rewind, and portable builds.

---

# First Runnable Demonstration

The first public demonstration should do exactly this:

1. Start a world from seed `84921`.
2. Paint a stone floor.
3. Paint a pile of sand.
4. Paint a suspended water reservoir.
5. Run for 500 ticks.
6. Change gravity from downward to rightward.
7. Run for another 500 ticks.
8. Save the event log and snapshot.
9. Close the application.
10. Reopen the application.
11. Replay to tick 1,000.
12. Verify the final state hash.
13. Scrub to tick 250, 500, 750, and 1,000.
14. Show that every state is reconstructed identically.

## Pass condition

```text
Original final hash == Replay final hash
```

## Failure condition

Any particle, material parameter, entity, rule version, or world value differs.

---

# Non-Negotiable Engineering Rules

1. Simulation uses a fixed timestep.
2. Rendering never mutates authoritative state.
3. User input becomes commands.
4. Commands become validated events.
5. Rule changes are logged.
6. Material definitions are versioned.
7. Rules execute in stable order.
8. Particles and entities update in stable order.
9. Randomness is seeded and address-based.
10. Parallelism cannot change results.
11. State hashes are generated regularly.
12. Snapshots are verified before replay.
13. Neural output is never authoritative.
14. Generated visual detail becomes persistent only after semantic interaction.
15. Every saved world records its schema, solver, material, and rule versions.

---

# Immediate Next Actions

## Today

- create the repository;
- add the directory structure;
- write `Types.hpp`;
- write `Particle.hpp`;
- write `World.hpp` and `World.cpp`;
- create a stable world hash;
- write the first determinism test.

## After the first test passes

- add the grid;
- add material definitions;
- implement stone;
- implement gravity;
- implement sand;
- render cells through SDL2.

## Do not add yet

- neural rendering;
- machine learning;
- networking;
- multiplayer;
- arbitrary 3D;
- complex fracture;
- GPU physics;
- procedural infinite zoom;
- cross-platform floating-point determinism.

Those systems should be added only after deterministic replay works in the smallest possible world.

---

# Definition of Success

The prototype succeeds when the world is not merely visually similar after reload, but mathematically identical in its authoritative state.

At that point, the project has a stable foundation for:

- semantic 2D and 3D modeling;
- arbitrary physical rule systems;
- mutable regional physics;
- persistent entities and perspectives;
- material histories and scars;
- deterministic world replay;
- branching timelines;
- simulation-trained modeling agents;
- neural perceptual rendering;
- portable semantic assets.
