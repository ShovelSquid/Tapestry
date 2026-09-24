// Stroke action grammar (STRK-01, STRK-06) and the brush validator (STRK-04).
//
// Every validation row in the interfaces table gets a case that builds the
// offending bytes with the shared encoder, asserts the exact error code, and
// asserts the hash is untouched. The round-trip case proves the encoder and
// the decoder agree field for field, tilt and twist included.
#include "ddsim/action.hpp"
#include "ddsim/brush.hpp"
#include "ddsim/ddsim_c.h"
#include "ddsim/presets.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <string>
#include <vector>

namespace {

using ddsim::Sample;
using ddsim::Sim;
using ddsim_test::BrushSpec;
using ddsim_test::encodeDefineBrush;
using ddsim_test::hex;
using ddsim_test::inkBrush;
using ddsim_test::PlaneSpec;
using ddsim_test::preset_brush;
using ddsim_test::synthetic_sample;
using ddsim_test::write_stroke_begin;
using ddsim_test::write_stroke_end;
using ddsim_test::write_stroke_samples;

std::string hashHex(const Sim& sim) {
    std::uint8_t digest[32];
    sim.hash(digest);
    return hex(digest);
}

int applyBytes(Sim& sim, const std::vector<std::uint8_t>& a) {
    return sim.apply(a.data(), static_cast<std::uint32_t>(a.size()));
}

// Ink brush at tick 0, stepped to tick 10.
Sim simAtTen() {
    Sim sim(42);
    REQUIRE(applyBytes(sim, encodeDefineBrush(inkBrush())) == DD_OK);
    for (int i = 0; i < 10; ++i) {
        sim.step();
    }
    REQUIRE(sim.tick() == 10);
    return sim;
}

// Ink brush, tick 10, stroke ordinal 1 begun.
Sim simWithStroke() {
    Sim sim = simAtTen();
    REQUIRE(applyBytes(sim, write_stroke_begin(1, 1, 10, 0)) == DD_OK);
    REQUIRE(sim.state().strokes.size() == 1);
    return sim;
}

Sample stamped(std::uint32_t t, std::uint32_t tick, std::uint16_t index) {
    Sample s = synthetic_sample(t);
    s.tick = tick;
    s.index = index;
    return s;
}

// ---------------------------------------------------------------------------

TEST_CASE("actions: every stroke action round-trips through the writer and decoder field for field") {
    PlaneSpec plane;
    const std::int32_t q[9] = {65536, -131072, 327680, 65536, 0, 0, 0, 0, 65536};
    for (int i = 0; i < 9; ++i) {
        plane.q[i] = q[i];
    }
    const std::vector<std::uint8_t> begin = write_stroke_begin((std::uint64_t{3} << 32) | 7u, 2, 10, 1, plane);
    CHECK(begin.size() == 8 + ddsim::DD_STROKE_BEGIN_BYTES);
    {
        ddsim::ByteReader r(begin.data(), begin.size());
        ddsim::ActionHeader h;
        REQUIRE(ddsim::decode_header(r, h) == DD_OK);
        CHECK(h.kind == 2);
        CHECK(h.payload_len == ddsim::DD_STROKE_BEGIN_BYTES);
        ddsim::StrokeBegin b;
        REQUIRE(ddsim::decode_stroke_begin(r, b) == DD_OK);
        CHECK(r.at_end());
        CHECK(b.stroke_id == ((std::uint64_t{3} << 32) | 7u));
        CHECK(b.brush_version_id == 2);
        CHECK(b.start_tick == 10);
        CHECK(b.pressure_source == 1);
        for (int i = 0; i < 3; ++i) {
            CHECK(b.plane.origin[i] == ddsim::fx64::from_q16(q[i]));
            CHECK(b.plane.right[i] == ddsim::fx64::from_q16(q[3 + i]));
            CHECK(b.plane.up[i] == ddsim::fx64::from_q16(q[6 + i]));
        }
        CHECK(b.plane.origin[1].raw == -(std::int64_t{2} << 32));
    }

    std::vector<Sample> samples;
    for (std::uint32_t t = 0; t < 3; ++t) {
        Sample s = stamped(t, 10, static_cast<std::uint16_t>(t));
        s.tilt_x = static_cast<std::int8_t>(-45 + static_cast<int>(t));
        s.tilt_y = static_cast<std::int8_t>(90 - static_cast<int>(t));
        s.twist = static_cast<std::uint16_t>(359 - t);
        s.flags = static_cast<std::uint8_t>(ddsim::DD_SAMPLE_FLAG_TILT | ddsim::DD_SAMPLE_FLAG_TWIST);
        samples.push_back(s);
    }
    const std::vector<std::uint8_t> sa = write_stroke_samples(7, samples);
    CHECK(sa.size() == 8 + 12 + 3 * ddsim::DD_SAMPLE_BYTES);
    {
        ddsim::ByteReader r(sa.data(), sa.size());
        ddsim::ActionHeader h;
        REQUIRE(ddsim::decode_header(r, h) == DD_OK);
        CHECK(h.kind == 3);
        ddsim::StrokeSamples d;
        REQUIRE(ddsim::decode_stroke_samples(r, d) == DD_OK);
        CHECK(r.at_end());
        CHECK(d.stroke_id == 7);
        REQUIRE(d.samples.size() == 3);
        for (std::size_t i = 0; i < 3; ++i) {
            const Sample& a = samples[i];
            const Sample& b = d.samples[i];
            CHECK(a.tick == b.tick);
            CHECK(a.index == b.index);
            CHECK(a.pressure == b.pressure);
            CHECK(a.u == b.u);
            CHECK(a.v == b.v);
            CHECK(a.tilt_x == b.tilt_x);
            CHECK(a.tilt_y == b.tilt_y);
            CHECK(a.twist == b.twist);
            CHECK(a.flags == b.flags);
            CHECK(b.pad[0] == 0);
            CHECK(b.pad[1] == 0);
            CHECK(b.pad[2] == 0);
        }
        CHECK(d.samples[0].tilt_x == -45);
        CHECK(d.samples[0].tilt_y == 90);
        CHECK(d.samples[0].twist == 359);
        CHECK(d.samples[1].v == ((7 - 20) * 8192));
    }
    // The wire offsets named in the interfaces block: tick@0, index@4,
    // pressure@6, u@8, v@12, tiltX@16, tiltY@17, twist@18, flags@20.
    const std::size_t s0 = 8 + 12;
    CHECK(sa[s0 + 0] == 10);
    CHECK(sa[s0 + 4] == 0);
    CHECK(sa[s0 + 16] == static_cast<std::uint8_t>(-45));
    CHECK(sa[s0 + 17] == 90);
    CHECK(sa[s0 + 18] == (359 & 0xff));
    CHECK(sa[s0 + 19] == (359 >> 8));
    CHECK(sa[s0 + 20] == 3);

    const std::vector<std::uint8_t> end = write_stroke_end(7, 130);
    CHECK(end.size() == 8 + ddsim::DD_STROKE_END_BYTES);
    {
        ddsim::ByteReader r(end.data(), end.size());
        ddsim::ActionHeader h;
        REQUIRE(ddsim::decode_header(r, h) == DD_OK);
        CHECK(h.kind == 4);
        ddsim::StrokeEnd e;
        REQUIRE(ddsim::decode_stroke_end(r, e) == DD_OK);
        CHECK(r.at_end());
        CHECK(e.stroke_id == 7);
        CHECK(e.end_tick == 130);
    }

    // Absent tilt and twist are zero with the flag bits clear (STRK-06).
    const Sample plain = synthetic_sample(5);
    CHECK(plain.tilt_x == 0);
    CHECK(plain.tilt_y == 0);
    CHECK(plain.twist == 0);
    CHECK(plain.flags == 0);
}

TEST_CASE("actions: a well-formed stroke is accepted and each action changes the hash") {
    Sim sim = simAtTen();
    const std::string h0 = hashHex(sim);
    REQUIRE(applyBytes(sim, write_stroke_begin(1, 1, 10, 0)) == DD_OK);
    const std::string h1 = hashHex(sim);
    CHECK(h1 != h0);
    REQUIRE(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 0), stamped(1, 10, 1)})) == DD_OK);
    const std::string h2 = hashHex(sim);
    CHECK(h2 != h1);
    CHECK(sim.state().strokes[0].pending.size() == 2);
    CHECK(sim.state().strokes[0].last_sample_index == 1);
    CHECK(sim.state().strokes[0].last_sample_tick == 10);
    // A second action in the same tick continues the index sequence.
    REQUIRE(applyBytes(sim, write_stroke_samples(1, {stamped(2, 10, 2)})) == DD_OK);
    CHECK(sim.state().strokes[0].pending.size() == 3);
    sim.step();
    CHECK(sim.tick() == 11);
    // After the step the tick's samples are consumed; index restarts at 0.
    CHECK(sim.state().strokes[0].pending.empty());
    REQUIRE(applyBytes(sim, write_stroke_samples(1, {stamped(3, 11, 0)})) == DD_OK);
    REQUIRE(applyBytes(sim, write_stroke_end(1, 11)) == DD_OK);
    CHECK(sim.state().strokes.empty());
    CHECK(hashHex(sim) != h2);
}

