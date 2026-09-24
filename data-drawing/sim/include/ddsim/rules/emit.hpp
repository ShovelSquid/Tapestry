// ddsim/rules/emit.hpp — node emission at spacing (STRK-03), pinned under
// DD_RULE_EMIT_VERSION = 1.
//
// Nodes are emitted along the brush body's path whenever the accumulated
// path length crosses the brush's spacing, distance-interpolated inside the
// sub-step segment they fall in. Their ids are make_node_id(branch, stroke
// ordinal, emission index) — the index counts up per stroke from 0 and is
// stored on the stroke, never taken from a global counter, so inserting a
// stroke into a session leaves every other stroke's ids untouched. The 3D
// position is origin + u * right + v * up in fixed point from the frame the
// stroke recorded (CANV-01): z comes from that frame, never from a camera.
//
// The pressure-to-weight mapping lives here because it is evaluated at
// emission time and is therefore part of this rule's version.
#pragma once

#include "ddsim/fx64.hpp"
#include "ddsim/ids.hpp"
#include "ddsim/state.hpp"

#include <algorithm>
#include <cstdint>

namespace ddsim {

// Piecewise-linear over the 17 u16 knots with integer interpolation:
// i = p >> 12 (0..15), frac = p & 4095, value = k[i] + ((k[i+1] - k[i]) *
// frac) >> 12 (an arithmetic shift, so a descending segment floors the same
// way an ascending one does), weight = value / 65536 as Q32.32. The identity
// curve (k[i] = i * 4096, k[16] = 65535) maps pressure p to about p / 65536.
inline fx64 curve_weight(const BrushVersion& b, std::uint16_t pressure) {
    const std::uint32_t i = static_cast<std::uint32_t>(pressure >> 12);
    const std::int64_t frac = static_cast<std::int64_t>(pressure & 4095u);
    const std::int64_t k0 = static_cast<std::int64_t>(b.curve[i]);
    const std::int64_t k1 = static_cast<std::int64_t>(b.curve[i + 1]);
    const std::int64_t value = k0 + (((k1 - k0) * frac) >> 12);
    return fx64::from_raw(value << 16);
}

// Emit one node at plane-local `pos` for the stroke, with the body's current
// direction and velocity. Inserted at its ascending-id position (ids within
// a stroke increase, so the common case is a push_back). Skipped
// deterministically — without consuming an index — when the node table is
// full or the stroke has used every 24-bit index.
inline void emit_node(ActiveStroke& st, const BrushVersion& brush, const fx64 pos[2], std::uint16_t pressure,
                      std::uint32_t tick, State& state) {
    if (state.nodes.size() >= DD_MAX_NODES || st.next_emission_index > DD_ID_INDEX_MASK) {
        return;
    }
    const std::uint8_t branch = static_cast<std::uint8_t>((st.id.value >> 32) & DD_ID_BRANCH_MASK);
    const std::uint32_t ordinal = static_cast<std::uint32_t>(st.id.value & DD_ID_ORDINAL_MASK);
    Node n;
    n.id = make_node_id(branch, ordinal, st.next_emission_index);
    st.next_emission_index += 1;
    const fx64 u = pos[0];
    const fx64 v = pos[1];
    // plane[0..2] origin, plane[3..5] right, plane[6..8] up.
    n.x = st.plane[0] + u * st.plane[3] + v * st.plane[6];
    n.y = st.plane[1] + u * st.plane[4] + v * st.plane[7];
    n.z = st.plane[2] + u * st.plane[5] + v * st.plane[8];
    n.weight = curve_weight(brush, pressure);
    n.dir_x = st.dir_x;
    n.dir_y = st.dir_y;
    n.vx = st.body.vx;
    n.vy = st.body.vy;
    n.tick = tick;
    n.brush = st.brush_id;
    n.scale_band = 0;
    const auto at = std::lower_bound(state.nodes.begin(), state.nodes.end(), n.id,
                                     [](const Node& a, NodeId id) { return a.id < id; });
    state.nodes.insert(at, n);
}

// Walk the sub-step segment p0 -> p1 and emit a node every `spacing` of
// path, carrying the leftover into the next segment:
//   seg = |p1 - p0|; carried = path_accum; remaining = seg; pos = p0
//   while carried >= spacing: emit at pos; carried -= spacing
//       (the guard that emits node 0 at the pen-down point, where seg == 0)
//   if seg > 0: while carried + remaining >= spacing:
//       d = spacing - carried; f = d / remaining; pos += (p1 - pos) * f;
//       emit at pos; remaining -= d; carried = 0
//   path_accum = carried + remaining
// When the node table fills, the rest of the segment's path is discarded
// (path_accum = 0) so a hostile spacing cannot spin the loop past the cap.
inline void emit_segment(ActiveStroke& st, const BrushVersion& brush, const fx64 p0[2], const fx64 p1[2],
                         std::uint16_t pressure, std::uint32_t tick, State& state) {
    const fx64 spacing = brush.spacing;
    const fx64 dx = p1[0] - p0[0];
    const fx64 dy = p1[1] - p0[1];
    const fx64 seg = sqrt(dx * dx + dy * dy);
    fx64 carried = st.path_accum;
    fx64 remaining = seg;
    fx64 pos[2] = {p0[0], p0[1]};
    bool full = false;
    while (carried >= spacing) {
        if (state.nodes.size() >= DD_MAX_NODES) {
            full = true;
            break;
        }
        emit_node(st, brush, pos, pressure, tick, state);
        carried -= spacing;
    }
    if (!full && seg.raw > 0) {
        while (carried + remaining >= spacing) {
            if (state.nodes.size() >= DD_MAX_NODES) {
                full = true;
                break;
            }
            const fx64 d = spacing - carried;
            const fx64 f = d / remaining;
            pos[0] = pos[0] + (p1[0] - pos[0]) * f;
            pos[1] = pos[1] + (p1[1] - pos[1]) * f;
            emit_node(st, brush, pos, pressure, tick, state);
            remaining -= d;
            carried = fx64::from_raw(0);
        }
    }
    st.path_accum = full ? fx64::from_raw(0) : carried + remaining;
}

} // namespace ddsim
