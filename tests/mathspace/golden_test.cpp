// golden_test.cpp — the committed fixtures under tests/golden/ms are honest:
// their hand-written hex equals what the encoders produce, replaying them
// in-process reproduces the committed .sha256 lines, and a replayed world
// equals the world built by direct calls. ms_replay and two_process.cmake
// check the same fixtures across processes and across build types.
#include <doctest.h>

#include "fixture.hpp"
#include "mathspace/action.hpp"
#include "mathspace/world.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"

#include <cstdlib>

#include <string>
#include <vector>

using namespace mathspace;
using namespace mathspace_test;

namespace {

// The encoded program for `text` compiled on `self` in `w`; the tests
// need real bytecode now that set_field validates it.
std::vector<std::uint8_t> code_for(const World& w, NoteId self, const char* text) {
    const expr::ParseResult p = expr::parse(text);
    REQUIRE_MESSAGE(p.ok(), text << ": " << expr::parse_error_name(p.error));
    const expr::CompileResult c = expr::compile(p.ast, expr::WorldDims{w, *w.find(self)});
    REQUIRE_MESSAGE(c.ok(), text << ": " << expr::compile_error_name(c.error));
    return expr::encode(c.program);
}

// The same for a program on a Rule note, compiled for its targets.
std::vector<std::uint8_t> rule_code_for(const World& w, NoteId rule, const char* text) {
    const expr::ParseResult p = expr::parse(text);
    REQUIRE_MESSAGE(p.ok(), text << ": " << expr::parse_error_name(p.error));
    const expr::CompileResult c = expr::compile(p.ast, expr::RuleDims{w, *w.find(rule)});
    REQUIRE_MESSAGE(c.ok(), text << ": " << expr::compile_error_name(c.error));
    return expr::encode(c.program);
}

// A fixture whose actions carry bytecode is generated, not hand-written:
// each action is applied to a World as it is produced, because the
// programs compile against the dims of the fields that exist at that
// point. The test compares the committed text byte for byte; run with
// MS_WRITE_FIXTURES=1 to rewrite it (then re-record the .sha256 with
// ms_replay --write-golden).
std::string fixtureText(const char* header, const std::vector<FixtureAction>& log, std::uint64_t seed,
                        const std::vector<std::uint64_t>& checkpoints) {
    std::string text = header;
    text += "seed " + std::to_string(seed) + "\n";
    for (const FixtureAction& a : log) {
        text += "action " + std::to_string(a.tick) + " " + hex(a.bytes) + "\n";
    }
    for (const std::uint64_t t : checkpoints) {
        text += "checkpoint " + std::to_string(t) + "\n";
    }
    return text;
}

void checkFixtureText(const char* name, const std::string& expected) {
    const std::string path = goldenPath(name, "actions");
    if (std::getenv("MS_WRITE_FIXTURES") != nullptr) {
        REQUIRE(writeFile(path, expected));
    }
    CHECK_MESSAGE(readFile(path) == expected,
                  name << ".actions differs from its generator; rerun with MS_WRITE_FIXTURES=1");
}

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

Field vec2(std::string_view name, std::int32_t x, std::int32_t y) {
    Field f;
    f.name = std::string(name);
    f.dim = 2;
    f.value[0] = fx64::from_int(x);
    f.value[1] = fx64::from_int(y);
    return f;
}

Field pos2(std::int32_t x, std::int32_t y) { return vec2(POS_FIELD, x, y); }

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
    const NoteId space{1};
    const NoteId a{2};
    const NoteId b{3};
    struct Stamped {
        std::uint64_t tick;
        std::vector<std::uint8_t> bytes;
    };
    const std::vector<Stamped> log = {
        {0, encode_create_space(space, 2)},
        {0, encode_create_note(a, space_of(space), NoteKind::Note)},
        {0, encode_set_field(a, pos2(1, 2))},
        {1, encode_create_note(b, space_of(space), NoteKind::Note)},
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
    const NoteId space{1}, a{2}, b{3};
    REQUIRE(direct.create_space(space, 2) == Error::Ok);
    REQUIRE(direct.create_note(a, space_of(space), NoteKind::Note) == Error::Ok);
    REQUIRE(direct.set_field(a, pos2(1, 2)) == Error::Ok);
    direct.step();
    REQUIRE(direct.create_note(b, space_of(space), NoteKind::Note) == Error::Ok);
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

TEST_CASE("golden velocity: hand-written hex equals the encoders, pos integrates") {
    const Fixture f = load("velocity");
    CHECK(f.seed == 1);
    const NoteId space{1};
    const NoteId a{2};
    const std::vector<std::vector<std::uint8_t>> log = {
        encode_create_space(space, 2),
        encode_create_note(a, space_of(space), NoteKind::Note),
        encode_set_field(a, pos2(0, 0)),
        encode_set_field(a, vec2(VELOCITY_FIELD, 1, 2)),
    };
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == 0);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i]), "action " << i);
    }
    CHECK(f.checkpoints == std::vector<std::uint64_t>{0, 1, 10, 60});

    World w(f.seed);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        const Field* pos = find_field(*at.find(a), POS_FIELD);
        REQUIRE(pos != nullptr);
        CHECK(pos->value[0] == fx64::from_int(static_cast<std::int32_t>(tick)));
        CHECK(pos->value[1] == fx64::from_int(static_cast<std::int32_t>(2 * tick)));
    }));
    checkAgainstGolden("velocity", f);
}

