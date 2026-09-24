// ddsim/rules/constraints.hpp — free particles connected by distance
// constraints, pinned under DD_RULE_CONSTRAINT_VERSION = 1.
//
// One primitive (a distance constraint with a stiffness) models three
// things by choice of parameters, not by branching on a kind:
//   - a rigid rod / rope segment: stiffness = 1
//   - a spring: stiffness < 1 (partial correction per iteration reads as
//     springy, damped motion)
//   - a hinge / pin joint: either endpoint is a static particle
//     (inv_mass = 0), anchoring the other to a fixed point
//
// Solver: fixed-iteration Position-Based Dynamics (Jakobsen-style — the
// method behind classic rope/cloth demos), with NO persistent solver state.
// Each tick, per free particle:
//   prevPos = pos
//   v += gravity * h              (h = 1 tick, semi-implicit)
//   pos += v * h
// then DD_CONSTRAINT_ITERATIONS Gauss-Seidel passes, each over every
// constraint in ascending id order (the storage order, since ids are
// assigned sequentially):
//   d = posB - posA; len = |d|; C = len - rest_length
//   posA += d * (C / len) * stiffness * (wA / (wA + wB))
//   posB -= d * (C / len) * stiffness * (wB / (wA + wB))
// then velocity is DERIVED from the position change, never integrated
// directly:
//   v = pos - prevPos
// so the constraint correction affects velocity exactly, without a Lagrange
// multiplier or any other value that would have to live in State and the
// canonical walk. The iteration count is FIXED, never convergence-checked:
// every build runs the identical number of operations, the same discipline
// every other rule in this codebase follows.
//
// DD_CONSTRAINT_EPS guards the degenerate case (two particles at the same
// point, len == 0): direction is undefined, so that pass is skipped, the
// same guard DD_DIR_EPS gives the brush body's direction vector.
#pragma once

#include "ddsim/fx64.hpp"
#include "ddsim/state.hpp"

#include <cstddef>
#include <vector>

namespace ddsim {

inline constexpr fx64 DD_CONSTRAINT_EPS = fx64::from_raw(fx64::ONE >> 16);

// The one place mass becomes a solver weight: static particles (fixed
// anchors) have inv_mass 0 and never move; validate_particle (particle.hpp)
// already guarantees mass > 0 whenever is_static is false, so this never
// divides by zero.
inline fx64 inv_mass(const Particle& p) {
    return p.is_static != 0 ? fx64::from_raw(0) : fx64::from_int(1) / p.mass;
}

inline void step_particles(State& state) {
    const std::size_t n = state.particles.size();
    if (n == 0) {
        return;
    }
    std::vector<fx64> prev_x(n), prev_y(n);
    for (std::size_t i = 0; i < n; ++i) {
        Particle& p = state.particles[i];
        prev_x[i] = p.x;
        prev_y[i] = p.y;
        if (p.is_static == 0) {
            p.vy += DD_GRAVITY_Y_PER_TICK;
            p.x += p.vx;
            p.y += p.vy;
        }
    }

    for (std::uint32_t iter = 0; iter < DD_CONSTRAINT_ITERATIONS; ++iter) {
        for (const Constraint& c : state.constraints) {
            Particle& a = state.particles[c.particle_a - 1];
            Particle& b = state.particles[c.particle_b - 1];
            const fx64 wa = inv_mass(a);
            const fx64 wb = inv_mass(b);
            const fx64 wsum = wa + wb;
            if (wsum.raw <= 0) {
                continue;
            }
            const fx64 dx = b.x - a.x;
            const fx64 dy = b.y - a.y;
            const fx64 len2 = dx * dx + dy * dy;
            if (len2 < DD_CONSTRAINT_EPS) {
                continue;
            }
            const fx64 len = sqrt(len2);
            const fx64 diff = ((len - c.rest_length) / len) * c.stiffness;
            const fx64 corr_x = dx * diff;
            const fx64 corr_y = dy * diff;
            a.x += corr_x * (wa / wsum);
            a.y += corr_y * (wa / wsum);
            b.x -= corr_x * (wb / wsum);
            b.y -= corr_y * (wb / wsum);
        }
    }

    for (std::size_t i = 0; i < n; ++i) {
        Particle& p = state.particles[i];
        if (p.is_static == 0) {
            p.vx = p.x - prev_x[i];
            p.vy = p.y - prev_y[i];
        }
    }
}

} // namespace ddsim
