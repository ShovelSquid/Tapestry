// ddsim/action.hpp — the action byte grammar and its bounds-checked decoder.
//
// All fields little-endian. Header: u8 kind | u8 version (=1) | u16 reserved
// (=0) | u32 payload_len. Kind 1 DefineBrush payload: u32 brush_version_id |
// u32 desc_len | desc bytes (UTF-8) | i64 mass | i64 radius | i64 spacing |
// 17 x u16 curve. Kinds 2-4 (StrokeBegin, StrokeSamples, StrokeEnd) have
// their layouts fixed in 01-05; this decoder reports them as unknown.
//
// Every read past the end of the buffer is DD_ERR_BAD_LENGTH. Decoders write
// into a local the caller commits only on DD_OK, so a rejected action never
// touches state.
#pragma once

#include "ddsim/ddsim_c.h"
#include "ddsim/state.hpp"

#include <cstddef>
#include <cstdint>
#include <string>

namespace ddsim {

enum class ActionKind : std::uint8_t {
    DefineBrush = 1,
    StrokeBegin = 2,
    StrokeSamples = 3,
    StrokeEnd = 4,
};

inline constexpr std::uint8_t DD_ACTION_VERSION = 1;
inline constexpr std::uint32_t DD_ACTION_HEADER_BYTES = 8;

struct ActionHeader {
    std::uint8_t kind = 0;
    std::uint8_t version = 0;
    std::uint16_t reserved = 0;
    std::uint32_t payload_len = 0;
};

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

// DD_ERR_BAD_HEADER when fewer than 8 bytes remain, the version is not 1, or
// the reserved field is not 0.
inline int decode_header(ByteReader& r, ActionHeader& h) {
    ActionHeader local;
    if (!r.read_u8(local.kind) || !r.read_u8(local.version) || !r.read_u16(local.reserved) ||
        !r.read_u32(local.payload_len)) {
        return DD_ERR_BAD_HEADER;
    }
    if (local.version != DD_ACTION_VERSION || local.reserved != 0) {
        return DD_ERR_BAD_HEADER;
    }
    h = local;
    return DD_OK;
}

// Decodes the DefineBrush payload. Field-level validity (id ordering,
// description length, positive mass) is the caller's job: this only proves
// the bytes are well-formed.
inline int decode_define_brush(ByteReader& r, BrushVersion& out) {
    BrushVersion local;
    std::uint32_t desc_len = 0;
    if (!r.read_u32(local.id) || !r.read_u32(desc_len)) {
        return DD_ERR_BAD_LENGTH;
    }
    if (!r.read_bytes(local.description, desc_len)) {
        return DD_ERR_BAD_LENGTH;
    }
    if (!r.read_fx(local.mass) || !r.read_fx(local.radius) || !r.read_fx(local.spacing)) {
        return DD_ERR_BAD_LENGTH;
    }
    for (std::uint32_t i = 0; i < DD_CURVE_KNOTS; ++i) {
        if (!r.read_u16(local.curve[i])) {
            return DD_ERR_BAD_LENGTH;
        }
    }
    out = std::move(local);
    return DD_OK;
}

} // namespace ddsim
