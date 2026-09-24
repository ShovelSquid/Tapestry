/*
 * mathspace/mathspace_c.h — the flat C ABI of the engine, shared by the
 * native tests and the Wasm build the plugin loads.
 *
 * Compiles as C and as C++. Every function is a one-line forward into
 * mathspace::World (src/mathspace/ms_c.cpp) with a null check; no
 * validation lives here. Only integers and byte buffers cross. The shape
 * copies ddsim_c.h on purpose so the plugin's loader (engine.js) can be
 * the data-drawing one with the prefix changed.
 *
 * Tick semantics: ms_tick() is the number of steps taken. Actions stamped
 * for tick t are applied while ms_tick() == t, then ms_step() makes it
 * t+1. The engine knows no other clock.
 *
 * Snapshot (ms_notes_ptr/len): the notes read-out of world.hpp, per note
 * in id order:
 *   u64 id | u8 field_count | per field in name order:
 *     u8 name_len | name | u8 dim | dim x i64 (raw fx64, Q32.32)
 * The pointer is valid until the next ms_apply, ms_step, ms_restore or
 * ms_destroy.
 */
#ifndef MATHSPACE_C_H
#define MATHSPACE_C_H

#include <stdint.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define MS_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define MS_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* One-to-one with mathspace::Error (world.hpp); ms_c.cpp asserts it. */
enum ms_error {
    MS_OK = 0,
    MS_ERR_BAD_DIM = 1,
    MS_ERR_BAD_NAME = 2,
    MS_ERR_BAD_KIND = 3,
    MS_ERR_NO_SUCH_SPACE = 4,
    MS_ERR_NO_SUCH_NOTE = 5,
    MS_ERR_NO_SUCH_FIELD = 6,
    MS_ERR_POS_DIM_MISMATCH = 7,
    MS_ERR_SPACE_NOT_EMPTY = 8,
    MS_ERR_LOCKED_FIELD = 9,
    MS_ERR_DUPLICATE_ID = 10,
    MS_ERR_TOO_MANY_FIELDS = 11,
    MS_ERR_BAD_BYTES = 12,
    MS_ERR_BAD_ACTION = 13
};

enum ms_layout {
    MS_ABI_VERSION = 1,
    MS_HASH_BYTES = 32
};

typedef struct ms_world ms_world;

MS_EXPORT uint32_t ms_version(void);
MS_EXPORT ms_world* ms_create(uint64_t seed);
MS_EXPORT void ms_destroy(ms_world* w);

/* Canonical little-endian action bytes (action.hpp). Returns MS_OK or an
 * MS_ERR_* code; on any error the state is byte-identical. */
MS_EXPORT int ms_apply(ms_world* w, const uint8_t* action, uint32_t len);
MS_EXPORT void ms_step(ms_world* w);
MS_EXPORT uint64_t ms_tick(const ms_world* w);
MS_EXPORT void ms_hash(const ms_world* w, uint8_t out[32]);

/* cap == 0 returns the needed length and writes nothing; an insufficient
 * cap returns 0 and writes nothing. */
MS_EXPORT uint32_t ms_serialize(const ms_world* w, uint8_t* out, uint32_t cap);
MS_EXPORT int ms_restore(ms_world* w, const uint8_t* in, uint32_t len);

MS_EXPORT const uint8_t* ms_notes_ptr(const ms_world* w);
MS_EXPORT uint32_t ms_notes_len(const ms_world* w);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* MATHSPACE_C_H */
