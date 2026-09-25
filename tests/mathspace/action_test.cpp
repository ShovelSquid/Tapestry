// action_test.cpp — the action grammar: every kind through encode/apply
// equals the direct mutator call, and every malformed byte pattern is
// BadAction with the world untouched.
#include <doctest.h>

#include "mathspace/action.hpp"
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

using Bytes = std::vector<std::uint8_t>;

Field vec(const char* name, std::uint8_t dim, std::int32_t v0 = 0, std::int32_t v1 = 0) {
    Field f;
    f.name = name;
    f.dim = dim;
    f.value[0] = fx64::from_int(v0);
    f.value[1] = fx64::from_int(v1);
    return f;
}

// A world with one 2-space (id 1) and one note (id 2) in it, built by
// direct calls.
World base(NoteId* space_out, NoteId* note_out) {
    World w(3);
    *space_out = NoteId{1};
    *note_out = NoteId{2};
    REQUIRE(w.create_space(*space_out, 2) == Error::Ok);
    REQUIRE(w.create_note(*note_out, space_of(*space_out), NoteKind::Note) == Error::Ok);
    return w;
}

// Applies `action` to a copy of `w`, checks the result code and that a
// failure left the copy byte-identical, and returns the copy.
World apply_checked(const World& w, const Bytes& action, Error expected) {
    World copy = w;
    const Error got = copy.apply(action);
    CHECK(got == expected);
    CHECK(error_name(got) == error_name(expected));
    if (got != Error::Ok) {
        CHECK(copy == w);
        CHECK(serialize(copy) == serialize(w));
    }
    return copy;
}

} // namespace

TEST_CASE("header layout is ddsim's: kind, version 1, reserved 0, payload_len") {
    const Bytes a = encode_create_space(NoteId{0x0102}, 2);
    REQUIRE(a.size() == ACTION_HEADER_BYTES + 9);
    CHECK(a[0] == 32);
    CHECK(a[1] == ACTION_VERSION);
    CHECK(a[2] == 0);
    CHECK(a[3] == 0);
    CHECK(a[4] == 9);
    CHECK(a[5] == 0);
    CHECK(a[6] == 0);
    CHECK(a[7] == 0);
    CHECK(a[8] == 2);  // id, little-endian
    CHECK(a[9] == 1);
    CHECK(a[15] == 0);
    CHECK(a[16] == 2); // dim
    CHECK(encode_create_note(NoteId{}, SpaceId{}, NoteKind::Note)[0] == 33);
    CHECK(encode_set_field(NoteId{}, vec("a", 1))[0] == 34);
    CHECK(encode_delete_note(NoteId{})[0] == 35);
    CHECK(encode_delete_field(NoteId{}, "a")[0] == 36);
}

TEST_CASE("CreateSpace through apply equals the direct call") {
    World direct(3);
    REQUIRE(direct.create_space(NoteId{1}, 2) == Error::Ok);

    World w(3);
    REQUIRE(w.apply(encode_create_space(NoteId{1}, 2)) == Error::Ok);
    CHECK(w == direct);
    CHECK(w.apply(encode_create_space(NoteId{2}, 3)) == Error::Ok);
    CHECK(w.notes.size() == 2);

    apply_checked(w, encode_create_space(NoteId{3}, 0), Error::BadDim);
    apply_checked(w, encode_create_space(NoteId{3}, 9), Error::BadDim);
    apply_checked(w, encode_create_space(NoteId{}, 2), Error::DuplicateId);
    apply_checked(w, encode_create_space(NoteId{1}, 2), Error::DuplicateId);
}