namespace {

// The plot fixture, built by applying each action to a World as it is
// generated, because the expressions compile against the dims of the
// fields that exist at that point. Returned with the ticks so the
// committed text can be checked byte for byte, or regenerated: run the
// tests with MS_WRITE_FIXTURES=1 and this test rewrites plot.actions
// (then re-record plot.sha256 with ms_replay --write-golden).
std::vector<FixtureAction> plotLog() {
    const NoteId space{1};
    const NoteId a{2};
    const NoteId b{3};
    World w(1);
    std::vector<FixtureAction> log;
    auto add = [&](std::uint64_t tick, std::vector<std::uint8_t> bytes) {
        REQUIRE(w.apply(bytes) == Error::Ok);
        log.push_back(FixtureAction{tick, std::move(bytes)});
    };
    auto bind = [&](std::uint64_t tick, NoteId note, const char* name, const char* text) {
        add(tick, encode_bind_field(note, name, code_for(w, note, text)));
    };
    add(0, encode_create_space(space, 2));
    add(0, encode_create_note(a, space_of(space), NoteKind::Note));
    add(0, encode_set_field(a, pos2(0, 0)));
    add(0, encode_set_field(a, vec2(VELOCITY_FIELD, 1, 0)));
    add(0, encode_create_note(b, space_of(space), NoteKind::Note));
    add(0, encode_set_field(b, pos2(3, 4)));
    bind(0, a, "s", "sin(self.pos.x / 4)");
    bind(0, a, "d", "norm(self.pos - node(n3).pos)");
    bind(0, a, "c", "curve([0, 1, 0], world.tick / 8)");
    bind(0, a, "k", "if self.pos.x > 3 then [1, 2] * self.pos.x else -self.pos");
    bind(0, b, "t", "world.tick + space.dim");
    bind(0, b, "e", "exp(0 - self.t) + log(max(self.t, 1))");
    add(3, encode_bind_field(a, "c", {}));
    bind(5, a, "s", "pow(self.pos.x, 0.5) + atan2(self.pos.y, self.pos.x)");
    return log;
}

std::string plotText(const std::vector<FixtureAction>& log) {
    return fixtureText(
        "# plot — phase 2 bound fields: a 2-space (id 1), note 2 at (0, 0) with\n"
        "# velocity (1, 0), note 3 at (3, 4). Note 2 binds s (sin), d (norm to\n"
        "# note 3), c (curve over the tick, unbound at tick 3), k (an if over\n"
        "# vectors); note 3 binds t (tick + space.dim) and e (exp, log, max of\n"
        "# its own t). s is rebound at tick 5 (pow, atan2). Generated by\n"
        "# golden_test.cpp's plotLog (MS_WRITE_FIXTURES=1 rewrites this file).\n",
        log, 1, {0, 1, 4, 8});
}

} // namespace

