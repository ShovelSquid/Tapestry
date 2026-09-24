// world_test.cpp — the store: create, set, delete, id stability, and the
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

} // namespace

TEST_CASE("create_space makes a Space note with a zero pos of that dim") {
    World w(7);
    NoteId s2, s3;
    REQUIRE(w.create_space(2, &s2) == Error::Ok);
    REQUIRE(w.create_space(3, &s3) == Error::Ok);
    CHECK(w.notes.size() == 2);
    CHECK(note_group(s2) == 1);
    CHECK(note_group(s3) == 2);
    CHECK(note_index(s2) == 0);
    CHECK(w.next_group == 3);
    CHECK(w.space_dim(space_of(s2)) == 2);
    CHECK(w.space_dim(space_of(s3)) == 3);
    CHECK(w.find(s2)->kind == NoteKind::Space);
    CHECK_FALSE(w.find(s2)->space.assigned());
    CHECK(find_field(*w.find(s3), POS_FIELD)->value[2] == fx64{});
    CHECK(w.well_formed());
    CHECK(w.seed == 7);
}

TEST_CASE("create_space rejects bad dims and leaves the world untouched") {
    World w;
    const World before = w;
    NoteId id{};
    CHECK(w.create_space(0, &id) == Error::BadDim);
    CHECK(w.create_space(9, &id) == Error::BadDim);
    CHECK(w == before);
    CHECK_FALSE(id.assigned());
}

TEST_CASE("create_note takes the next group, in the space, of the asked kind") {
    World w;
    NoteId s, a, b;
    REQUIRE(w.create_space(2, &s) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &a) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Rule, &b) == Error::Ok);
    CHECK(note_group(a) == 2);
    CHECK(note_group(b) == 3);
    CHECK(w.find(a)->space == space_of(s));
    CHECK(w.find(b)->kind == NoteKind::Rule);
    CHECK(w.find(a)->fields.empty());
    CHECK(w.notes_in(space_of(s)) == 2);
    CHECK(w.well_formed());
}

TEST_CASE("create_note rejects missing spaces, non-spaces and kind Space") {
    World w;
    NoteId s, n;
    REQUIRE(w.create_space(1, &s) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &n) == Error::Ok);
    const World before = w;
    NoteId out{};
    CHECK(w.create_note(SpaceId{}, NoteKind::Note, &out) == Error::NoSuchSpace);
    CHECK(w.create_note(space_of(make_note_id(0, 99, 0)), NoteKind::Note, &out) == Error::NoSuchSpace);
    CHECK(w.create_note(space_of(n), NoteKind::Note, &out) == Error::NoSuchSpace);
    CHECK(w.create_note(space_of(s), NoteKind::Space, &out) == Error::BadKind);
    CHECK(w == before);
    CHECK_FALSE(out.assigned());
}

TEST_CASE("set_field stores values and enforces the pos dim") {
    World w;
    NoteId s, n;
    REQUIRE(w.create_space(3, &s) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &n) == Error::Ok);
    CHECK(w.set_field(n, vec("mass", 1, 5)) == Error::Ok);
    CHECK(w.set_field(n, vec("pos", 3, 1)) == Error::Ok);
    CHECK(w.find(n)->fields.size() == 2);
    CHECK(w.find(n)->fields[0].name == "mass");
    CHECK(w.find(n)->fields[1].name == "pos");

    const World before = w;
    CHECK(w.set_field(n, vec("pos", 2, 1)) == Error::PosDimMismatch);
    CHECK(w.set_field(n, vec("", 1)) == Error::BadName);
    CHECK(w.set_field(n, vec("x", 0)) == Error::BadDim);
    CHECK(w.set_field(NoteId{}, vec("x", 1)) == Error::NoSuchNote);
    CHECK(w.set_field(make_note_id(0, 42, 0), vec("x", 1)) == Error::NoSuchNote);
    CHECK(w == before);

    // Replacing pos with the right dim, and any other field with any dim.
    CHECK(w.set_field(n, vec("pos", 3, 9)) == Error::Ok);
    CHECK(find_field(*w.find(n), "pos")->value[0] == fx64::from_int(9));
    CHECK(w.set_field(n, vec("mass", 8, 1)) == Error::Ok);
    CHECK(w.well_formed());
}

