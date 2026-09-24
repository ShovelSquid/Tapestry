// ddsim/state.hpp — the version pins and the authoritative state.
//
// Every DD_* version constant is written into the canonical byte walk, so a
// change to any of them changes every hash. DD_TICK_HZ is locked by the
// roadmap; DD_FX_FORMAT_ID names Q32.32 as (int bits << 16 | frac bits).
// DD_PRESSURE_MAX is a PROVISIONAL width: Phase 2 freezes it with the grammar.
//
// The structs hold exactly the fields the walk lists (hash.cpp), in the same
// order. A Sample is the 24-byte wire record of a pen sample (action.hpp),
// kept in the same field order as the wire so the decoder, the walk and the
// rules read one layout. Tilt and twist are recorded from the first fixture
// on; no rule reads them in this milestone.
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
// The constraint rule (rules/constraints.hpp): free particles connected by
// distance constraints, solved by fixed-iteration position correction.
// DD_CONSTRAINT_ITERATIONS is a FIXED pass count, never a convergence check,
// so Debug/Release/Wasm always run the identical number of operations.
// DD_GRAVITY_Y_PER_TICK is a tuned per-tick velocity delta (PROVISIONAL, like
// DD_PRESSURE_MAX): not SI, chosen so a pendulum's swing is visible over a
// few dozen ticks at DD_TICK_HZ.
inline constexpr std::uint32_t DD_RULE_CONSTRAINT_VERSION = 1u;
inline constexpr std::uint32_t DD_CONSTRAINT_ITERATIONS = 4u;
inline constexpr fx64 DD_GRAVITY_Y_PER_TICK = fx64::from_raw(-(fx64::ONE / 200));
inline constexpr std::uint32_t DD_MAX_PARTICLES = 65535u;
inline constexpr std::uint32_t DD_MAX_CONSTRAINTS = 65535u;
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

// Sample wire record (24 bytes, little-endian, action.hpp):
//   u32 tick@0 | u16 index@4 | u16 pressure@6 | i32 u@8 | i32 v@12 (Q16.16
//   plane units) | i8 tilt_x@16 | i8 tilt_y@17 (degrees, -90..90)
//   | u16 twist@18 (degrees, 0..359) | u8 flags@20 | u8 pad[3]@21 (all 0)
inline constexpr std::uint32_t DD_SAMPLE_BYTES = 24u;
inline constexpr std::uint32_t DD_STROKE_BEGIN_BYTES = 56u;
inline constexpr std::uint32_t DD_STROKE_END_BYTES = 12u;
inline constexpr std::uint8_t DD_SAMPLE_FLAG_TILT = 1u;      // bit0: tilt_x / tilt_y are real
inline constexpr std::uint8_t DD_SAMPLE_FLAG_TWIST = 2u;     // bit1: twist is real
inline constexpr std::uint8_t DD_SAMPLE_FLAG_SOURCE = 4u;    // bit2: 0 = pen sensor, 1 = mouse / no sensor
inline constexpr std::uint8_t DD_SAMPLE_FLAGS_MASK = 7u;     // every other bit must be 0
inline constexpr std::int8_t DD_TILT_MAX = 90;
inline constexpr std::uint16_t DD_TWIST_MAX = 359u;

struct Sample {
    std::uint32_t tick = 0;
    std::uint16_t index = 0;
    std::uint16_t pressure = 0;
    std::int32_t u = 0;
    std::int32_t v = 0;
    std::int8_t tilt_x = 0;
    std::int8_t tilt_y = 0;
    std::uint16_t twist = 0;
    std::uint8_t flags = 0;
    std::uint8_t pad[3] = {0, 0, 0};
};

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

// One active stroke. `pending` holds the samples applied for the current
// tick and not yet consumed by step(); it is part of the canonical walk
// because a checkpoint is taken after a tick's applies and before its step.
// `has_target` turns on with the first sample ever received (the body is
// placed on it); `last_pressure` is the pressure the body keeps emitting
// with on ticks that carry no sample.
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
    std::uint8_t has_target = 0;
    std::uint16_t last_pressure = 0;
    std::vector<Sample> pending;
};

// A free point mass for the constraint rule (rules/constraints.hpp). `mass`
// is exactly 0 when `is_static` (validated at creation, never derived and
// cached): a static particle is a fixed anchor, the standard trick for
// modelling a pin joint without a separate anchor entity. `inv_mass()` in
// the rule file turns `mass` into the solver's weight fresh each use, the
// same pattern rules/brush_body.hpp's derive_params() uses for BrushVersion.
struct Particle {
    ParticleId id;
    std::uint8_t is_static = 0;
    fx64 mass;
    fx64 x, y, vx, vy;
};

// A distance constraint between two particles (by 1-based id, matching
// BrushVersion's addressing): stiffness 1 is a rigid rod, stiffness < 1
// reads as a spring, and either endpoint can be a static particle to pin
// the other to a fixed point (a hinge). One primitive covers all three.
struct Constraint {
    ConstraintId id;
    std::uint32_t particle_a = 0;
    std::uint32_t particle_b = 0;
    fx64 rest_length;
    fx64 stiffness;
};

struct State {
    std::uint64_t seed = 0;
    std::uint64_t tick = 0;
    std::vector<BrushVersion> brushes;
    Xoshiro256ss rng;
    std::vector<ActiveStroke> strokes;
    std::vector<Node> nodes;
    std::vector<Particle> particles;
    std::vector<Constraint> constraints;
};

} // namespace ddsim