TEST_CASE("golden plot: fixture equals the generator, bound fields evaluate") {
    const std::vector<FixtureAction> log = plotLog();
    checkFixtureText("plot", plotText(log));
    const Fixture f = load("plot");
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    CHECK(f.checkpoints == std::vector<std::uint64_t>{0, 1, 4, 8});

    const NoteId a{2};
    const NoteId b{3};
    World w(f.seed);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        // At checkpoint t: pos.x == t, and the bound lanes are from the
        // step that ended tick t - 1 (all zero at t == 0).
        const Note& na = *at.find(a);
        const Note& nb = *at.find(b);
        const Field& d = *find_field(na, "d");
        const Field& c = *find_field(na, "c");
        const Field& k = *find_field(na, "k");
        const Field& t = *find_field(nb, "t");
        CHECK(find_field(na, POS_FIELD)->value[0] == fx64::from_int(static_cast<std::int32_t>(tick)));
        if (tick == 0) {
            CHECK(d.value[0].raw == 0);
            CHECK(k.value[0].raw == 0);
            return;
        }
        const std::int32_t dx = static_cast<std::int32_t>(tick) - 3;
        CHECK(d.value[0] == ddsim::sqrt(fx64::from_int(dx * dx + 16)));
        CHECK(t.value[0] == fx64::from_int(static_cast<std::int32_t>(tick - 1 + 2)));
        if (tick == 1) {
            CHECK(k.value[0] == fx64::from_int(-1)); // -pos
            CHECK(k.value[1].raw == 0);
            CHECK(c.value[0].raw == 0); // curve([0, 1, 0], 0 / 8)
            CHECK(c.bound);
        } else {
            CHECK(k.value[0] == fx64::from_int(static_cast<std::int32_t>(tick)));
            CHECK(k.value[1] == fx64::from_int(static_cast<std::int32_t>(2 * tick)));
            // Unbound at tick 3: holds the value from the step of tick 2.
            CHECK(c.value[0] == fx64::from_raw(fx64::ONE / 2));
            CHECK_FALSE(c.bound);
        }
    }));
    checkAgainstGolden("plot", f);
}