TEST_CASE("CreateNote through apply equals the direct call") {
    NoteId s, n;
    const World w = base(&s, &n);
    World direct = w;
    const NoteId d{3};
    REQUIRE(direct.create_note(d, space_of(s), NoteKind::Rule) == Error::Ok);

    World got = apply_checked(w, encode_create_note(d, space_of(s), NoteKind::Rule), Error::Ok);
    CHECK(got == direct);

    apply_checked(w, encode_create_note(d, space_of(s), NoteKind::Space), Error::BadKind);
    apply_checked(w, encode_create_note(d, space_of(n), NoteKind::Note), Error::NoSuchSpace);
    apply_checked(w, encode_create_note(d, SpaceId{}, NoteKind::Note), Error::NoSuchSpace);
    apply_checked(w, encode_create_note(n, space_of(s), NoteKind::Note), Error::DuplicateId);
    apply_checked(w, encode_create_note(NoteId{}, space_of(s), NoteKind::Note), Error::DuplicateId);
    // A kind byte past the enum is BadKind, not BadAction: the bytes are
    // well-formed, the content is not.
    Bytes k = encode_create_note(d, space_of(s), NoteKind::Note);
    k.back() = 200;
    apply_checked(w, k, Error::BadKind);
}

TEST_CASE("SetField through apply equals the direct call") {
    NoteId s, n;
    const World w = base(&s, &n);
    Field f = vec("vel", 2, 4, -5);
    f.bound = true;
    f.bytecode = code_for(w, n, "[4, -5]");
    World direct = w;
    REQUIRE(direct.set_field(n, f) == Error::Ok);

    World got = apply_checked(w, encode_set_field(n, f), Error::Ok);
    CHECK(got == direct);
    CHECK(*find_field(*got.find(n), "vel") == *find_field(*direct.find(n), "vel"));

    // Content errors come from the mutator.
    apply_checked(w, encode_set_field(n, vec("pos", 3)), Error::PosDimMismatch);
    apply_checked(w, encode_set_field(NoteId{9}, vec("a", 1)), Error::NoSuchNote);
    apply_checked(w, encode_set_field(n, vec("", 1)), Error::BadName);
    apply_checked(w, encode_set_field(n, vec("a\x01", 1)), Error::BadName);
    apply_checked(w, encode_set_field(n, vec("abcdefghijklmnopqrstuvwxyz012345", 1)), Error::BadName);
    apply_checked(w, encode_set_field(n, vec("a", 0)), Error::BadDim);
    // dim 9 has no meaningful lane count, so it is a grammar error.
    apply_checked(w, encode_set_field(n, vec("a", 9)), Error::BadAction);
    // bound must be 0 or 1.
    Bytes b = encode_set_field(n, vec("a", 1));
    b[ACTION_HEADER_BYTES + 8 + 1 + 1 + 1] = 2;
    apply_checked(w, b, Error::BadAction);
    // Bytecode is validated by the mutator: garbage, a dim that differs
    // from the field's, bytecode on an unbound field, none on a bound one.
    Field bad = vec("a", 1);
    bad.bound = true;
    bad.bytecode = {9, 8, 7};
    apply_checked(w, encode_set_field(n, bad), Error::BadBytecode);
    bad.bytecode = code_for(w, n, "[1, 2]");
    apply_checked(w, encode_set_field(n, bad), Error::BadBytecode);
    bad.bound = false;
    apply_checked(w, encode_set_field(n, bad), Error::BadBytecode);
    bad.bytecode.clear();
    bad.bound = true;
    apply_checked(w, encode_set_field(n, bad), Error::BadBytecode);
}

