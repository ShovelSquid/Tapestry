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
 *
 * Errors (ms_errors_ptr/len, RULE-07): what the last ms_step skipped,
 * per Rule note that skipped anything, in id order:
 *   u64 rule id | u32 skipped | u8 reason
 * `skipped` counts visits (a whole-rule skip counts once); `reason` is
 * the last skip's (world.hpp Skip: below 16 an expr::VmError), named by
 * ms_skip_reason_name. Diagnostics only: not in the hash, the serialized
 * world or the snapshot; empty before the first step and after
 * ms_restore. The pointer is valid until the next ms_step, ms_restore or
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
    MS_ERR_BAD_ACTION = 13,
    MS_ERR_BAD_BYTECODE = 14
};

/* ms_compile's failure code is -(stage << 8 | code): stage 0 is an
 * ms_error (no such note, null argument), stage 1 an expr::ParseError with
 * the byte offset in `where`, stage 2 an expr::CompileError with the Ast
 * node index in `where`. ms_compile_error_name turns any of them into a
 * static string such as "parse:InexactNumber" for the plugin's problems
 * list; "ok" for a non-negative value. */
enum ms_compile_stage {
    MS_STAGE_WORLD = 0,
    MS_STAGE_PARSE = 1,
    MS_STAGE_COMPILE = 2
};

/* 1: initial. 2: ms_errors_ptr/len and ms_skip_reason_name. */
enum ms_layout {
    MS_ABI_VERSION = 2,
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

MS_EXPORT const uint8_t* ms_errors_ptr(const ms_world* w);
MS_EXPORT uint32_t ms_errors_len(const ms_world* w);
/* A static name such as "NoSuchField" or "WrongDim"; "?" when unknown. */
MS_EXPORT const char* ms_skip_reason_name(uint8_t reason);

/* Compiles the expression `text` (len bytes, no terminator) for a field
 * of `note`, resolving `self` and `node(nN)` refs against the world as it
 * is now, and writes the encoded bytecode (expr/bytecode.hpp) that a
 * BindField action (kind 37) carries. Same cap protocol as ms_serialize:
 * cap 0 returns the needed length and writes nothing; an insufficient
 * cap returns 0 and writes nothing. A negative return is a failure (see
 * ms_compile_stage); `where` may be null. Compiling never changes the
 * world. On a Rule note the program is compiled for the rule's targets
 * (vm.hpp, RuleDims): `self.pos` is the space dim, other fields take the
 * dim of the first note in the space that has them. */
MS_EXPORT int32_t ms_compile(const ms_world* w, uint64_t note, const char* text, uint32_t len,
                             uint8_t* out, uint32_t cap, uint32_t* where);
MS_EXPORT const char* ms_compile_error_name(int32_t result);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* MATHSPACE_C_H */
