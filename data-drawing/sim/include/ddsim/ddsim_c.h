/*
 * ddsim/ddsim_c.h — the flat C ABI shared by the native and Wasm builds.
 *
 * This header compiles as C and as C++. Every function is a one-line forward
 * into the C++ Sim class (src/ddsim_c.cpp); no validation lives in the
 * wrapper. Only integers and byte buffers cross this boundary.
 *
 * Tick semantics: dd_tick() is the number of steps taken. Actions stamped
 * for tick t are applied while dd_tick() == t, then dd_step() makes it t+1.
 * The sim knows no other clock.
 *
 * Snapshot records (little-endian, written field by field, never memcpy):
 *   node (88 bytes): u64 id@0 | i64 x@8 y@16 z@24 | i64 weight@32
 *                    | i64 dir_x@40 dir_y@48 | i64 vx@56 vy@64
 *                    | u32 tick@72 | u32 brush@76 | u32 scale_band@80
 *                    | u32 reserved@84
 *   body (56 bytes): u64 stroke_id@0 | i64 x@8 y@16 vx@24 vy@32
 *                    | i64 target_u@40 target_v@48   (plane-local Q32.32)
 */
#ifndef DDSIM_C_H
#define DDSIM_C_H

#include <stdint.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define DD_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define DD_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

enum dd_error {
    DD_OK = 0,
    DD_ERR_BAD_HEADER = 1,
    DD_ERR_UNKNOWN_KIND = 2,
    DD_ERR_BAD_LENGTH = 3,
    DD_ERR_TICK_MISMATCH = 4,
    DD_ERR_BRUSH_ID = 5,
    DD_ERR_BRUSH_INVALID = 6,
    DD_ERR_STROKE_STATE = 7,
    DD_ERR_SAMPLE_ORDER = 8,
    DD_ERR_LIMIT = 9,
    DD_ERR_RESTORE = 10,
    DD_ERR_SAMPLE_RANGE = 11
};

enum dd_layout {
    DD_NODE_STRIDE = 88,
    DD_BODY_STRIDE = 56,
    DD_HASH_BYTES = 32
};

typedef struct dd_sim dd_sim;

DD_EXPORT uint32_t dd_version(void);
DD_EXPORT dd_sim* dd_create(uint64_t seed);
DD_EXPORT void dd_destroy(dd_sim* sim);

/* Canonical little-endian action bytes. Returns DD_OK or a DD_ERR_* code; on
 * any error the state is untouched and nothing derived from the action
 * enters the hash. */
DD_EXPORT int dd_apply(dd_sim* sim, const uint8_t* action, uint32_t len);
DD_EXPORT void dd_step(dd_sim* sim);
DD_EXPORT uint64_t dd_tick(const dd_sim* sim);
DD_EXPORT void dd_hash(const dd_sim* sim, uint8_t out[32]);

/* cap == 0 returns the needed length and writes nothing; an insufficient cap
 * returns 0 and writes nothing. */
DD_EXPORT uint32_t dd_serialize(const dd_sim* sim, uint8_t* out, uint32_t cap);
DD_EXPORT int dd_restore(dd_sim* sim, const uint8_t* in, uint32_t len);

DD_EXPORT const uint8_t* dd_nodes_ptr(const dd_sim* sim);
DD_EXPORT uint32_t dd_node_count(const dd_sim* sim);
DD_EXPORT uint32_t dd_node_stride(void);
DD_EXPORT const uint8_t* dd_body_ptr(const dd_sim* sim);
DD_EXPORT uint32_t dd_body_count(const dd_sim* sim);
DD_EXPORT uint32_t dd_body_stride(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* DDSIM_C_H */