namespace {

// The gravity fixture (phase 3): two unary force rules over two notes.
// Rule 4 is weight, `[0, 0 - self.mass]`; note 3 has no mass, so the rule
// skips it every tick. Rule 5 pushes everything by `[1, 0]`. Note 2 has
// mass 2 and starts at rest at (0, 0); note 3 has the default mass 1 and
// starts at (10, 0) with velocity (1, 0). Rule 6 is a pair rule with a
// force, skipped in this phase. Rule 7 lifts by `[0, 1]` whatever
// `self.pos.x >= 20` selects: note 3 from the step of tick 4 (x 24),
// never note 2 (x 17 at tick 10).
std::vector<FixtureAction> gravityLog() {
    const NoteId space{1};
    const NoteId a{2};
    const NoteId b{3};
    const NoteId weight{4};
    const NoteId push{5};
    const NoteId lift{7};
    const NoteId heat{8};
    World w(3);
    std::vector<FixtureAction> log;
    auto add = [&](std::uint64_t tick, std::vector<std::uint8_t> bytes) {
        REQUIRE(w.apply(bytes) == Error::Ok);
        log.push_back(FixtureAction{tick, std::move(bytes)});
    };
    add(0, encode_create_space(space, 2));
    add(0, encode_create_note(a, space_of(space), NoteKind::Note));
    add(0, encode_set_field(a, pos2(0, 0)));
    add(0, encode_set_field(a, vec2(VELOCITY_FIELD, 0, 0)));
    Field mass;
    mass.name = std::string(MASS_FIELD);
    mass.value[0] = fx64::from_int(2);
    add(0, encode_set_field(a, mass));
    Field warmth;
    warmth.name = "heat";
    add(0, encode_set_field(a, warmth));
    add(0, encode_create_note(b, space_of(space), NoteKind::Note));
    add(0, encode_set_field(b, pos2(10, 0)));
    add(0, encode_set_field(b, vec2(VELOCITY_FIELD, 1, 0)));
    add(0, encode_create_note(weight, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(weight, FORCE_FIELD, rule_code_for(w, weight, "[0, 0 - self.mass]")));
    add(0, encode_create_note(push, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(push, FORCE_FIELD, rule_code_for(w, push, "[1, 0]")));
    add(0, encode_create_note(lift, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(lift, SELECT_FIELD, rule_code_for(w, lift, "self.pos.x >= 20")));
    add(0, encode_bind_field(lift, FORCE_FIELD, rule_code_for(w, lift, "[0, 1]")));
    add(0, encode_create_note(heat, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(heat, "set.heat", rule_code_for(w, heat, "self.pos.x * 2")));
    // The push stops at tick 4: its force is unbound.
    add(4, encode_bind_field(push, FORCE_FIELD, {}));
    return log;
}

Field scalar(std::string_view name, std::int32_t v) {
    Field f;
    f.name = std::string(name);
    f.value[0] = fx64::from_int(v);
    return f;
}

// Phase 3 pair and global scope: a unit spring between two unit masses
// (period 4 with h = 1: the ends swap, rest, swap back, rest), a pinned
// third body the spring's select excludes as `other`, and a global rule
// that counts ticks into its own field.
std::vector<FixtureAction> pairLog() {
    const NoteId space{1};
    const NoteId a{2};
    const NoteId b{3};
    const NoteId c{4};
    const NoteId spring{5};
    const NoteId clock{6};
    World w(5);
    std::vector<FixtureAction> log;
    auto add = [&](std::uint64_t tick, std::vector<std::uint8_t> bytes) {
        REQUIRE(w.apply(bytes) == Error::Ok);
        log.push_back(FixtureAction{tick, std::move(bytes)});
    };
    add(0, encode_create_space(space, 2));
    for (const auto& [id, x, y, pinned] : {std::tuple{a, 0, 0, 0}, std::tuple{b, 10, 0, 0}, std::tuple{c, 0, 7, 1}}) {
        add(0, encode_create_note(id, space_of(space), NoteKind::Note));
        add(0, encode_set_field(id, pos2(x, y)));
        add(0, encode_set_field(id, vec2(VELOCITY_FIELD, 0, 0)));
        add(0, encode_set_field(id, scalar(PINNED_FIELD, pinned)));
    }
    add(0, encode_create_note(spring, space_of(space), NoteKind::Rule));
    add(0, encode_set_field(spring, scalar(SCOPE_FIELD, 1)));
    add(0, encode_bind_field(spring, SELECT_FIELD, rule_code_for(w, spring, "other.pinned == 0")));
    add(0, encode_bind_field(spring, FORCE_FIELD, rule_code_for(w, spring, "other.pos - self.pos")));
    add(0, encode_create_note(clock, space_of(space), NoteKind::Rule));
    add(0, encode_set_field(clock, scalar(SCOPE_FIELD, 2)));
    add(0, encode_set_field(clock, scalar("count", 0)));
    add(0, encode_bind_field(clock, "set.count", rule_code_for(w, clock, "world.tick + 1")));
    return log;
}

} // namespace

TEST_CASE("golden pair: fixture equals the generator, ordered pairs and a global set") {
    const std::vector<FixtureAction> log = pairLog();
    checkFixtureText("pair",
                     fixtureText("# pair — phase 3 pair and global scope: a 2-space (id 1), notes 2 at (0, 0)\n"
                                 "# and 3 at (10, 0) at rest, note 4 pinned at (0, 7). Rule 5 is a pair spring\n"
                                 "# other.pos - self.pos selecting other.pinned == 0 (the ends swap every other\n"
                                 "# tick, period 4; note 4 collects force but is held). Rule 6 is global and\n"
                                 "# sets its own count = world.tick + 1. Generated by golden_test.cpp's\n"
                                 "# pairLog (MS_WRITE_FIXTURES=1 rewrites this file).\n",
                                 log, 5, {0, 1, 2, 3, 4, 8}));
    const Fixture f = load("pair");
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    World w(f.seed);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        const std::int64_t t = static_cast<std::int64_t>(tick);
        const Field& pa = *find_field(*at.find(NoteId{2}), POS_FIELD);
        const Field& pb = *find_field(*at.find(NoteId{3}), POS_FIELD);
        const Field& pc = *find_field(*at.find(NoteId{4}), POS_FIELD);
        const Field& vc = *find_field(*at.find(NoteId{4}), VELOCITY_FIELD);
        const bool swapped = (t % 4) == 1 || (t % 4) == 2;
        CHECK(pa.value[0] == fx64::from_int(swapped ? 10 : 0));
        CHECK(pb.value[0] == fx64::from_int(swapped ? 0 : 10));
        CHECK(pa.value[1] == fx64{});
        CHECK(pb.value[1] == fx64{});
        CHECK(pc.value[0] == fx64{});
        CHECK(pc.value[1] == fx64::from_int(7));
        CHECK(vc.value[0] == fx64{});
        CHECK(find_field(*at.find(NoteId{6}), "count")->value[0] == fx64::from_int(static_cast<std::int32_t>(t)));
    }));
    checkAgainstGolden("pair", f);
}

// Phase 4 constraints: a pendulum. Note 2 is pinned at the origin, note 3
// hangs at (10, 0) at rest with mass 1; rule 4 is a pair rod
// `norm(other.pos - self.pos) - 10`, rule 5 is weight `[0, 1]` (y grows
// down the screen). The bob swings under the rod for 60 ticks.
std::vector<FixtureAction> rodLog() {
    const NoteId space{1};
    const NoteId anchor{2};
    const NoteId bob{3};
    const NoteId rod{4};
    const NoteId weight{5};
    World w(7);
    std::vector<FixtureAction> log;
    auto add = [&](std::uint64_t tick, std::vector<std::uint8_t> bytes) {
        REQUIRE(w.apply(bytes) == Error::Ok);
        log.push_back(FixtureAction{tick, std::move(bytes)});
    };
    add(0, encode_create_space(space, 2));
    add(0, encode_create_note(anchor, space_of(space), NoteKind::Note));
    add(0, encode_set_field(anchor, pos2(0, 0)));
    add(0, encode_set_field(anchor, vec2(VELOCITY_FIELD, 0, 0)));
    add(0, encode_set_field(anchor, scalar(PINNED_FIELD, 1)));
    add(0, encode_create_note(bob, space_of(space), NoteKind::Note));
    add(0, encode_set_field(bob, pos2(10, 0)));
    add(0, encode_set_field(bob, vec2(VELOCITY_FIELD, 0, 0)));
    add(0, encode_set_field(bob, scalar(MASS_FIELD, 1)));
    add(0, encode_create_note(rod, space_of(space), NoteKind::Rule));
    add(0, encode_set_field(rod, scalar(SCOPE_FIELD, 1)));
    add(0, encode_bind_field(rod, CONSTRAINT_FIELD, rule_code_for(w, rod, "norm(other.pos - self.pos) - 10")));
    add(0, encode_create_note(weight, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(weight, FORCE_FIELD, rule_code_for(w, weight, "[0, 1]")));
    return log;
}

TEST_CASE("golden rod: fixture equals the generator, the bob stays on the rod") {
    const std::vector<FixtureAction> log = rodLog();
    checkFixtureText("rod",
                     fixtureText("# rod — phase 4 constraints: a 2-space (id 1), note 2 pinned at (0, 0),\n"
                                 "# note 3 at (10, 0) at rest with mass 1. Rule 4 is a pair rod\n"
                                 "# norm(other.pos - self.pos) - 10, rule 5 is weight [0, 1]: the bob swings\n"
                                 "# as a pendulum, the rod length held by MS_CONSTRAINT_ITERATIONS XPBD\n"
                                 "# passes. Generated by golden_test.cpp's rodLog (MS_WRITE_FIXTURES=1\n"
                                 "# rewrites this file).\n",
                                 log, 7, {0, 1, 2, 10, 30, 60}));
    const Fixture f = load("rod");
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    World w(f.seed);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        const Field& pa = *find_field(*at.find(NoteId{2}), POS_FIELD);
        const Field& pb = *find_field(*at.find(NoteId{3}), POS_FIELD);
        CHECK(pa.value[0] == fx64{});
        CHECK(pa.value[1] == fx64{});
        // The bob never leaves the rod by more than the last pass's residual
        // (the anchor is pinned, so one visit meets the rod exactly; the
        // integrator's step of at most one unit per tick is what is corrected).
        const fx64 len2 = pb.value[0] * pb.value[0] + pb.value[1] * pb.value[1];
        const bool on_rod = len2.raw >= 99 * fx64::ONE && len2.raw <= 101 * fx64::ONE;
        CHECK_MESSAGE(on_rod, "tick " << tick << " len2 " << len2.raw);
        if (tick > 0) {
            CHECK(pb.value[1] > fx64{}); // it has fallen, y grows down
        }
        if (tick == 30) {
            // A pendulum from horizontal: the bob has swung past the bottom.
            CHECK(pb.value[0] < fx64{});
        }
    }));
    checkAgainstGolden("rod", f);
}

