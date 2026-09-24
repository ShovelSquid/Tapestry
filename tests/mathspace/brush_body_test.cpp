// brush_body_test.cpp — plan phase 7 (7b): the data-drawing brush body as a
// mathspace force rule, bit-equal to ddsim's.
//
// ddsim's body (transcribed in brush_reference.hpp since 7f deleted the
// original) is one semi-implicit Euler substep per sample,
//     a = k_t (target - x) - c_t v;  v += a h;  x += v h
// with k_t = 1 / mass and c_t = 2 zeta sqrt(k_t) = sqrt(k_t) (zeta = 0.5).
// A body note carrying `k` = k_t, `target`, `pos` and `velocity`, no
// `mass`, under the unary rule
//     force = self.k * (self.target - self.pos) - sqrt(self.k) * self.velocity
// integrates to the same raw bits every tick: the engine's integrator
// (velocity += force / 1; pos += velocity) is that substep at h = 1, and
// the rule evaluates the same fx64 products in the same order. The brush
// mass is folded into `k` rather than into the note's `mass` on purpose:
// ddsim divides once, in k_t, and dividing the summed force by a note
// mass would round differently. Sub-steps (h = 1/n for n samples in one
// tick) are not reproduced: the bridge keeps one sample per tick
// (STATE.md, Decisions).
#include <doctest.h>

#include "brush_reference.hpp"
#include "mathspace/action.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"
#include "mathspace/world.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

using namespace mathspace;

namespace {

constexpr const char* BRUSH_FORCE = "self.k * (self.target - self.pos) - sqrt(self.k) * self.velocity";

Field vec2(std::string_view name, fx64 x, fx64 y) {
    Field f;
    f.name = std::string(name);
    f.dim = 2;
    f.value[0] = x;
    f.value[1] = y;
    return f;
}

Field scalar(std::string_view name, fx64 v) {
    Field f;
    f.name = std::string(name);
    f.dim = 1;
    f.value[0] = v;
    return f;
}

// The sampled pen path: integer targets the body chases and never quite
// reaches, with a jump every seven ticks.
void target_at(std::uint32_t t, fx64& u, fx64& v) {
    u = fx64::from_int(static_cast<std::int32_t>(t) * 2);
    v = fx64::from_int(static_cast<std::int32_t>(t % 7) * 3 - 9);
}

std::vector<std::uint8_t> rule_code(const World& w, NoteId rule, const char* text) {
    const expr::ParseResult p = expr::parse(text);
    REQUIRE_MESSAGE(p.ok(), text << ": " << expr::parse_error_name(p.error));
    const expr::CompileResult c = expr::compile(p.ast, expr::RuleDims{w, *w.find(rule)});
    REQUIRE_MESSAGE(c.ok(), text << ": " << expr::compile_error_name(c.error));
    return expr::encode(c.program);
}

void check_parity(std::int32_t brush_mass, std::uint32_t ticks) {
    const mathspace_test::ReferenceParams params = mathspace_test::reference_params(fx64::from_int(brush_mass));

    const NoteId space{1};
    const NoteId body{2};
    const NoteId rule{3};
    World w(7);
    REQUIRE(w.apply(encode_create_space(space, 2)) == Error::Ok);
    REQUIRE(w.apply(encode_create_note(body, space_of(space), NoteKind::Note)) == Error::Ok);
    fx64 tu, tv;
    target_at(0, tu, tv);
    // The first sample places the body on itself at rest (integrate_tick).
    REQUIRE(w.apply(encode_set_field(body, vec2(POS_FIELD, tu, tv))) == Error::Ok);
    REQUIRE(w.apply(encode_set_field(body, vec2(VELOCITY_FIELD, fx64{}, fx64{}))) == Error::Ok);
    REQUIRE(w.apply(encode_set_field(body, vec2("target", tu, tv))) == Error::Ok);
    REQUIRE(w.apply(encode_set_field(body, scalar("k", params.k_t))) == Error::Ok);
    REQUIRE(w.apply(encode_create_note(rule, space_of(space), NoteKind::Rule)) == Error::Ok);
    REQUIRE(w.apply(encode_bind_field(rule, FORCE_FIELD, rule_code(w, rule, BRUSH_FORCE))) == Error::Ok);

    mathspace_test::ReferenceBody st;
    st.x = tu;
    st.y = tv;

    bool moved = false;
    for (std::uint32_t t = 0; t < ticks; ++t) {
        target_at(t, tu, tv);
        if (t > 0) {
            REQUIRE(w.apply(encode_set_field(body, vec2("target", tu, tv))) == Error::Ok);
        }
        mathspace_test::reference_substep(st, params, tu, tv);
        w.step();
        const Note& n = *w.find(body);
        const Field& pos = *find_field(n, POS_FIELD);
        const Field& vel = *find_field(n, VELOCITY_FIELD);
        CHECK_MESSAGE(pos.value[0].raw == st.x.raw, "mass " << brush_mass << " tick " << t << " x");
        CHECK_MESSAGE(pos.value[1].raw == st.y.raw, "mass " << brush_mass << " tick " << t << " y");
        CHECK_MESSAGE(vel.value[0].raw == st.vx.raw, "mass " << brush_mass << " tick " << t << " vx");
        CHECK_MESSAGE(vel.value[1].raw == st.vy.raw, "mass " << brush_mass << " tick " << t << " vy");
        moved = moved || pos.value[0].raw != 0;
    }
    CHECK(moved);
    CHECK(w.reports.empty());
}

} // namespace

TEST_CASE("brush body: the force rule reproduces ddsim's body_substep bit for bit, mass 1") {
    check_parity(1, 60);
}

TEST_CASE("brush body: the force rule reproduces ddsim's body_substep bit for bit, mass 64") {
    check_parity(64, 60);
}

TEST_CASE("brush body: derive_params is 1 / mass and sqrt of it, what the rule computes") {
    const mathspace_test::ReferenceParams p = mathspace_test::reference_params(fx64::from_int(64));
    CHECK(p.k_t.raw == fx64::ONE / 64);
    CHECK(p.c_t.raw == ddsim::sqrt(p.k_t).raw);
    CHECK(p.c_t.raw == fx64::ONE / 8);
}
