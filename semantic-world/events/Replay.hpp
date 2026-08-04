#pragma once

#include "core/StateHash.hpp"
#include "core/Types.hpp"
#include "events/Event.hpp"

#include <optional>
#include <string>
#include <vector>

namespace sw {

class World;

// Phase 5: rebuild a world from nothing but a seed and an event log.
World runSimulation(WorldSeed seed, const std::vector<Event>& events, Tick finalTick);

// Divergence report: which tick, which subsystem, which id, expected vs actual.
struct DivergenceReport {
    Tick tick {};
    std::string subsystem;
    std::uint64_t objectId {};
    StateHashValue expected {};
    StateHashValue actual {};
};

// Runs the same seed and log twice and reports the earliest tick whose hashes
// differ, if any.
std::optional<DivergenceReport> findFirstDivergence(
    WorldSeed seed,
    const std::vector<Event>& events,
    Tick finalTick);

} // namespace sw