// Phase 4 contacts: the `contact` preset in engine spelling. Note 2 is a
// ball at (10, 0) at rest with mass 1; rule 3 is weight `[0, 1]`, rule 4
// a round bumper `max(0, 60 - norm(self.pos - [0, 100]))`, rule 5 a
// floor `max(0, self.pos.y - 200)`. The ball falls onto the bumper,
// slides off and rests on the floor.
std::vector<FixtureAction> contactLog() {
    const NoteId space{1};
    const NoteId ball{2};
    const NoteId weight{3};
    const NoteId bumper{4};
    const NoteId floor{5};
    World w(9);
    std::vector<FixtureAction> log;
    auto add = [&](std::uint64_t tick, std::vector<std::uint8_t> bytes) {
        REQUIRE(w.apply(bytes) == Error::Ok);
        log.push_back(FixtureAction{tick, std::move(bytes)});
    };
    add(0, encode_create_space(space, 2));
    add(0, encode_create_note(ball, space_of(space), NoteKind::Note));
    add(0, encode_set_field(ball, pos2(10, 0)));
    add(0, encode_set_field(ball, vec2(VELOCITY_FIELD, 0, 0)));
    add(0, encode_set_field(ball, scalar(MASS_FIELD, 1)));
    add(0, encode_create_note(weight, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(weight, FORCE_FIELD, rule_code_for(w, weight, "[0, 1]")));
    add(0, encode_create_note(bumper, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(bumper, CONSTRAINT_FIELD, rule_code_for(w, bumper, "max(0, 60 - norm(self.pos - [0, 100]))")));
    add(0, encode_create_note(floor, space_of(space), NoteKind::Rule));
    add(0, encode_bind_field(floor, CONSTRAINT_FIELD, rule_code_for(w, floor, "max(0, self.pos.y - 200)")));
    return log;
}

TEST_CASE("golden contact: fixture equals the generator, the ball stays out of the shapes") {
    const std::vector<FixtureAction> log = contactLog();
    checkFixtureText("contact",
                     fixtureText("# contact — phase 4 contacts: a 2-space (id 1), note 2 a ball at (10, 0) at\n"
                                 "# rest with mass 1. Rule 3 is weight [0, 1], rule 4 a round bumper\n"
                                 "# max(0, 60 - norm(self.pos - [0, 100])), rule 5 a floor\n"
                                 "# max(0, self.pos.y - 200): the ball falls onto the bumper, slides off and\n"
                                 "# rests on the floor. Generated by golden_test.cpp's contactLog\n"
                                 "# (MS_WRITE_FIXTURES=1 rewrites this file).\n",
                                 log, 9, {0, 1, 10, 12, 30, 60, 120}));
    const Fixture f = load("contact");
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    World w(f.seed);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        const Field& p = *find_field(*at.find(NoteId{2}), POS_FIELD);
        const fx64 dx = p.value[0];
        const fx64 dy = p.value[1] - fx64::from_int(100);
        const fx64 r2 = dx * dx + dy * dy;
        // Never inside the bumper (r >= 60, r2 >= 3600) beyond a pass's residual,
        // never below the floor.
        const bool outside = r2.raw >= 3599 * fx64::ONE;
        CHECK_MESSAGE(outside, "tick " << tick << " r2 raw " << r2.raw);
        CHECK_MESSAGE(p.value[1].raw <= 200 * fx64::ONE + fx64::ONE / 1024, "tick " << tick << " y raw " << p.value[1].raw);
        if (tick == 12) {
            CHECK(r2.raw <= 3601 * fx64::ONE); // on the bumper
        }
        if (tick == 120) {
            CHECK(p.value[1].raw >= 199 * fx64::ONE); // at rest on the floor
            CHECK(p.value[0] > fx64::from_int(10));   // slid off to the side it started on
        }
        MESSAGE("contact tick " << tick << " x " << expr::to_decimal(p.value[0].raw) << " y "
                                << expr::to_decimal(p.value[1].raw));
    }));
    checkAgainstGolden("contact", f);
}

