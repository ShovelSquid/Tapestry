// world_test.cpp — the store: create, set, delete, id handling, and the
// rule that a rejected call leaves the world byte-identical.
#include <doctest.h>

#include "mathspace/world.hpp"

using namespace mathspace;

namespace {

Field vec(const char* name, std::uint8_t dim, std::int32_t v0 = 0) {
    Field f;
    f.name = name;
    f.dim = dim;
    f.value[0] = fx64::from_int(v0);
    return f;
}

constexpr NoteId S{1};
constexpr NoteId A{2};
constexpr NoteId B{3};
constexpr NoteId C{4};

} // namespace

TEST_CASE("create_space makes a Space note with a zero pos of that dim") {
    World w(7);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_space(A, 3) == Error::Ok);
    CHECK(w.notes.size() == 2);
    CHECK(w.notes[0].id == S);
    CHECK(w.notes[1].id == A);
    CHECK(w.space_dim(space_of(S)) == 2);
    CHECK(w.space_dim(space_of(A)) == 3);
    CHECK(w.find(S)->kind == NoteKind::Space);
    CHECK_FALSE(w.find(S)->space.assigned());
    CHECK(find_field(*w.find(A), POS_FIELD)->value[2] == fx64{});
    CHECK(w.well_formed());
    CHECK(w.seed == 7);
}

TEST_CASE("create_space rejects bad dims, zero and duplicate ids, untouched") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    const World before = w;
    CHECK(w.create_space(A, 0) == Error::BadDim);
    CHECK(w.create_space(A, 9) == Error::BadDim);
    CHECK(w.create_space(NoteId{}, 2) == Error::DuplicateId);
    CHECK(w.create_space(S, 2) == Error::DuplicateId);
    CHECK(w == before);
}

TEST_CASE("create_note stores the given id, in the space, of the asked kind") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Rule) == Error::Ok);
    CHECK(w.find(A)->space == space_of(S));
    CHECK(w.find(B)->kind == NoteKind::Rule);
    CHECK(w.find(A)->fields.empty());
    CHECK(w.notes_in(space_of(S)) == 2);
    CHECK(w.well_formed());
}

TEST_CASE("create_note rejects missing spaces, non-spaces, kind Space, bad ids") {
    World w;
    REQUIRE(w.create_space(S, 1) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    const World before = w;
    CHECK(w.create_note(B, SpaceId{}, NoteKind::Note) == Error::NoSuchSpace);
    CHECK(w.create_note(B, SpaceId{99}, NoteKind::Note) == Error::NoSuchSpace);
    CHECK(w.create_note(B, space_of(A), NoteKind::Note) == Error::NoSuchSpace);
    CHECK(w.create_note(B, space_of(S), NoteKind::Space) == Error::BadKind);
    CHECK(w.create_note(NoteId{}, space_of(S), NoteKind::Note) == Error::DuplicateId);
    CHECK(w.create_note(A, space_of(S), NoteKind::Note) == Error::DuplicateId);
    CHECK(w.create_note(S, space_of(S), NoteKind::Note) == Error::DuplicateId);
    CHECK(w == before);
}

TEST_CASE("ids need not arrive in order; the store keeps them sorted") {
    World w;
    REQUIRE(w.create_space(NoteId{10}, 2) == Error::Ok);
    REQUIRE(w.create_note(NoteId{30}, SpaceId{10}, NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(NoteId{20}, SpaceId{10}, NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_space(NoteId{5}, 1) == Error::Ok);
    CHECK(w.notes[0].id == NoteId{5});
    CHECK(w.notes[1].id == NoteId{10});
    CHECK(w.notes[2].id == NoteId{20});
    CHECK(w.notes[3].id == NoteId{30});
    CHECK(w.well_formed());
}

TEST_CASE("set_field stores values and enforces the pos dim") {
    World w;
    REQUIRE(w.create_space(S, 3) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    CHECK(w.set_field(A, vec("mass", 1, 5)) == Error::Ok);
    CHECK(w.set_field(A, vec("pos", 3, 1)) == Error::Ok);
    CHECK(w.find(A)->fields.size() == 2);
    CHECK(w.find(A)->fields[0].name == "mass");
    CHECK(w.find(A)->fields[1].name == "pos");

    const World before = w;
    CHECK(w.set_field(A, vec("pos", 2, 1)) == Error::PosDimMismatch);
    CHECK(w.set_field(A, vec("", 1)) == Error::BadName);
    CHECK(w.set_field(A, vec("x", 0)) == Error::BadDim);
    CHECK(w.set_field(NoteId{}, vec("x", 1)) == Error::NoSuchNote);
    CHECK(w.set_field(NoteId{42}, vec("x", 1)) == Error::NoSuchNote);
    CHECK(w == before);

    // Replacing pos with the right dim, and any other field with any dim.
    CHECK(w.set_field(A, vec("pos", 3, 9)) == Error::Ok);
    CHECK(find_field(*w.find(A), "pos")->value[0] == fx64::from_int(9));
    CHECK(w.set_field(A, vec("mass", 8, 1)) == Error::Ok);
    CHECK(w.well_formed());
}

TEST_CASE("a Space's own pos may be rewritten only at its dim") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    const World before = w;
    CHECK(w.set_field(S, vec("pos", 3)) == Error::PosDimMismatch);
    CHECK(w == before);
    CHECK(w.set_field(S, vec("pos", 2, 4)) == Error::Ok);
    CHECK(w.space_dim(space_of(S)) == 2);
    CHECK(w.set_field(S, vec("gravity", 2, 1)) == Error::Ok);
    CHECK(w.well_formed());
}

TEST_CASE("delete_field removes, rejects missing, and locks a Space's pos") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("mass", 1)) == Error::Ok);

    const World before = w;
    CHECK(w.delete_field(A, "nope") == Error::NoSuchField);
    CHECK(w.delete_field(NoteId{}, "mass") == Error::NoSuchNote);
    CHECK(w.delete_field(S, "pos") == Error::LockedField);
    CHECK(w == before);

    CHECK(w.delete_field(A, "mass") == Error::Ok);
    CHECK(w.delete_field(A, "pos") == Error::Ok); // a member note may lose its pos
    CHECK(w.find(A)->fields.empty());
    CHECK(w.well_formed());
}

