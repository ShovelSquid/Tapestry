// Ticks-per-frame invariance and mid-stroke serialize/restore (SIM-02).
//
// step() takes no time argument: the same recorded samples stepped one tick
// per call or four per burst must hash identically at every checkpoint. A
// checkpoint taken mid-stroke (active stroke with pending samples) must
// restore into a fresh sim that continues to the same final hash.
#include "ddsim/ddsim_c.h"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <string>
#include <vector>

namespace {

using ddsim::Sim;
using ddsim_test::Fixture;
using ddsim_test::GoldenLine;

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

std::uint64_t lastTick(const Fixture& f) {
    std::uint64_t max = 0;
    for (const auto& a : f.actions) {
        if (a.tick > max) max = a.tick;
    }
    for (const auto c : f.checkpoints) {
        if (c > max) max = c;
    }
    return max;
}

void applyTick(Sim& sim, const Fixture& f, std::uint64_t t) {
    for (const auto& a : f.actions) {
        if (a.tick == t) {
            REQUIRE_MESSAGE(sim.apply(a.bytes.data(), static_cast<std::uint32_t>(a.bytes.size())) == DD_OK, "tick " << t);
        }
    }
}

bool isCheckpoint(const Fixture& f, std::uint64_t t) {
    for (const auto c : f.checkpoints) {
        if (c == t) return true;
    }
    return false;
}

TEST_CASE("tpf: one step per call and four steps per burst hash identically at every checkpoint of one-stroke") {
    const Fixture f = loadFixture("one-stroke");
    const std::uint64_t last = lastTick(f);

    // (a) apply-then-step every tick.
    std::vector<GoldenLine> one;
    {
        Sim sim(f.seed);
        REQUIRE(ddsim_test::replayFixture(f, sim, [&](std::uint64_t tick, const Sim& s) {
            one.push_back(GoldenLine{tick, hashHex(s)});
        }));
    }

    // (b) the worker's shape: an outer loop that owes four ticks per frame
    // and drains them with four step() calls, applying each tick's actions
    // (and taking its checkpoint) at that tick's own boundary just before
    // its step. The sim cannot tell the two apart.
    std::vector<GoldenLine> four;
    {
        Sim sim(f.seed);
        std::uint64_t t = 0;
        while (t <= last) {
            for (int burst = 0; burst < 4 && t <= last; ++burst) {
                REQUIRE(sim.tick() == t);
                applyTick(sim, f, t);
                if (isCheckpoint(f, t)) {
                    four.push_back(GoldenLine{t, hashHex(sim)});
                }
                sim.step();
                ++t;
            }
        }
    }

    REQUIRE(one.size() == f.checkpoints.size());
    REQUIRE(four.size() == one.size());
    for (std::size_t i = 0; i < one.size(); ++i) {
        CHECK(one[i].tick == four[i].tick);
        CHECK_MESSAGE(one[i].hex == four[i].hex, "tick " << one[i].tick);
    }
    CHECK(one.front().tick == 10);
    CHECK(one.back().tick == 600);
}

TEST_CASE("tpf: serialize at tick 70 mid-stroke, restore into a fresh sim, continue both to 600 with equal hashes and node counts") {
    const Fixture f = loadFixture("one-stroke");
    Sim live(f.seed);
    for (std::uint64_t t = 0; t < 70; ++t) {
        applyTick(live, f, t);
        live.step();
    }
    REQUIRE(live.tick() == 70);
    applyTick(live, f, 70);  // the tick-70 sample is now pending
    REQUIRE(live.state().strokes.size() == 1);
    CHECK(live.state().strokes[0].pending.size() == 1);
    CHECK(live.state().strokes[0].has_target == 1);
    CHECK(live.state().nodes.size() > 0);
    const std::string at70 = hashHex(live);

    // The committed golden line for tick 70 is this very hash.
    std::vector<GoldenLine> golden;
    REQUIRE(ddsim_test::parseSha256(ddsim_test::readFile(ddsim_test::goldenPath("one-stroke", "sha256")), golden));
    bool found = false;
    for (const GoldenLine& g : golden) {
        if (g.tick == 70) {
            CHECK(g.hex == at70);
            found = true;
        }
    }
    CHECK(found);

    const std::vector<std::uint8_t> bytes = live.serialize();
    Sim restored(1);
    REQUIRE(restored.restore(bytes.data(), static_cast<std::uint32_t>(bytes.size())) == DD_OK);
    CHECK(hashHex(restored) == at70);
    CHECK(restored.state().strokes[0].pending.size() == 1);
    CHECK(restored.serialize() == bytes);

    // Continue both: the step for tick 70, then ticks 71..600.
    live.step();
    restored.step();
    for (std::uint64_t t = 71; t <= 600; ++t) {
        applyTick(live, f, t);
        applyTick(restored, f, t);
        if (t == 130) {
            CHECK(live.state().strokes.empty());
            CHECK(restored.state().strokes.empty());
        }
        live.step();
        restored.step();
    }
    CHECK(live.tick() == 601);
    CHECK(hashHex(live) == hashHex(restored));
    CHECK(live.state().nodes.size() == restored.state().nodes.size());
    CHECK(live.serialize() == restored.serialize());
    MESSAGE(live.state().nodes.size() << " nodes after restoring mid-stroke at tick 70");
}

} // namespace
