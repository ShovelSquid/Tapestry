#pragma once

#include "snapshots/Snapshot.hpp"

#include <optional>
#include <vector>

namespace sw {

// Phase 6: one snapshot every 1000 ticks to start with. Restoring always
// verifies the stored hash before replaying the events that follow it.
class SnapshotStore {
public:
    static constexpr Tick kDefaultInterval = 1000;

    void store(const Snapshot& snapshot);

    // Nearest snapshot at or before `tick`.
    std::optional<Snapshot> nearestAtOrBefore(Tick tick) const;

private:
    std::vector<Snapshot> m_snapshots; // sorted by tick
};

} // namespace sw
