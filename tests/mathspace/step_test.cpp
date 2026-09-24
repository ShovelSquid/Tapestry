// step_test.cpp — the tick: unary force rules accumulate into velocity
// through mass, pos += velocity for notes that have both at one dim, then
// the bound fields of non-Rule notes; nothing else changes.
#include <doctest.h>

#include "mathspace/version.hpp"
#include "mathspace/world.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"

#include <vector>

using namespace mathspace;

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

Field vec(const char* name, std::uint8_t dim, std::int32_t v0 = 0, std::int32_t v1 = 0, std::int32_t v2 = 0) {
    Field f;
    f.name = name;
    f.dim = dim;
    f.value[0] = fx64::from_int(v0);
    f.value[1] = fx64::from_int(v1);
    f.value[2] = fx64::from_int(v2);
    return f;
}

constexpr NoteId S{1};
constexpr NoteId A{2};
constexpr NoteId B{3};
constexpr NoteId R{4};
constexpr NoteId R2{5};

// The encoded program for `text` compiled on the Rule `rule` for its
// targets (RuleDims), as the plugin's ms_compile does.
std::vector<std::uint8_t> rule_code(const World& w, NoteId rule, const char* text) {
    const expr::ParseResult p = expr::parse(text);
    REQUIRE_MESSAGE(p.ok(), text << ": " << expr::parse_error_name(p.error));
    const expr::CompileResult c = expr::compile(p.ast, expr::RuleDims{w, *w.find(rule)});
    REQUIRE_MESSAGE(c.ok(), text << ": " << expr::compile_error_name(c.error));
    return expr::encode(c.program);
}

fx64 half(std::int32_t n) { return fx64::from_raw(std::int64_t{n} * (fx64::ONE / 2)); }

const Field& field(const World& w, NoteId id, std::string_view name) {
    const Field* f = find_field(*w.find(id), name);
    REQUIRE(f != nullptr);
    return *f;
}

} // namespace

TEST_CASE("a note with pos and velocity moves by velocity each tick") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 1, -2)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos").value[0] == fx64::from_int(1));
    CHECK(field(w, A, "pos").value[1] == fx64::from_int(-2));
    for (int i = 0; i < 9; ++i) {
        w.step();
    }
    CHECK(w.tick == 10);
    CHECK(field(w, A, "pos").value[0] == fx64::from_int(10));
    CHECK(field(w, A, "pos").value[1] == fx64::from_int(-20));
    // velocity itself is untouched, and so are the unused lanes.
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 1, -2));
    CHECK(field(w, A, "pos").value[2] == fx64{});
    CHECK(w.well_formed());
}

TEST_CASE("fractional velocities accumulate exactly in fx64") {
    World w;
    REQUIRE(w.create_space(S, 1) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 1)) == Error::Ok);
    Field v = vec("velocity", 1);
    v.value[0] = fx64::from_raw(1); // 2^-32
    REQUIRE(w.set_field(A, v) == Error::Ok);
    for (int i = 0; i < 1000; ++i) {
        w.step();
    }
    CHECK(field(w, A, "pos").value[0].raw == 1000);
}

TEST_CASE("notes without both fields, or at different dims, are untouched") {
    World w;
    REQUIRE(w.create_space(S, 3) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 3, 5, 6, 7)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 3, 1, 1, 1)) == Error::Ok); // no pos: never created
    REQUIRE(w.set_field(S, vec("velocity", 2, 1, 1)) == Error::Ok);    // space pos is dim 3
    World before = w;
    w.step();
    before.tick = 1;
    CHECK(w == before);

    // Matching dim on the space itself: a Space note drifts like any other.
    REQUIRE(w.set_field(S, vec("velocity", 3, 1, 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, S, "pos").value[2] == fx64::from_int(1));
    CHECK(w.space_dim(space_of(S)) == 3);
    CHECK(w.well_formed());
}

