// Strict restore: reject, never clamp. Any byte sequence can be offered to
// dd_restore (Phase 3 will feed it snapshots), so the contract is that a
// mutated state is either rejected with DD_ERR_RESTORE or accepted exactly —
// re-serializing to the very bytes that were offered — and never silently
// corrected into something else.
#include "ddsim/ddsim_c.h"
#include "ddsim/sim.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace {

using ddsim::Sim;
using ddsim_test::Fixture;
using ddsim_test::hex;

std::string hashHex(const Sim& sim) {
    std::uint8_t digest[32];
    sim.hash(digest);
    return hex(digest);
}

// The one-brush state at tick 60: the same bytes 01-01's abi test round-trips.
std::vector<std::uint8_t> oneBrushAt60() {
    Sim sim(42);
    const std::vector<std::uint8_t> ink = ddsim_test::encodeDefineBrush(ddsim_test::inkBrush());
    REQUIRE(sim.apply(ink.data(), static_cast<std::uint32_t>(ink.size())) == DD_OK);
    for (int i = 0; i < 60; ++i) {
        sim.step();
    }
    return sim.serialize();
}

std::vector<std::string> fixtureNames() {
    std::vector<std::string> names;
    for (const auto& entry : std::filesystem::directory_iterator(DDSIM_GOLDEN_DIR)) {
        if (entry.path().extension() == ".actions") {
            names.push_back(entry.path().stem().string());
        }
    }
    std::sort(names.begin(), names.end());
    return names;
}

TEST_CASE("restore: reject-or-exact byte sweep") {
    const std::vector<std::uint8_t> good = oneBrushAt60();
    REQUIRE(good.size() > 100);
    int rejected = 0;
    int acceptedExactly = 0;
    int corrected = 0;
    for (std::size_t i = 0; i < good.size(); ++i) {
        std::vector<std::uint8_t> mutated = good;
        mutated[i] = static_cast<std::uint8_t>(mutated[i] ^ 0xffu);
        Sim fresh(0);
        const std::string before = hashHex(fresh);
        const int rc = fresh.restore(mutated.data(), static_cast<std::uint32_t>(mutated.size()));
        if (rc == DD_ERR_RESTORE) {
            ++rejected;
            CHECK_MESSAGE(hashHex(fresh) == before, "offset " << i << ": a rejected restore touched the state");
        } else if (rc == DD_OK) {
            if (fresh.serialize() == mutated) {
                ++acceptedExactly;
            } else {
                ++corrected;
                CHECK_MESSAGE(false, "offset " << i << ": accepted but re-serialized differently (silent correction)");
            }
        } else {
            CHECK_MESSAGE(false, "offset " << i << ": unexpected code " << rc);
        }
    }
    CHECK(corrected == 0);
    CHECK(rejected + acceptedExactly == static_cast<int>(good.size()));
    CHECK(rejected > 0);
    CHECK(acceptedExactly > 0);  // the seed, tick, curve and rng bytes are free
    MESSAGE("byte sweep over " << good.size() << " offsets: " << rejected << " rejected, " << acceptedExactly
                               << " accepted exactly, " << corrected << " silently corrected");

    // Two-byte and whole-field mutations behave the same way.
    for (std::size_t i = 0; i + 1 < good.size(); i += 7) {
        std::vector<std::uint8_t> mutated = good;
        mutated[i] = static_cast<std::uint8_t>(mutated[i] ^ 0x5au);
        mutated[i + 1] = static_cast<std::uint8_t>(mutated[i + 1] ^ 0xa5u);
        Sim fresh(0);
        const int rc = fresh.restore(mutated.data(), static_cast<std::uint32_t>(mutated.size()));
        const bool ok = rc == DD_ERR_RESTORE || (rc == DD_OK && fresh.serialize() == mutated);
        CHECK_MESSAGE(ok, "offsets " << i << "," << i + 1);
    }
}

TEST_CASE("restore: truncation at every length from 0 to len-1 is rejected") {
    const std::vector<std::uint8_t> good = oneBrushAt60();
    Sim fresh(0);
    const std::string before = hashHex(fresh);
    int rejected = 0;
    for (std::size_t n = 0; n < good.size(); ++n) {
        if (fresh.restore(good.data(), static_cast<std::uint32_t>(n)) == DD_ERR_RESTORE) {
            ++rejected;
        }
    }
    CHECK(rejected == static_cast<int>(good.size()));
    CHECK(hashHex(fresh) == before);
    // Extending by one to sixteen bytes is rejected too.
    for (std::size_t extra = 1; extra <= 16; ++extra) {
        std::vector<std::uint8_t> longer = good;
        longer.insert(longer.end(), extra, std::uint8_t{0});
        CHECK(fresh.restore(longer.data(), static_cast<std::uint32_t>(longer.size())) == DD_ERR_RESTORE);
    }
    CHECK(hashHex(fresh) == before);
    // And the untouched bytes restore, through the C ABI as well.
    CHECK(fresh.restore(good.data(), static_cast<std::uint32_t>(good.size())) == DD_OK);
    CHECK(fresh.serialize() == good);
    dd_sim* c = dd_create(1);
    REQUIRE(c != nullptr);
    CHECK(dd_restore(c, good.data(), static_cast<std::uint32_t>(good.size())) == DD_OK);
    CHECK(dd_tick(c) == 60);
    dd_destroy(c);
}

TEST_CASE("restore: hash after restore equals the hash of the source for every fixture at every checkpoint") {
    const std::vector<std::string> names = fixtureNames();
    REQUIRE(names.size() >= 2);
    for (const std::string& name : names) {
        Fixture f;
        const std::string text = ddsim_test::readFile(ddsim_test::goldenPath(name, "actions"));
        REQUIRE_MESSAGE(ddsim_test::parseActions(text, f), "unparseable fixture " << name);
        Sim sim(f.seed);
        int checkpoints = 0;
        const bool ok = ddsim_test::replayFixture(f, sim, [&](std::uint64_t tick, const Sim& s) {
            const std::vector<std::uint8_t> bytes = s.serialize();
            Sim other(f.seed + 1);
            REQUIRE_MESSAGE(other.restore(bytes.data(), static_cast<std::uint32_t>(bytes.size())) == DD_OK,
                            name << " tick " << tick);
            CHECK_MESSAGE(hashHex(other) == hashHex(s), name << " tick " << tick);
            CHECK(other.serialize() == bytes);
            CHECK(other.tick() == tick);
            ++checkpoints;
        });
        REQUIRE_MESSAGE(ok, name << ": an action was rejected during replay");
        CHECK_MESSAGE(checkpoints == static_cast<int>(f.checkpoints.size()), name);
        MESSAGE(name << ": " << checkpoints << " checkpoints round-tripped");
    }
}

} // namespace
