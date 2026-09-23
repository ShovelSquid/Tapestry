// hash.cpp — the one canonical byte walk, its strict inverse, and SHA-256.
//
// Every field is written explicitly little-endian in the documented order;
// nothing is ever memcpy'd from a struct, because padding is not canonical.
// This is the only translation unit that includes PicoSHA2, so the golden
// .sha256 files stay verifiable with `shasum -a 256` over the serialized
// bytes and no other TU depends on the hash implementation.
//
// Walk:
//   "DDS1" | u32 sim_version | u32 fx_format_id | u32 rng_version
//   | u32 rule_brushbody_v | u32 rule_emit_v | u32 tick_hz | u64 seed | u64 tick
//   | u32 brush_count, per brush in id order:
//       u32 id | u32 desc_len | desc | i64 mass | i64 radius | i64 spacing | 17 x u16 curve
//   | u64 rng.s[0..3]
//   | u32 active_stroke_count, per stroke in ordinal order:
//       u64 stroke_id | u32 brush_id | u32 start_tick | u8 pressure_source
//       | 9 x i64 plane | 4 x i64 body(x,y,vx,vy) | i64 path_accum
//       | u32 next_emission_index | u32 last_sample_tick | u16 last_sample_index
//       | i64 target_u | i64 target_v | i64 dir_x | i64 dir_y
//   | u32 node_count, per node ascending NodeId:
//       u64 id | i64 x | i64 y | i64 z | i64 weight | i64 dir_x | i64 dir_y
//       | i64 vx | i64 vy | u32 tick | u32 brush | u32 scale_band
#include "ddsim/action.hpp"
#include "ddsim/brush.hpp"
#include "ddsim/ddsim_c.h"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"

#include <picosha2.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace ddsim {
namespace {

void put_u8(std::vector<std::uint8_t>& out, std::uint8_t v) { out.push_back(v); }

void put_u16(std::vector<std::uint8_t>& out, std::uint16_t v) {
    out.push_back(static_cast<std::uint8_t>(v & 0xffu));
    out.push_back(static_cast<std::uint8_t>((v >> 8) & 0xffu));
}

void put_u32(std::vector<std::uint8_t>& out, std::uint32_t v) {
    for (unsigned i = 0; i < 4; ++i) {
        out.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
    }
}

void put_u64(std::vector<std::uint8_t>& out, std::uint64_t v) {
    for (unsigned i = 0; i < 8; ++i) {
        out.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
    }
}

void put_i64(std::vector<std::uint8_t>& out, std::int64_t v) { put_u64(out, static_cast<std::uint64_t>(v)); }

void put_fx(std::vector<std::uint8_t>& out, fx64 v) { put_i64(out, v.raw); }

void put_bytes(std::vector<std::uint8_t>& out, const std::string& s) {
    out.insert(out.end(), s.begin(), s.end());
}

} // namespace

void write_canonical(const State& s, std::vector<std::uint8_t>& out) {
    out.clear();
    for (const char c : DD_STATE_MAGIC) {
        put_u8(out, static_cast<std::uint8_t>(c));
    }
    put_u32(out, DD_SIM_VERSION);
    put_u32(out, DD_FX_FORMAT_ID);
    put_u32(out, DD_RNG_VERSION);
    put_u32(out, DD_RULE_BRUSHBODY_VERSION);
    put_u32(out, DD_RULE_EMIT_VERSION);
    put_u32(out, DD_TICK_HZ);
    put_u64(out, s.seed);
    put_u64(out, s.tick);

    put_u32(out, static_cast<std::uint32_t>(s.brushes.size()));
    for (const BrushVersion& b : s.brushes) {
        put_u32(out, b.id);
        put_u32(out, static_cast<std::uint32_t>(b.description.size()));
        put_bytes(out, b.description);
        put_fx(out, b.mass);
        put_fx(out, b.radius);
        put_fx(out, b.spacing);
        for (std::uint32_t i = 0; i < DD_CURVE_KNOTS; ++i) {
            put_u16(out, b.curve[i]);
        }
    }

    for (const std::uint64_t word : s.rng.s) {
        put_u64(out, word);
    }

    put_u32(out, static_cast<std::uint32_t>(s.strokes.size()));
    for (const ActiveStroke& st : s.strokes) {
        put_u64(out, st.id.value);
        put_u32(out, st.brush_id);
        put_u32(out, st.start_tick);
        put_u8(out, st.pressure_source);
        for (const fx64 p : st.plane) {
            put_fx(out, p);
        }
        put_fx(out, st.body.x);
        put_fx(out, st.body.y);
        put_fx(out, st.body.vx);
        put_fx(out, st.body.vy);
        put_fx(out, st.path_accum);
        put_u32(out, st.next_emission_index);
        put_u32(out, st.last_sample_tick);
        put_u16(out, st.last_sample_index);
        put_fx(out, st.target_u);
        put_fx(out, st.target_v);
        put_fx(out, st.dir_x);
        put_fx(out, st.dir_y);
    }

    put_u32(out, static_cast<std::uint32_t>(s.nodes.size()));
    for (const Node& n : s.nodes) {
        put_u64(out, n.id.value);
        put_fx(out, n.x);
        put_fx(out, n.y);
        put_fx(out, n.z);
        put_fx(out, n.weight);
        put_fx(out, n.dir_x);
        put_fx(out, n.dir_y);
        put_fx(out, n.vx);
        put_fx(out, n.vy);
        put_u32(out, n.tick);
        put_u32(out, n.brush);
        put_u32(out, n.scale_band);
    }
}

