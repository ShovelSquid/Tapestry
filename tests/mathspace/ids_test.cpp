// ids_test.cpp — NoteId is a plain u64 that orders numerically; SpaceId is
// the same value under a distinct type.
#include <doctest.h>

#include "mathspace/ids.hpp"
#include "mathspace/version.hpp"

using namespace mathspace;

TEST_CASE("NoteId is a plain value: zero is unassigned, order is numeric") {
    CHECK(NoteId{} == NoteId{0});
    CHECK_FALSE(NoteId{}.assigned());
    CHECK(NoteId{1}.assigned());
    CHECK(NoteId{1} < NoteId{2});
    CHECK(NoteId{2} < NoteId{0x0100000000000000ull});
    CHECK(NoteId{5} != NoteId{6});
}

TEST_CASE("SpaceId round-trips through NoteId") {
    const NoteId n{4};
    CHECK(note_of(space_of(n)) == n);
    CHECK(space_of(n).value == 4);
    CHECK_FALSE(SpaceId{}.assigned());
}

TEST_CASE("version string is set") {
    CHECK(version() != nullptr);
}
