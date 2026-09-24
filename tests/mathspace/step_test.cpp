// step_test.cpp — the tick: unary force rules accumulate into velocity
// through mass, pos += velocity for notes that have both at one dim, then
// the bound fields of non-Rule notes; nothing else changes.
#include <doctest.h>

#include "mathspace/version.hpp"
#include "mathspace/world.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"

#include <string>
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

    // A scalar force is not a space vector: skipped, and reported (RULE-07).
    w = before;
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "1")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 0, 0));
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].rule == R);
    CHECK(w.reports[0].skipped == 1);
    CHECK(w.reports[0].reason == static_cast<std::uint8_t>(Skip::WrongDim));
    CHECK(std::string(skip_name(w.reports[0].reason)) == "WrongDim");

    // A bad scope is a whole-rule skip too; a clean step clears the reports.
    w = before;
    REQUIRE(w.set_field(R, vec("scope", 1, 7)) == Error::Ok);
    w.step();
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].reason == static_cast<std::uint8_t>(Skip::NoScope));
    REQUIRE(w.set_field(R, vec("scope", 1, 0)) == Error::Ok);
    w.step();
    CHECK(w.reports.empty());

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
    // A has no `k`: that visit is skipped and reported (RULE-07), B's is not.
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].rule == R);
    CHECK(w.reports[0].skipped == 1);
    CHECK(w.reports[0].reason == static_cast<std::uint8_t>(expr::VmError::NoSuchField));
    CHECK(std::string(skip_name(w.reports[0].reason)) == "NoSuchField");

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
    // Both visits skip now, and the reason is the last skip's.
    REQUIRE(w.set_field(B, vec("k", 2, 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 6, 0));
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].skipped == 2);
    CHECK(w.reports[0].reason == static_cast<std::uint8_t>(expr::VmError::DimChanged));
    // Reports are not state: the world equals its copy without them.
    World copy = w;
    copy.reports.clear();
    CHECK(copy == w);
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

