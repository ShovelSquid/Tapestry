// ids_test.cpp — NoteId layout: (branch, group, index) packs, unpacks, and
// orders numerically the same way ddsim's NodeId does.
#include <doctest.h>

#include "mathspace/ids.hpp"
#include "mathspace/version.hpp"

using namespace mathspace;

TEST_CASE("NoteId packs and unpacks each field") {
    const NoteId id = make_note_id(3, 0x12345678u, 0xABCDEFu);
    CHECK(id.assigned());
    CHECK(note_branch(id) == 3);
    CHECK(note_group(id) == 0x12345678u);
    CHECK(note_index(id) == 0xABCDEFu);
    CHECK(id.value == 0x0312345678ABCDEFull);
}

TEST_CASE("NoteId fields are masked to their width") {
    const NoteId id = make_note_id(0, 1, 0xFFFFFFFFu);
    CHECK(note_group(id) == 1);
    CHECK(note_index(id) == ID_INDEX_MASK);
}

TEST_CASE("NoteId orders by branch, then group, then index") {
    CHECK(make_note_id(0, 2, 0) < make_note_id(1, 1, 0));
    CHECK(make_note_id(0, 1, 5) < make_note_id(0, 2, 0));
    CHECK(make_note_id(0, 1, 1) < make_note_id(0, 1, 2));
    CHECK(NoteId{} == NoteId{0});
    CHECK_FALSE(NoteId{}.assigned());
}

TEST_CASE("NoteId layout matches ddsim NodeId") {
    const NoteId n = make_note_id(7, 9, 11);
    const ddsim::NodeId d = ddsim::make_node_id(7, 9, 11);
    CHECK(n.value == d.value);
}

TEST_CASE("SpaceId round-trips through NoteId") {
    const NoteId n = make_note_id(0, 4, 0);
    CHECK(note_of(space_of(n)) == n);
    CHECK_FALSE(SpaceId{}.assigned());
}

TEST_CASE("version string is set") {
    CHECK(version() != nullptr);
}
