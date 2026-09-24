// ddsim/presets.hpp — the four shipped brush presets (STRK-04).
//
// The mass is the feel knob: 1, 4, 16, 64 span light-and-direct to heavy-
// and-lagging (see rules/brush_body.hpp for how mass becomes the spring
// constants). Radius and spacing differ mildly so the four are visually
// distinguishable; every preset uses the identity pressure curve. The raw
// values are Q32.32 integers, fixed here so the TypeScript PRESETS table
// (plugin side) is compared against the bytes these produce in the
// `presets` golden fixture.
#pragma once

#include <cstdint>

namespace ddsim {

struct PresetSpec {
    const char* description;
    std::int64_t mass_raw;
    std::int64_t radius_raw;
    std::int64_t spacing_raw;
};

inline constexpr std::uint32_t DD_PRESET_COUNT = 4u;

// description | mass | radius | spacing (Q32.32 raw)
inline constexpr PresetSpec DD_PRESETS[DD_PRESET_COUNT] = {
    {"ink", 4294967296, 3221225472, 2147483648},      // mass 1,  radius 0.75, spacing 0.5
    {"rust", 17179869184, 3865470566, 1932735283},    // mass 4,  radius 0.9,  spacing 0.45
    {"clay", 68719476736, 4724464025, 1717986918},    // mass 16, radius 1.1,  spacing 0.4
    {"lead", 274877906944, 5583457485, 1503238553},   // mass 64, radius 1.3,  spacing 0.35
};

} // namespace ddsim
