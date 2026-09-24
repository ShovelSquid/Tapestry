// hash_test.cpp — the canonical walk: round trip, strictness under every
// single-byte tamper, untouched state on failure, and sensitivity to
// everything operator== sees.
#include <doctest.h>

#include "mathspace/world.hpp"

#include <array>
#include <string>

using namespace mathspace;

namespace {

using Digest = std::array<std::uint8_t, 32>;

Digest digest(const World& w) {
    Digest d{};
    hash(w, d.data());
    return d;
}

Field vec(const char* name, std::uint8_t dim, std::int32_t v0 = 0, std::int32_t v1 = 0) {
    Field f;
    f.name = name;
    f.dim = dim;
    f.value[0] = fx64::from_int(v0);
    f.value[1] = fx64::from_int(v1);
    return f;
}

// Two spaces, three notes, a bound field with bytecode, a deleted note
// so the ids have a gap, and a few ticks.
World sample() {
    World w(42);
    const NoteId s2{1}, s3{2}, a{3}, b{4}, gone{5}, c{6};
    REQUIRE(w.create_space(s2, 2) == Error::Ok);
    REQUIRE(w.create_space(s3, 3) == Error::Ok);
    REQUIRE(w.create_note(a, space_of(s2), NoteKind::Note) == Error::Ok);
    REQUIRE(w.create_note(b, space_of(s2), NoteKind::Rule) == Error::Ok);
    REQUIRE(w.create_note(gone, space_of(s3), NoteKind::View) == Error::Ok);
    REQUIRE(w.create_note(c, space_of(s3), NoteKind::Note) == Error::Ok);
    REQUIRE(w.set_field(a, vec("pos", 2, 3, -4)) == Error::Ok);
    REQUIRE(w.set_field(a, vec("mass", 1, 5)) == Error::Ok);
    Field bound = vec("vel", 2, 1, 1);
    bound.bound = true;
    bound.bytecode = {0x01, 0x02, 0x03};
    REQUIRE(w.set_field(b, bound) == Error::Ok);
    REQUIRE(w.set_field(c, vec("pos", 3, 9)) == Error::Ok);
    REQUIRE(w.delete_note(gone) == Error::Ok);
    w.step();
    w.step();
    REQUIRE(w.well_formed());
    return w;
}

} // namespace

TEST_CASE("empty world serializes to the header alone and round-trips") {
    World w;
    const auto bytes = serialize(w);
    // magic 4 | 2 pins 8 | seed 8 | tick 8 | note_count 4
    CHECK(bytes.size() == 32);
    CHECK(bytes[0] == 'M');
    CHECK(bytes[3] == '1');
    World back(99);
    back.tick = 5;
    CHECK(restore(back, bytes) == Error::Ok);
    CHECK(back == w);
    CHECK(digest(back) == digest(w));
}

TEST_CASE("serialize then restore gives an equal world with an equal hash") {
    const World w = sample();
    const auto bytes = serialize(w);
    World back;
    REQUIRE(restore(back, bytes) == Error::Ok);
    CHECK(back == w);
    CHECK(digest(back) == digest(w));
    CHECK(serialize(back) == bytes);
    // And the restored world accepts the same next create as the original.
    World w2 = w;
    REQUIRE(w2.create_note(NoteId{7}, space_of(w2.notes[0].id), NoteKind::Note) == Error::Ok);
    REQUIRE(back.create_note(NoteId{7}, space_of(back.notes[0].id), NoteKind::Note) == Error::Ok);
    CHECK(back == w2);
}

TEST_CASE("hash is a pure function of state") {
    CHECK(digest(sample()) == digest(sample()));
    World copy = sample();
    CHECK(digest(copy) == digest(sample()));
}

TEST_CASE("every single-byte tamper is rejected or changes the hash") {
    const World w = sample();
    const auto bytes = serialize(w);
    const Digest original = digest(w);
    for (std::size_t i = 0; i < bytes.size(); ++i) {
        for (const std::uint8_t delta : {std::uint8_t{1}, std::uint8_t{0x80}}) {
            auto t = bytes;
            t[i] = static_cast<std::uint8_t>(t[i] ^ delta);
            World back;
            const Error e = restore(back, t);
            if (e == Error::Ok) {
                CAPTURE(i);
                CHECK(back != w);
                CHECK(digest(back) != original);
                CHECK(serialize(back) == t);
            } else {
                CHECK(e == Error::BadBytes);
            }
        }
    }
}

TEST_CASE("truncation and trailing bytes are rejected") {
    const auto bytes = serialize(sample());
    for (std::size_t len = 0; len < bytes.size(); ++len) {
        World back;
        CAPTURE(len);
        CHECK(restore(back, bytes.data(), len) == Error::BadBytes);
    }
    auto longer = bytes;
    longer.push_back(0);
    World back;
    CHECK(restore(back, longer) == Error::BadBytes);
    CHECK(restore(back, nullptr, 4) == Error::BadBytes);
}