TEST_CASE("golden gravity: fixture equals the generator, forces integrate through mass") {
    const std::vector<FixtureAction> log = gravityLog();
    checkFixtureText("gravity",
                     fixtureText("# gravity — phase 3 unary force rules: a 2-space (id 1), note 2 at rest\n"
                                 "# with mass 2, note 3 at (10, 0) with velocity (1, 0) and no mass. Rule 4\n"
                                 "# is weight [0, -mass] (skips note 3), rule 5 pushes [1, 0] until it is\n"
                                 "# unbound at tick 4, rule 7 lifts [0, 1] where self.pos.x >= 20 (note 3\n"
                                 "# from tick 4), rule 8 sets\n"
                                 "# heat = 2 * pos.x on note 2 (note 3 has no heat). Generated by\n"
                                 "# golden_test.cpp's gravityLog (MS_WRITE_FIXTURES=1 rewrites this file).\n",
                                 log, 3, {0, 1, 2, 4, 10}));
    const Fixture f = load("gravity");
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    CHECK(f.checkpoints == std::vector<std::uint64_t>{0, 1, 2, 4, 10});

    const NoteId a{2};
    const NoteId b{3};
    World w(f.seed);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        const std::int64_t t = static_cast<std::int64_t>(tick);
        const std::int64_t pushed = t < 4 ? t : 4; // ticks the push acted (0..3)
        const Field& pa = *find_field(*at.find(a), POS_FIELD);
        const Field& va = *find_field(*at.find(a), VELOCITY_FIELD);
        const Field& pb = *find_field(*at.find(b), POS_FIELD);
        const Field& vb = *find_field(*at.find(b), VELOCITY_FIELD);
        // a: weight -2 / mass 2 = -1 per tick in y; push 1 / 2 in x while it lasts.
        CHECK(va.value[1] == fx64::from_int(static_cast<std::int32_t>(-t)));
        CHECK(pa.value[1] == fx64::from_int(static_cast<std::int32_t>(-t * (t + 1) / 2)));
        CHECK(va.value[0].raw == pushed * (fx64::ONE / 2));
        // x after tick k is the sum of the velocities so far.
        std::int64_t sumx = 0;
        for (std::int64_t k = 1; k <= t; ++k) {
            sumx += (k < 4 ? k : 4);
        }
        CHECK(pa.value[0].raw == sumx * (fx64::ONE / 2));
        // Rule 8 sets heat from this tick's integrated pos.
        const Field& ha = *find_field(*at.find(a), "heat");
        CHECK(ha.dim == 1);
        CHECK(ha.value[0].raw == sumx * fx64::ONE);
        CHECK(find_field(*at.find(b), "heat") == nullptr);
        // b: no mass, so no weight; velocity 1 + pushed in x, pos 10 + sum.
        CHECK(vb.value[0] == fx64::from_int(static_cast<std::int32_t>(1 + pushed)));
        CHECK(pb.value[0] == fx64::from_int(static_cast<std::int32_t>(10 + t + sumx)));
        // Lift selects b once x >= 20 (from the step of tick 4) and never a.
        const std::int64_t lifted = t > 4 ? t - 4 : 0;
        CHECK(vb.value[1] == fx64::from_int(static_cast<std::int32_t>(lifted)));
        CHECK(pb.value[1] == fx64::from_int(static_cast<std::int32_t>(lifted * (lifted + 1) / 2)));
    }));
    checkAgainstGolden("gravity", f);
}

