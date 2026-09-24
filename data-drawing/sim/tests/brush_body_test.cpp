// The spring-damper brush body (STRK-02), emission at spacing with stable
// (ordinal, index) ids (STRK-03), and 3D positions from the recorded plane
// frame (CANV-01). Logs are built in-test with the shared encoder and
// replayed in-process.
#include "ddsim/brush.hpp"
#include "ddsim/ddsim_c.h"
#include "ddsim/ids.hpp"
#include "ddsim/presets.hpp"
#include "ddsim/rules/brush_body.hpp"
#include "ddsim/rules/emit.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <set>
#include <string>
#include <vector>

namespace {

using ddsim::fx64;
using ddsim::Node;
using ddsim::Sample;
using ddsim::Sim;
using ddsim_test::BrushSpec;
using ddsim_test::encodeDefineBrush;
using ddsim_test::inkBrush;
using ddsim_test::PlaneSpec;
using ddsim_test::preset_brush;
using ddsim_test::synthetic_sample;
using ddsim_test::write_stroke_begin;
using ddsim_test::write_stroke_end;
using ddsim_test::write_stroke_samples;

struct LogEntry {
    std::uint32_t tick;
    std::vector<std::uint8_t> bytes;
};

// Apply every entry stamped t (in log order) then step, for t = 0..last.
void runTo(Sim& sim, const std::vector<LogEntry>& log, std::uint32_t last) {
    for (std::uint32_t t = 0; t <= last; ++t) {
        for (const LogEntry& e : log) {
            if (e.tick == t) {
                REQUIRE_MESSAGE(sim.apply(e.bytes.data(), static_cast<std::uint32_t>(e.bytes.size())) == DD_OK,
                                "rejected at tick " << t);
            }
        }
        sim.step();
    }
}

Sample stamped(const Sample& base, std::uint32_t tick, std::uint16_t index) {
    Sample s = base;
    s.tick = tick;
    s.index = index;
    return s;
}

Sample straight(std::uint32_t t) {
    Sample s;
    s.u = static_cast<std::int32_t>(t) * 16384;  // 0.25 units per sample along u
    s.v = 0;
    s.pressure = 32768;
    return s;
}

// brush at tick 0; StrokeBegin ordinal at tick `first`; one sample per tick
// for `count` ticks; no StrokeEnd unless `end` is true.
std::vector<LogEntry> strokeLog(const BrushSpec& brush, std::uint64_t ordinal, std::uint32_t first, std::uint32_t count,
                                Sample (*curve)(std::uint32_t), bool end, const PlaneSpec& plane = PlaneSpec{}) {
    std::vector<LogEntry> log;
    log.push_back({0, encodeDefineBrush(brush)});
    log.push_back({first, write_stroke_begin(ordinal, brush.id, first, 0, plane)});
    for (std::uint32_t t = 0; t < count; ++t) {
        log.push_back({first + t, write_stroke_samples(ordinal, {stamped(curve(t), first + t, 0)})});
    }
    if (end) {
        log.push_back({first + count, write_stroke_end(ordinal, first + count)});
    }
    return log;
}

fx64 distance(fx64 ax, fx64 ay, fx64 bx, fx64 by) {
    const fx64 dx = ax - bx;
    const fx64 dy = ay - by;
    return ddsim::sqrt(dx * dx + dy * dy);
}

BrushSpec withMass(std::int64_t mass_raw) {
    BrushSpec b = inkBrush();
    b.mass_raw = mass_raw;
    return b;
}

// ---------------------------------------------------------------------------

TEST_CASE("brush_body: heavy lags more than light on a straight stroke") {
    fx64 lag[2];
    const std::int64_t masses[2] = {fx64::ONE, fx64::ONE * 64};
    for (int i = 0; i < 2; ++i) {
        Sim sim(42);
        runTo(sim, strokeLog(withMass(masses[i]), 1, 10, 60, straight, false), 69);
        REQUIRE(sim.state().strokes.size() == 1);
        const ddsim::ActiveStroke& st = sim.state().strokes[0];
        CHECK(st.target_u == fx64::from_q16(59 * 16384));
        CHECK(st.target_v.raw == 0);
        lag[i] = distance(st.body.x, st.body.y, st.target_u, st.target_v);
    }
    MESSAGE("distance from body to last target at the last sample's tick: light=" << lag[0].raw
                                                                                   << " heavy=" << lag[1].raw);
    CHECK(lag[1].raw > 0);
    CHECK(lag[1] > lag[0]);
    // Light (k_t = c_t = 1, h = 1) is dead-beat: v <- target - x, x <- target,
    // so with one sample per tick it lands exactly on each sample (lag 0).
    // Heavy (1/64, 1/8) trails a target moving 0.25 per tick by up to
    // c_t * v / k_t = 2 units at steady state; after 60 samples it is well
    // over 1 unit behind.
    CHECK(lag[0].raw == 0);
    CHECK(lag[1].raw >= fx64::ONE);
    CHECK(lag[1].raw <= fx64::ONE * 2);
}

TEST_CASE("brush_body: every preset converges onto a held target within 600 empty ticks") {
    for (std::uint32_t i = 0; i < ddsim::DD_PRESET_COUNT; ++i) {
        BrushSpec b = preset_brush(i);
        b.id = 1;
        Sim sim(42);
        // 10 samples at ticks 10..19, then 600 ticks with no sample.
        runTo(sim, strokeLog(b, 1, 10, 10, synthetic_sample, false), 19 + 600);
        REQUIRE(sim.state().strokes.size() == 1);
        const ddsim::ActiveStroke& st = sim.state().strokes[0];
        const fx64 d = distance(st.body.x, st.body.y, st.target_u, st.target_v);
        const fx64 v = ddsim::sqrt(st.body.vx * st.body.vx + st.body.vy * st.body.vy);
        MESSAGE("preset " << b.description << ": |body - target| raw " << d.raw << ", |v| raw " << v.raw);
        CHECK_MESSAGE(d.raw < (fx64::ONE >> 10), b.description);
        CHECK_MESSAGE(v.raw < (fx64::ONE >> 12), b.description);
        CHECK(st.has_target == 1);
        CHECK(st.last_pressure == synthetic_sample(9).pressure);
    }
}

TEST_CASE("brush_body: symplectic order means velocity is updated before position") {
    // One sub-step from rest with k_t = c_t = ONE, target at distance 1,
    // h = ONE: a = 1, v = 0 + 1 = 1, x = 0 + 1 * 1 = 1. Position-first
    // (explicit Euler) would leave x at 0.
    ddsim::State state;
    ddsim::BrushVersion brush;
    brush.id = 1;
    brush.description = "x";
    brush.mass = fx64::from_int(1);
    brush.radius = fx64::from_raw(inkBrush().radius_raw);
    brush.spacing = fx64::from_raw(inkBrush().spacing_raw);
    ddsim_test::identityCurve(brush.curve);
    state.brushes.push_back(brush);
    ddsim::ActiveStroke st;
    st.id.value = 1;
    st.brush_id = 1;
    st.plane[3] = fx64::from_int(1);
    st.plane[7] = fx64::from_int(1);
    st.has_target = 1;
    Sample s;
    s.tick = 10;
    s.u = 65536;
    s.v = 0;
    s.pressure = 65535;
    st.pending.push_back(s);
    const ddsim::BodyParams params{fx64::from_int(1), fx64::from_int(1)};
    ddsim::integrate_tick(st, brush, params, 10, state);
    CHECK(st.body.vx.raw == fx64::ONE);
    CHECK(st.body.x.raw == fx64::ONE);
    CHECK(st.body.vy.raw == 0);
    CHECK(st.body.y.raw == 0);
    CHECK(st.pending.empty());
    CHECK(st.dir_x.raw == fx64::ONE);
    CHECK(st.dir_y.raw == 0);
    // The segment 0 -> 1 with spacing 0.5 and nothing carried emits at 0.5
    // and at 1.0, distance-interpolated.
    REQUIRE(state.nodes.size() == 2);
    CHECK(state.nodes[0].x.raw == fx64::ONE / 2);
    CHECK(state.nodes[1].x.raw == fx64::ONE);
    CHECK(state.nodes[0].id == ddsim::make_node_id(0, 1, 0));
    CHECK(state.nodes[1].id == ddsim::make_node_id(0, 1, 1));
    CHECK(st.path_accum.raw == 0);
    CHECK(st.next_emission_index == 2);
    // The derived constants for mass 1 are exactly these.
    const ddsim::BodyParams derived = ddsim::derive_params(brush);
    CHECK(derived.k_t.raw == fx64::ONE);
    CHECK(derived.c_t.raw == fx64::ONE);
}

TEST_CASE("emit: consecutive nodes along a straight stroke are spacing apart within ONE over 2 to the 20") {
    Sim sim(42);
    runTo(sim, strokeLog(withMass(fx64::ONE), 1, 10, 60, straight, true), 70);
    const std::vector<Node>& nodes = sim.state().nodes;
    REQUIRE(nodes.size() > 20);
    const fx64 spacing = fx64::from_raw(inkBrush().spacing_raw);
    const std::int64_t tol = fx64::ONE >> 20;
    for (std::size_t k = 0; k + 1 < nodes.size(); ++k) {
        CHECK(nodes[k].y.raw == 0);
        CHECK(nodes[k].z.raw == 0);
        const fx64 d = distance(nodes[k + 1].x, nodes[k + 1].y, nodes[k].x, nodes[k].y);
        const std::int64_t err = d.raw > spacing.raw ? d.raw - spacing.raw : spacing.raw - d.raw;
        CHECK_MESSAGE(err <= tol, "nodes " << k << " and " << k + 1 << ": distance raw " << d.raw);
    }
    MESSAGE(nodes.size() << " nodes along 14.75 units at spacing 0.5");
    CHECK(sim.state().strokes.empty());  // ended; nodes stay
}

TEST_CASE("emit: the first node is at the first sample's position with emission index 0") {
    Sim sim(42);
    runTo(sim, strokeLog(inkBrush(), 5, 10, 1, synthetic_sample, false), 10);
    REQUIRE(sim.state().nodes.size() == 1);
    const Node& n = sim.state().nodes[0];
    CHECK(n.id == ddsim::make_node_id(0, 5, 0));
    CHECK(ddsim::node_index(n.id) == 0);
    CHECK(ddsim::node_ordinal(n.id) == 5);
    const Sample s0 = synthetic_sample(0);
    CHECK(n.x == fx64::from_q16(s0.u));
    CHECK(n.y == fx64::from_q16(s0.v));
    CHECK(n.y.raw == -(std::int64_t{5} << 31));  // -2.5
    CHECK(n.z.raw == 0);
    CHECK(n.tick == 10);
    CHECK(n.brush == 1);
    CHECK(n.scale_band == 0);
    CHECK(n.weight == ddsim::curve_weight(sim.state().brushes[0], s0.pressure));
    CHECK(n.vx.raw == 0);
    CHECK(n.vy.raw == 0);
    CHECK(n.dir_x.raw == fx64::ONE);
    CHECK(n.dir_y.raw == 0);
    const ddsim::ActiveStroke& st = sim.state().strokes[0];
    CHECK(st.next_emission_index == 1);
    CHECK(st.path_accum.raw == 0);
    CHECK(st.body.x == n.x);
    CHECK(st.body.y == n.y);
}

TEST_CASE("ids: every node id equals make_node_id of the stroke ordinal and a dense index from 0 and an ended ordinal cannot be reused") {
    Sim sim(42);
    runTo(sim, strokeLog(inkBrush(), 3, 10, 120, synthetic_sample, true), 130);
    const std::vector<Node>& nodes = sim.state().nodes;
    REQUIRE(nodes.size() > 2);
    for (std::size_t k = 0; k < nodes.size(); ++k) {
        CHECK(nodes[k].id == ddsim::make_node_id(0, 3, static_cast<std::uint32_t>(k)));
        CHECK(ddsim::node_branch(nodes[k].id) == 0);
        if (k > 0) {
            CHECK(nodes[k - 1].id < nodes[k].id);
        }
    }
    MESSAGE(nodes.size() << " nodes with dense indices");
    CHECK(sim.state().strokes.empty());
    // The ordinal now lives in the node table: a new stroke with it is a
    // duplicate even though it is no longer active.
    CHECK(sim.tick() == 131);
    std::vector<std::uint8_t> again = write_stroke_begin(3, 1, 131, 0);
    std::uint8_t before[32], after[32];
    sim.hash(before);
    CHECK(sim.apply(again.data(), static_cast<std::uint32_t>(again.size())) == DD_ERR_STROKE_STATE);
    sim.hash(after);
    CHECK(ddsim_test::hex(before) == ddsim_test::hex(after));
    std::vector<std::uint8_t> fresh = write_stroke_begin(4, 1, 131, 0);
    CHECK(sim.apply(fresh.data(), static_cast<std::uint32_t>(fresh.size())) == DD_OK);
}

TEST_CASE("plane_frame: node z comes from the recorded frame and never from a camera") {
    // (a) origin (0, 0, 5): every node's z is exactly 5.
    PlaneSpec raised;
    raised.q[2] = 5 * 65536;
    Sim a(42);
    runTo(a, strokeLog(inkBrush(), 1, 10, 40, synthetic_sample, true, raised), 50);
    REQUIRE(a.state().nodes.size() > 2);
    for (const Node& n : a.state().nodes) {
        CHECK(n.z == fx64::from_int(5));
    }
    // (b) up = (0, 0, 1): z varies with v and y is exactly 0; node for node,
    // (x, z) equals the default frame's (x, y) for the same samples.
    PlaneSpec tilted;
    tilted.q[6] = 0;
    tilted.q[7] = 0;
    tilted.q[8] = 65536;
    Sim b(42);
    runTo(b, strokeLog(inkBrush(), 1, 10, 40, synthetic_sample, true, tilted), 50);
    Sim ref(42);
    runTo(ref, strokeLog(inkBrush(), 1, 10, 40, synthetic_sample, true), 50);
    REQUIRE(b.state().nodes.size() == ref.state().nodes.size());
    std::set<std::int64_t> zs;
    for (std::size_t k = 0; k < b.state().nodes.size(); ++k) {
        const Node& t = b.state().nodes[k];
        const Node& r = ref.state().nodes[k];
        CHECK(t.y.raw == 0);
        CHECK(t.x == r.x);
        CHECK(t.z == r.y);
        CHECK(r.z.raw == 0);
        zs.insert(t.z.raw);
    }
    CHECK(zs.size() > 1);
    MESSAGE(a.state().nodes.size() << " nodes at z = 5; " << zs.size() << " distinct z values on the tilted frame");
}

} // namespace
