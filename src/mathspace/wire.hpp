// mathspace/wire.hpp — the little-endian byte helpers shared by the hash
// walk (hash.cpp), the action decoder (action.cpp) and the bytecode
// decoder (expr/bytecode.cpp): the writers, the bounds-checked ByteReader
// and the eight-byte action header (u8 kind | u8 version (=1) | u16
// reserved (=0) | u32 payload_len, inherited from ddsim so the two logs
// could share a file).
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

#include "mathspace/action.hpp"
#include "mathspace/note.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
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

// Every read past the end of the buffer returns false and leaves `out`
// alone; the cursor never moves past `size`. Decoders read into locals
// and the caller commits only on success, so a rejected buffer never
// touches state.
class ByteReader {
public:
    ByteReader(const std::uint8_t* data, std::size_t size) : data_(data), size_(size) {}

    std::size_t remaining() const { return size_ - pos_; }
    bool at_end() const { return pos_ == size_; }
    const std::uint8_t* cursor() const { return data_ + pos_; }

    bool read_u8(std::uint8_t& out) {
        if (remaining() < 1) {
            return false;
        }
        out = data_[pos_++];
        return true;
    }
    bool read_u16(std::uint16_t& out) {
        if (remaining() < 2) {
            return false;
        }
        out = static_cast<std::uint16_t>(std::uint16_t{data_[pos_]} | (std::uint16_t{data_[pos_ + 1]} << 8));
        pos_ += 2;
        return true;
    }
    bool read_u32(std::uint32_t& out) {
        if (remaining() < 4) {
            return false;
        }
        out = std::uint32_t{data_[pos_]} | (std::uint32_t{data_[pos_ + 1]} << 8) |
              (std::uint32_t{data_[pos_ + 2]} << 16) | (std::uint32_t{data_[pos_ + 3]} << 24);
        pos_ += 4;
        return true;
    }
    bool read_i32(std::int32_t& out) {
        std::uint32_t u = 0;
        if (!read_u32(u)) {
            return false;
        }
        out = static_cast<std::int32_t>(u);
        return true;
    }
    bool read_u64(std::uint64_t& out) {
        if (remaining() < 8) {
            return false;
        }
        std::uint64_t v = 0;
        for (std::size_t i = 0; i < 8; ++i) {
            v |= std::uint64_t{data_[pos_ + i]} << (8 * i);
        }
        pos_ += 8;
        out = v;
        return true;
    }
    bool read_i64(std::int64_t& out) {
        std::uint64_t u = 0;
        if (!read_u64(u)) {
            return false;
        }
        out = static_cast<std::int64_t>(u);
        return true;
    }
    bool read_fx(fx64& out) {
        std::int64_t r = 0;
        if (!read_i64(r)) {
            return false;
        }
        out = fx64::from_raw(r);
        return true;
    }
    bool read_bytes(std::string& out, std::size_t n) {
        if (remaining() < n) {
            return false;
        }
        out.assign(reinterpret_cast<const char*>(data_ + pos_), n);
        pos_ += n;
        return true;
    }
    bool skip(std::size_t n) {
        if (remaining() < n) {
            return false;
        }
        pos_ += n;
        return true;
    }

private:
    const std::uint8_t* data_;
    std::size_t size_;
    std::size_t pos_ = 0;
};

struct ActionHeader {
    std::uint8_t kind = 0;
    std::uint8_t version = 0;
    std::uint16_t reserved = 0;
    std::uint32_t payload_len = 0;
};

// False when fewer than ACTION_HEADER_BYTES remain, the version is not
// ACTION_VERSION, or the reserved field is not 0.
inline bool read_header(ByteReader& r, ActionHeader& h) {
    ActionHeader local;
    if (!r.read_u8(local.kind) || !r.read_u8(local.version) || !r.read_u16(local.reserved) ||
        !r.read_u32(local.payload_len)) {
        return false;
    }
    if (local.version != ACTION_VERSION || local.reserved != 0) {
        return false;
    }
    h = local;
    return true;
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

inline bool read_field(ByteReader& r, Field& f) {
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
