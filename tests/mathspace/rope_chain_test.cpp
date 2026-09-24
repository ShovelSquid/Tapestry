// rope_chain_test.cpp — the pendulum and rope-chain regressions, once a
// comparison against ddsim's particle solver on its own goldens and, since
// plan phase 7 deleted that solver (7f), a plain record of what mathspace
// computes for the same two chains: an anchor and one or two mass-1 links
// on rods of rest length 2 under ddsim's gravity (-1/200 per tick, not on
// the Q32.32 grid, so it is a field, never a literal), 600 ticks, one pair
// rod rule selecting neighbours and one gravity rule.
//
// The raw positions below are exact: a change in any of them means step()
// changed for a chain, which is a MS_STEP_VERSION bump or a bug. ddsim's
// positions are recorded beside them (from tests/golden/pendulum.sha256
// and rope-chain.sha256 at commit f74d0db) with the tolerance the old
// comparison used, so the accepted deviation (STATE.md, Decisions: ddsim
// corrected both ends of a rod per visit, mathspace one end per ordered
// visit, so a free-free rod keeps 2^-8 of its stretch and the double
// pendulum's chaos amplifies it) stays measurable without ddsim.
#include <doctest.h>

#include <cstdint>
#include <string>
#include <vector>

#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"
#include "mathspace/world.hpp"

using namespace mathspace;

