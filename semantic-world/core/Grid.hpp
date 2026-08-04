#pragma once

#include "core/Types.hpp"

#include <cstddef>
#include <vector>

namespace sw {

// Fixed-size 2D cell grid mapping a position to the particle occupying it.
// Phase 1 implements storage, bounds checking and deterministic iteration.
class Grid {
public:
    Grid(std::int32_t width, std::int32_t height);

    std::int32_t width() const;
    std::int32_t height() const;

    bool inBounds(Vec2i position) const;

    ParticleId at(Vec2i position) const;
    void set(Vec2i position, ParticleId id);

private:
    std::int32_t m_width {};
    std::int32_t m_height {};
    std::vector<ParticleId> m_cells;
};

} // namespace sw
