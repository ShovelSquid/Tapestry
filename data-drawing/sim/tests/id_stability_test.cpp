// Insert-a-stroke id stability (STRK-03): two logs that differ only by one
// stroke inserted in time keep every id and every field of the shared
// strokes' nodes identical, and the inserted stroke's ids are dense from 0.
#include "ddsim/ids.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace {

using ddsim::Node;
using ddsim::Sim;
using ddsim_test::Fixture;

std::string hashHex(const Sim& sim) {
    std::uint8_t digest[32];
    sim.hash(digest);
    return ddsim_test::hex(digest);
}

Fixture loadFixture(const std::string& name) {
    Fixture f;
    const std::string text = ddsim_test::readFile(ddsim_test::goldenPath(name, "actions"));
    REQUIRE_MESSAGE(!text.empty(), "missing fixture " << name << ".actions");
    REQUIRE_MESSAGE(ddsim_test::parseActions(text, f), "unparseable fixture " << name << ".actions");
    return f;
}

// Replay to the fixture's last tick (600) and return the nodes grouped by
// stroke ordinal, plus the hash at 600.
std::map<std::uint32_t, std::vector<Node>> replayByOrdinal(const std::string& name, std::string& hashAt600) {
    const Fixture f = loadFixture(name);
    Sim sim(f.seed);
    const bool ok = ddsim_test::replayFixture(f, sim, [&](std::uint64_t tick, const Sim& s) {
        if (tick == 600) {
            hashAt600 = hashHex(s);
        }
    });
    REQUIRE(ok);
    std::map<std::uint32_t, std::vector<Node>> byOrdinal;
    for (const Node& n : sim.state().nodes) {
        byOrdinal[ddsim::node_ordinal(n.id)].push_back(n);
    }
    return byOrdinal;
}

bool sameNode(const Node& a, const Node& b) {
    return a.id == b.id && a.x == b.x && a.y == b.y && a.z == b.z && a.weight == b.weight && a.dir_x == b.dir_x &&
           a.dir_y == b.dir_y && a.vx == b.vx && a.vy == b.vy && a.tick == b.tick && a.brush == b.brush &&
           a.scale_band == b.scale_band;
}

TEST_CASE("id_stability: inserting stroke 3 between strokes 1 and 2 leaves every node id and field of ordinals 1 and 2 identical") {
    std::string hashA, hashB;
    const auto a = replayByOrdinal("two-strokes", hashA);
    const auto b = replayByOrdinal("two-strokes-inserted", hashB);
    REQUIRE(a.size() == 2);
    REQUIRE(b.size() == 3);
    REQUIRE(a.count(1) == 1);
    REQUIRE(a.count(2) == 1);
    REQUIRE(b.count(3) == 1);

    for (const std::uint32_t ordinal : {1u, 2u}) {
        const std::vector<Node>& na = a.at(ordinal);
        const std::vector<Node>& nb = b.at(ordinal);
        REQUIRE_MESSAGE(na.size() == nb.size(), "ordinal " << ordinal);
        REQUIRE(!na.empty());
        std::set<std::uint64_t> idsA, idsB;
        for (const Node& n : na) idsA.insert(n.id.value);
        for (const Node& n : nb) idsB.insert(n.id.value);
        CHECK(idsA == idsB);
        for (std::size_t k = 0; k < na.size(); ++k) {
            CHECK_MESSAGE(sameNode(na[k], nb[k]), "ordinal " << ordinal << " node " << k);
        }
        MESSAGE("ordinal " << ordinal << ": " << na.size() << " nodes identical");
    }

    // The inserted stroke's ids exist only in the inserted replay and carry
    // index bits dense from 0.
    const std::vector<Node>& inserted = b.at(3);
    REQUIRE(!inserted.empty());
    for (std::size_t k = 0; k < inserted.size(); ++k) {
        CHECK(inserted[k].id == ddsim::make_node_id(0, 3, static_cast<std::uint32_t>(k)));
        CHECK(inserted[k].brush == 1);
    }
    MESSAGE("ordinal 3 (inserted): " << inserted.size() << " nodes with dense indices");

    // The whole-state hashes differ (the inserted nodes exist) even though
    // the shared strokes are identical.
    CHECK(hashA.size() == 64);
    CHECK(hashA != hashB);
    // Node order is ascending id (by ordinal, then index), not time: ordinal
    // 3 sits after ordinal 2 in the table even though it was painted first.
    CHECK(ddsim::make_node_id(0, 1, 0) < ddsim::make_node_id(0, 2, 0));
    CHECK(ddsim::make_node_id(0, 2, 0) < ddsim::make_node_id(0, 3, 0));
}

} // namespace
