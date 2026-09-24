// action_writer.hpp — the ONE test-side C++ encoder for every action kind,
// mirroring the sim's ByteReader (include/ddsim/action.hpp). Shared by the
// doctest suites and by tools/gen_fixtures, so the goldens and the tests
// are produced by the same bytes (pitfall 8: one C++ encoder, one TS
// encoder, proven equal by the plugin's golden test).
//
// Also holds the synthetic stroke curve every stroke fixture uses and the
// preset -> BrushSpec adapter. Tests and tools are outside the forbidden-
// token gate, but nothing here needs a floating-point value either: brush
// parameters are raw Q32.32 and the curve is integer arithmetic so the
// TypeScript side can regenerate it byte for byte.
#pragma once

#include "ddsim/action.hpp"
#include "ddsim/presets.hpp"
#include "ddsim/state.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace ddsim_test {

// ---------------------------------------------------------------------------
// Encoder mirroring ddsim::ByteReader.
// ---------------------------------------------------------------------------
struct ByteWriter {
    std::vector<std::uint8_t> bytes;

    void u8(std::uint8_t v) { bytes.push_back(v); }
    void i8(std::int8_t v) { bytes.push_back(static_cast<std::uint8_t>(v)); }
    void u16(std::uint16_t v) {
        bytes.push_back(static_cast<std::uint8_t>(v & 0xffu));
        bytes.push_back(static_cast<std::uint8_t>((v >> 8) & 0xffu));
    }
    void u32(std::uint32_t v) {
        for (unsigned i = 0; i < 4; ++i) {
            bytes.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
        }
    }
    void i32(std::int32_t v) { u32(static_cast<std::uint32_t>(v)); }
    void u64(std::uint64_t v) {
        for (unsigned i = 0; i < 8; ++i) {
            bytes.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
        }
    }
    void i64(std::int64_t v) { u64(static_cast<std::uint64_t>(v)); }
    void raw(const std::string& s) { bytes.insert(bytes.end(), s.begin(), s.end()); }
};

// Header (8 bytes) + payload.
inline std::vector<std::uint8_t> wrapAction(std::uint8_t kind, const ByteWriter& payload) {
    ByteWriter w;
    w.u8(kind);
    w.u8(1);   // version
    w.u16(0);  // reserved
    w.u32(static_cast<std::uint32_t>(payload.bytes.size()));
    w.bytes.insert(w.bytes.end(), payload.bytes.begin(), payload.bytes.end());
    return w.bytes;
}

// ---------------------------------------------------------------------------
// DefineBrush (kind 1).
// ---------------------------------------------------------------------------
struct BrushSpec {
    std::uint32_t id = 1;
    std::string description;
    std::int64_t mass_raw = 0;
    std::int64_t radius_raw = 0;
    std::int64_t spacing_raw = 0;
    std::uint16_t curve[ddsim::DD_CURVE_KNOTS] = {};
};

inline void identityCurve(std::uint16_t (&curve)[ddsim::DD_CURVE_KNOTS]) {
    for (std::uint32_t i = 0; i < 16; ++i) {
        curve[i] = static_cast<std::uint16_t>(i * 4096u);
    }
    curve[16] = 65535u;
}

// The "ink" brush every golden and the dev page share: mass 1.0, radius
// 0.75, spacing 0.5 as Q32.32 raw, identity curve. Equal to preset_brush(0).
inline BrushSpec inkBrush() {
    BrushSpec b;
    b.id = 1;
    b.description = "ink";
    b.mass_raw = ddsim::fx64::ONE;                  // 1.0
    b.radius_raw = (ddsim::fx64::ONE / 4) * 3;      // 0.75
    b.spacing_raw = ddsim::fx64::ONE / 2;           // 0.5
    identityCurve(b.curve);
    return b;
}