TEST_CASE("actions: StrokeBegin with a tick mismatch is rejected and the hash is unchanged") {
    Sim sim = simAtTen();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_begin(1, 1, 9, 0)) == DD_ERR_TICK_MISMATCH);
    CHECK(applyBytes(sim, write_stroke_begin(1, 1, 11, 0)) == DD_ERR_TICK_MISMATCH);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().strokes.empty());
}

TEST_CASE("actions: StrokeBegin with an unknown brush id is rejected and the hash is unchanged") {
    Sim sim = simAtTen();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_begin(1, 2, 10, 0)) == DD_ERR_BRUSH_ID);
    CHECK(applyBytes(sim, write_stroke_begin(1, 0, 10, 0)) == DD_ERR_BRUSH_ID);
    CHECK(hashHex(sim) == before);
}

TEST_CASE("actions: StrokeBegin with a duplicate or zero ordinal is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_begin(1, 1, 10, 0)) == DD_ERR_STROKE_STATE);
    CHECK(applyBytes(sim, write_stroke_begin(0, 1, 10, 0)) == DD_ERR_STROKE_STATE);
    // Bits above the (branch, ordinal) layout are not a different stroke.
    CHECK(applyBytes(sim, write_stroke_begin((std::uint64_t{1} << 40) | 2u, 1, 10, 0)) == DD_ERR_STROKE_STATE);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().strokes.size() == 1);
    // A different ordinal on another branch tag is a different stroke.
    CHECK(applyBytes(sim, write_stroke_begin((std::uint64_t{1} << 32) | 1u, 1, 10, 0)) == DD_OK);
    CHECK(sim.state().strokes.size() == 2);
    CHECK(sim.state().strokes[0].id.value == 1);
    CHECK(sim.state().strokes[1].id.value == ((std::uint64_t{1} << 32) | 1u));
}

