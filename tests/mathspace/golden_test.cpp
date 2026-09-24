// golden_test.cpp — the committed fixtures under tests/golden/ms are honest:
// their hand-written hex equals what the encoders produce, replaying them
// in-process reproduces the committed .sha256 lines, and a replayed world
// equals the world built by direct calls. ms_replay and two_process.cmake
// check the same fixtures across processes and across build types.
#include <doctest.h>

#include "fixture.hpp"
#include "mathspace/action.hpp"
#include "mathspace/world.hpp"

#include <string>
#include <vector>

using namespace mathspace;
using namespace mathspace_test;

namespace {

Fixture load(const char* name) {
    const std::string text = readFile(goldenPath(name, "actions"));
    REQUIRE_MESSAGE(!text.empty(), goldenPath(name, "actions"));
    Fixture f;
    REQUIRE(parseActions(text, f));
    return f;
}

std::vector<GoldenLine> loadSha(const char* name) {
    const std::string text = readFile(goldenPath(name, "sha256"));
    REQUIRE_MESSAGE(!text.empty(), goldenPath(name, "sha256"));
    std::vector<GoldenLine> lines;
    REQUIRE(parseSha256(text, lines));
    return lines;
}

std::string hashOf(const World& w) {
    std::uint8_t d[32];
    hash(w, d);
    return hex(d);
}

Field pos2(std::int32_t x, std::int32_t y) {
    Field f;
    f.name = std::string(POS_FIELD);
    f.dim = 2;
    f.value[0] = fx64::from_int(x);
    f.value[1] = fx64::from_int(y);
    return f;
}

// Replays `name` in-process and checks every checkpoint hash against the
// committed golden, plus a serialize/restore roundtrip at each one.
void checkAgainstGolden(const char* name, const Fixture& f) {
    const std::vector<GoldenLine> expected = loadSha(name);
    World w(f.seed);
    std::vector<GoldenLine> got;
    Error rejected = Error::Ok;
    const bool ok = replayFixture(
        f, w,
        [&](std::uint64_t tick, const World& at) {
            got.push_back(GoldenLine{tick, hashOf(at)});
            World other(at.seed);
            REQUIRE(restore(other, serialize(at)) == Error::Ok);
            CHECK(other == at);
            CHECK(hashOf(other) == got.back().hex);
        },
        &rejected);
    CHECK_MESSAGE(ok, error_name(rejected));
    REQUIRE(got.size() == expected.size());
    for (std::size_t i = 0; i < got.size(); ++i) {
        CHECK(got[i].tick == expected[i].tick);
        CHECK_MESSAGE(got[i].hex == expected[i].hex, name << " tick " << got[i].tick);
    }
}

} // namespace

TEST_CASE("golden empty: parses, replays, matches the committed hashes") {
    const Fixture f = load("empty");
    CHECK(f.seed == 42);
    CHECK(f.actions.empty());
    CHECK(f.checkpoints == std::vector<std::uint64_t>{0, 1, 60});
    checkAgainstGolden("empty", f);
}

TEST_CASE("golden two-notes: hand-written hex equals the encoders") {
    const Fixture f = load("two-notes");
    CHECK(f.seed == 7);
    const NoteId space = make_note_id(0, 1, 0);
    const NoteId a = make_note_id(0, 2, 0);
    const NoteId b = make_note_id(0, 3, 0);
    struct Stamped {
        std::uint64_t tick;
        std::vector<std::uint8_t> bytes;
    };
    const std::vector<Stamped> log = {
        {0, encode_create_space(2)},
        {0, encode_create_note(space_of(space), NoteKind::Note)},
        {0, encode_set_field(a, pos2(1, 2))},
        {1, encode_create_note(space_of(space), NoteKind::Note)},
        {1, encode_set_field(b, pos2(3, 4))},
        {2, encode_set_field(a, pos2(5, 6))},
        {3, encode_delete_note(a)},
    };
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    CHECK(f.checkpoints == std::vector<std::uint64_t>{0, 1, 2, 3, 4});
}

TEST_CASE("golden two-notes: replay equals the direct build and the committed hashes") {
    const Fixture f = load("two-notes");

    // Direct build, stepping the same way the replay rule does.
    World direct(f.seed);
    NoteId space, a, b;
    REQUIRE(direct.create_space(2, &space) == Error::Ok);
    REQUIRE(direct.create_note(space_of(space), NoteKind::Note, &a) == Error::Ok);
    REQUIRE(direct.set_field(a, pos2(1, 2)) == Error::Ok);
    direct.step();
    REQUIRE(direct.create_note(space_of(space), NoteKind::Note, &b) == Error::Ok);
    REQUIRE(direct.set_field(b, pos2(3, 4)) == Error::Ok);
    direct.step();
    REQUIRE(direct.set_field(a, pos2(5, 6)) == Error::Ok);
    direct.step();
    REQUIRE(direct.delete_note(a) == Error::Ok);
    direct.step();
    // Tick 4 is a checkpoint: nothing applied, then one more step.
    const std::string directAt4 = hashOf(direct);
    direct.step();

    World replayed(f.seed);
    std::string replayedAt4;
    REQUIRE(replayFixture(f, replayed, [&](std::uint64_t tick, const World& w) {
        if (tick == 4) replayedAt4 = hashOf(w);
    }));
    CHECK(replayed == direct);
    CHECK(replayedAt4 == directAt4);
    CHECK(replayed.notes.size() == 2);
    CHECK(replayed.find(a) == nullptr);
    CHECK(replayed.find(b) != nullptr);

    checkAgainstGolden("two-notes", f);
}
