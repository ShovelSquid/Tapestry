// rope_chain_test.cpp — mathspace against ddsim on ddsim's own rope-chain
// golden (tests/golden/rope-chain.actions): an anchor and two mass-1 links
// on rods of rest length 2 under DD_GRAVITY_Y_PER_TICK, 600 ticks. The
// ddsim side replays the fixture bytes through ddsim::Sim and is checked
// against the committed .sha256, so it is the real golden; the mathspace
// side is the same chain as notes (k = chain index, `pinned` for the
// static anchor) with one pair rod rule selecting neighbours and one
// gravity rule reading its own `g` field (1/200 is not on the Q32.32
// grid, so it cannot be a literal). Positions are compared per checkpoint
// within a stated tolerance, never the hash: the walks differ, and so do
// the solvers in one respect that this test measures (Decisions in
// autonomy/STATE.md): ddsim corrects both ends of a rod in one visit,
// mathspace one end per ordered visit, so a free-free rod keeps 2^-8 of
// its stretch after the four passes where ddsim keeps none. This
// deviation over a double pendulum is what phase 7 (folding ddsim in)
// has to close or accept; the tolerance below records where it stands.
#include <doctest.h>

#include <string>

#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "fixture.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"
#include "mathspace/world.hpp"

using namespace mathspace;
using mathspace_test::Fixture;
using mathspace_test::GoldenLine;

