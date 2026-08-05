#pragma once

#include "core/Types.hpp"

#include <cstdint>
#include <vector>

namespace tapestry {

struct StrokePoint {
    Vec2 position;
    double pressure = 0.5; // normalized 0..1 at input
};

// A vector gesture in world space. Pressure belongs to each sample rather
// than the stroke, allowing a renderer to reconstruct variable-width marks.
struct Stroke {
    std::uint64_t id = 0;
    std::vector<StrokePoint> points;
};

} // namespace tapestry
