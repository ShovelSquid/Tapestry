#pragma once

#include "core/Types.hpp"

namespace sw {

struct Particle {
    ParticleId id {};
    MaterialId material {};

    Vec2i position {};
    Vec2i velocity {};

    std::uint32_t ageTicks {};
    std::int32_t temperature {};
    std::uint16_t damage {};
    std::uint32_t semanticFlags {};

    friend constexpr bool operator==(const Particle&, const Particle&) = default;
};

} // namespace sw
