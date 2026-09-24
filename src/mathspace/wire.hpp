// mathspace/wire.hpp — the little-endian byte helpers shared by the hash
// walk (hash.cpp) and the action decoder (action.cpp).
//
// Internal to the library: the public surface is serialize/restore and
// the action encoders. Both users write a Field the same way, so the
// record lives here once:
//
//   u8 name_len | name | u8 dim | u8 bound | dim x i64 value
//   | u32 bytecode_len | bytecode
//
// read_field proves only that the bytes are well-formed (dim at most
// MAX_DIM so the lane count is meaningful, bound is 0 or 1, every length
// fits the buffer). Whether the name and dim are legal for the store is
// the caller's check: restore relies on World::well_formed, apply on the
// mutator, so the two report content errors the same way they would for
// a direct call.
#pragma once

#include "ddsim/action.hpp"
#include "mathspace/note.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace mathspace::wire {

using Bytes = std::vector<std::uint8_t>;

inline void put_u8(Bytes& out, std::uint8_t v) { out.push_back(v); }

inline void put_u16(Bytes& out, std::uint16_t v) {
    out.push_back(static_cast<std::uint8_t>(v & 0xffu));
    out.push_back(static_cast<std::uint8_t>((v >> 8) & 0xffu));
}

inline void put_u32(Bytes& out, std::uint32_t v) {
    for (unsigned i = 0; i < 4; ++i) {
        out.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
    }
}

inline void put_u64(Bytes& out, std::uint64_t v) {
    for (unsigned i = 0; i < 8; ++i) {
        out.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
    }
}

inline void put_fx(Bytes& out, fx64 v) { put_u64(out, static_cast<std::uint64_t>(v.raw)); }

inline void put_bytes(Bytes& out, const void* data, std::size_t len) {
    const auto* p = static_cast<const std::uint8_t*>(data);
    out.insert(out.end(), p, p + len);
}

// Only the first `dim` lanes are written; set_field keeps the rest zero,
// so operator== on Field agrees with byte equality of this record. A
// bound field still writes its lanes: in phase 2 they hold the last
// evaluated value, which is state until the next tick overwrites it.
// The name length is truncated to a byte and dim written as given, so an
// encoder can build a malformed record on purpose (tests do).
inline void write_field(Bytes& out, const Field& f) {
    put_u8(out, static_cast<std::uint8_t>(f.name.size()));
    put_bytes(out, f.name.data(), f.name.size());
    put_u8(out, f.dim);
    put_u8(out, f.bound ? 1u : 0u);
    for (std::uint8_t i = 0; i < f.dim && i < MAX_DIM; ++i) {
        put_fx(out, f.value[i]);
    }
    put_u32(out, static_cast<std::uint32_t>(f.bytecode.size()));
    put_bytes(out, f.bytecode.data(), f.bytecode.size());
}

// Smallest possible field record: one-byte name, one lane, no bytecode.
inline constexpr std::size_t MIN_FIELD_BYTES = 1u + 1u + 1u + 1u + 8u + 4u;
inline constexpr std::uint32_t MAX_BYTECODE = 1u << 16;

inline bool read_field(ddsim::ByteReader& r, Field& f) {
    std::uint8_t name_len = 0;
    if (!r.read_u8(name_len) || r.remaining() < name_len) {
        return false;
    }
    f.name.assign(reinterpret_cast<const char*>(r.cursor()), name_len);
    r.skip(name_len);
    std::uint8_t bound = 0;
    if (!r.read_u8(f.dim) || f.dim > MAX_DIM || !r.read_u8(bound) || bound > 1) {
        return false;
    }
    f.bound = bound == 1;
    for (std::uint8_t i = 0; i < f.dim; ++i) {
        if (!r.read_fx(f.value[i])) {
            return false;
        }
    }
    std::uint32_t code_len = 0;
    if (!r.read_u32(code_len) || code_len > MAX_BYTECODE || r.remaining() < code_len) {
        return false;
    }
    f.bytecode.assign(r.cursor(), r.cursor() + code_len);
    r.skip(code_len);
    return true;
}

} // namespace mathspace::wire