// Phase 6 metric spaces: the Poincaré disk of chart radius 100 (the unit
// disk's metric 4 / (1 - |x|^2)^2 in x = pos / 100, the constant factor
// leaving the geodesics alone). Space 1 binds `metric` to that diagonal;
// note 2 starts at (30, 0) moving (0, 1), note 3 at (0, 60) moving
// (-1, 0). Each follows a geodesic: a circle arc that meets the rim at
// right angles, so r grows from a tangential start and the coordinate
// speed dies toward the rim, which is never reached.
std::vector<FixtureAction> poincareLog() {
    const NoteId space{1};
    const NoteId a{2};
    const NoteId b{3};
    World w(11);
    std::vector<FixtureAction> log;
    auto add = [&](std::uint64_t tick, std::vector<std::uint8_t> bytes) {
        REQUIRE(w.apply(bytes) == Error::Ok);
        log.push_back(FixtureAction{tick, std::move(bytes)});
    };
    add(0, encode_create_space(space, 2));
    add(0, encode_bind_field(space, METRIC_FIELD,
                             code_for(w, space, "4 / pow(1 - dot(self.pos, self.pos) / 10000, 2) * [1, 1]")));
    add(0, encode_create_note(a, space_of(space), NoteKind::Note));
    add(0, encode_set_field(a, pos2(30, 0)));
    add(0, encode_set_field(a, vec2(VELOCITY_FIELD, 0, 1)));
    add(0, encode_create_note(b, space_of(space), NoteKind::Note));
    add(0, encode_set_field(b, pos2(0, 60)));
    add(0, encode_set_field(b, vec2(VELOCITY_FIELD, -1, 0)));
    return log;
}

