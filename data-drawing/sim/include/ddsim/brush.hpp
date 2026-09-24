// ddsim/brush.hpp — brush version validation.
//
// Strict parse, reject not clamp: a brush the sim would not have produced is
// not a brush. The stability clamps on the derived spring constants come
// from rules/brush_body.hpp (the same derive_params the integrator uses) and
// reject the action rather than adjusting it. The pressure-to-weight
// mapping, curve_weight, lives in rules/emit.hpp and is reachable through
// this header.
#pragma once

#include "ddsim/ddsim_c.h"
#include "ddsim/rules/brush_body.hpp"
#include "ddsim/state.hpp"

namespace ddsim {

inline int validate_brush(const BrushVersion& b) {
    if (b.id == 0) {
        return DD_ERR_BRUSH_INVALID;
    }
    // Length in UTF-8 bytes, compared byte-wise, never normalised.
    if (b.description.empty() || b.description.size() > DD_MAX_DESC_BYTES) {
        return DD_ERR_BRUSH_INVALID;
    }
    if (b.mass.raw <= 0 || b.radius.raw <= 0 || b.spacing.raw <= 0) {
        return DD_ERR_BRUSH_INVALID;
    }
    // Stability: 0 < k_t <= 1 and 0 < c_t <= 1 (mass >= 1 with K = 1). A
    // mass below 1 gives k_t > 1 and is rejected, never clamped.
    const BodyParams p = derive_params(b);
    if (p.k_t.raw <= 0 || p.k_t.raw > fx64::ONE || p.c_t.raw <= 0 || p.c_t.raw > fx64::ONE) {
        return DD_ERR_BRUSH_INVALID;
    }
    return DD_OK;
}

} // namespace ddsim
