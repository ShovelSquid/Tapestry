#pragma once

#include "core/Entity.hpp"
#include "core/Particle.hpp"
#include "core/StateHash.hpp"
#include "core/Types.hpp"

#include <vector>

namespace sw {

// Phase 6: a snapshot is authoritative state plus every version number needed
// to prove it was produced by the same physics.
struct Snapshot {
    Tick tick {};
    WorldSeed seed {};

    std::vector<Particle> particles; // sorted by id
    std::vector<Entity> entities;    // sorted by id
    Vec2i gravity {};

    std::uint32_t materialLibraryVersion {};
    std::uint32_t rulePipelineVersion {};

    std::size_t eventLogPosition {};
    StateHashValue stateHash {};
};

} // namespace sw
