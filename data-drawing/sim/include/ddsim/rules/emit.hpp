// ddsim/rules/emit.hpp — node emission at spacing (STRK-03), pinned under
// DD_RULE_EMIT_VERSION = 1.
//
// The pressure-to-weight mapping lives here because it is evaluated at
// emission time and is therefore part of this rule's version. The emission
// loop itself (emit_segment / emit_node) arrives with the body rule.
#pragma once

#include "ddsim/fx64.hpp"
#include "ddsim/ids.hpp"
#include "ddsim/state.hpp"

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

} // namespace ddsim
