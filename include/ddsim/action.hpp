// ddsim/action.hpp — the action byte grammar and its bounds-checked decoder.
//
// All fields little-endian. Header: u8 kind | u8 version (=1) | u16 reserved
// (=0) | u32 payload_len.
//
//   Kind 1 DefineBrush:   u32 brush_version_id | u32 desc_len | desc bytes
//                         (UTF-8) | i64 mass | i64 radius | i64 spacing
//                         | 17 x u16 curve
//   Kind 2 StrokeBegin:   u64 stroke_id@0 | u32 brush_version_id@8
//                         | u32 start_tick@12 | u8 pressure_source@16
//                         | u8 pad[3]@17 (=0) | 9 x i32 plane@20 (origin xyz,
//                         right xyz, up xyz; Q16.16)              = 56 bytes
//   Kind 3 StrokeSamples: u64 stroke_id@0 | u32 count@8 | count x Sample@12
//   Kind 4 StrokeEnd:     u64 stroke_id@0 | u32 end_tick@8       = 12 bytes
//   Kind 5 CreateParticle: u32 particle_id | u8 is_static | u8 pad[3] (=0)
//                          | i64 mass | i64 x | i64 y              = 32 bytes
//   Kind 6 CreateConstraint: u32 constraint_id | u32 particle_a | u32 particle_b
//                            | i64 rest_length | i64 stiffness     = 28 bytes
//
// Sample (24 bytes): see state.hpp. Plane coordinates cross as i32 Q16.16
// and are widened to Q32.32 here (fx64::from_q16), which keeps JS on safe
// integers and the future journal numbers short.
//
// Every read past the end of the buffer is DD_ERR_BAD_LENGTH. The decoders
// prove only that the bytes are well-formed (lengths, the reserved pad
// bytes, the one-bit pressure source); every check that depends on state —
// ticks, brush ids, stroke state, sample order and ranges — lives in
// Sim::apply in the documented order. Decoders write into a local the
// caller commits only on DD_OK, so a rejected action never touches state.
#pragma once

#include "ddsim/ddsim_c.h"
#include "ddsim/state.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace ddsim {

