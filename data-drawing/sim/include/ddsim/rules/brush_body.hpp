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

#include <cstddef>
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

// One semi-implicit Euler sub-step of size h toward (tu, tv):
//   a = k_t * (target - x) - c_t * v
//   v += a * h        (velocity first ...)
//   x += v * h        (... then position: symplectic)
// then the direction: if |v|^2 >= DD_DIR_EPS, dir = v / |v| (isqrt-based),
// else the previous direction is kept.
inline void body_substep(ActiveStroke& st, const BodyParams& p, fx64 tu, fx64 tv, fx64 h) {
    const fx64 ax = p.k_t * (tu - st.body.x) - p.c_t * st.body.vx;
    const fx64 ay = p.k_t * (tv - st.body.y) - p.c_t * st.body.vy;
    st.body.vx += ax * h;
    st.body.vy += ay * h;
    st.body.x += st.body.vx * h;
    st.body.y += st.body.vy * h;
    const fx64 v2 = st.body.vx * st.body.vx + st.body.vy * st.body.vy;
    if (v2 >= DD_DIR_EPS) {
        const fx64 mag = sqrt(v2);
        st.dir_x = st.body.vx / mag;
        st.dir_y = st.body.vy / mag;
    }
}

// One tick of the body rule for one active stroke, consuming the tick's
// pending samples in index order with sub-steps of h = 1/n (n samples), and
// calling emit_segment over each sub-step's path with that sample's
// pressure. The first sample ever received places the body on it (x =
// target, v = 0, dir = (1, 0), path_accum = spacing, so node 0 is emitted at
// the pen-down point). A tick with no samples holds the last target and
// takes one sub-step of h = 1 toward it, still emitting with the last
// pressure — the body keeps moving after the pen pauses; that is the
// momentum. Clears `pending` at the end.
inline void integrate_tick(ActiveStroke& st, const BrushVersion& brush, const BodyParams& params, std::uint32_t tick,
                           State& state) {
    const std::size_t n = st.pending.size();
    if (n == 0) {
        if (st.has_target == 0) {
            return;
        }
        const fx64 p0[2] = {st.body.x, st.body.y};
        body_substep(st, params, st.target_u, st.target_v, fx64::from_int(1));
        const fx64 p1[2] = {st.body.x, st.body.y};
        emit_segment(st, brush, p0, p1, st.last_pressure, tick, state);
        return;
    }
    const fx64 h = fx64::from_int(1) / fx64::from_int(static_cast<std::int32_t>(n));
    for (const Sample& s : st.pending) {
        const fx64 tu = fx64::from_q16(s.u);
        const fx64 tv = fx64::from_q16(s.v);
        if (st.has_target == 0) {
            st.body.x = tu;
            st.body.y = tv;
            st.body.vx = fx64::from_raw(0);
            st.body.vy = fx64::from_raw(0);
            st.dir_x = fx64::from_int(1);
            st.dir_y = fx64::from_raw(0);
            st.path_accum = brush.spacing;
            st.has_target = 1;
        }
        st.target_u = tu;
        st.target_v = tv;
        const fx64 p0[2] = {st.body.x, st.body.y};
        body_substep(st, params, tu, tv, h);
        const fx64 p1[2] = {st.body.x, st.body.y};
        emit_segment(st, brush, p0, p1, s.pressure, tick, state);
        st.last_pressure = s.pressure;
    }
    st.pending.clear();
}

} // namespace ddsim
