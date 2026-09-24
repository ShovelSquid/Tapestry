// mathspace/ms_c.cpp — the flat C ABI. Every function is a forward into
// World with a null check; no validation lives here. The error enum in
// the header is the C++ one by value, checked below so the two cannot
// drift without a compile error.
#include "mathspace/mathspace_c.h"

#include "mathspace/world.hpp"

#include <cstdint>
#include <cstring>
#include <new>
#include <vector>

struct ms_world {
    mathspace::World world;
    explicit ms_world(std::uint64_t seed) : world(seed) {}
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
    return code(mathspace::restore(w->world, in, len));
}

const uint8_t* ms_notes_ptr(const ms_world* w) { return w == nullptr ? nullptr : w->world.notes_bytes().data(); }

uint32_t ms_notes_len(const ms_world* w) {
    return w == nullptr ? 0 : static_cast<uint32_t>(w->world.notes_bytes().size());
}

} // extern "C"
