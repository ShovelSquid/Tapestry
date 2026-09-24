// Skeleton invariants.
//
// The core value is "same file, seed and pinned versions reproduce the same
// node state at every tick", so the properties that matter here are that
// the hash is a pure function of the state, that the goldens on disk are
// reproduced, that serialize/restore is an exact inverse, and that a
// rejected action or a rejected restore leaves the hash untouched.
#include "ddsim/ddsim_c.h"
#include "ddsim/fx64.hpp"
#include "ddsim/ids.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <cstdlib>
#include <string>
#include <type_traits>
#include <vector>

namespace {

using ddsim::Sim;
using ddsim_test::BrushSpec;
using ddsim_test::encodeDefineBrush;
using ddsim_test::Fixture;
using ddsim_test::GoldenLine;
using ddsim_test::hex;
using ddsim_test::inkBrush;

std::string hashHex(const Sim& sim) {
    std::uint8_t digest[32];
    sim.hash(digest);
    return hex(digest);
}

Fixture loadFixture(const std::string& name) {
    Fixture f;
    const std::string text = ddsim_test::readFile(ddsim_test::goldenPath(name, "actions"));
    REQUIRE_MESSAGE(!text.empty(), "missing fixture " << name << ".actions");
    REQUIRE_MESSAGE(ddsim_test::parseActions(text, f), "unparseable fixture " << name << ".actions");
    return f;
}

std::vector<GoldenLine> replayToLines(const Fixture& f) {
    Sim sim(f.seed);
    std::vector<GoldenLine> lines;
    const bool ok = ddsim_test::replayFixture(f, sim, [&](std::uint64_t tick, const Sim& s) {
        lines.push_back(GoldenLine{tick, hashHex(s)});
    });
    REQUIRE(ok);
    return lines;
}

// Compares the replay with <name>.sha256. When the file is missing and
// DDSIM_WRITE_GOLDEN=1 is set, writes it and passes: this is how the first
// goldens are produced (from native-release) before being committed.
void checkGolden(const std::string& name) {
    const Fixture f = loadFixture(name);
    const std::vector<GoldenLine> got = replayToLines(f);
    REQUIRE(got.size() == f.checkpoints.size());

    const std::string shaPath = ddsim_test::goldenPath(name, "sha256");
    if (!ddsim_test::fileExists(shaPath)) {
        const char* write = std::getenv("DDSIM_WRITE_GOLDEN");
        const bool mayWrite = write != nullptr && std::string(write) == "1";
        REQUIRE_MESSAGE(mayWrite,
                        "missing golden " << shaPath << " (set DDSIM_WRITE_GOLDEN=1 to create it)");
        std::string text;
        for (const GoldenLine& g : got) {
            text += std::to_string(g.tick) + " " + g.hex + "\n";
        }
        REQUIRE(ddsim_test::writeFile(shaPath, text));
        MESSAGE("wrote golden " << shaPath);
        return;
    }

    std::vector<GoldenLine> expected;
    REQUIRE_MESSAGE(ddsim_test::parseSha256(ddsim_test::readFile(shaPath), expected), "unparseable " << shaPath);
    REQUIRE(expected.size() == got.size());
    for (std::size_t i = 0; i < expected.size(); ++i) {
        CHECK(expected[i].tick == got[i].tick);
        CHECK_MESSAGE(expected[i].hex == got[i].hex, name << " tick " << expected[i].tick);
    }
}

// ---------------------------------------------------------------------------

TEST_CASE("fx64: no floating-point constructor exists and the pins are Q32.32") {
    static_assert(!std::is_constructible_v<ddsim::fx64, float>);
    static_assert(!std::is_constructible_v<ddsim::fx64, double>);
    static_assert(!std::is_constructible_v<ddsim::fx64, long double>);
    static_assert(!std::is_convertible_v<double, ddsim::fx64>);
    static_assert(ddsim::fx64::ONE == std::int64_t{1} << 32);
    static_assert(ddsim::DD_FX_FORMAT_ID == 0x00200020u);
    static_assert(ddsim::DD_TICK_HZ == 60u);
    CHECK(ddsim::fx64::from_int(-3).floor_to_int() == -3);
    CHECK(ddsim::fx64::from_q16(-1).raw == -65536);
    CHECK((ddsim::fx64::from_int(1) - ddsim::fx64::from_raw(1)).floor_to_int() == 0);
    CHECK(ddsim::fx64::from_raw(-1).floor_to_int() == -1);
    CHECK(ddsim::fx64::from_int(5).to_q16() == (5 << 16));
}

TEST_CASE("ids: make_node_id packs branch, ordinal and index and masks each field") {
    const ddsim::NodeId id = ddsim::make_node_id(0x02, 0x00000007u, 0x00000009u);
    CHECK(id.value == ((std::uint64_t{2} << 56) | (std::uint64_t{7} << 24) | 9u));
    CHECK(ddsim::node_branch(id) == 2);
    CHECK(ddsim::node_ordinal(id) == 7u);
    CHECK(ddsim::node_index(id) == 9u);
    // An index past 24 bits cannot bleed into the ordinal.
    const ddsim::NodeId over = ddsim::make_node_id(0, 1, 0x01ffffffu);
    CHECK(ddsim::node_ordinal(over) == 1u);
    CHECK(ddsim::node_index(over) == 0x00ffffffu);
    // Ascending numeric order is (branch, stroke, index).
    CHECK(ddsim::make_node_id(0, 1, 5) < ddsim::make_node_id(0, 2, 0));
    CHECK(ddsim::make_node_id(0, 9, 9) < ddsim::make_node_id(1, 0, 0));
    CHECK(ddsim::make_stroke_id(1, 3).value == ((std::uint64_t{1} << 32) | 3u));
    CHECK(!ddsim::NodeId{}.assigned());
}

TEST_CASE("sim: fresh state hashes deterministically across two instances") {
    Sim a(42), b(42), c(43);
    CHECK(hashHex(a) == hashHex(b));
    CHECK(hashHex(a) != hashHex(c));
    CHECK(hashHex(a).size() == 64);
    a.step();
    CHECK(a.tick() == 1);
    CHECK(hashHex(a) != hashHex(b));
    b.step();
    CHECK(hashHex(a) == hashHex(b));
    // The seeded rng state sits in the walk: the two seeds differ there too.
    CHECK(a.state().rng.s[0] != c.state().rng.s[0]);
}

TEST_CASE("sim: golden noop hashes at checkpoints") { checkGolden("noop"); }

TEST_CASE("sim: golden one-brush hashes at checkpoints") { checkGolden("one-brush"); }

TEST_CASE("sim: the brush changes the hash at every checkpoint") {
    const std::vector<GoldenLine> noop = replayToLines(loadFixture("noop"));
    const std::vector<GoldenLine> one = replayToLines(loadFixture("one-brush"));
    REQUIRE(noop.size() == one.size());
    for (std::size_t i = 0; i < noop.size(); ++i) {
        CHECK(noop[i].tick == one[i].tick);
        CHECK(noop[i].hex != one[i].hex);
    }
}

TEST_CASE("sim: restore(serialize(s)).hash() == s.hash() at every checkpoint") {
    for (const char* name : {"noop", "one-brush"}) {
        const Fixture f = loadFixture(name);
        Sim sim(f.seed);
        int checkpoints = 0;
        const bool ok = ddsim_test::replayFixture(f, sim, [&](std::uint64_t, const Sim& s) {
            const std::vector<std::uint8_t> bytes = s.serialize();
            Sim other(0);
            REQUIRE(other.restore(bytes.data(), static_cast<std::uint32_t>(bytes.size())) == DD_OK);
            CHECK(hashHex(other) == hashHex(s));
            CHECK(other.tick() == s.tick());
            CHECK(other.state().brushes.size() == s.state().brushes.size());
            CHECK(other.serialize() == bytes);
            ++checkpoints;
        });
        REQUIRE(ok);
        CHECK(checkpoints == 4);
    }
}

TEST_CASE("sim: restore rejects truncated, magic-mismatched and trailing-byte inputs and leaves the hash unchanged") {
    Sim source(42);
    const std::vector<std::uint8_t> ink = encodeDefineBrush(inkBrush());
    REQUIRE(source.apply(ink.data(), static_cast<std::uint32_t>(ink.size())) == DD_OK);
    source.step();
    const std::vector<std::uint8_t> good = source.serialize();

    Sim target(7);
    const std::string before = hashHex(target);

    SUBCASE("truncated at every length") {
        for (std::size_t n = 0; n < good.size(); ++n) {
            CHECK(target.restore(good.data(), static_cast<std::uint32_t>(n)) == DD_ERR_RESTORE);
        }
        CHECK(hashHex(target) == before);
    }
    SUBCASE("magic mismatch") {
        std::vector<std::uint8_t> bad = good;
        bad[3] = '2';
        CHECK(target.restore(bad.data(), static_cast<std::uint32_t>(bad.size())) == DD_ERR_RESTORE);
        CHECK(hashHex(target) == before);
    }
    SUBCASE("version pin mismatch") {
        std::vector<std::uint8_t> bad = good;
        bad[4] = static_cast<std::uint8_t>(bad[4] + 1);  // sim_version low byte
        CHECK(target.restore(bad.data(), static_cast<std::uint32_t>(bad.size())) == DD_ERR_RESTORE);
        bad = good;
        bad[24] = static_cast<std::uint8_t>(bad[24] + 1);  // tick_hz low byte
        CHECK(target.restore(bad.data(), static_cast<std::uint32_t>(bad.size())) == DD_ERR_RESTORE);
        CHECK(hashHex(target) == before);
    }
    SUBCASE("trailing byte") {
        std::vector<std::uint8_t> bad = good;
        bad.push_back(0);
        CHECK(target.restore(bad.data(), static_cast<std::uint32_t>(bad.size())) == DD_ERR_RESTORE);
        CHECK(hashHex(target) == before);
    }
    SUBCASE("null and empty") {
        CHECK(target.restore(nullptr, 0) == DD_ERR_RESTORE);
        CHECK(target.restore(good.data(), 0) == DD_ERR_RESTORE);
        CHECK(hashHex(target) == before);
    }
    SUBCASE("the untouched bytes still restore") {
        CHECK(target.restore(good.data(), static_cast<std::uint32_t>(good.size())) == DD_OK);
        CHECK(hashHex(target) == hashHex(source));
    }
}

TEST_CASE("sim: DefineBrush with wrong id, empty description, or zero mass is rejected and the hash is unchanged") {
    Sim sim(42);
    const std::string before = hashHex(sim);

    BrushSpec wrongId = inkBrush();
    wrongId.id = 2;
    std::vector<std::uint8_t> a = encodeDefineBrush(wrongId);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_ID);
    CHECK(hashHex(sim) == before);