TEST_CASE("a rule's bound set.<f> assigns f on each selected target after the integrator") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.create_note(R2, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("heat", 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("tag", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, 5, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("heat", 2, 0, 0)) == Error::Ok); // wrong dim: never written
    // Two set fields on one rule, in name order; the target's pos is this tick's.
    REQUIRE(w.bind_field(R, "set.heat", rule_code(w, R, "self.pos.x * 10")) == Error::Ok);
    REQUIRE(w.bind_field(R, "set.tag", rule_code(w, R, "[self.heat, 1]")) == Error::Ok);
    REQUIRE(w.bind_field(R, "set.nope", rule_code(w, R, "7")) == Error::Ok); // no target has it
    w.step();
    CHECK(field(w, A, "pos") == vec("pos", 2, 2, 0));
    CHECK(field(w, A, "heat") == vec("heat", 1, 20));
    CHECK(field(w, A, "tag") == vec("tag", 2, 20, 1)); // set.heat ran first (name order)
    CHECK(field(w, B, "heat") == vec("heat", 2, 0, 0));
    CHECK(find_field(*w.find(A), "nope") == nullptr);
    CHECK(find_field(*w.find(B), "nope") == nullptr);
    // RULE-07: B's reshaped heat, nope on both, B's missing tag: four skips.
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].rule == R);
    CHECK(w.reports[0].skipped == 4);
    CHECK(w.reports[0].reason == static_cast<std::uint8_t>(Skip::NoTargetField));
    // A later rule in id order wins; select gates it; a pinned target is skipped.
    REQUIRE(w.bind_field(R2, "set.heat", rule_code(w, R2, "0 - 1")) == Error::Ok);
    REQUIRE(w.bind_field(R2, "select", rule_code(w, R2, "self.pos.x > 100")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "heat") == vec("heat", 1, 30)); // not selected: rule R's value
    REQUIRE(w.bind_field(R2, "select", {}) == Error::Ok);
    w.step();
    CHECK(field(w, A, "heat") == vec("heat", 1, -1));
    REQUIRE(w.set_field(A, vec("pinned", 1, 1)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "heat") == vec("heat", 1, -1));
    CHECK(field(w, A, "tag") == vec("tag", 2, 40, 1)); // tick 3's value, no write while pinned
    // A pinned target is not a reported skip (RULE-08 is what was asked):
    // R still has B's three, R2 has B's reshaped heat only.
    REQUIRE(w.reports.size() == 2);
    CHECK(w.reports[0].rule == R);
    CHECK(w.reports[0].skipped == 3);
    CHECK(w.reports[1].rule == R2);
    CHECK(w.reports[1].skipped == 1);
    // A set rule under a non-unary scope is skipped whole.
    REQUIRE(w.set_field(A, vec("pinned", 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(R2, vec("scope", 1, 2)) == Error::Ok);
    w.step();
    CHECK(field(w, A, "heat") == vec("heat", 1, 50));
    CHECK(w.well_formed());
}

TEST_CASE("a pair rule visits every ordered pair with other bound; global visits the rule once") {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.create_note(R2, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("near", 1, 1000)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, 10, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("near", 1, 1000)) == Error::Ok);
    REQUIRE(w.set_field(R, vec("scope", 1, 1)) == Error::Ok);
    // A spring toward the other end: symmetric, so both ends move.
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "other.pos - self.pos")) == Error::Ok);
    // A pair set reads what the previous visit wrote: a running min over others.
    REQUIRE(w.bind_field(R, "set.near", rule_code(w, R, "min(self.near, abs(self.pos.x - other.pos.x))")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 10, 0));
    CHECK(field(w, A, "pos") == vec("pos", 2, 10, 0));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, -10, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 0, 0));
    CHECK(field(w, A, "near") == vec("near", 1, 10)); // from this tick's integrated pos
    CHECK(field(w, B, "near") == vec("near", 1, 10));
    // select sees `other` too: gate the spring on the other end's x.
    REQUIRE(w.bind_field(R, "select", rule_code(w, R, "other.pos.x > 5")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 10, 0)); // other is B at x 0: not selected
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 0, 0));  // other is A at x 10: force -10
    CHECK(field(w, A, "pos") == vec("pos", 2, 20, 0));
    CHECK(field(w, B, "pos") == vec("pos", 2, 0, 0));
    // A unary rule that reads `other` is a per-visit skip; a global rule
    // visits the rule note itself: its force goes nowhere useful, its set
    // writes its own field. Scope 3 is no scope.
    REQUIRE(w.set_field(R, vec("scope", 1, 0)) == Error::Ok);
    REQUIRE(w.set_field(R2, vec("scope", 1, 2)) == Error::Ok);
    REQUIRE(w.set_field(R2, vec("count", 1, 0)) == Error::Ok);
    REQUIRE(w.bind_field(R2, "set.count", rule_code(w, R2, "world.tick + 1")) == Error::Ok);
    REQUIRE(w.bind_field(R2, "force", rule_code(w, R2, "[1, 1]")) == Error::Ok);
    w.step();
    CHECK(field(w, A, "velocity") == vec("velocity", 2, 10, 0));
    CHECK(field(w, B, "velocity") == vec("velocity", 2, 0, 0));
    CHECK(field(w, R2, "count") == vec("count", 1, 3));
    CHECK(find_field(*w.find(R2), "velocity") == nullptr);
    REQUIRE(w.set_field(R2, vec("scope", 1, 3)) == Error::Ok);
    w.step();
    CHECK(field(w, R2, "count") == vec("count", 1, 3));
    CHECK(w.well_formed());
}

