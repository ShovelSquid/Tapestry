// ddsim/state.hpp — the version pins and the authoritative state.
//
// Every DD_* version constant is written into the canonical byte walk, so a
// change to any of them changes every hash. DD_TICK_HZ is locked by the
// roadmap; DD_FX_FORMAT_ID names Q32.32 as (int bits << 16 | frac bits).
// DD_PRESSURE_MAX is a PROVISIONAL width: Phase 2 freezes it with the grammar.
//
// The structs hold exactly the fields the walk lists (hash.cpp), in the same
// order. Active strokes and nodes are always empty in this plan; the fields
// exist now so 01-05 fills them without changing the walk.
#pragma once

#include "ddsim/fx64.hpp"
#include "ddsim/ids.hpp"
#include "ddsim/rng.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace ddsim {

inline constexpr std::uint32_t DD_TICK_HZ = 60u;
inline constexpr std::uint32_t DD_SIM_VERSION = 1u;
inline constexpr std::uint32_t DD_FX_FORMAT_ID = 0x00200020u;
inline constexpr std::uint32_t DD_RNG_VERSION = 1u;
inline constexpr std::uint32_t DD_RULE_BRUSHBODY_VERSION = 1u;
inline constexpr std::uint32_t DD_RULE_EMIT_VERSION = 1u;
inline constexpr std::uint32_t DD_PRESSURE_MAX = 65535u;
inline constexpr std::uint32_t DD_MAX_DESC_BYTES = 255u;
inline constexpr std::uint32_t DD_MAX_BRUSHES = 65535u;
inline constexpr std::uint32_t DD_MAX_ACTIVE_STROKES = 8u;
inline constexpr std::uint32_t DD_MAX_SAMPLES_PER_ACTION = 1024u;
inline constexpr std::uint32_t DD_MAX_SAMPLES_PER_TICK = 64u;
inline constexpr std::uint32_t DD_MAX_NODES = 1u << 20;
inline constexpr std::uint32_t DD_CURVE_KNOTS = 17u;
inline constexpr const char* DD_EMSDK_VERSION = "6.0.10";
inline constexpr char DD_STATE_MAGIC[4] = {'D', 'D', 'S', '1'};

struct BrushVersion {
    std::uint32_t id = 0;
    std::string description;
    fx64 mass;
    fx64 radius;
    fx64 spacing;
    std::uint16_t curve[DD_CURVE_KNOTS] = {};
};

struct Node {
    NodeId id;
    fx64 x, y, z;
    fx64 weight;
    fx64 dir_x, dir_y;
    fx64 vx, vy;
    std::uint32_t tick = 0;
    std::uint32_t brush = 0;
    std::uint32_t scale_band = 0;
};

struct BrushBody {
    fx64 x, y, vx, vy;
};

struct ActiveStroke {
    StrokeId id;
    std::uint32_t brush_id = 0;
    std::uint32_t start_tick = 0;
    std::uint8_t pressure_source = 0;
    fx64 plane[9];
    BrushBody body;
    fx64 path_accum;
    std::uint32_t next_emission_index = 0;
    std::uint32_t last_sample_tick = 0;
    std::uint16_t last_sample_index = 0;
    fx64 target_u, target_v;
    fx64 dir_x, dir_y;
};

struct State {
    std::uint64_t seed = 0;
    std::uint64_t tick = 0;
    std::vector<BrushVersion> brushes;
    Xoshiro256ss rng;
    std::vector<ActiveStroke> strokes;
    std::vector<Node> nodes;
};

} // namespace ddsim
