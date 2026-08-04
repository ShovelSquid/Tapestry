#pragma once

#include "core/Types.hpp"

namespace sw {

class World;

using StateHashValue = std::uint64_t;

// Hashes only authoritative state: tick, seed, rule-pipeline versions and
// order, material definitions, global parameters, particles and entities in id
// order, rule regions, pending events.
//
// Never renderer state, window size, camera, frame time or UI selection.
StateHashValue hashWorld(const World& world);

} // namespace sw