TEST_CASE("the step version is pinned in the walk") {
    CHECK(MS_STEP_VERSION == 11u);
    const World w;
    const auto bytes = serialize(w);
    // magic 4 | FORMAT_VERSION 4 | MS_FX_FORMAT_ID 4 | rule version 4
    CHECK(bytes[12] == 11);
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

// Phase 4: constraints. A rod between a pinned anchor and a free end, the
// XPBD split by inverse mass, compliance, a unary manifold constraint,
// and the whole-rule skips.
namespace {

// Space S dim 2; A at (ax, ay), B at (bx, by), both with velocity 0 and
// the default mass; rule R with `scope` and a bound `constraint`.
void rod_world(World& w, std::int32_t ax, std::int32_t ay, std::int32_t bx, std::int32_t by, std::int32_t scope,
               const char* constraint) {
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, ax, ay)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, bx, by)) == Error::Ok);
    REQUIRE(w.set_field(B, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.set_field(R, vec("scope", 1, scope)) == Error::Ok);
    REQUIRE(w.bind_field(R, "constraint", rule_code(w, R, constraint)) == Error::Ok);
}

} // namespace

TEST_CASE("a rod to a pinned anchor is met in one pass and the velocity is the correction") {
    World w(1);
    rod_world(w, 0, 0, 15, 0, 1, "norm(other.pos - self.pos) - 10");
    REQUIRE(w.set_field(A, vec("pinned", 1, 1)) == Error::Ok);
    w.step();
    // A is pinned: skipped silently (RULE-08), so w_other = 0 on B's visit and
    // B takes the whole correction, C = 5 along the unit gradient.
    CHECK(field(w, A, "pos").value[0] == fx64{});
    CHECK(field(w, B, "pos").value[0] == fx64::from_int(10));
    CHECK(field(w, B, "pos").value[1] == fx64{});
    CHECK(field(w, B, "velocity").value[0] == fx64::from_int(-5));
    CHECK(field(w, A, "velocity").value[0] == fx64{});
    CHECK(w.reports.empty());
    // At rest on the rod, nothing changes but the velocity, which is zero again.
    w.step();
    CHECK(field(w, B, "pos").value[0] == fx64::from_int(10));
    CHECK(field(w, B, "velocity").value[0] == fx64{});
    CHECK(w.well_formed());
}

TEST_CASE("compliance softens the rod: half the correction per pass at alpha 1") {
    World w(1);
    rod_world(w, 0, 0, 15, 0, 1, "norm(other.pos - self.pos) - 10");
    REQUIRE(w.set_field(A, vec("pinned", 1, 1)) == Error::Ok);
    REQUIRE(w.set_field(R, vec("compliance", 1, 1)) == Error::Ok);
    w.step();
    // dlambda = -C / (1 * 1 + 1): 15 -> 12.5 -> 11.25 -> 10.625 -> 10.3125.
    CHECK(MS_CONSTRAINT_ITERATIONS == 4u);
    CHECK(field(w, B, "pos").value[0].raw == 10 * fx64::ONE + (fx64::ONE * 5 / 16));
    CHECK(field(w, B, "velocity").value[0].raw == -(4 * fx64::ONE + (fx64::ONE * 11 / 16)));
}