TEST_CASE("actions: StrokeBegin past DD_MAX_ACTIVE_STROKES is rejected and the hash is unchanged") {
    Sim sim = simAtTen();
    for (std::uint32_t o = 1; o <= ddsim::DD_MAX_ACTIVE_STROKES; ++o) {
        REQUIRE(applyBytes(sim, write_stroke_begin(o, 1, 10, 0)) == DD_OK);
    }
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_begin(ddsim::DD_MAX_ACTIVE_STROKES + 1, 1, 10, 0)) == DD_ERR_LIMIT);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().strokes.size() == ddsim::DD_MAX_ACTIVE_STROKES);
}

TEST_CASE("actions: StrokeBegin with a non-zero pad byte or a pressure source above 1 is DD_ERR_SAMPLE_RANGE") {
    Sim sim = simAtTen();
    const std::string before = hashHex(sim);
    std::vector<std::uint8_t> a = write_stroke_begin(1, 1, 10, 0);
    a[8 + 17] = 1;
    CHECK(applyBytes(sim, a) == DD_ERR_SAMPLE_RANGE);
    CHECK(applyBytes(sim, write_stroke_begin(1, 1, 10, 2)) == DD_ERR_SAMPLE_RANGE);
    CHECK(hashHex(sim) == before);
}