    BrushSpec zeroId = inkBrush();
    zeroId.id = 0;
    a = encodeDefineBrush(zeroId);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_ID);
    CHECK(hashHex(sim) == before);

    BrushSpec empty = inkBrush();
    empty.description.clear();
    a = encodeDefineBrush(empty);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_INVALID);
    CHECK(hashHex(sim) == before);

    BrushSpec tooLong = inkBrush();
    tooLong.description.assign(ddsim::DD_MAX_DESC_BYTES + 1, 'x');
    a = encodeDefineBrush(tooLong);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_INVALID);
    CHECK(hashHex(sim) == before);

    BrushSpec zeroMass = inkBrush();
    zeroMass.mass_raw = 0;
    a = encodeDefineBrush(zeroMass);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_INVALID);
    CHECK(hashHex(sim) == before);

    BrushSpec negativeRadius = inkBrush();
    negativeRadius.radius_raw = -1;
    a = encodeDefineBrush(negativeRadius);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_INVALID);
    CHECK(hashHex(sim) == before);

    // Malformed bytes: short header, wrong version, payload_len disagreeing
    // with len, payload truncated, payload with extra bytes.
    a = encodeDefineBrush(inkBrush());
    CHECK(sim.apply(a.data(), 7) == DD_ERR_BAD_HEADER);
    std::vector<std::uint8_t> badVersion = a;
    badVersion[1] = 2;
    CHECK(sim.apply(badVersion.data(), static_cast<std::uint32_t>(badVersion.size())) == DD_ERR_BAD_HEADER);
    std::vector<std::uint8_t> badReserved = a;
    badReserved[2] = 1;
    CHECK(sim.apply(badReserved.data(), static_cast<std::uint32_t>(badReserved.size())) == DD_ERR_BAD_HEADER);
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size() - 1)) == DD_ERR_BAD_LENGTH);
    std::vector<std::uint8_t> truncatedPayload = a;
    truncatedPayload.pop_back();
    truncatedPayload[4] = static_cast<std::uint8_t>(truncatedPayload[4] - 1);
    CHECK(sim.apply(truncatedPayload.data(), static_cast<std::uint32_t>(truncatedPayload.size())) == DD_ERR_BAD_LENGTH);
    std::vector<std::uint8_t> extraPayload = a;
    extraPayload.push_back(0);
    extraPayload[4] = static_cast<std::uint8_t>(extraPayload[4] + 1);
    CHECK(sim.apply(extraPayload.data(), static_cast<std::uint32_t>(extraPayload.size())) == DD_ERR_BAD_LENGTH);
    CHECK(sim.apply(nullptr, 0) == DD_ERR_BAD_HEADER);
    CHECK(hashHex(sim) == before);
    CHECK(sim.state().brushes.empty());

    // And the well-formed one is accepted exactly once.
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_OK);
    CHECK(hashHex(sim) != before);
    CHECK(sim.state().brushes.size() == 1);
    CHECK(sim.state().brushes[0].description == "ink");
    CHECK(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BRUSH_ID);
}