TEST_CASE("a free rod pulled apart returns toward its length, both ends moving") {
    World w(1);
    rod_world(w, 0, 0, 10, 0, 1, "norm(other.pos - self.pos) - 10");
    // A force away from the midpoint x = 5 stretches the rod to 20 before the passes.
    REQUIRE(w.create_note(R2, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.bind_field(R2, "force", rule_code(w, R2, "self.pos - [5, 0]")) == Error::Ok);
    w.step();
    const fx64 ax = field(w, A, "pos").value[0];
    const fx64 bx = field(w, B, "pos").value[0];
    const fx64 len = bx - ax;
    // Each visit moves its end by half of C along the rod, the other end's
    // visit sees the remainder: the residual quarters every pass, 10 * 2^-8 after four.
    CHECK(len.raw == 10 * fx64::ONE + 10 * fx64::ONE / 256);
    CHECK(ax > fx64::from_int(-5));
    CHECK(bx < fx64::from_int(15));
    CHECK(field(w, A, "velocity").value[0] == ax);
    CHECK(field(w, B, "velocity").value[0] == bx - fx64::from_int(10));
    CHECK(w.reports.empty());
}

TEST_CASE("a unary constraint holds a note on a manifold") {
    World w(1);
    rod_world(w, 10, 0, 0, 5, 0, "norm(self.pos) - 5");
    w.step();
    // A: C = 5, gradient (1, 0), no other: moved to the circle in one pass.
    CHECK(field(w, A, "pos").value[0] == fx64::from_int(5));
    CHECK(field(w, A, "velocity").value[0] == fx64::from_int(-5));
    // B is already on it.
    CHECK(field(w, B, "pos").value[1] == fx64::from_int(5));
    CHECK(field(w, B, "velocity").value[1] == fx64{});
}

TEST_CASE("a constraint that is not scalar, or has no gradient, skips the rule whole") {
    World w(1);
    rod_world(w, 0, 0, 15, 0, 1, "other.pos - self.pos");
    w.step();
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].rule == R);
    CHECK(w.reports[0].skipped == 1);
    CHECK(w.reports[0].reason == static_cast<std::uint8_t>(Skip::WrongDim));
    CHECK(field(w, B, "pos").value[0] == fx64::from_int(15));

    REQUIRE(w.set_field(A, vec("t", 1, 0)) == Error::Ok);
    REQUIRE(w.bind_field(R, "constraint", rule_code(w, R, "curve(self.pos, self.t)")) == Error::Ok);
    w.step();
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].skipped == 1);
    CHECK(std::string(skip_name(w.reports[0].reason)) == "BadGradient");
    CHECK(field(w, B, "pos").value[0] == fx64::from_int(15));

    // A flat gradient with no compliance is a silent per-visit skip: C = 3
    // with d C / d pos = 0 leaves everything alone and reports nothing.
    REQUIRE(w.bind_field(R, "constraint", rule_code(w, R, "3")) == Error::Ok);
    w.step();
    CHECK(w.reports.empty());
    CHECK(field(w, B, "pos").value[0] == fx64::from_int(15));
    CHECK(w.well_formed());
}

TEST_CASE("a View note is neither a rule target nor evaluated by the bound-field pass") {
    World w(1);
    constexpr NoteId V{6};
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 1, 2)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 0, 0)) == Error::Ok);
    REQUIRE(w.create_note(V, space_of(S), NoteKind::View) == Error::Ok);
    REQUIRE(w.set_field(V, vec("pos", 2, 5, 5)) == Error::Ok);
    REQUIRE(w.set_field(V, vec("velocity", 2, 0, 0)) == Error::Ok);
    // The view's project is compiled for the notes of its space (RuleDims).
    REQUIRE(w.bind_field(V, "project", rule_code(w, V, "self.pos * 2")) == Error::Ok);
    REQUIRE(w.create_note(R, space_of(S), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.bind_field(R, "force", rule_code(w, R, "[1, 0]")) == Error::Ok);
    w.step();
    CHECK(w.reports.empty());
    // A is pushed; the View, though it has pos and velocity, is not a target.
    CHECK(field(w, A, "pos").value[0] == fx64::from_int(2));
    CHECK(field(w, V, "pos").value[0] == fx64::from_int(5));
    CHECK(field(w, V, "velocity").value[0] == fx64{});
    // The bound project keeps its zero lanes: step() never evaluates it.
    CHECK(field(w, V, "project").bound);
    CHECK(field(w, V, "project").value[0] == fx64{});
    CHECK(field(w, V, "project").value[1] == fx64{});
    CHECK(w.well_formed());
}

// Phase 6: a Space note's bound `metric` (the diagonal of g) makes the
// integrator geodesic.
namespace {

// A 2-space S with note A at (x, y) carrying velocity (vx, vy) in raw
// units, no rules.
World metric_world(std::int32_t x, std::int32_t y, std::int64_t vx_raw, std::int64_t vy_raw) {
    World w(1);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, x, y)) == Error::Ok);
    Field v = vec(VELOCITY_FIELD.data(), 2);
    v.value[0] = fx64::from_raw(vx_raw);
    v.value[1] = fx64::from_raw(vy_raw);
    REQUIRE(w.set_field(A, v) == Error::Ok);
    return w;
}

} // namespace

