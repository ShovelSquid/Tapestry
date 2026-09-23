// ddsim/brush.hpp — brush version validation.
//
// Strict parse, reject not clamp: a brush the sim would not have produced is
// not a brush. Stability clamps on the derived spring constants arrive with
// the body rule in 01-05 and reject the action rather than adjusting it.
#pragma once

#include "ddsim/ddsim_c.h"
#include "ddsim/state.hpp"

namespace ddsim {

inline int validate_brush(const BrushVersion& b) {
    if (b.id == 0) {
        return DD_ERR_BRUSH_INVALID;
    }
    if (b.description.empty() || b.description.size() > DD_MAX_DESC_BYTES) {
        return DD_ERR_BRUSH_INVALID;
    }
    if (b.mass.raw <= 0 || b.radius.raw <= 0 || b.spacing.raw <= 0) {
        return DD_ERR_BRUSH_INVALID;
    }
    return DD_OK;
}

} // namespace ddsim
