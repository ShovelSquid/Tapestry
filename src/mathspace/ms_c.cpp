// mathspace/ms_c.cpp — the flat C ABI. Every function is a forward into
// World with a null check; no validation lives here. The error enum in
// the header is the C++ one by value, checked below so the two cannot
// drift without a compile error.
#include "mathspace/mathspace_c.h"

#include "mathspace/expr/bytecode.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"
#include "mathspace/world.hpp"
#include "wire.hpp"

#include <cstdint>
#include <cstring>
#include <new>
#include <string_view>
#include <vector>

struct ms_world {
    mathspace::World world;
    // World::reports encoded as the header says, rebuilt by ms_step and
    // cleared by ms_restore (a restored world has no reports).
    std::vector<std::uint8_t> errors;
    explicit ms_world(std::uint64_t seed) : world(seed) {}

    void encode_errors() {
        errors.clear();
        for (const mathspace::RuleReport& r : world.reports) {
            mathspace::wire::put_u64(errors, r.rule.value);
            mathspace::wire::put_u32(errors, r.skipped);
            mathspace::wire::put_u8(errors, r.reason);
        }
    }
};

namespace {

using mathspace::Error;

static_assert(static_cast<int>(Error::Ok) == MS_OK);
static_assert(static_cast<int>(Error::BadDim) == MS_ERR_BAD_DIM);
static_assert(static_cast<int>(Error::BadName) == MS_ERR_BAD_NAME);
static_assert(static_cast<int>(Error::BadKind) == MS_ERR_BAD_KIND);
static_assert(static_cast<int>(Error::NoSuchSpace) == MS_ERR_NO_SUCH_SPACE);
static_assert(static_cast<int>(Error::NoSuchNote) == MS_ERR_NO_SUCH_NOTE);
static_assert(static_cast<int>(Error::NoSuchField) == MS_ERR_NO_SUCH_FIELD);
static_assert(static_cast<int>(Error::PosDimMismatch) == MS_ERR_POS_DIM_MISMATCH);
static_assert(static_cast<int>(Error::SpaceNotEmpty) == MS_ERR_SPACE_NOT_EMPTY);
static_assert(static_cast<int>(Error::LockedField) == MS_ERR_LOCKED_FIELD);
static_assert(static_cast<int>(Error::DuplicateId) == MS_ERR_DUPLICATE_ID);
static_assert(static_cast<int>(Error::TooManyFields) == MS_ERR_TOO_MANY_FIELDS);
static_assert(static_cast<int>(Error::BadBytes) == MS_ERR_BAD_BYTES);
static_assert(static_cast<int>(Error::BadAction) == MS_ERR_BAD_ACTION);
static_assert(static_cast<int>(Error::BadBytecode) == MS_ERR_BAD_BYTECODE);

int32_t failure(int stage, int code) { return -static_cast<int32_t>((stage << 8) | code); }

int code(Error e) { return static_cast<int>(e); }

} // namespace

