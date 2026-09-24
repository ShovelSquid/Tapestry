// ddsim/particle.hpp — particle and constraint validation.
//
// Strict parse, reject not clamp, the same rule brush.hpp already follows:
// a particle or constraint the sim would not have produced is not one.
// Both validators are called from Sim::apply (src/sim.cpp) and again from
// read_canonical (src/hash.cpp) so apply and restore can never drift apart.
#pragma once

#include "ddsim/ddsim_c.h"
#include "ddsim/state.hpp"

namespace ddsim {

// A static particle is a fixed anchor: mass must be exactly 0. A dynamic
// particle's mass must be strictly positive — never clamped up from zero or
// down from a huge value.
inline int validate_particle(const Particle& p) {
    if (p.is_static > 1) {
        return DD_ERR_PARTICLE_INVALID;
    }
    if (p.is_static != 0) {
        if (p.mass.raw != 0) {
            return DD_ERR_PARTICLE_INVALID;
        }
    } else {
        if (p.mass.raw <= 0) {
            return DD_ERR_PARTICLE_INVALID;
        }
    }
    return DD_OK;
}

// particle_a/particle_b are validated against the live particle count by
// the caller (Sim::apply / read_canonical), since that bound is state, not
// a field-level property. Here: distinct endpoints, non-negative rest
// length, stiffness in (0, 1] — 0 would never move anything and > 1
// overshoots the position-based correction every iteration.
inline int validate_constraint(const Constraint& c) {
    if (c.particle_a == 0 || c.particle_b == 0 || c.particle_a == c.particle_b) {
        return DD_ERR_CONSTRAINT_INVALID;
    }
    if (c.rest_length.raw < 0) {
        return DD_ERR_CONSTRAINT_INVALID;
    }
    if (c.stiffness.raw <= 0 || c.stiffness.raw > fx64::ONE) {
        return DD_ERR_CONSTRAINT_INVALID;
    }
    return DD_OK;
}

} // namespace ddsim