TEST_CASE("unary force rules accumulate in id order and integrate through mass") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.create_note(R2, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("mass", 1, 2)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, 10, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 2, 1, 0)) == Error::Ok); // no mass: 1
    // Weight, proportional to mass: B has no mass, so this rule skips B.
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "[0, 0 - self.mass]")) == Error::Ok);
    // A constant push on everything in the space.
    REQUIRE(w.bind_field(R2, "force", rule_code(w, R2, "[1, 0]")) == Error::Ok);

    w.step();
    CHECK(field(w, A, "velocity").value[0] == half(1));
    CHECK(field(w, A, "velocity").value[1] == fx64::from_int(-1));
    CHECK(field(w, A, "pos").value[0] == half(1));
    CHECK(field(w, A, "pos").value[1] == fx64::from_int(-1));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 2, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 12, 0));
    w.step();
    CHECK(field(w, A, "velocity").value[0] == fx64::from_int(1));
    CHECK(field(w, A, "velocity").value[1] == fx64::from_int(-2));
    CHECK(field(w, A, "pos").value[0] == half(3));
    CHECK(field(w, A, "pos").value[1] == fx64::from_int(-3));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 3, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 15, 0));
    // The rules' own lanes are never written: a rule is not its own target.
    CHECK(field(w, R, "force").value[0].raw == 0);
    CHECK(field(w, R, "force").value[1].raw == 0);
    CHECK(field(w, R2, "force").value[0].raw == 0);
    CHECK(field(w, A, "mass") == vec("mass", 1, 2));
    CHECK(w.well_formed());
}

TEST_CASE("a rule is skipped when it is not unary, not a space vector, or in another space") {
    World w(1);
    constexpr NoteId S2{6};
    constexpr NoteId C{7};
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_space(S2, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.create_note(C, space_of(S2), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(C, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(C, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "[1, 1]")) == Error::Ok);
    const World before = w;

    // Pair scope: nothing happens this phase.
    REQUIRE(w.set_field(R, vec("scope", 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 0, 0));
    CHECK(field(w, C, "pos") == vec("pos", 2, 0, 0));

    // Unary by an explicit 0: A moves, C (another space) does not.
    REQUIRE(w.set_field(R, vec("scope", 1, 0)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 1, 1));
    CHECK(field(w, C, "pos") == vec("pos", 2, 0, 0));

    // A scalar force is not a space vector: skipped.
    w = before;
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "1")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 0, 0));

    // A bound `force` on a plain note is an ordinary bound field, not a law.
    w = before;
    REQUIRE(w.delete_field(R, "force") == Error::Ok);
    REQUIRE(w.bind_field(A, "force", rule_code(w, R, "[1, 1]")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 0, 0));
    CHECK(field(w, A, "force").value[0] == fx64::from_int(1));
    CHECK(field(w, A, "force").value[1] == fx64::from_int(1));
    CHECK(w.well_formed());
}

TEST_CASE("force needs velocity and a positive mass; a per-note failure skips that note") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok); // no velocity
    REQUIRE(w.set_field(B, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("k", 1, 3)) == Error::Ok);
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "[self.k, 0]")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 0, 0)); // never created a velocity
    CHECK(find_field(*w.find(A), "velocity") == nullptr);
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 3, 0));

    // mass 0 and a negative mass drop the force; velocity still integrates.
    REQUIRE(w.set_field(B, vec("mass", 1, 0)) == Error::Ok);
    w.step();
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 3, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 6, 0));
    REQUIRE(w.set_field(B, vec("mass", 1, -1)) == Error::Ok);
    w.step();
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 3, 0));
    // A vector mass is not a mass: the default 1 applies.
    REQUIRE(w.set_field(B, vec("mass", 2, 5, 5)) == Error::Ok);
    w.step();
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 6, 0));

    // `self.k` reshaped on B: DimChanged for B only; A is untouched anyway.
    REQUIRE(w.set_field(B, vec("k", 2, 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 6, 0));
    CHECK(w.well_formed());
}

TEST_CASE("a bound select gates each target; an error or zero is a skip") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("hot", 1, 1)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "[1, 0]")) == Error::Ok);
    REQUIRE(w.bind_field(R, "select", rule_code(w, R, "self.hot > 0")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 1, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 0, 0)); // no `hot`: not selected
    REQUIRE(w.set_field(A, vec("hot", 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("hot", 1, 5)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 2, 0)); // velocity stays 1, no new force
    CHECK(field(w, B, "pos") == vec("pos", 2, 1, 0));
    // An unbound `select` (a plain scalar on the rule) selects everything.
    REQUIRE(w.bind_field(R, "select", {}) == Error::Ok);
    w.step();
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 2, 0));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 2, 0));
    // A vector-valued select skips the rule whole.
    REQUIRE(w.bind_field(R, "select", rule_code(w, R, "[1, 1]")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 2, 0));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 2, 0));
    CHECK(w.well_formed());
}