TEST_CASE("BindField through apply equals the direct call") {
    NoteId s, n;
    const World w = base(&s, &n);
    const Bytes code = code_for(w, n, "[1, 2] * 3");
    World direct = w;
    REQUIRE(direct.bind_field(n, "vel", code) == Error::Ok);
    World got = apply_checked(w, encode_bind_field(n, "vel", code), Error::Ok);
    CHECK(got == direct);
    const Field* vel = find_field(*got.find(n), "vel");
    REQUIRE(vel != nullptr);
    CHECK(vel->bound);
    CHECK(vel->dim == 2);
    CHECK(vel->bytecode == code);
    CHECK(vel->value[0].raw == 0);

    // Rebinding at the same dim keeps the lanes; a new dim zeroes them.
    REQUIRE(got.set_field(n, vec("vel", 2, 7, 8)) == Error::Ok);
    got = apply_checked(got, encode_bind_field(n, "vel", code), Error::Ok);
    CHECK(find_field(*got.find(n), "vel")->value[0] == fx64::from_int(7));
    CHECK(find_field(*got.find(n), "vel")->bound);
    got = apply_checked(got, encode_bind_field(n, "vel", code_for(got, n, "5")), Error::Ok);
    CHECK(find_field(*got.find(n), "vel")->dim == 1);
    CHECK(find_field(*got.find(n), "vel")->value[0].raw == 0);

    // Unbind keeps dim and lanes, drops the bytecode.
    World unbound = apply_checked(got, encode_bind_field(n, "vel", {}), Error::Ok);
    const Field* u = find_field(*unbound.find(n), "vel");
    REQUIRE(u != nullptr);
    CHECK_FALSE(u->bound);
    CHECK(u->bytecode.empty());
    CHECK(u->dim == 1);
    World direct2 = got;
    REQUIRE(direct2.bind_field(n, "vel", {}) == Error::Ok);
    CHECK(unbound == direct2);

    // Content errors.
    apply_checked(w, encode_bind_field(n, "nothere", {}), Error::NoSuchField);
    apply_checked(w, encode_bind_field(NoteId{9}, "vel", code), Error::NoSuchNote);
    apply_checked(w, encode_bind_field(n, "", code), Error::BadName);
    apply_checked(w, encode_bind_field(n, "vel", {1, 2, 3}), Error::BadBytecode);
    // pos keeps its dim rule: a dim-1 program cannot bind pos in a 2-space.
    apply_checked(w, encode_bind_field(n, "pos", code_for(w, n, "5")), Error::PosDimMismatch);
    apply_checked(w, encode_bind_field(n, "pos", code_for(w, n, "[5, 6]")), Error::Ok);
    // Oversized code length is a grammar error.
    Bytes big = encode_bind_field(n, "vel", code);
    big[ACTION_HEADER_BYTES + 8 + 1 + 3 + 2] = 0x01; // code_len byte 2 -> 65536 + n
    apply_checked(w, big, Error::BadAction);
}

TEST_CASE("DeleteNote and DeleteField through apply equal the direct calls") {
    NoteId s, n;
    World w = base(&s, &n);
    REQUIRE(w.set_field(n, vec("mass", 1, 2)) == Error::Ok);

    World direct = w;
    REQUIRE(direct.delete_field(n, "mass") == Error::Ok);
    World got = apply_checked(w, encode_delete_field(n, "mass"), Error::Ok);
    CHECK(got == direct);
    apply_checked(w, encode_delete_field(n, "nope"), Error::NoSuchField);
    apply_checked(w, encode_delete_field(s, "pos"), Error::LockedField);
    apply_checked(w, encode_delete_field(NoteId{9}, "mass"), Error::NoSuchNote);

    REQUIRE(direct.delete_note(n) == Error::Ok);
    got = apply_checked(got, encode_delete_note(n), Error::Ok);
    CHECK(got == direct);
    apply_checked(w, encode_delete_note(s), Error::SpaceNotEmpty);
    apply_checked(w, encode_delete_note(NoteId{9}), Error::NoSuchNote);
}