TEST_CASE("actions: StrokeSamples without a StrokeBegin is rejected and the hash is unchanged") {
    Sim sim = simAtTen();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 0)})) == DD_ERR_STROKE_STATE);
    CHECK(hashHex(sim) == before);
    // And for an ordinal other than the active one.
    Sim withStroke = simWithStroke();
    const std::string before2 = hashHex(withStroke);
    CHECK(applyBytes(withStroke, write_stroke_samples(2, {stamped(0, 10, 0)})) == DD_ERR_STROKE_STATE);
    CHECK(hashHex(withStroke) == before2);
}

TEST_CASE("actions: StrokeSamples with a tick mismatch is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 9, 0)})) == DD_ERR_TICK_MISMATCH);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 11, 0)})) == DD_ERR_TICK_MISMATCH);
    // One bad sample among good ones rejects the whole action.
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 0), stamped(1, 11, 1)})) == DD_ERR_TICK_MISMATCH);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().strokes[0].pending.empty());
}

TEST_CASE("actions: StrokeSamples with a wrong first index is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 1)})) == DD_ERR_SAMPLE_ORDER);
    CHECK(hashHex(sim) == before);
    REQUIRE(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 0)})) == DD_OK);
    const std::string after = hashHex(sim);
    // The next action must continue at index 1, not restart at 0.
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(1, 10, 0)})) == DD_ERR_SAMPLE_ORDER);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(1, 10, 2)})) == DD_ERR_SAMPLE_ORDER);
    CHECK(hashHex(sim) == after);
}

TEST_CASE("actions: StrokeSamples with a non-sequential index is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 0), stamped(1, 10, 2)})) == DD_ERR_SAMPLE_ORDER);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(0, 10, 0), stamped(1, 10, 0)})) == DD_ERR_SAMPLE_ORDER);
    CHECK(hashHex(sim) == before);
}

TEST_CASE("actions: StrokeSamples over DD_MAX_SAMPLES_PER_TICK, with zero samples, or over DD_MAX_SAMPLES_PER_ACTION is DD_ERR_LIMIT") {
    Sim sim = simWithStroke();
    std::vector<Sample> full;
    for (std::uint32_t i = 0; i < ddsim::DD_MAX_SAMPLES_PER_TICK; ++i) {
        full.push_back(stamped(i, 10, static_cast<std::uint16_t>(i)));
    }
    REQUIRE(applyBytes(sim, write_stroke_samples(1, full)) == DD_OK);
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_samples(1, {stamped(64, 10, 64)})) == DD_ERR_LIMIT);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().strokes[0].pending.size() == ddsim::DD_MAX_SAMPLES_PER_TICK);

    Sim fresh = simWithStroke();
    const std::string before2 = hashHex(fresh);
    CHECK(applyBytes(fresh, write_stroke_samples(1, {})) == DD_ERR_LIMIT);
    std::vector<Sample> over;
    for (std::uint32_t i = 0; i <= ddsim::DD_MAX_SAMPLES_PER_ACTION; ++i) {
        over.push_back(stamped(i, 10, static_cast<std::uint16_t>(i)));
    }
    CHECK(applyBytes(fresh, write_stroke_samples(1, over)) == DD_ERR_LIMIT);
    CHECK(hashHex(fresh) == before2);
}

TEST_CASE("actions: a sample at DD_PRESSURE_MAX is accepted and the u16 wire field cannot exceed it") {
    // DD_PRESSURE_MAX is the provisional width; while it equals 65535 the
    // wire field cannot carry a larger value, so the range row for pressure
    // is a static fact rather than a runtime rejection.
    static_assert(ddsim::DD_PRESSURE_MAX == 65535u);
    static_assert(ddsim::DD_PRESSURE_MAX <= 0xffffu);
    Sim sim = simWithStroke();
    Sample s = stamped(0, 10, 0);
    s.pressure = 65535u;
    CHECK(ddsim::sample_in_range(s));
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_OK);
    CHECK(sim.state().strokes[0].pending[0].pressure == 65535u);
}