TEST_CASE("delete_note removes a note and refuses a non-empty space") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(B, space_of(S), NoteKind::Note) == Error::Ok);

    const World before = w;
    CHECK(w.delete_note(S) == Error::SpaceNotEmpty);
    CHECK(w.delete_note(NoteId{}) == Error::NoSuchNote);
    CHECK(w.delete_note(NoteId{50}) == Error::NoSuchNote);
    CHECK(w == before);

    CHECK(w.delete_note(B) == Error::Ok);
    CHECK(w.find(B) == nullptr);
    CHECK(w.delete_note(B) == Error::NoSuchNote);
    // The store does not remember deleted ids; not reusing them is the
    // kernel's promise (ids.hpp).
    REQUIRE(w.create_note(C, space_of(S), NoteKind::Note) == Error::Ok);
    CHECK(w.find(A)->id == A); // A is where it was

    CHECK(w.delete_note(A) == Error::Ok);
    CHECK(w.delete_note(C) == Error::Ok);
    CHECK(w.delete_note(S) == Error::Ok);
    CHECK(w.notes.empty());
    CHECK(w.well_formed());
}

TEST_CASE("notes stay in id order and find is exact") {
    World w;
    REQUIRE(w.create_space(S, 1) == Error::Ok);
    NoteId ids[6];
    for (std::size_t i = 0; i < 6; ++i) {
        ids[i] = NoteId{10 * (i + 1)};
        REQUIRE(w.create_note(ids[i], space_of(S), NoteKind::Note) == Error::Ok);
    }
    for (std::size_t i = 1; i < w.notes.size(); ++i) {
        CHECK(w.notes[i - 1].id < w.notes[i].id);
    }
    CHECK(w.find(ids[3])->id == ids[3]);
    CHECK(w.note_lower_bound(NoteId{25}) == 3);
    CHECK(w.find(NoteId{25}) == nullptr);
}

TEST_CASE("step advances the tick and nothing else") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    World before = w;
    w.step();
    w.step();
    CHECK(w.tick == 2);
    before.tick = 2;
    CHECK(w == before);
}

TEST_CASE("well_formed catches a pos of the wrong dim poked in directly") {
    World w;
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    CHECK(w.well_formed());
    mathspace::set_field(*w.find(A), vec("pos", 3));
    CHECK_FALSE(w.well_formed());
}
