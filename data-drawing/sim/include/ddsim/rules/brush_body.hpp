// ddsim/rules/brush_body.hpp — the spring-damper brush body (STRK-02),
// pinned under DD_RULE_BRUSHBODY_VERSION = 1.
//
// The body is a mass on a spring toward the pen sample, integrated with
// semi-implicit (symplectic) Euler in fixed point, inside the sim, from the
// recorded samples — so the feel is a property of the brush version and
// replays exactly. The only brush-visible knob is the mass:
//
//   k_t = K / m           per-tick stiffness   (K = DD_BODY_K = 1.0)
//   c_t = 2 * zeta * sqrt(k_t)   per-tick damping  (zeta = DD_BODY_ZETA = 0.5)
//
// so m = 1 gives (1, 1): light, near-critical; m = 64 gives (1/64, 1/8):
// heavy, visibly underdamped. Stability (Jury conditions on the h = 1 update
// matrix): 0 < c_t < 2 and 0 < k_t < 4 - 2 c_t. The validator (brush.hpp)
// requires the tighter 0 < k_t <= 1 and 0 < c_t <= 1 and REJECTS any brush
// outside it — never clamps — so replay can never depend on a silent
// correction. Sub-stepping by h = 1/n only shrinks k_t h^2 and c_t h, so
// validating at h = 1 is sufficient.
#pragma once

#include "ddsim/fx64.hpp"
#include "ddsim/rules/emit.hpp"
#include "ddsim/state.hpp"

#include <cstdint>

namespace ddsim {

inline constexpr fx64 DD_BODY_K = fx64::from_raw(fx64::ONE);           // 1.0
inline constexpr fx64 DD_BODY_ZETA = fx64::from_raw(fx64::ONE / 2);     // 0.5
inline constexpr fx64 DD_DIR_EPS = fx64::from_raw(fx64::ONE >> 16);     // |v|^2 below this keeps the previous direction

struct BodyParams {
    fx64 k_t;
    fx64 c_t;
};

// The one place mass becomes spring constants: the validator and the
// integrator both call this, so they cannot drift apart. With zeta = 0.5 the
// factor 2 * zeta is exactly ONE, so c_t is exactly sqrt(k_t). Requires
// mass > 0 (the validator checks that first).
constexpr BodyParams derive_params(const BrushVersion& b) {
    BodyParams p;
    p.k_t = DD_BODY_K / b.mass;
    p.c_t = (DD_BODY_ZETA + DD_BODY_ZETA) * sqrt(p.k_t);
    return p;
}

} // namespace ddsim
