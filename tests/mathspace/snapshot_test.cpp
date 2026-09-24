// snapshot_test.cpp — World::notes_bytes: the plugin's read-out after a
// step. Checked against a hand-built byte expectation, and for the lazy
// cache's invariants: same bytes across serialize/restore, changed by a
// step that moves something, untouched by a rejected apply.
#include <doctest.h>

#include "mathspace/action.hpp"
#include "mathspace/world.hpp"

#include <cstdint>
#include <string_view>
#include <vector>

using namespace mathspace;

namespace {

Field vec(const char* name, std::uint8_t dim, std::int32_t v0 = 0, std::int32_t v1 = 0) {
    Field f;
    f.name = name;
    f.dim = dim;
    f.value[0] = fx64::from_int(v0);
    f.value[1] = fx64::from_int(v1);
    return f;
}

constexpr NoteId S{1};
constexpr NoteId A{2};

void u8(std::vector<std::uint8_t>& out, std::uint8_t v) { out.push_back(v); }
void u64(std::vector<std::uint8_t>& out, std::uint64_t v) {
    for (unsigned i = 0; i < 8; ++i) out.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
}
void i64(std::vector<std::uint8_t>& out, std::int64_t v) { u64(out, static_cast<std::uint64_t>(v)); }
void name(std::vector<std::uint8_t>& out, std::string_view s) {
    u8(out, static_cast<std::uint8_t>(s.size()));
    out.insert(out.end(), s.begin(), s.end());
}

// A two-note world: space S (dim 2) and note A with pos (3, -4) and
// velocity (1, 0). `velocity` sorts after `pos`.
World two_notes() {
    World w(7);
    REQUIRE(w.create_space(S, 2) == Error::Ok);
    REQUIRE(w.create_note(A, space_of(S), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(A, vec("pos", 2, 3, -4)) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2, 1, 0)) == Error::Ok);
    return w;
}

} // namespace

TEST_CASE("empty world has empty snapshot") {
    World w;
    CHECK(w.notes_bytes().empty());
}

TEST_CASE("snapshot bytes match the hand-built layout") {
    World w = two_notes();
    std::vector<std::uint8_t> want;
    // note S: one field, pos dim 2 zero
    u64(want, 1);
    u8(want, 1);
    name(want, "pos");
    u8(want, 2);
    i64(want, 0);
    i64(want, 0);
    // note A: pos then velocity
    u64(want, 2);
    u8(want, 2);
    name(want, "pos");
    u8(want, 2);
    i64(want, std::int64_t{3} << 32);
    i64(want, -(std::int64_t{4} << 32));
    name(want, "velocity");
    u8(want, 2);
    i64(want, std::int64_t{1} << 32);
    i64(want, 0);
    CHECK(w.notes_bytes() == want);
    // Reading twice is the cached copy, and identical.
    CHECK_FALSE(w.notes_dirty);
    CHECK(w.notes_bytes() == want);
}

TEST_CASE("snapshot survives serialize and restore") {
    World w = two_notes();
    const std::vector<std::uint8_t> before = w.notes_bytes();
    World r;
    REQUIRE(restore(r, serialize(w)) == Error::Ok);
    CHECK(r.notes_bytes() == before);
    CHECK(r == w);
}

TEST_CASE("a step that moves a note changes the snapshot") {
    World w = two_notes();
    const std::vector<std::uint8_t> before = w.notes_bytes();
    w.step();
    CHECK(w.notes_dirty);
    const std::vector<std::uint8_t>& after = w.notes_bytes();
    CHECK(after != before);
    CHECK(after.size() == before.size()); // same shape, one lane moved
    // Only pos.x of A moved: bytes differ exactly in that i64.
    std::size_t diffs = 0;
    for (std::size_t i = 0; i < before.size(); ++i) {
        if (before[i] != after[i]) ++diffs;
    }
    CHECK(diffs >= 1);
    CHECK(diffs <= 8);
}

TEST_CASE("a rejected apply leaves the snapshot untouched") {
    World w = two_notes();
    const std::vector<std::uint8_t> before = w.notes_bytes();
    // dim 3 pos in a dim 2 space: PosDimMismatch.
    const auto bytes = encode_set_field(A, vec("pos", 3));
    CHECK(w.apply(bytes) == Error::PosDimMismatch);
    CHECK_FALSE(w.notes_dirty);
    CHECK(w.notes_bytes() == before);
    // And an accepted one changes it.
    CHECK(w.apply(encode_set_field(A, vec("mass", 1, 5))) == Error::Ok);
    CHECK(w.notes_dirty);
    CHECK(w.notes_bytes() != before);
    CHECK(w.well_formed());
}

TEST_CASE("cache members do not enter equality or the hash") {
    World a = two_notes();
    World b = two_notes();
    (void)a.notes_bytes(); // a is clean, b is dirty
    CHECK(a == b);
    std::uint8_t ha[32], hb[32];
    hash(a, ha);
    hash(b, hb);
    CHECK(std::vector<std::uint8_t>(ha, ha + 32) == std::vector<std::uint8_t>(hb, hb + 32));
    CHECK(serialize(a) == serialize(b));
}
