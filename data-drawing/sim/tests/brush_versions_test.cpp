// Brush versions are immutable and append-only (STRK-04): after an edit
// creates version 2, a stroke made with version 1 replays to identical
// nodes, and a stroke made with version 2 differs from what version 1 would
// have produced from the same samples.
#include "ddsim/ids.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace {

using ddsim::fx64;
using ddsim::Node;
using ddsim::Sim;
using ddsim_test::BrushSpec;
using ddsim_test::encodeDefineBrush;
using ddsim_test::Fixture;
using ddsim_test::preset_brush;
using ddsim_test::StampedAction;

Fixture loadFixture(const std::string& name) {
    Fixture f;
    const std::string text = ddsim_test::readFile(ddsim_test::goldenPath(name, "actions"));
    REQUIRE_MESSAGE(!text.empty(), "missing fixture " << name << ".actions");
    REQUIRE_MESSAGE(ddsim_test::parseActions(text, f), "unparseable fixture " << name << ".actions");
    return f;
}

std::map<std::uint32_t, std::vector<Node>> byOrdinal(const Sim& sim) {
    std::map<std::uint32_t, std::vector<Node>> out;
    for (const Node& n : sim.state().nodes) {
        out[ddsim::node_ordinal(n.id)].push_back(n);
    }
    return out;
}

bool sameNode(const Node& a, const Node& b) {
    return a.id == b.id && a.x == b.x && a.y == b.y && a.z == b.z && a.weight == b.weight && a.dir_x == b.dir_x &&
           a.dir_y == b.dir_y && a.vx == b.vx && a.vy == b.vy && a.tick == b.tick && a.brush == b.brush &&
           a.scale_band == b.scale_band;
}

TEST_CASE("brush_versions: an edit creates version 2 and stroke 1 made with version 1 replays to identical nodes") {
    const Fixture f = loadFixture("brush-edit");
    Sim edited(f.seed);
    REQUIRE(ddsim_test::replayFixture(f, edited, [](std::uint64_t, const Sim&) {}));
    const auto editedNodes = byOrdinal(edited);
    REQUIRE(editedNodes.size() == 2);

    // Log A: brush 1 and stroke 1 only — the session without the edit.
    std::vector<StampedAction> a;
    a.push_back({0, encodeDefineBrush(preset_brush(0))});
    REQUIRE(ddsim_test::stroke_actions(a, 1, 1, 10, 60, 1, {}) == 70);
    Sim without(f.seed);
    REQUIRE(ddsim_test::replayLog(a, without, 600));
    const auto withoutNodes = byOrdinal(without);
    REQUIRE(withoutNodes.size() == 1);

    const std::vector<Node>& e1 = editedNodes.at(1);
    const std::vector<Node>& w1 = withoutNodes.at(1);
    REQUIRE(e1.size() == w1.size());
    REQUIRE(!e1.empty());
    for (std::size_t k = 0; k < e1.size(); ++k) {
        CHECK_MESSAGE(sameNode(e1[k], w1[k]), "ordinal 1 node " << k);
        CHECK(e1[k].brush == 1);
    }
    MESSAGE("ordinal 1: " << e1.size() << " nodes identical with and without the later edit");

    // Log B: stroke 2's samples painted with brush 1 instead of brush 2 —
    // the same samples, a different mass: at least one node differs.
    std::vector<StampedAction> b;
    b.push_back({0, encodeDefineBrush(preset_brush(0))});
    REQUIRE(ddsim_test::stroke_actions(b, 2, 1, 100, 60, 1, {}) == 160);
    Sim withOne(f.seed);
    REQUIRE(ddsim_test::replayLog(b, withOne, 600));
    const auto withOneNodes = byOrdinal(withOne);
    REQUIRE(withOneNodes.size() == 1);
    const std::vector<Node>& e2 = editedNodes.at(2);
    const std::vector<Node>& o2 = withOneNodes.at(2);
    REQUIRE(!e2.empty());
    REQUIRE(!o2.empty());
    bool differs = e2.size() != o2.size();
    for (std::size_t k = 0; !differs && k < e2.size(); ++k) {
        differs = e2[k].x != o2[k].x || e2[k].y != o2[k].y;
    }
    CHECK(differs);
    for (const Node& n : e2) {
        CHECK(n.brush == 2);
    }
    MESSAGE("ordinal 2: " << e2.size() << " nodes with version 2 vs " << o2.size() << " with version 1");

    // The table holds both versions and version 1 is untouched by the edit.
    REQUIRE(edited.state().brushes.size() == 2);
    const ddsim::BrushVersion& v1 = edited.state().brushes[0];
    const ddsim::BrushVersion& v2 = edited.state().brushes[1];
    const BrushSpec ink = preset_brush(0);
    CHECK(v1.id == 1);
    CHECK(v1.description == ink.description);
    CHECK(v1.mass.raw == ink.mass_raw);
    CHECK(v1.radius.raw == ink.radius_raw);
    CHECK(v1.spacing.raw == ink.spacing_raw);
    for (std::uint32_t i = 0; i < ddsim::DD_CURVE_KNOTS; ++i) {
        CHECK(v1.curve[i] == ink.curve[i]);
    }
    CHECK(v2.id == 2);
    CHECK(v2.description == "ink");
    CHECK(v2.mass.raw == fx64::ONE * 4);
    CHECK(v2.radius.raw == ink.radius_raw);
    // And version 1 is byte-identical to the one in the session without the edit.
    CHECK(without.state().brushes.size() == 1);
    CHECK(without.state().brushes[0].mass == v1.mass);
    CHECK(without.state().brushes[0].description == v1.description);
}

TEST_CASE("brush_versions: the presets fixture defines the four DD_PRESETS as ids 1..4 differing in description and mass") {
    const Fixture f = loadFixture("presets");
    Sim sim(f.seed);
    REQUIRE(ddsim_test::replayFixture(f, sim, [](std::uint64_t, const Sim&) {}));
    REQUIRE(sim.state().brushes.size() == 4);
    for (std::uint32_t i = 0; i < 4; ++i) {
        const ddsim::BrushVersion& b = sim.state().brushes[i];
        const BrushSpec spec = preset_brush(i);
        CHECK(b.id == i + 1);
        CHECK(b.description == spec.description);
        CHECK(b.mass.raw == spec.mass_raw);
        CHECK(b.radius.raw == spec.radius_raw);
        CHECK(b.spacing.raw == spec.spacing_raw);
        for (std::uint32_t j = 0; j < i; ++j) {
            CHECK(b.description != sim.state().brushes[j].description);
            CHECK(b.mass != sim.state().brushes[j].mass);
        }
    }
    CHECK(sim.state().nodes.empty());
    CHECK(sim.state().strokes.empty());
}

} // namespace