extern "C" {

uint32_t ms_version(void) { return MS_ABI_VERSION; }

ms_world* ms_create(uint64_t seed) { return new (std::nothrow) ms_world(seed); }

void ms_destroy(ms_world* w) { delete w; }

int ms_apply(ms_world* w, const uint8_t* action, uint32_t len) {
    if (w == nullptr || action == nullptr) {
        return MS_ERR_BAD_ACTION;
    }
    return code(w->world.apply(action, len));
}

void ms_step(ms_world* w) {
    if (w != nullptr) {
        w->world.step();
        w->encode_errors();
    }
}

uint64_t ms_tick(const ms_world* w) { return w == nullptr ? 0 : w->world.tick; }

void ms_hash(const ms_world* w, uint8_t out[32]) {
    if (w == nullptr || out == nullptr) {
        return;
    }
    mathspace::hash(w->world, out);
}

uint32_t ms_serialize(const ms_world* w, uint8_t* out, uint32_t cap) {
    if (w == nullptr) {
        return 0;
    }
    const std::vector<std::uint8_t> bytes = mathspace::serialize(w->world);
    const uint32_t needed = static_cast<uint32_t>(bytes.size());
    if (cap == 0) {
        return needed;
    }
    if (out == nullptr || cap < needed) {
        return 0;
    }
    std::memcpy(out, bytes.data(), needed);
    return needed;
}

int ms_restore(ms_world* w, const uint8_t* in, uint32_t len) {
    if (w == nullptr || in == nullptr) {
        return MS_ERR_BAD_BYTES;
    }
    const int rc = code(mathspace::restore(w->world, in, len));
    if (rc == MS_OK) {
        w->errors.clear();
    }
    return rc;
}

const uint8_t* ms_notes_ptr(const ms_world* w) { return w == nullptr ? nullptr : w->world.notes_bytes().data(); }

uint32_t ms_notes_len(const ms_world* w) {
    return w == nullptr ? 0 : static_cast<uint32_t>(w->world.notes_bytes().size());
}

const uint8_t* ms_errors_ptr(const ms_world* w) { return w == nullptr ? nullptr : w->errors.data(); }

uint32_t ms_errors_len(const ms_world* w) { return w == nullptr ? 0 : static_cast<uint32_t>(w->errors.size()); }

const char* ms_skip_reason_name(uint8_t reason) { return mathspace::skip_name(reason); }

int32_t ms_compile(const ms_world* w, uint64_t note, const char* text, uint32_t len, uint8_t* out, uint32_t cap,
                   uint32_t* where) {
    if (where != nullptr) {
        *where = 0;
    }
    if (w == nullptr || (text == nullptr && len != 0)) {
        return failure(MS_STAGE_WORLD, MS_ERR_BAD_BYTES);
    }
    const mathspace::Note* self = w->world.find(mathspace::NoteId{note});
    if (self == nullptr) {
        return failure(MS_STAGE_WORLD, MS_ERR_NO_SUCH_NOTE);
    }
    const mathspace::expr::ParseResult p = mathspace::expr::parse(std::string_view(text, len));
    if (!p.ok()) {
        if (where != nullptr) {
            *where = p.offset;
        }
        return failure(MS_STAGE_PARSE, static_cast<int>(p.error));
    }
    // A Rule note's program runs against its targets, so its dims come
    // from the space, not from the rule note (vm.hpp, RuleDims).
    const mathspace::expr::CompileResult c =
        self->kind == mathspace::NoteKind::Rule
            ? mathspace::expr::compile(p.ast, mathspace::expr::RuleDims{w->world, *self})
            : mathspace::expr::compile(p.ast, mathspace::expr::WorldDims{w->world, *self});
    if (!c.ok()) {
        if (where != nullptr) {
            *where = c.where;
        }
        return failure(MS_STAGE_COMPILE, static_cast<int>(c.error));
    }
    const std::vector<std::uint8_t> bytes = mathspace::expr::encode(c.program);
    const uint32_t needed = static_cast<uint32_t>(bytes.size());
    if (cap == 0) {
        return static_cast<int32_t>(needed);
    }
    if (out == nullptr || cap < needed) {
        return 0;
    }
    std::memcpy(out, bytes.data(), needed);
    return static_cast<int32_t>(needed);
}

const char* ms_compile_error_name(int32_t result) {
    if (result >= 0) {
        return "ok";
    }
    const int packed = -result;
    const int stage = packed >> 8;
    const int c = packed & 0xff;
    // Static tables so the pointer outlives the call (the Wasm side reads
    // it with UTF8ToString). One entry per enumerator, in enum order.
    static const char* const world_names[] = {
        "ok", "world:BadDim", "world:BadName", "world:BadKind", "world:NoSuchSpace", "world:NoSuchNote",
        "world:NoSuchField", "world:PosDimMismatch", "world:SpaceNotEmpty", "world:LockedField",
        "world:DuplicateId", "world:TooManyFields", "world:BadBytes", "world:BadAction", "world:BadBytecode"};
    static const char* const parse_names[] = {
        "ok", "parse:UnexpectedChar", "parse:UnexpectedEnd", "parse:UnexpectedToken", "parse:TrailingInput",
        "parse:InexactNumber", "parse:NumberTooLarge", "parse:UnknownFunction", "parse:BadArity",
        "parse:BadComponent", "parse:BadNodeId", "parse:BadName", "parse:VectorTooLong", "parse:TooDeep",
        "parse:TooManyNodes"};
    static const char* const compile_names[] = {
        "ok", "compile:DimMismatch", "compile:NotScalar", "compile:NestedVector", "compile:BadLane",
        "compile:UnknownRef", "compile:EmptyAst", "compile:TooManyOps", "compile:StackTooDeep",
        "compile:BadBytes", "compile:BadJump", "compile:BadStack"};
    static_assert(sizeof(world_names) / sizeof(world_names[0]) == MS_ERR_BAD_BYTECODE + 1);
    static_assert(sizeof(parse_names) / sizeof(parse_names[0]) ==
                  static_cast<int>(mathspace::expr::ParseError::TooManyNodes) + 1);
    static_assert(sizeof(compile_names) / sizeof(compile_names[0]) ==
                  static_cast<int>(mathspace::expr::CompileError::BadStack) + 1);
    switch (stage) {
    case MS_STAGE_WORLD:
        return c < static_cast<int>(sizeof(world_names) / sizeof(world_names[0])) ? world_names[c] : "world:?";
    case MS_STAGE_PARSE:
        return c < static_cast<int>(sizeof(parse_names) / sizeof(parse_names[0])) ? parse_names[c] : "parse:?";
    case MS_STAGE_COMPILE:
        return c < static_cast<int>(sizeof(compile_names) / sizeof(compile_names[0])) ? compile_names[c] : "compile:?";
    default:
        return "?";
    }
}

} // extern "C"