TEST_CASE("a Euclidean metric [1, 1] steps bit for bit like no metric") {
    World plain = metric_world(3, 4, fx64::ONE, -fx64::ONE / 2);
    World flat = metric_world(3, 4, fx64::ONE, -fx64::ONE / 2);
    REQUIRE(flat.bind_field(S, METRIC_FIELD, code_for(flat, S, "[1, 1]")) == Error::Ok);
    for (int t = 0; t < 20; ++t) {
        plain.step();
        flat.step();
        CHECK(flat.reports.empty());
        CHECK(field(flat, A, POS_FIELD).value == field(plain, A, POS_FIELD).value);
        CHECK(field(flat, A, VELOCITY_FIELD).value == field(plain, A, VELOCITY_FIELD).value);
    }
    // The metric's own lanes on the space are never written by the
    // bound-field pass: it is a law, not a value.
    CHECK(field(flat, S, METRIC_FIELD).value == std::array<fx64, MAX_DIM>{});
}

TEST_CASE("polar coordinates: a geodesic is a straight line, r grows as sqrt(r0^2 + t^2)") {
    // Chart (r, theta) with g = diag(1, r^2). A note at r = 100 moving
    // tangentially at unit speed (theta' = 1 / 100) follows the line
    // x = 100, so r^2 = 100^2 + t^2 and theta -> atan(t / 100).
    World w = metric_world(100, 0, 0, fx64::ONE / 100);
    REQUIRE(w.bind_field(S, METRIC_FIELD, code_for(w, S, "[1, self.pos.x * self.pos.x]")) == Error::Ok);
    for (int t = 0; t < 100; ++t) {
        w.step();
        REQUIRE(w.reports.empty());
    }
    const Field& pos = field(w, A, POS_FIELD);
    const fx64 r = pos.value[0];
    const fx64 theta = pos.value[1];
    // r = 141.42 within 2 percent of the exact line (Euler, h = 1).
    CHECK(r.raw > 138 * fx64::ONE);
    CHECK(r.raw < 145 * fx64::ONE);
    // theta = pi / 4 = 0.785 within the same tolerance.
    CHECK(theta.raw > (fx64::ONE * 76) / 100);
    CHECK(theta.raw < (fx64::ONE * 81) / 100);
    // Without the metric the same chart velocities would leave r at 100.
    World flat = metric_world(100, 0, 0, fx64::ONE / 100);
    for (int t = 0; t < 100; ++t) flat.step();
    CHECK(field(flat, A, POS_FIELD).value[0] == fx64::from_int(100));
}

TEST_CASE("a metric that is not a dim-N program is reported on the space and the chart is Euclidean") {
    World w = metric_world(100, 0, 0, fx64::ONE);
    REQUIRE(w.bind_field(S, METRIC_FIELD, code_for(w, S, "self.pos.x")) == Error::Ok);
    w.step();
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].rule == S);
    CHECK(w.reports[0].skipped == 1);
    CHECK(std::string(skip_name(w.reports[0].reason)) == "BadMetric");
    CHECK(field(w, A, POS_FIELD).value[1] == fx64::from_int(1));
    // A metric with no symbolic gradient (curve of pos) is the same skip.
    World c = metric_world(100, 0, 0, fx64::ONE);
    REQUIRE(c.bind_field(S, METRIC_FIELD, code_for(c, S, "[curve([1, 2], self.pos.x), 1]")) == Error::Ok);
    c.step();
    REQUIRE(c.reports.size() == 1);
    CHECK(std::string(skip_name(c.reports[0].reason)) == "BadMetric");
}