TEST_CASE("a failed restore leaves the target untouched") {
    World target = sample();
    const World before = target;
    auto bytes = serialize(World(1));
    bytes.pop_back();
    CHECK(restore(target, bytes) == Error::BadBytes);
    CHECK(target == before);
    CHECK(serialize(target) == serialize(before));
}

TEST_CASE("restore refuses a walk that decodes but is not well formed") {
    World w = sample();
    // A member note whose pos dim disagrees with its space: the byte
    // grammar accepts it, well_formed does not.
    Note& a = w.notes[2];
    REQUIRE(a.kind == NoteKind::Note);
    find_field(a, POS_FIELD)->dim = 1;
    REQUIRE_FALSE(w.well_formed());
    World back;
    CHECK(restore(back, serialize(w)) == Error::BadBytes);

    // A member note whose space is missing.
    World w2 = sample();
    w2.notes[4].space = SpaceId{99};
    REQUIRE_FALSE(w2.well_formed());
    CHECK(restore(back, serialize(w2)) == Error::BadBytes);
}

TEST_CASE("hash changes with every part of the state operator== sees") {
    const World base = sample();
    const Digest h = digest(base);
    const NoteId a = base.notes[2].id;

    SUBCASE("seed") {
        World w = base;
        w.seed += 1;
        CHECK(digest(w) != h);
    }
    SUBCASE("tick") {
        World w = base;
        w.step();
        CHECK(digest(w) != h);
    }
    SUBCASE("note id") {
        World w = base;
        w.notes.back().id = NoteId{w.notes.back().id.value + 1};
        CHECK(digest(w) != h);
    }
    SUBCASE("field value") {
        World w = base;
        REQUIRE(w.set_field(a, vec("mass", 1, 6)) == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("field value in a later lane") {
        World w = base;
        REQUIRE(w.set_field(a, vec("pos", 2, 3, -5)) == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("field name") {
        World w = base;
        REQUIRE(w.delete_field(a, "mass") == Error::Ok);
        REQUIRE(w.set_field(a, vec("mast", 1, 5)) == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("field dim") {
        World w = base;
        REQUIRE(w.set_field(a, vec("mass", 2, 5)) == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("field bound flag") {
        World w = base;
        Field f = vec("mass", 1, 5);
        f.bound = true;
        REQUIRE(w.set_field(a, f) == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("field bytecode") {
        World w = base;
        Field f = *find_field(*w.find(base.notes[3].id), "vel");
        f.bytecode.push_back(0x04);
        REQUIRE(w.set_field(base.notes[3].id, f) == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("field added and removed") {
        World w = base;
        REQUIRE(w.set_field(a, vec("extra", 1)) == Error::Ok);
        CHECK(digest(w) != h);
        REQUIRE(w.delete_field(a, "extra") == Error::Ok);
        CHECK(digest(w) == h);
        REQUIRE(w.delete_field(a, "mass") == Error::Ok);
        CHECK(digest(w) != h);
    }
    SUBCASE("note kind") {
        World w = base;
        w.notes[2].kind = NoteKind::Rule;
        CHECK(digest(w) != h);
    }
    SUBCASE("note space") {
        World w = base;
        // Move note a from the 2-space to the 3-space; pos dim must follow.
        w.notes[2].space = space_of(base.notes[1].id);
        REQUIRE(w.delete_field(a, "pos") == Error::Ok);
        REQUIRE(w.well_formed());
        CHECK(digest(w) != h);
    }
    SUBCASE("note deleted") {
        World w = base;
        REQUIRE(w.delete_note(a) == Error::Ok);
        CHECK(digest(w) != h);
    }
}

TEST_CASE("set_field refuses the 256th name and fields_well_formed agrees") {
    World w;
    const NoteId s{1}, n{2};
    REQUIRE(w.create_space(s, 1) == Error::Ok);
    REQUIRE(w.create_note(n, space_of(s), NoteKind::Note) == Error::Ok);
    for (std::size_t i = 0; i < MAX_FIELDS; ++i) {
        REQUIRE(w.set_field(n, vec(("f" + std::to_string(1000 + i)).c_str(), 1)) == Error::Ok);
    }
    const World before = w;
    CHECK(w.set_field(n, vec("g", 1)) == Error::TooManyFields);
    CHECK(w == before);
    // Replacing an existing name at capacity is still fine.
    CHECK(w.set_field(n, vec("f1000", 1, 7)) == Error::Ok);
    World back;
    REQUIRE(restore(back, serialize(w)) == Error::Ok);
    CHECK(back == w);
    w.notes[1].fields.push_back(vec("zz", 1));
    CHECK_FALSE(w.well_formed());
}
