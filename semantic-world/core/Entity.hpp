#pragma once

#include "core/Types.hpp"

namespace sw {

// Phase 8 adds SensorState, MemoryState and BehaviorState. Only the fields the
// authoritative state needs from the start live here.
struct Entity {
    EntityId id {};

    Vec2i position {};
    Vec2i velocity {};

    std::int32_t energy {};
    std::int32_t health {};
    std::uint32_t ageTicks {};

    friend constexpr bool operator==(const Entity&, const Entity&) = default;
};

} // namespace sw