int read_canonical(const std::uint8_t* bytes, std::uint32_t len, State& out) {
    if (bytes == nullptr) {
        return DD_ERR_RESTORE;
    }
    ByteReader r(bytes, len);
    State s;

    for (const char c : DD_STATE_MAGIC) {
        std::uint8_t got = 0;
        if (!r.read_u8(got) || got != static_cast<std::uint8_t>(c)) {
            return DD_ERR_RESTORE;
        }
    }
    const std::uint32_t pins[6] = {DD_SIM_VERSION,           DD_FX_FORMAT_ID,      DD_RNG_VERSION,
                                   DD_RULE_BRUSHBODY_VERSION, DD_RULE_EMIT_VERSION, DD_TICK_HZ};
    for (const std::uint32_t expected : pins) {
        std::uint32_t got = 0;
        if (!r.read_u32(got) || got != expected) {
            return DD_ERR_RESTORE;
        }
    }
    if (!r.read_u64(s.seed) || !r.read_u64(s.tick)) {
        return DD_ERR_RESTORE;
    }

    std::uint32_t brush_count = 0;
    if (!r.read_u32(brush_count) || brush_count > DD_MAX_BRUSHES) {
        return DD_ERR_RESTORE;
    }
    s.brushes.reserve(brush_count);
    for (std::uint32_t i = 0; i < brush_count; ++i) {
        BrushVersion b;
        std::uint32_t desc_len = 0;
        if (!r.read_u32(b.id) || !r.read_u32(desc_len) || desc_len > DD_MAX_DESC_BYTES ||
            !r.read_bytes(b.description, desc_len) || !r.read_fx(b.mass) || !r.read_fx(b.radius) ||
            !r.read_fx(b.spacing)) {
            return DD_ERR_RESTORE;
        }
        for (std::uint32_t k = 0; k < DD_CURVE_KNOTS; ++k) {
            if (!r.read_u16(b.curve[k])) {
                return DD_ERR_RESTORE;
            }
        }
        if (b.id != i + 1 || validate_brush(b) != DD_OK) {
            return DD_ERR_RESTORE;
        }
        s.brushes.push_back(std::move(b));
    }

    for (std::uint64_t& word : s.rng.s) {
        if (!r.read_u64(word)) {
            return DD_ERR_RESTORE;
        }
    }
    if (s.rng.s[0] == 0 && s.rng.s[1] == 0 && s.rng.s[2] == 0 && s.rng.s[3] == 0) {
        return DD_ERR_RESTORE;
    }

    std::uint32_t stroke_count = 0;
    if (!r.read_u32(stroke_count) || stroke_count > DD_MAX_ACTIVE_STROKES) {
        return DD_ERR_RESTORE;
    }
    s.strokes.reserve(stroke_count);
    for (std::uint32_t i = 0; i < stroke_count; ++i) {
        ActiveStroke st;
        if (!r.read_u64(st.id.value) || !r.read_u32(st.brush_id) || !r.read_u32(st.start_tick) ||
            !r.read_u8(st.pressure_source)) {
            return DD_ERR_RESTORE;
        }
        for (fx64& p : st.plane) {
            if (!r.read_fx(p)) {
                return DD_ERR_RESTORE;
            }
        }
        if (!r.read_fx(st.body.x) || !r.read_fx(st.body.y) || !r.read_fx(st.body.vx) ||
            !r.read_fx(st.body.vy) || !r.read_fx(st.path_accum) || !r.read_u32(st.next_emission_index) ||
            !r.read_u32(st.last_sample_tick) || !r.read_u16(st.last_sample_index) ||
            !r.read_fx(st.target_u) || !r.read_fx(st.target_v) || !r.read_fx(st.dir_x) ||
            !r.read_fx(st.dir_y)) {
            return DD_ERR_RESTORE;
        }
        if (!st.id.assigned() || st.brush_id == 0 || st.brush_id > brush_count ||
            (!s.strokes.empty() && !(s.strokes.back().id < st.id))) {
            return DD_ERR_RESTORE;
        }
        s.strokes.push_back(st);
    }

    std::uint32_t node_count = 0;
    if (!r.read_u32(node_count) || node_count > DD_MAX_NODES) {
        return DD_ERR_RESTORE;
    }
    // Every node record is at least 88 bytes; refuse a count the buffer
    // cannot possibly hold before reserving for it.
    if (static_cast<std::size_t>(node_count) * 88u > r.remaining()) {
        return DD_ERR_RESTORE;
    }
    s.nodes.reserve(node_count);
    for (std::uint32_t i = 0; i < node_count; ++i) {
        Node n;
        if (!r.read_u64(n.id.value) || !r.read_fx(n.x) || !r.read_fx(n.y) || !r.read_fx(n.z) ||
            !r.read_fx(n.weight) || !r.read_fx(n.dir_x) || !r.read_fx(n.dir_y) || !r.read_fx(n.vx) ||
            !r.read_fx(n.vy) || !r.read_u32(n.tick) || !r.read_u32(n.brush) || !r.read_u32(n.scale_band)) {
            return DD_ERR_RESTORE;
        }
        if (!n.id.assigned() || n.brush == 0 || n.brush > brush_count ||
            (!s.nodes.empty() && !(s.nodes.back().id < n.id))) {
            return DD_ERR_RESTORE;
        }
        s.nodes.push_back(n);
    }

    if (!r.at_end()) {
        return DD_ERR_RESTORE;
    }
    out = std::move(s);
    return DD_OK;
}

void sha256_bytes(const std::uint8_t* bytes, std::size_t len, std::uint8_t out[32]) {
    picosha2::hash256(bytes, bytes + len, out, out + 32);
}

} // namespace ddsim
