// brush_reference.hpp — ddsim's brush body, transcribed for the parity
// tests after plan phase 7 deleted ddsim itself (its rules/brush_body.hpp
// at commit f74d0db). One semi-implicit Euler step per tick toward the
// pen target:
//     a = k_t (target - x) - c_t v;  v += a;  x += v
// with k_t = 1 / mass and c_t = 2 zeta sqrt(k_t) = sqrt(k_t) (zeta = 0.5,
// so the factor 2 zeta is exactly ONE and c_t is exactly sqrt(k_t)).
// The fx64 products are evaluated in this order on purpose: the engine's
// force rule and integrator must reproduce these raw bits, and a
// reordering here would only mask a divergence there.
#pragma once

#include "mathspace/fx64.hpp"

namespace mathspace_test {

using ddsim::fx64;

struct ReferenceBody {
    fx64 x{}, y{}, vx{}, vy{};
};

struct ReferenceParams {
    fx64 k_t;
    fx64 c_t;
};

// ddsim::derive_params: the one division, then the damping from it.
constexpr ReferenceParams reference_params(fx64 mass) {
    ReferenceParams p;
    p.k_t = fx64::from_raw(fx64::ONE) / mass;
    p.c_t = (fx64::from_raw(fx64::ONE / 2) + fx64::from_raw(fx64::ONE / 2)) * ddsim::sqrt(p.k_t);
    return p;
}

// ddsim::body_substep at h = 1 (the bridge takes one step per tick).
inline void reference_substep(ReferenceBody& b, const ReferenceParams& p, fx64 tu, fx64 tv) {
    const fx64 h = fx64::from_int(1);
    const fx64 ax = p.k_t * (tu - b.x) - p.c_t * b.vx;
    const fx64 ay = p.k_t * (tv - b.y) - p.c_t * b.vy;
    b.vx += ax * h;
    b.vy += ay * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
}

} // namespace mathspace_test