enum class ActionKind : std::uint8_t {
    DefineBrush = 1,
    StrokeBegin = 2,
    StrokeSamples = 3,
    StrokeEnd = 4,
    CreateParticle = 5,
    CreateConstraint = 6,
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
    bool read_i8(std::int8_t& out) {
        std::uint8_t b = 0;
        if (!read_u8(b)) {
            return false;
        }
        out = static_cast<std::int8_t>(b);
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
// description length, positive mass, stability) is the caller's job: this
// only proves the bytes are well-formed.
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

// ---------------------------------------------------------------------------
// Particle and constraint actions.
// ---------------------------------------------------------------------------

struct CreateParticle {
    std::uint32_t particle_id = 0;
    std::uint8_t is_static = 0;
    fx64 mass;
    fx64 x, y;
};

struct CreateConstraint {
    std::uint32_t constraint_id = 0;
    std::uint32_t particle_a = 0;
    std::uint32_t particle_b = 0;
    fx64 rest_length;
    fx64 stiffness;
};

// CreateParticle: 32 bytes. The three pad bytes must be zero and is_static
// is one bit; anything else is DD_ERR_BAD_LENGTH so a malformed flag can
// never reach the field-level validator.
inline int decode_create_particle(ByteReader& r, CreateParticle& out) {
    CreateParticle p;
    std::uint8_t pad[3] = {0, 0, 0};
    if (!r.read_u32(p.particle_id) || !r.read_u8(p.is_static) || !r.read_u8(pad[0]) || !r.read_u8(pad[1]) ||
        !r.read_u8(pad[2]) || !r.read_fx(p.mass) || !r.read_fx(p.x) || !r.read_fx(p.y)) {
        return DD_ERR_BAD_LENGTH;
    }
    if (pad[0] != 0 || pad[1] != 0 || pad[2] != 0 || p.is_static > 1) {
        return DD_ERR_BAD_LENGTH;
    }
    out = p;
    return DD_OK;
}

// CreateConstraint: 28 bytes.
inline int decode_create_constraint(ByteReader& r, CreateConstraint& out) {
    CreateConstraint c;
    if (!r.read_u32(c.constraint_id) || !r.read_u32(c.particle_a) || !r.read_u32(c.particle_b) ||
        !r.read_fx(c.rest_length) || !r.read_fx(c.stiffness)) {
        return DD_ERR_BAD_LENGTH;
    }
    out = c;
    return DD_OK;
}

// ---------------------------------------------------------------------------
// Stroke actions.
// ---------------------------------------------------------------------------

// The plane frame a stroke was painted on, in world units: origin, right and
// up. Every emitted node's 3D position is origin + u * right + v * up, so z
// comes from this recorded frame and never from a camera (CANV-01).
struct PlaneFrame {
    fx64 origin[3];
    fx64 right[3];
    fx64 up[3];
};

struct StrokeBegin {
    std::uint64_t stroke_id = 0;
    std::uint32_t brush_version_id = 0;
    std::uint32_t start_tick = 0;
    std::uint8_t pressure_source = 0;
    PlaneFrame plane;
};

struct StrokeSamples {
    std::uint64_t stroke_id = 0;
    std::vector<Sample> samples;
};

struct StrokeEnd {
    std::uint64_t stroke_id = 0;
    std::uint32_t end_tick = 0;
};

// The per-field range rule for a sample (the DD_ERR_SAMPLE_RANGE row): the
// pressure fits the provisional width, |tilt| <= 90, twist <= 359, only the
// three defined flag bits, and zero padding. Ticks and indices are checked
// against state in Sim::apply, not here.
inline bool sample_in_range(const Sample& s) {
    if (static_cast<std::uint32_t>(s.pressure) > DD_PRESSURE_MAX) {
        return false;
    }
    if (s.tilt_x > DD_TILT_MAX || s.tilt_x < -DD_TILT_MAX || s.tilt_y > DD_TILT_MAX || s.tilt_y < -DD_TILT_MAX) {
        return false;
    }
    if (s.twist > DD_TWIST_MAX) {
        return false;
    }
    if ((s.flags & static_cast<std::uint8_t>(~DD_SAMPLE_FLAGS_MASK)) != 0) {
        return false;
    }
    if (s.pad[0] != 0 || s.pad[1] != 0 || s.pad[2] != 0) {
        return false;
    }
    return true;
}

// One 24-byte sample record, field by field (never memcpy).
inline int decode_sample(ByteReader& r, Sample& out) {
    Sample s;
    if (!r.read_u32(s.tick) || !r.read_u16(s.index) || !r.read_u16(s.pressure) || !r.read_i32(s.u) ||
        !r.read_i32(s.v) || !r.read_i8(s.tilt_x) || !r.read_i8(s.tilt_y) || !r.read_u16(s.twist) ||
        !r.read_u8(s.flags) || !r.read_u8(s.pad[0]) || !r.read_u8(s.pad[1]) || !r.read_u8(s.pad[2])) {
        return DD_ERR_BAD_LENGTH;
    }
    out = s;
    return DD_OK;
}

// StrokeBegin: 56 bytes. The three pad bytes must be zero and the pressure
// source is one bit (0 = pen sensor, 1 = mouse / no sensor); anything else
// is DD_ERR_SAMPLE_RANGE.
inline int decode_stroke_begin(ByteReader& r, StrokeBegin& out) {
    StrokeBegin b;
    std::uint8_t pad[3] = {0, 0, 0};
    if (!r.read_u64(b.stroke_id) || !r.read_u32(b.brush_version_id) || !r.read_u32(b.start_tick) ||
        !r.read_u8(b.pressure_source) || !r.read_u8(pad[0]) || !r.read_u8(pad[1]) || !r.read_u8(pad[2])) {
        return DD_ERR_BAD_LENGTH;
    }
    std::int32_t q[9];
    for (std::int32_t& c : q) {
        if (!r.read_i32(c)) {
            return DD_ERR_BAD_LENGTH;
        }
    }
    if (pad[0] != 0 || pad[1] != 0 || pad[2] != 0 || b.pressure_source > 1) {
        return DD_ERR_SAMPLE_RANGE;
    }
    for (int i = 0; i < 3; ++i) {
        b.plane.origin[i] = fx64::from_q16(q[i]);
        b.plane.right[i] = fx64::from_q16(q[3 + i]);
        b.plane.up[i] = fx64::from_q16(q[6 + i]);
    }
    out = b;
    return DD_OK;
}

// StrokeSamples: the count is trusted only as far as the buffer can hold
// (count * 24 bytes must remain), so a hostile count cannot reserve memory
// beyond the action itself; the 1..DD_MAX_SAMPLES_PER_ACTION limit is the
// caller's DD_ERR_LIMIT row.
inline int decode_stroke_samples(ByteReader& r, StrokeSamples& out) {
    StrokeSamples s;
    std::uint32_t count = 0;
    if (!r.read_u64(s.stroke_id) || !r.read_u32(count)) {
        return DD_ERR_BAD_LENGTH;
    }
    if (static_cast<std::size_t>(count) * DD_SAMPLE_BYTES > r.remaining()) {
        return DD_ERR_BAD_LENGTH;
    }
    s.samples.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
        Sample sample;
        const int rc = decode_sample(r, sample);
        if (rc != DD_OK) {
            return rc;
        }
        s.samples.push_back(sample);
    }
    out = std::move(s);
    return DD_OK;
}

// StrokeEnd: 12 bytes.
inline int decode_stroke_end(ByteReader& r, StrokeEnd& out) {
    StrokeEnd e;
    if (!r.read_u64(e.stroke_id) || !r.read_u32(e.end_tick)) {
        return DD_ERR_BAD_LENGTH;
    }
    out = e;
    return DD_OK;
}

} // namespace ddsim
