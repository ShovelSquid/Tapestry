#pragma once

#include <cstdint>

namespace sw {

// The 2D prototype is integer-only; floating point is banned from authoritative
// state. Fixed-point arithmetic arrives with Phase 11 (3D expansion), where
// sub-cell positions become necessary. The alias is declared now so that later
// code has a single place to change.
using FixedRaw = std::int64_t;

inline constexpr int kFixedFractionBits = 16;

} // namespace sw
