// sim.cpp — apply / step / hash / serialize / restore.
//
// apply() decodes into a local and commits only on DD_OK, so a rejected
// action leaves the state and the hash exactly as they were. step() is the
// only thing that advances the tick; the rules that run inside a tick land
// in 01-05 without changing this shape. The snapshot byte buffers handed out
// through the C ABI are rebuilt field by field after every accepted change.
#include "ddsim/sim.hpp"

#include "ddsim/action.hpp"
#include "ddsim/brush.hpp"
#include "ddsim/ddsim_c.h"
#include "ddsim/state.hpp"

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace ddsim {
namespace {

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

void put_fx(std::vector<std::uint8_t>& out, fx64 v) { put_u64(out, static_cast<std::uint64_t>(v.raw)); }

} // namespace

Sim::Sim(std::uint64_t seed) {
    state_.seed = seed;
    state_.tick = 0;
    state_.rng.seed_from(seed);
    refresh_snapshots();
}

int Sim::apply(const std::uint8_t* action, std::uint32_t len) {
    if (action == nullptr) {
        return DD_ERR_BAD_HEADER;
    }
    ByteReader r(action, len);
    ActionHeader h;
    const int hr = decode_header(r, h);
    if (hr != DD_OK) {
        return hr;
    }
    if (h.payload_len != len - DD_ACTION_HEADER_BYTES) {
        return DD_ERR_BAD_LENGTH;
    }

    switch (static_cast<ActionKind>(h.kind)) {
    case ActionKind::DefineBrush: {
        BrushVersion b;
        const int rc = decode_define_brush(r, b);
        if (rc != DD_OK) {
            return rc;
        }
        if (!r.at_end()) {
            return DD_ERR_BAD_LENGTH;
        }
        if (b.id != state_.brushes.size() + 1) {
            return DD_ERR_BRUSH_ID;
        }
        if (state_.brushes.size() >= DD_MAX_BRUSHES) {
            return DD_ERR_LIMIT;
        }
        const int vr = validate_brush(b);
        if (vr != DD_OK) {
            return vr;
        }
        state_.brushes.push_back(std::move(b));
        refresh_snapshots();
        return DD_OK;
    }
    case ActionKind::StrokeBegin:
    case ActionKind::StrokeSamples:
    case ActionKind::StrokeEnd:
    default:
        return DD_ERR_UNKNOWN_KIND;
    }
}

void Sim::step() {
    state_.tick += 1;
    refresh_snapshots();
}

void Sim::hash(std::uint8_t out[32]) const {
    std::vector<std::uint8_t> bytes;
    write_canonical(state_, bytes);
    sha256_bytes(bytes.data(), bytes.size(), out);
}

std::vector<std::uint8_t> Sim::serialize() const {
    std::vector<std::uint8_t> bytes;
    write_canonical(state_, bytes);
    return bytes;
}

int Sim::restore(const std::uint8_t* bytes, std::uint32_t len) {
    State fresh;
    const int rc = read_canonical(bytes, len, fresh);
    if (rc != DD_OK) {
        return rc;
    }
    state_ = std::move(fresh);
    refresh_snapshots();
    return DD_OK;
}

void Sim::refresh_snapshots() {
    node_bytes_.clear();
    node_bytes_.reserve(state_.nodes.size() * DD_NODE_STRIDE);
    for (const Node& n : state_.nodes) {
        put_u64(node_bytes_, n.id.value);
        put_fx(node_bytes_, n.x);
        put_fx(node_bytes_, n.y);
        put_fx(node_bytes_, n.z);
        put_fx(node_bytes_, n.weight);
        put_fx(node_bytes_, n.dir_x);
        put_fx(node_bytes_, n.dir_y);
        put_fx(node_bytes_, n.vx);
        put_fx(node_bytes_, n.vy);
        put_u32(node_bytes_, n.tick);
        put_u32(node_bytes_, n.brush);
        put_u32(node_bytes_, n.scale_band);
        put_u32(node_bytes_, 0u);
    }

    body_bytes_.clear();
    body_bytes_.reserve(state_.strokes.size() * DD_BODY_STRIDE);
    for (const ActiveStroke& st : state_.strokes) {
        put_u64(body_bytes_, st.id.value);
        put_fx(body_bytes_, st.body.x);
        put_fx(body_bytes_, st.body.y);
        put_fx(body_bytes_, st.body.vx);
        put_fx(body_bytes_, st.body.vy);
        put_fx(body_bytes_, st.target_u);
        put_fx(body_bytes_, st.target_v);
    }
}

} // namespace ddsim