TEST_CASE("sim: apply of an unknown kind returns DD_ERR_UNKNOWN_KIND and an empty stroke payload is DD_ERR_BAD_LENGTH") {
    Sim sim(42);
    const std::string before = hashHex(sim);
    for (const std::uint8_t kind : {std::uint8_t{0}, std::uint8_t{7}, std::uint8_t{255}}) {
        const std::vector<std::uint8_t> a = ddsim_test::encodeEmptyAction(kind);
        CHECK_MESSAGE(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_UNKNOWN_KIND, "kind " << int(kind));
    }
    // Kinds 2, 3, 4 are the stroke actions (01-05) and 5, 6 the particle/
    // constraint actions: a well-formed header with no payload is a length
    // error, not an unknown kind.
    for (const std::uint8_t kind : {std::uint8_t{2}, std::uint8_t{3}, std::uint8_t{4}, std::uint8_t{5}, std::uint8_t{6}}) {
        const std::vector<std::uint8_t> a = ddsim_test::encodeEmptyAction(kind);
        CHECK_MESSAGE(sim.apply(a.data(), static_cast<std::uint32_t>(a.size())) == DD_ERR_BAD_LENGTH, "kind " << int(kind));
    }
    CHECK(hashHex(sim) == before);
}

TEST_CASE("abi: dd_serialize(cap=0) returns the length and a second call with that cap round-trips through dd_restore") {
    dd_sim* a = dd_create(42);
    REQUIRE(a != nullptr);
    const std::vector<std::uint8_t> ink = encodeDefineBrush(inkBrush());
    CHECK(dd_apply(a, ink.data(), static_cast<uint32_t>(ink.size())) == DD_OK);
    for (int i = 0; i < 60; ++i) {
        dd_step(a);
    }
    CHECK(dd_tick(a) == 60);
    CHECK(dd_version() == ddsim::DD_SIM_VERSION);
    CHECK(dd_node_stride() == 88u);
    CHECK(dd_body_stride() == 56u);
    CHECK(dd_node_count(a) == 0u);
    CHECK(dd_body_count(a) == 0u);

    const uint32_t needed = dd_serialize(a, nullptr, 0);
    CHECK(needed > 0);
    std::vector<uint8_t> buf(needed);
    CHECK(dd_serialize(a, buf.data(), needed - 1) == 0u);  // insufficient cap writes nothing
    CHECK(dd_serialize(a, buf.data(), needed) == needed);

    dd_sim* b = dd_create(1);
    REQUIRE(b != nullptr);
    CHECK(dd_restore(b, buf.data(), needed) == DD_OK);
    uint8_t ha[32], hb[32];
    dd_hash(a, ha);
    dd_hash(b, hb);
    CHECK(hex(ha) == hex(hb));
    CHECK(dd_tick(b) == 60);

    // Null handling in the wrapper.
    CHECK(dd_apply(nullptr, ink.data(), static_cast<uint32_t>(ink.size())) == DD_ERR_BAD_HEADER);
    CHECK(dd_apply(a, nullptr, 8) == DD_ERR_BAD_HEADER);
    CHECK(dd_apply(a, ink.data(), 7) == DD_ERR_BAD_HEADER);
    CHECK(dd_restore(b, nullptr, 8) == DD_ERR_RESTORE);
    CHECK(dd_tick(nullptr) == 0);
    CHECK(dd_serialize(nullptr, nullptr, 0) == 0u);

    dd_destroy(a);
    dd_destroy(b);
    dd_destroy(nullptr);
}

} // namespace
