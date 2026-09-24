// step_test.cpp — the bootstrap integrate rule: pos += velocity per tick
// for notes that have both at one dim, and nothing else changes.
#include <doctest.h>

#include "mathspace/version.hpp"
#include "mathspace/world.hpp"

using namespace mathspace;

namespace {

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

TEST_CASE("the rule version is pinned in the walk") {
    CHECK(MS_RULE_INTEGRATE_VERSION == 1u);
    const World w;
    const auto bytes = serialize(w);
    // magic 4 | FORMAT_VERSION 4 | DD_FX_FORMAT_ID 4 | rule version 4
    CHECK(bytes[12] == 1);
    CHECK(bytes[13] == 0);
    CHECK(bytes[14] == 0);
    CHECK(bytes[15] == 0);
}