TEST_CASE("a Space's own pos may be rewritten only at its dim") {
    World w;
    NoteId s;
    REQUIRE(w.create_space(2, &s) == Error::Ok);
    const World before = w;
    CHECK(w.set_field(s, vec("pos", 3)) == Error::PosDimMismatch);
    CHECK(w == before);
    CHECK(w.set_field(s, vec("pos", 2, 4)) == Error::Ok);
    CHECK(w.space_dim(space_of(s)) == 2);
    CHECK(w.set_field(s, vec("gravity", 2, 1)) == Error::Ok);
    CHECK(w.well_formed());
}

TEST_CASE("delete_field removes, rejects missing, and locks a Space's pos") {
    World w;
    NoteId s, n;
    REQUIRE(w.create_space(2, &s) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &n) == Error::Ok);
    REQUIRE(w.set_field(n, vec("pos", 2)) == Error::Ok);
    REQUIRE(w.set_field(n, vec("mass", 1)) == Error::Ok);

    const World before = w;
    CHECK(w.delete_field(n, "nope") == Error::NoSuchField);
    CHECK(w.delete_field(NoteId{}, "mass") == Error::NoSuchNote);
    CHECK(w.delete_field(s, "pos") == Error::LockedField);
    CHECK(w == before);

    CHECK(w.delete_field(n, "mass") == Error::Ok);
    CHECK(w.delete_field(n, "pos") == Error::Ok); // a member note may lose its pos
    CHECK(w.find(n)->fields.empty());
    CHECK(w.well_formed());
}

TEST_CASE("delete_note removes a note, refuses a non-empty space, never reuses ids") {
    World w;
    NoteId s, a, b;
    REQUIRE(w.create_space(2, &s) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &a) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &b) == Error::Ok);

    const World before = w;
    CHECK(w.delete_note(s) == Error::SpaceNotEmpty);
    CHECK(w.delete_note(NoteId{}) == Error::NoSuchNote);
    CHECK(w.delete_note(make_note_id(0, 50, 0)) == Error::NoSuchNote);
    CHECK(w == before);

    CHECK(w.delete_note(b) == Error::Ok);
    CHECK(w.find(b) == nullptr);
    CHECK(w.delete_note(b) == Error::NoSuchNote);
    NoteId c;
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &c) == Error::Ok);
    CHECK(c != b);
    CHECK(note_group(c) == 4);
    CHECK(w.find(a)->id == a); // a is where it was

    CHECK(w.delete_note(a) == Error::Ok);
    CHECK(w.delete_note(c) == Error::Ok);
    CHECK(w.delete_note(s) == Error::Ok);
    CHECK(w.notes.empty());
    CHECK(w.next_group == 5);
    CHECK(w.well_formed());
}

TEST_CASE("notes stay in id order and find is exact") {
    World w;
    NoteId s;
    REQUIRE(w.create_space(1, &s) == Error::Ok);
    NoteId ids[6];
    for (NoteId& id : ids) {
        REQUIRE(w.create_note(space_of(s), NoteKind::Note, &id) == Error::Ok);
    }
    for (std::size_t i = 1; i < w.notes.size(); ++i) {
        CHECK(w.notes[i - 1].id < w.notes[i].id);
    }
    CHECK(w.find(ids[3])->id == ids[3]);
    CHECK(w.note_lower_bound(make_note_id(0, 3, 1)) == 3);
    CHECK(w.find(make_note_id(0, 3, 1)) == nullptr);
}

TEST_CASE("step advances the tick and nothing else") {
    World w;
    NoteId s;
    REQUIRE(w.create_space(2, &s) == Error::Ok);
    World before = w;
    w.step();
    w.step();
    CHECK(w.tick == 2);
    before.tick = 2;
    CHECK(w == before);
}

TEST_CASE("group ordinal exhaustion is reported, not wrapped") {
    World w;
    w.next_group = static_cast<std::uint32_t>(ID_GROUP_MASK);
    NoteId s;
    REQUIRE(w.create_space(1, &s) == Error::Ok);
    CHECK(note_group(s) == ID_GROUP_MASK);
    CHECK(w.next_group == 0); // wrapped counter means exhausted
    const World before = w;
    NoteId out{};
    CHECK(w.create_space(1, &out) == Error::IdExhausted);
    CHECK(w.create_note(space_of(s), NoteKind::Note, &out) == Error::IdExhausted);
    CHECK(w == before);
}

TEST_CASE("well_formed catches a pos of the wrong dim poked in directly") {
    World w;
    NoteId s, n;
    REQUIRE(w.create_space(2, &s) == Error::Ok);
    REQUIRE(w.create_note(space_of(s), NoteKind::Note, &n) == Error::Ok);
    CHECK(w.well_formed());
    mathspace::set_field(*w.find(n), vec("pos", 3));
    CHECK_FALSE(w.well_formed());
}
