// step_test.cpp — the bootstrap integrate rule: pos += velocity per tick
// for notes that have both at one dim, and nothing else changes.
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

TEST_CASE("the step version is pinned in the walk") {
    CHECK(MS_STEP_VERSION == 2u);
    const World w;
    const auto bytes = serialize(w);
    // magic 4 | FORMAT_VERSION 4 | DD_FX_FORMAT_ID 4 | rule version 4
    CHECK(bytes[12] == 2);
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
