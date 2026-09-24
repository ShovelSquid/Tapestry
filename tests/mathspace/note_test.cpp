// note_test.cpp — Field/Note helpers keep fields sorted by name, unique,
// validated, with unused lanes zero.
#include <doctest.h>

#include "mathspace/note.hpp"

using namespace mathspace;

namespace {

Field make(const char* name, std::uint8_t dim, std::int32_t v0) {
    Field f;
    f.name = name;
    f.dim = dim;
    f.value[0] = fx64::from_int(v0);
    return f;
}

} // namespace

TEST_CASE("set_field inserts in name order regardless of call order") {
    Note n;
    CHECK(set_field(n, make("pos", 2, 1)));
    CHECK(set_field(n, make("a", 1, 2)));
    CHECK(set_field(n, make("mass", 1, 3)));
    CHECK(set_field(n, make("zeta", 1, 4)));
    REQUIRE(n.fields.size() == 4);
    CHECK(n.fields[0].name == "a");
    CHECK(n.fields[1].name == "mass");
    CHECK(n.fields[2].name == "pos");
    CHECK(n.fields[3].name == "zeta");
    CHECK(fields_well_formed(n));
}

TEST_CASE("set_field replaces a field of the same name in place") {
    Note n;
    set_field(n, make("a", 1, 1));
    set_field(n, make("b", 1, 2));
    set_field(n, make("c", 1, 3));
    CHECK(set_field(n, make("b", 3, 9)));
    REQUIRE(n.fields.size() == 3);
    CHECK(n.fields[1].name == "b");
    CHECK(n.fields[1].dim == 3);
    CHECK(n.fields[1].value[0] == fx64::from_int(9));
    CHECK(fields_well_formed(n));
}

TEST_CASE("set_field zeroes lanes beyond dim") {
    Note n;
    Field f = make("v", 2, 5);
    f.value[2] = fx64::from_int(7);
    f.value[7] = fx64::from_int(8);
    CHECK(set_field(n, f));
    CHECK(n.fields[0].value[2] == fx64{});
    CHECK(n.fields[0].value[7] == fx64{});
    CHECK(fields_well_formed(n));

    // A well-formed note stops being so if a lane is poked directly.
    n.fields[0].value[5] = fx64::from_int(1);
    CHECK_FALSE(fields_well_formed(n));
}

TEST_CASE("set_field rejects invalid names and dims and leaves the note untouched") {
    Note n;
    set_field(n, make("keep", 1, 1));
    const Note before = n;

    CHECK_FALSE(set_field(n, make("", 1, 0)));
    CHECK_FALSE(set_field(n, make("0123456789012345678901234567890x", 1, 0))); // 32 bytes
    CHECK_FALSE(set_field(n, make("has\ttab", 1, 0)));
    CHECK_FALSE(set_field(n, make("d0", 0, 0)));
    CHECK_FALSE(set_field(n, make("d9", 9, 0)));
    CHECK(n == before);

    CHECK(set_field(n, make("0123456789012345678901234567890", 1, 0))); // 31 bytes
    CHECK(set_field(n, make("d8", 8, 0)));
    CHECK(fields_well_formed(n));
}

TEST_CASE("find_field and erase_field") {
    Note n;
    set_field(n, make("a", 1, 1));
    set_field(n, make("b", 1, 2));
    set_field(n, make("c", 1, 3));

    const Field* b = find_field(n, "b");
    REQUIRE(b != nullptr);
    CHECK(b->value[0] == fx64::from_int(2));
    CHECK(find_field(n, "bb") == nullptr);
    CHECK(find_field(n, "") == nullptr);

    CHECK(erase_field(n, "b"));
    CHECK_FALSE(erase_field(n, "b"));
    REQUIRE(n.fields.size() == 2);
    CHECK(n.fields[0].name == "a");
    CHECK(n.fields[1].name == "c");
    CHECK(fields_well_formed(n));

    find_field(n, "a")->value[0] = fx64::from_int(10);
    CHECK(find_field(static_cast<const Note&>(n), "a")->value[0] == fx64::from_int(10));
}

TEST_CASE("name order is byte order, not length order") {
    Note n;
    set_field(n, make("b", 1, 0));
    set_field(n, make("ab", 1, 0));
    set_field(n, make("a", 1, 0));
    CHECK(n.fields[0].name == "a");
    CHECK(n.fields[1].name == "ab");
    CHECK(n.fields[2].name == "b");
}

TEST_CASE("Note equality covers id, space, kind and fields") {
    Note a;
    a.id = NoteId{2};
    a.space = SpaceId{1};
    a.kind = NoteKind::Note;
    set_field(a, make("x", 1, 1));
    Note b = a;
    CHECK(a == b);
    b.kind = NoteKind::Rule;
    CHECK(a != b);
    b = a;
    set_field(b, make("x", 1, 2));
    CHECK(a != b);
    b = a;
    b.fields[0].bound = true;
    CHECK(a != b);
}