// DD_PRESETS[i] as a BrushSpec with id i + 1 and the identity curve.
inline BrushSpec preset_brush(std::uint32_t i) {
    const ddsim::PresetSpec& p = ddsim::DD_PRESETS[i];
    BrushSpec b;
    b.id = i + 1;
    b.description = p.description;
    b.mass_raw = p.mass_raw;
    b.radius_raw = p.radius_raw;
    b.spacing_raw = p.spacing_raw;
    identityCurve(b.curve);
    return b;
}

inline std::vector<std::uint8_t> encodeDefineBrush(const BrushSpec& b) {
    ByteWriter payload;
    payload.u32(b.id);
    payload.u32(static_cast<std::uint32_t>(b.description.size()));
    payload.raw(b.description);
    payload.i64(b.mass_raw);
    payload.i64(b.radius_raw);
    payload.i64(b.spacing_raw);
    for (std::uint32_t i = 0; i < ddsim::DD_CURVE_KNOTS; ++i) {
        payload.u16(b.curve[i]);
    }
    return wrapAction(1, payload);
}

// An action with an arbitrary kind and empty payload (well-formed header).
inline std::vector<std::uint8_t> encodeEmptyAction(std::uint8_t kind) {
    ByteWriter w;
    w.u8(kind);
    w.u8(1);
    w.u16(0);
    w.u32(0);
    return w.bytes;
}

// ---------------------------------------------------------------------------
// Particle and constraint actions (kinds 5, 6).
// ---------------------------------------------------------------------------

inline std::vector<std::uint8_t> encodeCreateParticle(std::uint32_t particle_id, bool is_static,
                                                       std::int64_t mass_raw, std::int64_t x_raw,
                                                       std::int64_t y_raw) {
    ByteWriter payload;
    payload.u32(particle_id);
    payload.u8(is_static ? 1 : 0);
    payload.u8(0);
    payload.u8(0);
    payload.u8(0);
    payload.i64(mass_raw);
    payload.i64(x_raw);
    payload.i64(y_raw);
    return wrapAction(5, payload);
}

inline std::vector<std::uint8_t> encodeCreateConstraint(std::uint32_t constraint_id, std::uint32_t particle_a,
                                                         std::uint32_t particle_b, std::int64_t rest_length_raw,
                                                         std::int64_t stiffness_raw) {
    ByteWriter payload;
    payload.u32(constraint_id);
    payload.u32(particle_a);
    payload.u32(particle_b);
    payload.i64(rest_length_raw);
    payload.i64(stiffness_raw);
    return wrapAction(6, payload);
}

// ---------------------------------------------------------------------------
// Stroke actions (kinds 2, 3, 4).
// ---------------------------------------------------------------------------

// Nine i32 Q16.16: origin xyz, right xyz, up xyz. Default: origin 0, right
// +x, up +y (the plane every fixture uses unless it says otherwise).
struct PlaneSpec {
    std::int32_t q[9] = {0, 0, 0, 65536, 0, 0, 0, 65536, 0};
};

inline std::vector<std::uint8_t> write_stroke_begin(std::uint64_t stroke_id, std::uint32_t brush_version_id,
                                                    std::uint32_t start_tick, std::uint8_t pressure_source,
                                                    const PlaneSpec& plane = PlaneSpec{}) {
    ByteWriter payload;
    payload.u64(stroke_id);
    payload.u32(brush_version_id);
    payload.u32(start_tick);
    payload.u8(pressure_source);
    payload.u8(0);
    payload.u8(0);
    payload.u8(0);
    for (const std::int32_t c : plane.q) {
        payload.i32(c);
    }
    return wrapAction(2, payload);
}

inline void write_sample(ByteWriter& w, const ddsim::Sample& s) {
    w.u32(s.tick);
    w.u16(s.index);
    w.u16(s.pressure);
    w.i32(s.u);
    w.i32(s.v);
    w.i8(s.tilt_x);
    w.i8(s.tilt_y);
    w.u16(s.twist);
    w.u8(s.flags);
    w.u8(s.pad[0]);
    w.u8(s.pad[1]);
    w.u8(s.pad[2]);
}