namespace {

std::vector<std::uint8_t> rule_code(const World& w, NoteId rule, const char* text) {
    const expr::ParseResult p = expr::parse(text);
    REQUIRE_MESSAGE(p.ok(), text << ": " << expr::parse_error_name(p.error));
    const expr::CompileResult c = expr::compile(p.ast, expr::RuleDims{w, *w.find(rule)});
    REQUIRE_MESSAGE(c.ok(), text << ": " << expr::compile_error_name(c.error));
    return expr::encode(c.program);
}

Field scalar_raw(std::string_view name, std::int64_t raw) {
    Field f;
    f.name = std::string(name);
    f.value[0] = fx64::from_raw(raw);
    return f;
}

Field vec2(std::string_view name, fx64 x, fx64 y) {
    Field f;
    f.name = std::string(name);
    f.dim = 2;
    f.value[0] = x;
    f.value[1] = y;
    return f;
}

std::string ddsimPath(const char* file) { return std::string(MATHSPACE_GOLDEN_DIR) + "/../" + file; }

fx64 abs_fx(fx64 v) { return v.raw < 0 ? fx64::from_raw(-v.raw) : v; }

// Replays ddsim fixture `name` (a chain: particle i+1 linked to i by a
// rest-2 rigid constraint) through both engines and checks each
// checkpoint's positions agree within tolerances[checkpoint] raw units,
// printing the worst deviation per checkpoint.
void compare_chain(const char* name, const std::vector<std::int64_t>& tolerances) {
    const std::string text = mathspace_test::readFile(ddsimPath((std::string(name) + ".actions").c_str()));
    REQUIRE_MESSAGE(!text.empty(), name);
    Fixture f;
    REQUIRE(mathspace_test::parseActions(text, f));
    std::vector<GoldenLine> golden;
    REQUIRE(mathspace_test::parseSha256(
        mathspace_test::readFile(ddsimPath((std::string(name) + ".sha256").c_str())), golden));
    REQUIRE(golden.size() == f.checkpoints.size());
    REQUIRE(tolerances.size() == f.checkpoints.size());

    // ddsim: the fixture as committed, every action at tick 0.
    ddsim::Sim sim(f.seed);
    for (const auto& a : f.actions) {
        REQUIRE(a.tick == 0);
        REQUIRE(sim.apply(a.bytes.data(), static_cast<std::uint32_t>(a.bytes.size())) == 0);
    }
    const std::vector<ddsim::Particle>& particles = sim.state().particles;
    REQUIRE(particles.size() >= 2);

    // mathspace: the same chain. Space 1; notes 2, 3, 4 with k 0, 1, 2;
    // rule 5 is the rod between neighbours, rule 6 is gravity.
    const NoteId space{1};
    const NoteId rod{5};
    const NoteId gravity{6};
    World w(f.seed);
    REQUIRE(w.create_space(space, 2) == Error::Ok);
    for (std::size_t i = 0; i < particles.size(); ++i) {
        const ddsim::Particle& p = particles[i];
        const NoteId id{2 + i};
        REQUIRE(w.create_note(id, space_of(space), NoteKind::Note) == Error::Ok);
        REQUIRE(w.set_field(id, vec2(POS_FIELD, p.x, p.y)) == Error::Ok);
        REQUIRE(w.set_field(id, vec2(VELOCITY_FIELD, p.vx, p.vy)) == Error::Ok);
        REQUIRE(w.set_field(id, scalar_raw(MASS_FIELD, p.is_static ? fx64::ONE : p.mass.raw)) == Error::Ok);
        REQUIRE(w.set_field(id, scalar_raw(PINNED_FIELD, p.is_static ? fx64::ONE : 0)) == Error::Ok);
        REQUIRE(w.set_field(id, scalar_raw("k", fx64::from_int(static_cast<std::int32_t>(i)).raw)) == Error::Ok);
    }
    const std::vector<ddsim::Constraint>& constraints = sim.state().constraints;
    REQUIRE(constraints.size() == particles.size() - 1);
    for (const ddsim::Constraint& c : constraints) {
        CHECK(c.rest_length == fx64::from_int(2));
        CHECK(c.stiffness == fx64::from_int(1));
        CHECK(c.particle_b == c.particle_a + 1);
    }
    REQUIRE(w.create_note(rod, space_of(space), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(rod, scalar_raw(SCOPE_FIELD, fx64::ONE)) == Error::Ok);
    REQUIRE(w.bind_field(rod, SELECT_FIELD, rule_code(w, rod, "abs(other.k - self.k) == 1")) == Error::Ok);
    REQUIRE(w.bind_field(rod, CONSTRAINT_FIELD, rule_code(w, rod, "norm(other.pos - self.pos) - 2")) == Error::Ok);
    REQUIRE(w.create_note(gravity, space_of(space), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(gravity, scalar_raw("g", ddsim::DD_GRAVITY_Y_PER_TICK.raw)) == Error::Ok);
    REQUIRE(w.bind_field(gravity, FORCE_FIELD, rule_code(w, gravity, "[0, node(n6).g * self.mass]")) == Error::Ok);

    std::size_t next = 0;
    const std::uint64_t last = f.checkpoints.back();
    for (std::uint64_t t = 0; t <= last; ++t) {
        if (next < f.checkpoints.size() && f.checkpoints[next] == t) {
            std::uint8_t digest[32];
            sim.hash(digest);
            CHECK_MESSAGE(mathspace_test::hex(digest) == golden[next].hex, "ddsim tick " << t);
            CHECK(golden[next].tick == t);
            const fx64 tolerance = fx64::from_raw(tolerances[next]);
            fx64 worst{};
            for (std::size_t i = 0; i < particles.size(); ++i) {
                const Field& pos = *find_field(*w.find(NoteId{2 + i}), POS_FIELD);
                const fx64 dx = abs_fx(pos.value[0] - particles[i].x);
                const fx64 dy = abs_fx(pos.value[1] - particles[i].y);
                if (dx > worst) worst = dx;
                if (dy > worst) worst = dy;
                CHECK_MESSAGE(dx <= tolerance, "tick " << t << " particle " << i << " dx raw " << dx.raw);
                CHECK_MESSAGE(dy <= tolerance, "tick " << t << " particle " << i << " dy raw " << dy.raw);
            }
            MESSAGE(std::string(name) << " tick " << t << " worst deviation raw " << worst.raw << " ("
                                      << expr::to_decimal(worst.raw) << ")");
            ++next;
        }
        sim.step();
        w.step();
        REQUIRE(w.reports.empty());
    }
    REQUIRE(next == f.checkpoints.size());
    CHECK(w.tick == last + 1);
}

} // namespace

// The single pendulum: the anchor is pinned, so the bob's one visit is
// ddsim's correction exactly and what remains is fx64 rounding along two
// different op sequences (ddsim's (len - rest) / len against the symbolic
// gradient's dot(d, dd) / norm(d) and the |g|^2 denominator).
TEST_CASE("pendulum: mathspace's rod rule matches ddsim's solver to rounding") {
    compare_chain("pendulum", {0, 1 << 8, 1 << 16, 1 << 18, 1 << 20});
}

// The double pendulum is chaotic: the free-free rod's 2^-8 residual (see
// the header) is amplified from 2^-19 at tick 1 to about 0.45 by tick 60,
// 0.97 by 300 and 1.44 by 600 on rods of length 2 (measured at ms4).
// The bounds are those numbers with headroom, a characterisation, not a
// promise; the numbers are what phase 7 has to close or accept.
TEST_CASE("rope-chain: mathspace's rod rule tracks ddsim's solver, diverging as a double pendulum does") {
    compare_chain("rope-chain", {0, 1 << 14, fx64::ONE / 2, fx64::ONE + fx64::ONE / 8, fx64::ONE * 3 / 2});
}