TEST_CASE("a degenerate chart point skips the correction silently; a note without velocity is untouched") {
    // g_thetatheta = r^2 = 0 at the origin: Euclidean there, no report.
    World w = metric_world(0, 0, 0, fx64::ONE);
    REQUIRE(w.bind_field(S, METRIC_FIELD, code_for(w, S, "[1, self.pos.x * self.pos.x]")) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(B, vec("pos", 2, 50, 50)) == Error::Ok);
    w.step();
    CHECK(w.reports.empty());
    CHECK(field(w, A, POS_FIELD).value[0] == fx64{});
    CHECK(field(w, A, POS_FIELD).value[1] == fx64::from_int(1));
    CHECK(field(w, B, POS_FIELD).value[0] == fx64::from_int(50));
    CHECK(field(w, B, POS_FIELD).value[1] == fx64::from_int(50));
}

// Phase 6: `identify` on a Space note wraps pos lanes into [-L, L).
TEST_CASE("identify of half-width 100 on x wraps x into the half-open interval and leaves y open, velocity untouched") {
    World w = metric_world(99, 0, 2 * fx64::ONE, 3 * fx64::ONE);
    REQUIRE(w.set_field(S, vec(IDENTIFY_FIELD.data(), 2, 100, 0)) == Error::Ok);
    w.step();
    CHECK(w.reports.empty());
    // 99 + 2 = 101 -> 101 - 200 = -99. y runs on: 3.
    CHECK(field(w, A, POS_FIELD).value[0] == fx64::from_int(-99));
    CHECK(field(w, A, POS_FIELD).value[1] == fx64::from_int(3));
    CHECK(field(w, A, VELOCITY_FIELD).value[0] == fx64::from_int(2));
    // Backwards past -100 lands just under 100; a note far out wraps in one step.
    World b = metric_world(-99, 0, -2 * fx64::ONE, 0);
    REQUIRE(b.set_field(S, vec(IDENTIFY_FIELD.data(), 2, 100, 0)) == Error::Ok);
    REQUIRE(b.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(b.set_field(B, vec("pos", 2, 1050, -7)) == Error::Ok);
    b.step();
    CHECK(field(b, A, POS_FIELD).value[0] == fx64::from_int(99));
    CHECK(field(b, B, POS_FIELD).value[0] == fx64::from_int(50));
    CHECK(field(b, B, POS_FIELD).value[1] == fx64::from_int(-7));
    // The boundary itself: exactly L maps to -L, so the interval is half open.
    World e = metric_world(98, 0, 2 * fx64::ONE, 0);
    REQUIRE(e.set_field(S, vec(IDENTIFY_FIELD.data(), 2, 100, 0)) == Error::Ok);
    e.step();
    CHECK(field(e, A, POS_FIELD).value[0] == fx64::from_int(-100));
    CHECK(w.well_formed());
}

TEST_CASE("identify at the wrong dim is reported on the space and wraps nothing, a bound identify wraps by its evaluated lanes") {
    World w = metric_world(99, 0, 2 * fx64::ONE, 0);
    REQUIRE(w.set_field(S, vec(IDENTIFY_FIELD.data(), 1, 100)) == Error::Ok);
    w.step();
    REQUIRE(w.reports.size() == 1);
    CHECK(w.reports[0].rule == S);
    CHECK(std::string(skip_name(w.reports[0].reason)) == "BadIdentify");
    CHECK(field(w, A, POS_FIELD).value[0] == fx64::from_int(101));
    // Bound: the lanes are zero on the first step (nothing wraps), then
    // hold the evaluated value for the second.
    World b = metric_world(99, 0, 2 * fx64::ONE, 0);
    REQUIRE(b.bind_field(S, IDENTIFY_FIELD, code_for(b, S, "[100, 0]")) == Error::Ok);
    b.step();
    CHECK(b.reports.empty());
    CHECK(field(b, A, POS_FIELD).value[0] == fx64::from_int(101));
    CHECK(field(b, S, IDENTIFY_FIELD).value[0] == fx64::from_int(100));
    b.step();
    CHECK(field(b, A, POS_FIELD).value[0] == fx64::from_int(-97));
}