TEST_CASE("RuleDims resolves pos from the space and other fields from the first note that has them") {
    World w(1);
    REQUIRE(w.create_space(S, 3) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(R, vec("k", 1, 9)) == Error::Ok); // the rule's own field is not a target's
    // Built per query: creating a note moves the vector under a held reference.
    auto dim = [&](expr::RefKind ref, std::uint64_t id, const char* name) {
        return expr::RuleDims{w, *w.find(R)}.dim(ref, id, name);
    };
    CHECK(dim(expr::RefKind::Self, 0, "pos") == 3);
    CHECK(dim(expr::RefKind::Other, 0, "pos") == 3);
    CHECK(dim(expr::RefKind::Self, 0, "k") == 0);
    CHECK(dim(expr::RefKind::Space, 0, "dim") == 1);
    CHECK(dim(expr::RefKind::Space, 0, "pos") == 3);
    CHECK(dim(expr::RefKind::World, 0, "tick") == 1);
    CHECK(dim(expr::RefKind::Node, R.value, "k") == 1);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(B, vec("k", 2, 1, 1)) == Error::Ok);
    CHECK(dim(expr::RefKind::Self, 0, "k") == 2); // B is the first note that has k
    REQUIRE(w.set_field(A, vec("k", 1, 1)) == Error::Ok);
    CHECK(dim(expr::RefKind::Self, 0, "k") == 1); // now A is
    CHECK(dim(expr::RefKind::Other, 0, "k") == 1);
    CHECK(dim(expr::RefKind::Self, 0, "nope") == 0);
}

TEST_CASE("a pinned note keeps its pos and velocity whatever the forces (RULE-08)") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pinned", 1, 1)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 2, 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pinned", 1, 0)) == Error::Ok); // zero is not pinned
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "[0, 2]")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 0, 0));
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 1, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 1, 2));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 1, 2));
    // A vector `pinned` is not a pin; unpinning lets the note go on from where it was held.
    REQUIRE(w.set_field(A, vec("pinned", 2, 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 1, 2));
    CHECK(w.well_formed());
}

TEST_CASE("the step version is pinned in the walk") {
    CHECK(MS_STEP_VERSION == 5u);
    const World w;
    const auto bytes = serialize(w);
    // magic 4 | FORMAT_VERSION 4 | DD_FX_FORMAT_ID 4 | rule version 4
    CHECK(bytes[12] == 5);
    CHECK(bytes[13] == 0);
    CHECK(bytes[14] == 0);
    CHECK(bytes[15] == 0);
}

TEST_CASE("bound fields are evaluated after the integrate rule, in name order") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 1, 2)) == Error::Ok);
    // `x2` sees this tick's pos; `a` (name order first) reads `b` from
    // the previous evaluation, `b` reads the tick.
    REQUIRE(w.bind_field(A, "x2", code_for(w, A, "self.pos.x * 2")) == Error::Ok);
    REQUIRE(w.bind_field(A, "b", code_for(w, A, "world.tick + 10")) == Error::Ok);
    REQUIRE(w.bind_field(A, "a", code_for(w, A, "self.b + 100")) == Error::Ok);
    CHECK(field(w, A, "x2").value[0].raw == 0);

    w.step();
    CHECK(field(w, A, "pos").value[0] == fx64::from_int(1));
    CHECK(field(w, A, "x2").value[0] == fx64::from_int(2));
    CHECK(field(w, A, "b").value[0] == fx64::from_int(10));
    CHECK(field(w, A, "a").value[0] == fx64::from_int(100)); // b was 0 when a ran
    w.step();
    CHECK(field(w, A, "x2").value[0] == fx64::from_int(4));
    CHECK(field(w, A, "b").value[0] == fx64::from_int(11));
    CHECK(field(w, A, "a").value[0] == fx64::from_int(110));
    CHECK(w.well_formed());

    // Unbound: the last value stays and stops changing.
    REQUIRE(w.bind_field(A, "x2", {}) == Error::Ok);
    w.step();
    CHECK(field(w, A, "x2").value[0] == fx64::from_int(4));
    CHECK_FALSE(field(w, A, "x2").bound);
}

TEST_CASE("an evaluation error leaves the field's lanes alone") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(B, vec("m", 1, 7)) == Error::Ok);
    REQUIRE(w.bind_field(A, "r", code_for(w, A, "node(n3).m + 1")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "r").value[0] == fx64::from_int(8));
    // Reshape the referenced field: DimChanged at eval, r keeps 8.
    REQUIRE(w.set_field(B, vec("m", 2, 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "r").value[0] == fx64::from_int(8));
    // Delete the note: NoSuchNote, r still keeps 8.
    REQUIRE(w.delete_note(B) == Error::Ok);
    w.step();
    CHECK(field(w, A, "r").value[0] == fx64::from_int(8));
    CHECK(field(w, A, "r").bound);
    CHECK(w.well_formed());
}
