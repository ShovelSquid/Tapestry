// c_abi_test.cpp — mathspace_c.h driven only through its C functions,
// checked against the same sequence on a World. The plugin's Wasm build
// exports exactly these symbols, so this is the contract engine.js sees.
#include <doctest.h>

#include "mathspace/action.hpp"
#include "mathspace/expr/bytecode.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"
#include "mathspace/mathspace_c.h"
#include "mathspace/world.hpp"

#include <cstdint>
#include <cstring>
#include <string>
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

int applyTo(ms_world* w, const std::vector<std::uint8_t>& a) {
    return ms_apply(w, a.data(), static_cast<uint32_t>(a.size()));
}

std::vector<std::uint8_t> hashOf(const ms_world* w) {
    std::uint8_t d[32] = {};
    ms_hash(w, d);
    return std::vector<std::uint8_t>(d, d + 32);
}

std::vector<std::uint8_t> hashOf(const World& w) {
    std::uint8_t d[32] = {};
    hash(w, d);
    return std::vector<std::uint8_t>(d, d + 32);
}

std::vector<std::uint8_t> notesOf(const ms_world* w) {
    const uint8_t* p = ms_notes_ptr(w);
    return std::vector<std::uint8_t>(p, p + ms_notes_len(w));
}

struct Handle {
    ms_world* w;
    explicit Handle(std::uint64_t seed) : w(ms_create(seed)) {}
    ~Handle() { ms_destroy(w); }
};

} // namespace

TEST_CASE("version and a fresh handle") {
    CHECK(ms_version() == MS_ABI_VERSION);
    Handle h(9);
    REQUIRE(h.w != nullptr);
    CHECK(ms_tick(h.w) == 0);
    CHECK(ms_notes_len(h.w) == 0);
    CHECK(hashOf(h.w) == hashOf(World(9)));
}

TEST_CASE("apply, step, hash and snapshot agree with a World") {
    Handle h(3);
    World w(3);
    const std::vector<std::vector<std::uint8_t>> acts = {encode_create_space(S, 2), encode_create_note(A, space_of(S), NoteKind::Note),
                       encode_set_field(A, vec("pos", 2, 1, 2)), encode_set_field(A, vec("velocity", 2, 0, 1))};
    for (const auto& a : acts) {
        CHECK(applyTo(h.w, a) == MS_OK);
        REQUIRE(w.apply(a) == Error::Ok);
    }
    for (int i = 0; i < 5; ++i) {
        ms_step(h.w);
        w.step();
    }
    CHECK(ms_tick(h.w) == 5);
    CHECK(hashOf(h.w) == hashOf(w));
    CHECK(notesOf(h.w) == w.notes_bytes());
}

TEST_CASE("error codes are the World's, and a rejected apply changes nothing") {
    Handle h(1);
    REQUIRE(applyTo(h.w, encode_create_space(S, 2)) == MS_OK);
    const auto before = hashOf(h.w);
    CHECK(applyTo(h.w, encode_create_space(S, 2)) == MS_ERR_DUPLICATE_ID);
    CHECK(applyTo(h.w, encode_create_space(NoteId{5}, 0)) == MS_ERR_BAD_DIM);
    CHECK(applyTo(h.w, encode_create_note(A, SpaceId{77}, NoteKind::Note)) == MS_ERR_NO_SUCH_SPACE);
    CHECK(applyTo(h.w, encode_set_field(S, vec("pos", 3))) == MS_ERR_POS_DIM_MISMATCH);
    CHECK(applyTo(h.w, encode_delete_field(S, "pos")) == MS_ERR_LOCKED_FIELD);
    CHECK(applyTo(h.w, encode_delete_field(S, "nope")) == MS_ERR_NO_SUCH_FIELD);
    CHECK(applyTo(h.w, encode_delete_note(NoteId{42})) == MS_ERR_NO_SUCH_NOTE);
    const std::uint8_t junk[3] = {0xff, 0xff, 0xff};
    CHECK(ms_apply(h.w, junk, 3) == MS_ERR_BAD_ACTION);
    CHECK(ms_apply(h.w, nullptr, 0) == MS_ERR_BAD_ACTION);
    CHECK(hashOf(h.w) == before);
    CHECK(ms_tick(h.w) == 0);
}

