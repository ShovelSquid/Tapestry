#pragma once

#include "core/Entity.hpp"
#include "core/Grid.hpp"
#include "core/Particle.hpp"
#include "core/Types.hpp"

#include <vector>

namespace sw {

class MaterialLibrary;
class RulePipeline;

// The authoritative world state. Phase 1 fills this in.
//
// Invariants it must hold from the first line of implementation:
//   - no wall-clock time,
//   - no unseeded randomness,
//   - no renderer may mutate it,
//   - iteration order for authoritative updates is stable (sorted by id),
//   - no floating point.
class World {
public:
    World(WorldSeed seed, std::int32_t width, std::int32_t height);

    Tick tick() const;
    WorldSeed seed() const;

    const Grid& grid() const;

    ParticleId addParticle(const Particle& particle);
    void removeParticle(ParticleId id);

    // Advances exactly one fixed timestep.
    void step();

private:
    Tick m_tick {};
    WorldSeed m_seed {};

    Grid m_grid;

    std::vector<Particle> m_particles; // kept sorted by id
    std::vector<Entity> m_entities;    // kept sorted by id

    ParticleId m_nextParticleId {1};
    EntityId m_nextEntityId {1};

    Vec2i m_gravity {0, 1};
};

} // namespace sw