TEST_CASE("actions: a sample with tilt 91 or -91 is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    Sample s = stamped(0, 10, 0);
    s.flags = ddsim::DD_SAMPLE_FLAG_TILT;
    s.tilt_x = 91;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    s.tilt_x = -91;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    s.tilt_x = 0;
    s.tilt_y = 91;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    s.tilt_y = -91;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    CHECK(hashHex(sim) == before);
    s.tilt_x = 90;
    s.tilt_y = -90;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_OK);
}

TEST_CASE("actions: a sample with twist 360 is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    Sample s = stamped(0, 10, 0);
    s.flags = ddsim::DD_SAMPLE_FLAG_TWIST;
    s.twist = 360;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    s.twist = 65535;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    CHECK(hashHex(sim) == before);
    s.twist = 359;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_OK);
}

TEST_CASE("actions: a sample with flags bit 3 set is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    Sample s = stamped(0, 10, 0);
    s.flags = 8;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    s.flags = 0x80;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    CHECK(hashHex(sim) == before);
    s.flags = 7;
    CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_OK);
}

TEST_CASE("actions: a sample with a non-zero pad byte is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    for (int p = 0; p < 3; ++p) {
        Sample s = stamped(0, 10, 0);
        s.pad[p] = 1;
        CHECK(applyBytes(sim, write_stroke_samples(1, {s})) == DD_ERR_SAMPLE_RANGE);
    }
    CHECK(hashHex(sim) == before);
}

TEST_CASE("actions: StrokeEnd without a StrokeBegin is rejected and the hash is unchanged") {
    Sim sim = simAtTen();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_end(1, 10)) == DD_ERR_STROKE_STATE);
    CHECK(hashHex(sim) == before);
    Sim withStroke = simWithStroke();
    const std::string before2 = hashHex(withStroke);
    CHECK(applyBytes(withStroke, write_stroke_end(2, 10)) == DD_ERR_STROKE_STATE);
    CHECK(hashHex(withStroke) == before2);
    // Ending twice: the second is a stroke that is no longer active.
    REQUIRE(applyBytes(withStroke, write_stroke_end(1, 10)) == DD_OK);
    const std::string ended = hashHex(withStroke);
    CHECK(applyBytes(withStroke, write_stroke_end(1, 10)) == DD_ERR_STROKE_STATE);
    CHECK(hashHex(withStroke) == ended);
}

TEST_CASE("actions: StrokeEnd with a wrong tick is rejected and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, write_stroke_end(1, 9)) == DD_ERR_TICK_MISMATCH);
    CHECK(applyBytes(sim, write_stroke_end(1, 11)) == DD_ERR_TICK_MISMATCH);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().strokes.size() == 1);
}

TEST_CASE("actions: truncated and over-long stroke payloads are DD_ERR_BAD_LENGTH and the hash is unchanged") {
    Sim sim = simWithStroke();
    const std::string before = hashHex(sim);
    for (const std::vector<std::uint8_t>& good :
         {write_stroke_begin(2, 1, 10, 0), write_stroke_samples(1, {stamped(0, 10, 0)}), write_stroke_end(1, 10)}) {
        std::vector<std::uint8_t> shorter = good;
        shorter.pop_back();
        shorter[4] = static_cast<std::uint8_t>(shorter[4] - 1);
        CHECK(applyBytes(sim, shorter) == DD_ERR_BAD_LENGTH);
        std::vector<std::uint8_t> longer = good;
        longer.push_back(0);
        longer[4] = static_cast<std::uint8_t>(longer[4] + 1);
        CHECK(applyBytes(sim, longer) == DD_ERR_BAD_LENGTH);
        // payload_len disagreeing with len.
        CHECK(sim.apply(good.data(), static_cast<std::uint32_t>(good.size() - 1)) == DD_ERR_BAD_LENGTH);
    }
    // A sample count larger than the payload can hold.
    std::vector<std::uint8_t> lying = write_stroke_samples(1, {stamped(0, 10, 0)});
    lying[8 + 8] = 2;
    CHECK(applyBytes(sim, lying) == DD_ERR_BAD_LENGTH);
    lying[8 + 8] = 0xff;
    lying[8 + 9] = 0xff;
    lying[8 + 10] = 0xff;
    lying[8 + 11] = 0xff;
    CHECK(applyBytes(sim, lying) == DD_ERR_BAD_LENGTH);
    CHECK(hashHex(sim) == before);
}