TEST_CASE("serialize follows the cap protocol and restore is its inverse") {
    Handle h(5);
    REQUIRE(applyTo(h.w, encode_create_space(S, 1)) == MS_OK);
    REQUIRE(applyTo(h.w, encode_create_note(A, space_of(S), NoteKind::Note)) == MS_OK);
    REQUIRE(applyTo(h.w, encode_set_field(A, vec("pos", 1, 8))) == MS_OK);
    ms_step(h.w);
    const uint32_t needed = ms_serialize(h.w, nullptr, 0);
    REQUIRE(needed > 0);
    std::vector<std::uint8_t> small(needed - 1);
    CHECK(ms_serialize(h.w, small.data(), needed - 1) == 0);
    std::vector<std::uint8_t> bytes(needed);
    CHECK(ms_serialize(h.w, bytes.data(), needed) == needed);

    Handle r(5);
    CHECK(ms_restore(r.w, bytes.data(), needed) == MS_OK);
    CHECK(ms_tick(r.w) == 1);
    CHECK(hashOf(r.w) == hashOf(h.w));
    CHECK(notesOf(r.w) == notesOf(h.w));

    // Bad bytes: rejected, state untouched.
    bytes[0] ^= 0xff;
    const auto before = hashOf(r.w);
    CHECK(ms_restore(r.w, bytes.data(), needed) == MS_ERR_BAD_BYTES);
    CHECK(ms_restore(r.w, nullptr, 0) == MS_ERR_BAD_BYTES);
    CHECK(hashOf(r.w) == before);
}

TEST_CASE("null handles are inert") {
    CHECK(ms_tick(nullptr) == 0);
    CHECK(ms_notes_ptr(nullptr) == nullptr);
    CHECK(ms_notes_len(nullptr) == 0);
    CHECK(ms_serialize(nullptr, nullptr, 0) == 0);
    CHECK(ms_apply(nullptr, nullptr, 0) == MS_ERR_BAD_ACTION);
    CHECK(ms_restore(nullptr, nullptr, 0) == MS_ERR_BAD_BYTES);
    ms_step(nullptr);
    ms_destroy(nullptr);
}

TEST_CASE("ms_compile follows the cap protocol and matches the C++ compiler") {
    Handle h(2);
    World w(2);
    for (const auto& a : {encode_create_space(S, 2), encode_create_note(A, space_of(S), NoteKind::Note),
                          encode_set_field(A, vec("pos", 2, 1, 2)), encode_set_field(A, vec("k", 1, 3))}) {
        REQUIRE(applyTo(h.w, a) == MS_OK);
        REQUIRE(w.apply(a) == Error::Ok);
    }
    const std::string text = "self.pos * self.k + [1, 2]";
    const expr::ParseResult p = expr::parse(text);
    REQUIRE(p.ok());
    const expr::CompileResult c = expr::compile(p.ast, expr::WorldDims{w, *w.find(A)});
    REQUIRE(c.ok());
    const std::vector<std::uint8_t> want = expr::encode(c.program);

    const auto before = hashOf(h.w);
    uint32_t where = 77;
    const int32_t needed = ms_compile(h.w, A.value, text.data(), static_cast<uint32_t>(text.size()), nullptr, 0, &where);
    REQUIRE(needed == static_cast<int32_t>(want.size()));
    CHECK(where == 0);
    std::vector<std::uint8_t> small(static_cast<std::size_t>(needed) - 1);
    CHECK(ms_compile(h.w, A.value, text.data(), static_cast<uint32_t>(text.size()), small.data(),
                     static_cast<uint32_t>(small.size()), nullptr) == 0);
    std::vector<std::uint8_t> got(static_cast<std::size_t>(needed));
    CHECK(ms_compile(h.w, A.value, text.data(), static_cast<uint32_t>(text.size()), got.data(),
                     static_cast<uint32_t>(got.size()), &where) == needed);
    CHECK(got == want);
    CHECK(std::string(ms_compile_error_name(needed)) == "ok");

    // The bytes bind through action 37 and evaluate on step.
    REQUIRE(applyTo(h.w, encode_bind_field(A, "q", got)) == MS_OK);
    REQUIRE(w.bind_field(A, "q", want) == Error::Ok);
    ms_step(h.w);
    w.step();
    CHECK(hashOf(h.w) == hashOf(w));
    CHECK(find_field(*w.find(A), "q")->value[0] == fx64::from_int(4)); // 1*3 + 1
    CHECK(hashOf(h.w) != before);
}