namespace {

constexpr std::int64_t GRAVITY_PER_TICK_RAW = -(fx64::ONE / 200);

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

fx64 abs_fx(fx64 v) { return v.raw < 0 ? fx64::from_raw(-v.raw) : v; }

struct Checkpoint {
    std::uint64_t tick;
    std::int64_t tolerance;                      // raw, against ddsim
    std::vector<std::int64_t> mathspace;         // x0 y0 x1 y1 ... raw, exact
    std::vector<std::int64_t> ddsim;             // the deleted solver's, for the deviation
};

// A chain of `links` + 1 particles: the anchor pinned at the origin, link i
// at (2 i, 0), each joined to the previous by a rest-2 rod. Note 2 + i is
// particle i with k = i; rule 5 is the rod, rule 6 gravity.
void check_chain(const char* name, std::size_t links, const std::vector<Checkpoint>& checkpoints) {
    const std::size_t count = links + 1;
    const NoteId space{1};
    const NoteId rod{5};
    const NoteId gravity{6};
    World w(1);
    REQUIRE(w.create_space(space, 2) == Error::Ok);
    for (std::size_t i = 0; i < count; ++i) {
        const NoteId id{2 + i};
        REQUIRE(w.create_note(id, space_of(space), NoteKind::Note) == Error::Ok);
        REQUIRE(w.set_field(id, vec2(POS_FIELD, fx64::from_int(static_cast<std::int32_t>(2 * i)), fx64{})) == Error::Ok);
        REQUIRE(w.set_field(id, vec2(VELOCITY_FIELD, fx64{}, fx64{})) == Error::Ok);
        REQUIRE(w.set_field(id, scalar_raw(MASS_FIELD, fx64::ONE)) == Error::Ok);
        REQUIRE(w.set_field(id, scalar_raw(PINNED_FIELD, i == 0 ? fx64::ONE : 0)) == Error::Ok);
        REQUIRE(w.set_field(id, scalar_raw("k", fx64::from_int(static_cast<std::int32_t>(i)).raw)) == Error::Ok);
    }
    REQUIRE(w.create_note(rod, space_of(space), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(rod, scalar_raw(SCOPE_FIELD, fx64::ONE)) == Error::Ok);
    REQUIRE(w.bind_field(rod, SELECT_FIELD, rule_code(w, rod, "abs(other.k - self.k) == 1")) == Error::Ok);
    REQUIRE(w.bind_field(rod, CONSTRAINT_FIELD, rule_code(w, rod, "norm(other.pos - self.pos) - 2")) == Error::Ok);
    REQUIRE(w.create_note(gravity, space_of(space), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(gravity, scalar_raw("g", GRAVITY_PER_TICK_RAW)) == Error::Ok);
    REQUIRE(w.bind_field(gravity, FORCE_FIELD, rule_code(w, gravity, "[0, node(n6).g * self.mass]")) == Error::Ok);

    std::size_t next = 0;
    const std::uint64_t last = checkpoints.back().tick;
    for (std::uint64_t t = 0; t <= last; ++t) {
        if (next < checkpoints.size() && checkpoints[next].tick == t) {
            const Checkpoint& c = checkpoints[next];
            REQUIRE(c.mathspace.size() == 2 * count);
            REQUIRE(c.ddsim.size() == 2 * count);
            fx64 worst{};
            for (std::size_t i = 0; i < count; ++i) {
                const Field& pos = *find_field(*w.find(NoteId{2 + i}), POS_FIELD);
                CHECK_MESSAGE(pos.value[0].raw == c.mathspace[2 * i], name << " tick " << t << " particle " << i << " x");
                CHECK_MESSAGE(pos.value[1].raw == c.mathspace[2 * i + 1], name << " tick " << t << " particle " << i << " y");
                const fx64 dx = abs_fx(pos.value[0] - fx64::from_raw(c.ddsim[2 * i]));
                const fx64 dy = abs_fx(pos.value[1] - fx64::from_raw(c.ddsim[2 * i + 1]));
                if (dx > worst) worst = dx;
                if (dy > worst) worst = dy;
            }
            CHECK_MESSAGE(worst.raw <= c.tolerance, name << " tick " << t << " worst deviation from ddsim raw " << worst.raw);
            MESSAGE(std::string(name) << " tick " << t << " worst deviation from ddsim raw " << worst.raw << " ("
                                      << expr::to_decimal(worst.raw) << ")");
            ++next;
        }
        w.step();
        REQUIRE(w.reports.empty());
    }
    REQUIRE(next == checkpoints.size());
    CHECK(w.tick == last + 1);
}

} // namespace

// The single pendulum: the anchor is pinned, so the bob's one visit is
// ddsim's correction exactly and what remains is fx64 rounding along two
// different op sequences (ddsim's (len - rest) / len against the symbolic
// gradient's dot(d, dd) / norm(d) and the |g|^2 denominator).
TEST_CASE("pendulum: the rod rule's positions are exact and within rounding of ddsim's solver") {
    check_chain("pendulum", 1,
                {{0, 0, {0, 0, 8589934592, 0}, {0, 0, 8589934592, 0}},
                 {1, 1 << 8, {0, 0, 8589907748, -21474772}, {0, 0, 8589907750, -21474768}},
                 {60, 1 << 16, {0, 0, -7723668047, -3759245699}, {0, 0, -7723667521, -3759246779}},
                 {300, 1 << 18, {0, 0, 2442197543, -8235450654}, {0, 0, 2442200695, -8235449720}},
                 {600, 1 << 20, {0, 0, -4062311315, -7568659266}, {0, 0, -4062311534, -7568659149}}});
}

// The double pendulum is chaotic: the free-free rod's 2^-8 residual (see
// the header) is amplified from 2^-19 at tick 1 to about 0.45 by tick 60,
// 0.97 by 300 and 1.44 by 600 on rods of length 2 (measured at ms4). The
// bounds are those numbers with headroom, a characterisation of the
// accepted deviation, not a promise.
TEST_CASE("rope-chain: the rod rule's positions are exact, diverging from ddsim's as a double pendulum does") {
    check_chain("rope-chain", 2,
                {{0, 0, {0, 0, 8589934592, 0, 17179869184, 0}, {0, 0, 8589934592, 0, 17179869184, 0}},
                 {1, 1 << 14, {0, 0, 8589913411, -21474697, 17179850834, -21474836},
                  {0, 0, 8589909428, -21474712, 17179844023, -21474832}},
                 {60, fx64::ONE / 2, {0, 0, -4041944654, -7598335740, -7603105141, -15424435680},
                  {0, 0, -3522332996, -7836820355, -9538767176, -13967847680}},
                 {300, fx64::ONE + fx64::ONE / 8, {0, 0, -3633540360, -7786704073, -10792952153, -12536247014},
                  {0, 0, -2267576016, -8287184842, -6642178694, -15679737019}},
                 {600, fx64::ONE * 3 / 2, {0, 0, -2188822470, -8315333268, -4022560148, -16711689499},
                  {0, 0, -4479362266, -7330878109, -10209798307, -13730024853}}});
}