// ---------------------------------------------------------------------------
// Brush versions (STRK-04).
// ---------------------------------------------------------------------------

TEST_CASE("brush_versions: validator rejects mass 0.5, accepts all four DD_PRESETS, rejects an empty and a 256-byte description") {
    Sim sim(42);
    const std::string before = hashHex(sim);

    BrushSpec half = inkBrush();
    half.mass_raw = ddsim::fx64::ONE / 2;  // k_t = 2 > ONE
    CHECK(applyBytes(sim, encodeDefineBrush(half)) == DD_ERR_BRUSH_INVALID);
    BrushSpec nearlyOne = inkBrush();
    nearlyOne.mass_raw = ddsim::fx64::ONE - 1;  // k_t just above ONE
    CHECK(applyBytes(sim, encodeDefineBrush(nearlyOne)) == DD_ERR_BRUSH_INVALID);
    BrushSpec empty = inkBrush();
    empty.description.clear();
    CHECK(applyBytes(sim, encodeDefineBrush(empty)) == DD_ERR_BRUSH_INVALID);
    BrushSpec tooLong = inkBrush();
    tooLong.description.assign(256, 'x');
    CHECK(applyBytes(sim, encodeDefineBrush(tooLong)) == DD_ERR_BRUSH_INVALID);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().brushes.empty());

    // The validator itself, on the derived constants.
    ddsim::BrushVersion b;
    b.id = 1;
    b.description = "x";
    b.mass = ddsim::fx64::from_int(1);
    b.radius = ddsim::fx64::from_int(1);
    b.spacing = ddsim::fx64::from_int(1);
    CHECK(ddsim::validate_brush(b) == DD_OK);
    const ddsim::BodyParams one = ddsim::derive_params(b);
    CHECK(one.k_t.raw == ddsim::fx64::ONE);
    CHECK(one.c_t.raw == ddsim::fx64::ONE);
    b.mass = ddsim::fx64::from_int(64);
    const ddsim::BodyParams heavy = ddsim::derive_params(b);
    CHECK(heavy.k_t.raw == ddsim::fx64::ONE / 64);
    CHECK(heavy.c_t.raw == ddsim::fx64::ONE / 8);
    b.mass = ddsim::fx64::from_raw(ddsim::fx64::ONE / 2);
    CHECK(ddsim::validate_brush(b) == DD_ERR_BRUSH_INVALID);
    b.mass = ddsim::fx64::from_raw(0);
    CHECK(ddsim::validate_brush(b) == DD_ERR_BRUSH_INVALID);

    // A 255-byte description is the maximum and is accepted; the presets
    // are accepted in order with ids 1..4 and differ in description and mass.
    BrushSpec maxLen = inkBrush();
    maxLen.description.assign(255, 'y');
    Sim other(42);
    CHECK(applyBytes(other, encodeDefineBrush(maxLen)) == DD_OK);

    static_assert(ddsim::DD_PRESET_COUNT == 4);
    for (std::uint32_t i = 0; i < ddsim::DD_PRESET_COUNT; ++i) {
        CHECK_MESSAGE(applyBytes(sim, encodeDefineBrush(preset_brush(i))) == DD_OK, "preset " << i);
    }
    REQUIRE(sim.state().brushes.size() == 4);
    CHECK(sim.state().brushes[0].description == "ink");
    CHECK(sim.state().brushes[1].description == "rust");
    CHECK(sim.state().brushes[2].description == "clay");
    CHECK(sim.state().brushes[3].description == "lead");
    CHECK(sim.state().brushes[0].mass.raw == 4294967296);
    CHECK(sim.state().brushes[1].mass.raw == 17179869184);
    CHECK(sim.state().brushes[2].mass.raw == 68719476736);
    CHECK(sim.state().brushes[3].mass.raw == 274877906944);
    CHECK(ddsim::DD_PRESETS[0].radius_raw == 3221225472);
    CHECK(ddsim::DD_PRESETS[3].spacing_raw == 1503238553);
    // preset_brush(0) is the ink brush every earlier golden used.
    CHECK(encodeDefineBrush(preset_brush(0)) == encodeDefineBrush(inkBrush()));
}