TEST_CASE("golden poincare: fixture equals the generator, geodesics bend outward and stay in the disk") {
    const std::vector<FixtureAction> log = poincareLog();
    checkFixtureText("poincare",
                     fixtureText("# poincare — phase 6 metric spaces: a 2-space (id 1) whose `metric` is the\n"
                                 "# Poincaré disk of chart radius 100, 4 / pow(1 - dot(self.pos, self.pos)\n"
                                 "# / 10000, 2) * [1, 1]. Note 2 starts at (30, 0) moving (0, 1), note 3 at\n"
                                 "# (0, 60) moving (-1, 0); each follows a geodesic arc toward the rim and\n"
                                 "# never reaches it. Generated by golden_test.cpp's poincareLog\n"
                                 "# (MS_WRITE_FIXTURES=1 rewrites this file).\n",
                                 log, 11, {0, 1, 2, 10, 30, 60, 120, 240}));
    const Fixture f = load("poincare");
    REQUIRE(f.actions.size() == log.size());
    for (std::size_t i = 0; i < log.size(); ++i) {
        CHECK(f.actions[i].tick == log[i].tick);
        CHECK_MESSAGE(hex(f.actions[i].bytes) == hex(log[i].bytes), "action " << i);
    }
    World w(f.seed);
    fx64 last_ra = fx64::from_int(30 * 30);
    fx64 last_rb = fx64::from_int(60 * 60);
    REQUIRE(replayFixture(f, w, [&](std::uint64_t tick, const World& at) {
        CHECK(at.reports.empty());
        const Field& pa = *find_field(*at.find(NoteId{2}), POS_FIELD);
        const Field& pb = *find_field(*at.find(NoteId{3}), POS_FIELD);
        const fx64 ra = pa.value[0] * pa.value[0] + pa.value[1] * pa.value[1];
        const fx64 rb = pb.value[0] * pb.value[0] + pb.value[1] * pb.value[1];
        // Inside the disk, and r never shrinks from a tangential start.
        CHECK_MESSAGE(ra.raw < 100 * 100 * fx64::ONE, "tick " << tick << " |a|^2 " << ra.raw);
        CHECK_MESSAGE(rb.raw < 100 * 100 * fx64::ONE, "tick " << tick << " |b|^2 " << rb.raw);
        CHECK_MESSAGE(ra >= last_ra, "tick " << tick);
        CHECK_MESSAGE(rb >= last_rb, "tick " << tick);
        last_ra = ra;
        last_rb = rb;
        if (tick > 0) {
            CHECK(pa.value[1] > fx64{});  // a has moved up
            CHECK(pb.value[0] < fx64{});  // b has moved left
        }
        if (tick >= 30) {
            // The arcs bend outward: a's x has grown past 30, b's y past 60.
            CHECK(pa.value[0] > fx64::from_int(30));
            CHECK(pb.value[1] > fx64::from_int(60));
        }
    }));
    checkAgainstGolden("poincare", f);
}