inline std::vector<std::uint8_t> write_stroke_samples(std::uint64_t stroke_id, const std::vector<ddsim::Sample>& samples) {
    ByteWriter payload;
    payload.u64(stroke_id);
    payload.u32(static_cast<std::uint32_t>(samples.size()));
    for (const ddsim::Sample& s : samples) {
        write_sample(payload, s);
    }
    return wrapAction(3, payload);
}

inline std::vector<std::uint8_t> write_stroke_end(std::uint64_t stroke_id, std::uint32_t end_tick) {
    ByteWriter payload;
    payload.u64(stroke_id);
    payload.u32(end_tick);
    return wrapAction(4, payload);
}

// The synthetic stroke curve every stroke fixture uses, for sample t:
//   u = t * 16384                     (0.25 units per sample, Q16.16)
//   v = ((t * 7) % 40 - 20) * 8192    (a zig-zag between -2.5 and +2.375 units)
//   pressure = min(65535, t * 546)
//   tilt_x = tilt_y = 0, twist = 0, flags = 0
// tick and index are left 0 for the caller to stamp.
inline ddsim::Sample synthetic_sample(std::uint32_t t) {
    ddsim::Sample s;
    s.u = static_cast<std::int32_t>(t) * 16384;
    s.v = (static_cast<std::int32_t>((t * 7u) % 40u) - 20) * 8192;
    const std::uint32_t p = t * 546u;
    s.pressure = static_cast<std::uint16_t>(p > 65535u ? 65535u : p);
    return s;
}

// ---------------------------------------------------------------------------
// Stroke logs: the actions of one stroke, stamped, in time order. Used by
// gen_fixtures to write fixtures and by the suites to build logs in-test, so
// a stroke described the same way produces the same bytes in both.
// ---------------------------------------------------------------------------
struct StampedAction {
    std::uint32_t tick = 0;
    std::vector<std::uint8_t> bytes;
};

// Appends StrokeBegin at first_tick, then `count` samples from curve(t),
// t = 0..count-1, grouped `per_tick` per tick with indices 0..per_tick-1
// (one StrokeSamples action per tick), skipping every tick listed in
// `gaps` (the pen paused: those ticks carry no samples and the curve
// continues on the next tick), then StrokeEnd on the tick after the last
// sample tick when with_end. Returns that end tick.
inline std::uint32_t stroke_actions(std::vector<StampedAction>& out, std::uint64_t stroke_id, std::uint32_t brush_id,
                                    std::uint32_t first_tick, std::uint32_t count, std::uint32_t per_tick,
                                    const std::vector<std::uint32_t>& gaps,
                                    ddsim::Sample (*curve)(std::uint32_t) = synthetic_sample,
                                    const PlaneSpec& plane = PlaneSpec{}, bool with_end = true) {
    out.push_back({first_tick, write_stroke_begin(stroke_id, brush_id, first_tick, 0, plane)});
    std::uint32_t tick = first_tick;
    std::uint32_t t = 0;
    while (t < count) {
        bool gap = false;
        for (const std::uint32_t g : gaps) {
            if (g == tick) {
                gap = true;
            }
        }
        if (gap) {
            ++tick;
            continue;
        }
        std::vector<ddsim::Sample> samples;
        for (std::uint32_t i = 0; i < per_tick && t < count; ++i, ++t) {
            ddsim::Sample s = curve(t);
            s.tick = tick;
            s.index = static_cast<std::uint16_t>(i);
            samples.push_back(s);
        }
        out.push_back({tick, write_stroke_samples(stroke_id, samples)});
        ++tick;
    }
    if (with_end) {
        out.push_back({tick, write_stroke_end(stroke_id, tick)});
    }
    return tick;
}

} // namespace ddsim_test