TEST_CASE("brush_versions: description bytes are compared byte-wise so ink, ink with a trailing space and an NFD string are three distinct brushes") {
    const std::string a = "ink";
    const std::string b = "ink ";
    const std::string c = "i\xcc\x88nk";  // i + COMBINING DIAERESIS (NFD), never normalised
    CHECK(a != b);
    CHECK(a != c);
    CHECK(b != c);

    std::vector<std::string> hashes;
    for (const std::string& desc : {a, b, c}) {
        Sim sim(42);
        BrushSpec spec = inkBrush();
        spec.description = desc;
        REQUIRE(applyBytes(sim, encodeDefineBrush(spec)) == DD_OK);
        CHECK(sim.state().brushes[0].description.size() == desc.size());
        CHECK(sim.state().brushes[0].description == desc);
        hashes.push_back(hashHex(sim));
    }
    CHECK(hashes[0] != hashes[1]);
    CHECK(hashes[0] != hashes[2]);
    CHECK(hashes[1] != hashes[2]);

    // All three coexist in one table as versions 1, 2, 3.
    Sim sim(42);
    std::uint32_t id = 1;
    for (const std::string& desc : {a, b, c}) {
        BrushSpec spec = inkBrush();
        spec.id = id++;
        spec.description = desc;
        REQUIRE(applyBytes(sim, encodeDefineBrush(spec)) == DD_OK);
    }
    CHECK(sim.state().brushes.size() == 3);
}

TEST_CASE("brush_versions: a single-brush table serializes and hashes identically across two fresh sims") {
    Sim a(42), b(42);
    BrushSpec rust = preset_brush(1);
    rust.id = 1;  // the first version in a fresh table
    REQUIRE(applyBytes(a, encodeDefineBrush(rust)) == DD_OK);
    REQUIRE(applyBytes(b, encodeDefineBrush(rust)) == DD_OK);
    CHECK(hashHex(a) == hashHex(b));
    CHECK(a.serialize() == b.serialize());
    CHECK(a.state().brushes[0].description == "rust");
    Sim c(42);
    REQUIRE(applyBytes(c, encodeDefineBrush(preset_brush(0))) == DD_OK);
    CHECK(hashHex(a) != hashHex(c));
}

TEST_CASE("brush_versions: an edit is a new sequential version and the old version is untouched") {
    Sim sim(42);
    REQUIRE(applyBytes(sim, encodeDefineBrush(inkBrush())) == DD_OK);
    const ddsim::BrushVersion v1 = sim.state().brushes[0];
    BrushSpec edited = inkBrush();
    edited.id = 2;
    edited.mass_raw = ddsim::fx64::ONE * 4;
    REQUIRE(applyBytes(sim, encodeDefineBrush(edited)) == DD_OK);
    // Non-sequential ids are rejected: versions are append-only.
    BrushSpec skip = inkBrush();
    skip.id = 4;
    CHECK(applyBytes(sim, encodeDefineBrush(skip)) == DD_ERR_BRUSH_ID);
    BrushSpec rewrite = inkBrush();
    rewrite.id = 1;
    CHECK(applyBytes(sim, encodeDefineBrush(rewrite)) == DD_ERR_BRUSH_ID);
    REQUIRE(sim.state().brushes.size() == 2);
    CHECK(sim.state().brushes[0].id == 1);
    CHECK(sim.state().brushes[0].description == v1.description);
    CHECK(sim.state().brushes[0].mass == v1.mass);
    CHECK(sim.state().brushes[0].radius == v1.radius);
    CHECK(sim.state().brushes[0].spacing == v1.spacing);
    CHECK(sim.state().brushes[1].id == 2);
    CHECK(sim.state().brushes[1].description == "ink");
    CHECK(sim.state().brushes[1].mass.raw == ddsim::fx64::ONE * 4);
}

} // namespace
