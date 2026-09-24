// mathspace/hash.cpp — the canonical byte walk of a World, its strict
// inverse, and the SHA-256 over it.
//
// Every value is written explicitly little-endian in the order below;
// nothing is memcpy'd from a struct, because padding is not canonical.
// The digest comes from ddsim::sha256_bytes so this TU never sees the
// hash implementation and the golden .sha256 files stay verifiable with
// `shasum -a 256` over the serialized bytes.
//
// Walk (mathspace_plan.md, plus `u32 next_group` after tick; STATE.md
// Decisions explains why that ordinal is state):
//   "MSP1" | u32 FORMAT_VERSION | u32 DD_FX_FORMAT_ID
//   | u64 seed | u64 tick | u32 next_group
//   | u32 note_count, per note in id order:
//       u64 id | u64 space_id | u8 kind
//       | u8 field_count, per field in name order: the field record of
//         wire.hpp (u8 name_len | name | u8 dim | u8 bound | dim x i64
//         | u32 bytecode_len | bytecode)
//
// restore is strict: any byte the walk would not have produced (a
// trailing byte, an out-of-order id, an invalid name, a count the buffer
// cannot hold) is BadBytes, and a well_formed() check on the decoded
// local catches the structural rules the byte grammar cannot express.
#include "ddsim/action.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "mathspace/world.hpp"
#include "wire.hpp"

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace mathspace {
namespace {

using wire::Bytes;
using wire::put_bytes;
using wire::put_u32;
using wire::put_u64;
using wire::put_u8;

constexpr char MAGIC[4] = {'M', 'S', 'P', '1'};

// Smallest possible note record, used to refuse a count that the
// remaining buffer cannot possibly hold before reserving for it.
constexpr std::size_t MIN_NOTE_BYTES = 8u + 8u + 1u + 1u;
constexpr std::uint32_t MAX_NOTES = 1u << 24;

bool read_note(ddsim::ByteReader& r, Note& n) {
    std::uint8_t kind = 0;
    std::uint8_t field_count = 0;
    if (!r.read_u64(n.id.value) || !r.read_u64(n.space.value) || !r.read_u8(kind) ||
        kind > static_cast<std::uint8_t>(NoteKind::View) || !r.read_u8(field_count)) {
        return false;
    }
    n.kind = static_cast<NoteKind>(kind);
    if (static_cast<std::size_t>(field_count) * wire::MIN_FIELD_BYTES > r.remaining()) {
        return false;
    }
    n.fields.reserve(field_count);
    for (std::uint8_t i = 0; i < field_count; ++i) {
        Field f;
        if (!wire::read_field(r, f)) {
            return false;
        }
        // Strictly ascending names: the walk never writes anything else.
        if (!n.fields.empty() && !(n.fields.back().name < f.name)) {
            return false;
        }
        n.fields.push_back(std::move(f));
    }
    return true;
}

bool read_world(const std::uint8_t* bytes, std::size_t len, World& w) {
    ddsim::ByteReader r(bytes, len);
    for (const char c : MAGIC) {
        std::uint8_t got = 0;
        if (!r.read_u8(got) || got != static_cast<std::uint8_t>(c)) {
            return false;
        }
    }
    for (const std::uint32_t expected : {FORMAT_VERSION, ddsim::DD_FX_FORMAT_ID}) {
        std::uint32_t got = 0;
        if (!r.read_u32(got) || got != expected) {
            return false;
        }
    }
    std::uint32_t note_count = 0;
    if (!r.read_u64(w.seed) || !r.read_u64(w.tick) || !r.read_u32(w.next_group) || !r.read_u32(note_count) ||
        note_count > MAX_NOTES || static_cast<std::size_t>(note_count) * MIN_NOTE_BYTES > r.remaining()) {
        return false;
    }
    w.notes.reserve(note_count);
    for (std::uint32_t i = 0; i < note_count; ++i) {
        Note n;
        if (!read_note(r, n)) {
            return false;
        }
        if (!w.notes.empty() && !(w.notes.back().id < n.id)) {
            return false;
        }
        w.notes.push_back(std::move(n));
    }
    return r.at_end() && w.well_formed();
}

} // namespace

std::vector<std::uint8_t> serialize(const World& w) {
    Bytes out;
    put_bytes(out, MAGIC, sizeof MAGIC);
    put_u32(out, FORMAT_VERSION);
    put_u32(out, ddsim::DD_FX_FORMAT_ID);
    put_u64(out, w.seed);
    put_u64(out, w.tick);
    put_u32(out, w.next_group);
    put_u32(out, static_cast<std::uint32_t>(w.notes.size()));
    for (const Note& n : w.notes) {
        put_u64(out, n.id.value);
        put_u64(out, n.space.value);
        put_u8(out, static_cast<std::uint8_t>(n.kind));
        put_u8(out, static_cast<std::uint8_t>(n.fields.size()));
        for (const Field& f : n.fields) {
            wire::write_field(out, f);
        }
    }
    return out;
}

void hash(const World& w, std::uint8_t out[32]) {
    const std::vector<std::uint8_t> bytes = serialize(w);
    ddsim::sha256_bytes(bytes.data(), bytes.size(), out);
}

Error restore(World& w, const std::uint8_t* bytes, std::size_t len) {
    if (bytes == nullptr && len != 0) {
        return Error::BadBytes;
    }
    World local;
    if (!read_world(bytes, len, local)) {
        return Error::BadBytes;
    }
    w = std::move(local);
    return Error::Ok;
}

} // namespace mathspace
