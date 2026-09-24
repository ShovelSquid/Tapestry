// sim.cpp — apply / step / hash / serialize / restore.
//
// apply() decodes into a local, runs the documented validation rows in
// order, and commits only on DD_OK, so a rejected action leaves the state
// and the hash exactly as they were. step() runs the brush body and
// emission rules for every active stroke in ordinal order, then advances
// the tick; it is the only thing that advances the tick and takes no time
// argument, so one step per call and four per burst are the same sim. The
// snapshot byte buffers handed out through the C ABI are rebuilt field by
// field after every accepted change.
#include "ddsim/sim.hpp"

#include "ddsim/action.hpp"
#include "ddsim/brush.hpp"
#include "ddsim/ddsim_c.h"
#include "ddsim/ids.hpp"
#include "ddsim/state.hpp"

#include <algorithm>
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

// Bits 63..40 of a stroke id are outside the (branch, ordinal) layout; a
// stroke id carrying them would map onto another stroke's node ids.
constexpr std::uint64_t DD_STROKE_ID_MASK = (std::uint64_t{1} << 40) - 1;

std::vector<ActiveStroke>::iterator find_stroke(std::vector<ActiveStroke>& strokes, std::uint64_t id) {
    for (auto it = strokes.begin(); it != strokes.end(); ++it) {
        if (it->id.value == id) {
            return it;
        }
    }
    return strokes.end();
}

// "Never seen before in this session": the ordinal is in use if a stroke
// with this id is active or any node already carries its (branch, ordinal).
// Nodes are kept in ascending id order and a stroke's ids form the
// contiguous range [make_node_id(b, o, 0), make_node_id(b, o, index_mask)],
// so one lower_bound answers it. Derived from the hashed state rather than
// kept as a separate list, so a restored sim answers exactly as the live
// one did.
bool stroke_in_use(const State& s, std::uint64_t stroke_id) {
    for (const ActiveStroke& st : s.strokes) {
        if (st.id.value == stroke_id) {
            return true;
        }
    }
    const std::uint8_t branch = static_cast<std::uint8_t>((stroke_id >> 32) & DD_ID_BRANCH_MASK);
    const std::uint32_t ordinal = static_cast<std::uint32_t>(stroke_id & DD_ID_ORDINAL_MASK);
    const NodeId first = make_node_id(branch, ordinal, 0);
    const NodeId last = make_node_id(branch, ordinal, static_cast<std::uint32_t>(DD_ID_INDEX_MASK));
    const auto it = std::lower_bound(s.nodes.begin(), s.nodes.end(), first,
                                     [](const Node& n, NodeId id) { return n.id < id; });
    return it != s.nodes.end() && !(last < it->id);
}

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
    case ActionKind::StrokeBegin: {
        StrokeBegin b;
        const int rc = decode_stroke_begin(r, b);
        if (rc != DD_OK) {
            return rc;
        }
        if (!r.at_end()) {
            return DD_ERR_BAD_LENGTH;
        }
        if (std::uint64_t{b.start_tick} != state_.tick) {
            return DD_ERR_TICK_MISMATCH;
        }
        if (b.brush_version_id == 0 || b.brush_version_id > state_.brushes.size()) {
            return DD_ERR_BRUSH_ID;
        }
        const std::uint32_t ordinal = static_cast<std::uint32_t>(b.stroke_id & DD_ID_ORDINAL_MASK);
        if (ordinal == 0 || (b.stroke_id & ~DD_STROKE_ID_MASK) != 0 || stroke_in_use(state_, b.stroke_id)) {
            return DD_ERR_STROKE_STATE;
        }
        if (state_.strokes.size() >= DD_MAX_ACTIVE_STROKES) {
            return DD_ERR_LIMIT;
        }
        ActiveStroke st;
        st.id.value = b.stroke_id;
        st.brush_id = b.brush_version_id;
        st.start_tick = b.start_tick;
        st.pressure_source = b.pressure_source;
        for (int i = 0; i < 3; ++i) {
            st.plane[i] = b.plane.origin[i];
            st.plane[3 + i] = b.plane.right[i];
            st.plane[6 + i] = b.plane.up[i];
        }
        // The active list stays sorted by stroke id (branch, ordinal): the
        // rules run in ordinal order and the walk writes it in that order.
        const auto pos = std::lower_bound(state_.strokes.begin(), state_.strokes.end(), st.id,
                                          [](const ActiveStroke& a, StrokeId id) { return a.id < id; });
        state_.strokes.insert(pos, std::move(st));
        refresh_snapshots();
        return DD_OK;
    }
    case ActionKind::StrokeSamples: {
        StrokeSamples s;
        const int rc = decode_stroke_samples(r, s);
        if (rc != DD_OK) {
            return rc;
        }
        if (!r.at_end()) {
            return DD_ERR_BAD_LENGTH;
        }
        const auto it = find_stroke(state_.strokes, s.stroke_id);
        if (it == state_.strokes.end()) {
            return DD_ERR_STROKE_STATE;
        }
        const std::size_t count = s.samples.size();
        if (count < 1 || count > DD_MAX_SAMPLES_PER_ACTION) {
            return DD_ERR_LIMIT;
        }
        for (const Sample& sample : s.samples) {
            if (std::uint64_t{sample.tick} != state_.tick) {
                return DD_ERR_TICK_MISMATCH;
            }
        }
        // `pending` holds exactly this tick's samples, so the first index of
        // this action continues them or starts at 0.
        std::uint32_t expected = it->pending.empty() ? 0u : std::uint32_t{it->last_sample_index} + 1u;
        for (const Sample& sample : s.samples) {
            if (std::uint32_t{sample.index} != expected) {
                return DD_ERR_SAMPLE_ORDER;
            }
            ++expected;
        }
        if (it->pending.size() + count > DD_MAX_SAMPLES_PER_TICK) {
            return DD_ERR_LIMIT;
        }
        for (const Sample& sample : s.samples) {
            if (!sample_in_range(sample)) {
                return DD_ERR_SAMPLE_RANGE;
            }
        }
        it->pending.insert(it->pending.end(), s.samples.begin(), s.samples.end());
        it->last_sample_tick = static_cast<std::uint32_t>(state_.tick);
        it->last_sample_index = s.samples.back().index;
        refresh_snapshots();
        return DD_OK;
    }
    case ActionKind::StrokeEnd: {
        StrokeEnd e;
        const int rc = decode_stroke_end(r, e);
        if (rc != DD_OK) {
            return rc;
        }
        if (!r.at_end()) {
            return DD_ERR_BAD_LENGTH;
        }
        const auto it = find_stroke(state_.strokes, e.stroke_id);
        if (it == state_.strokes.end()) {
            return DD_ERR_STROKE_STATE;
        }
        if (std::uint64_t{e.end_tick} != state_.tick) {
            return DD_ERR_TICK_MISMATCH;
        }
        // The stroke leaves the active list; its nodes stay.
        state_.strokes.erase(it);
        refresh_snapshots();
        return DD_OK;
    }
    default:
        return DD_ERR_UNKNOWN_KIND;
    }
}

void Sim::step() {
    // The tick's samples are consumed here (the body and emission rules
    // replace this plain consumption in the next task).
    for (ActiveStroke& st : state_.strokes) {
        st.pending.clear();
    }
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