TEST_CASE("malformed headers are BadAction and leave the world untouched") {
    NoteId s, n;
    const World w = base(&s, &n);
    const Bytes good = encode_create_space(NoteId{3}, 2);

    SUBCASE("null and short") {
        World copy = w;
        CHECK(copy.apply(nullptr, 9) == Error::BadAction);
        CHECK(copy.apply(Bytes{}) == Error::BadAction);
        for (std::size_t len = 0; len < good.size(); ++len) {
            CAPTURE(len);
            World c = w;
            CHECK(c.apply(good.data(), len) == Error::BadAction);
            CHECK(c == w);
        }
    }
    SUBCASE("wrong version") {
        Bytes a = good;
        a[1] = 2;
        apply_checked(w, a, Error::BadAction);
    }
    SUBCASE("reserved not zero") {
        Bytes a = good;
        a[2] = 1;
        apply_checked(w, a, Error::BadAction);
        a[2] = 0;
        a[3] = 1;
        apply_checked(w, a, Error::BadAction);
    }
    SUBCASE("unknown kinds, including ddsim's") {
        for (const std::uint8_t kind : {std::uint8_t{0}, std::uint8_t{1}, std::uint8_t{6}, std::uint8_t{31},
                                        std::uint8_t{37}, std::uint8_t{255}}) {
            CAPTURE(kind);
            Bytes a = good;
            a[0] = kind;
            apply_checked(w, a, Error::BadAction);
        }
    }
    SUBCASE("payload_len disagrees with the buffer") {
        Bytes a = good;
        a[4] = 2;
        apply_checked(w, a, Error::BadAction);
        a[4] = 0;
        apply_checked(w, a, Error::BadAction);
    }
    SUBCASE("trailing byte with a matching payload_len") {
        Bytes a = good;
        a.push_back(0);
        a[4] = 2;
        apply_checked(w, a, Error::BadAction);
    }
}

TEST_CASE("every kind rejects a truncated or extended payload") {
    NoteId s, n;
    const World w = base(&s, &n);
    Field f = vec("vel", 2, 1, 2);
    f.bound = true;
    f.bytecode = code_for(w, n, "[1, 2]");
    const Bytes actions[] = {
        encode_create_space(NoteId{3}, 3),
        encode_create_note(NoteId{3}, space_of(s), NoteKind::Note),
        encode_set_field(n, f),
        encode_delete_note(n),
        encode_delete_field(n, "pos"),
        encode_bind_field(n, "vel", f.bytecode),
    };
    for (const Bytes& a : actions) {
        CAPTURE(a[0]);
        // Sanity: the intact action is accepted (DeleteField pos on a
        // member note is fine; the note has no pos yet, so NoSuchField).
        World c = w;
        const Error ok = c.apply(a);
        CHECK((ok == Error::Ok || ok == Error::NoSuchField));
        for (std::size_t cut = ACTION_HEADER_BYTES; cut < a.size(); ++cut) {
            CAPTURE(cut);
            Bytes t(a.begin(), a.begin() + static_cast<std::ptrdiff_t>(cut));
            t[4] = static_cast<std::uint8_t>(cut - ACTION_HEADER_BYTES);
            apply_checked(w, t, Error::BadAction);
        }
        Bytes longer = a;
        longer.push_back(0);
        longer[4] = static_cast<std::uint8_t>(longer.size() - ACTION_HEADER_BYTES);
        apply_checked(w, longer, Error::BadAction);
    }
}

TEST_CASE("a log of actions replays to the same hash as the direct build") {
    World direct(11);
    const NoteId s{1}, a{2}, b{3};
    REQUIRE(direct.create_space(s, 2) == Error::Ok);
    REQUIRE(direct.create_note(a, space_of(s), NoteKind::Note) == Error::Ok);
    REQUIRE(direct.create_note(b, space_of(s), NoteKind::Note) == Error::Ok);
    REQUIRE(direct.set_field(a, vec("pos", 2, 1, 2)) == Error::Ok);
    REQUIRE(direct.set_field(b, vec("pos", 2, 3, 4)) == Error::Ok);
    REQUIRE(direct.delete_note(a) == Error::Ok);
    direct.step();

    const Bytes log[] = {
        encode_create_space(s, 2),
        encode_create_note(a, space_of(s), NoteKind::Note),
        encode_create_note(b, space_of(s), NoteKind::Note),
        encode_set_field(a, vec("pos", 2, 1, 2)),
        encode_set_field(b, vec("pos", 2, 3, 4)),
        encode_delete_note(a),
    };
    World replayed(11);
    for (const Bytes& action : log) {
        REQUIRE(replayed.apply(action) == Error::Ok);
    }
    replayed.step();
    CHECK(replayed == direct);
    std::uint8_t h1[32], h2[32];
    hash(direct, h1);
    hash(replayed, h2);
    CHECK(std::vector<std::uint8_t>(h1, h1 + 32) == std::vector<std::uint8_t>(h2, h2 + 32));
}