TEST_CASE("ms_compile on a Rule note compiles for the rule's targets") {
    Handle h(2);
    World w(2);
    constexpr NoteId R{4};
    for (const auto& a : {encode_create_space(S, 2), encode_create_note(A, space_of(S), NoteKind::Note),
                          encode_set_field(A, vec("pos", 2, 1, 2)), encode_set_field(A, vec("mass", 1, 3)),
                          encode_create_note(R, space_of(S), NoteKind::Rule)}) {
        REQUIRE(applyTo(h.w, a) == MS_OK);
        REQUIRE(w.apply(a) == Error::Ok);
    }
    // The rule has neither pos nor mass; the space and A supply the dims.
    const std::string text = "self.pos * self.mass";
    const expr::ParseResult p = expr::parse(text);
    REQUIRE(p.ok());
    const expr::CompileResult c = expr::compile(p.ast, expr::RuleDims{w, *w.find(R)});
    REQUIRE(c.ok());
    const std::vector<std::uint8_t> want = expr::encode(c.program);
    std::vector<std::uint8_t> got(want.size());
    CHECK(ms_compile(h.w, R.value, text.data(), static_cast<uint32_t>(text.size()), got.data(),
                     static_cast<uint32_t>(got.size()), nullptr) == static_cast<int32_t>(want.size()));
    CHECK(got == want);
    // Bound as the rule's force it moves A once A has a velocity.
    REQUIRE(applyTo(h.w, encode_bind_field(R, "force", got)) == MS_OK);
    REQUIRE(applyTo(h.w, encode_set_field(A, vec("velocity", 2))) == MS_OK);
    REQUIRE(w.bind_field(R, "force", want) == Error::Ok);
    REQUIRE(w.set_field(A, vec("velocity", 2)) == Error::Ok);
    ms_step(h.w);
    w.step();
    CHECK(hashOf(h.w) == hashOf(w));
    CHECK(find_field(*w.find(A), "pos")->value[0] == fx64::from_int(2)); // 1 + 1*3/3
    CHECK(find_field(*w.find(A), "pos")->value[1] == fx64::from_int(4));
}

TEST_CASE("ms_compile failures carry the stage, the code and where") {
    Handle h(2);
    REQUIRE(applyTo(h.w, encode_create_space(S, 2)) == MS_OK);
    REQUIRE(applyTo(h.w, encode_create_note(A, space_of(S), NoteKind::Note)) == MS_OK);
    REQUIRE(applyTo(h.w, encode_set_field(A, vec("pos", 2))) == MS_OK);
    const auto before = hashOf(h.w);
    uint32_t where = 0;
    auto compile = [&](std::uint64_t note, const char* text) {
        where = 99;
        return ms_compile(h.w, note, text, static_cast<uint32_t>(std::strlen(text)), nullptr, 0, &where);
    };

    int32_t r = compile(42, "1");
    CHECK(r == -((MS_STAGE_WORLD << 8) | MS_ERR_NO_SUCH_NOTE));
    CHECK(std::string(ms_compile_error_name(r)) == "world:NoSuchNote");

    r = compile(A.value, "1 + 0.1");
    CHECK(r == -((MS_STAGE_PARSE << 8) | static_cast<int>(expr::ParseError::InexactNumber)));
    CHECK(where == 4);
    CHECK(std::string(ms_compile_error_name(r)) == "parse:InexactNumber");

    r = compile(A.value, "self.pos + 1");
    CHECK(r == -((MS_STAGE_COMPILE << 8) | static_cast<int>(expr::CompileError::DimMismatch)));
    CHECK(std::string(ms_compile_error_name(r)) == "compile:DimMismatch");

    r = compile(A.value, "self.nope");
    CHECK(r == -((MS_STAGE_COMPILE << 8) | static_cast<int>(expr::CompileError::UnknownRef)));
    CHECK(std::string(ms_compile_error_name(r)) == "compile:UnknownRef");

    r = ms_compile(nullptr, A.value, "1", 1, nullptr, 0, nullptr);
    CHECK(r == -((MS_STAGE_WORLD << 8) | MS_ERR_BAD_BYTES));
    CHECK(ms_compile(h.w, A.value, nullptr, 3, nullptr, 0, nullptr) == r);
    // Empty text is a parse error, not a crash.
    CHECK(ms_compile(h.w, A.value, nullptr, 0, nullptr, 0, nullptr) < 0);
    CHECK(std::string(ms_compile_error_name(-((7 << 8) | 1))) == "?");
    CHECK(hashOf(h.w) == before);
}
