// mathspace/action.cpp — action encoders and World::apply, the decoder.
//
// apply is the only reader of action bytes. The header goes through
// ddsim::decode_header so the two grammars can never disagree on the
// first eight bytes; payload_len must equal the bytes that follow, and
// each kind's decoder must consume exactly the payload. Everything is
// read into locals first and the mutator is called last, so the world is
// untouched on any failure. Bytes that decode but name something the
// store rejects (a bad dim, a missing note) get the mutator's own error,
// not BadAction: the action log reports what a direct call would.
#include "mathspace/action.hpp"

#include "ddsim/action.hpp"
#include "ddsim/ddsim_c.h"
#include "mathspace/world.hpp"
#include "wire.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace mathspace {
namespace {

using wire::Bytes;

Bytes with_header(ActionKind kind, Bytes payload) {
    Bytes out;
    out.reserve(ACTION_HEADER_BYTES + payload.size());
    wire::put_u8(out, static_cast<std::uint8_t>(kind));
    wire::put_u8(out, ACTION_VERSION);
    wire::put_u16(out, 0);
    wire::put_u32(out, static_cast<std::uint32_t>(payload.size()));
    out.insert(out.end(), payload.begin(), payload.end());
    return out;
}

bool read_name(ddsim::ByteReader& r, std::string& out) {
    std::uint8_t len = 0;
    if (!r.read_u8(len) || r.remaining() < len) {
        return false;
    }
    out.assign(reinterpret_cast<const char*>(r.cursor()), len);
    r.skip(len);
    return true;
}

} // namespace

Bytes encode_create_space(NoteId id, std::uint8_t dim) {
    Bytes p;
    wire::put_u64(p, id.value);
    wire::put_u8(p, dim);
    return with_header(ActionKind::CreateSpace, std::move(p));
}

Bytes encode_create_note(NoteId id, SpaceId space, NoteKind kind) {
    Bytes p;
    wire::put_u64(p, id.value);
    wire::put_u64(p, space.value);
    wire::put_u8(p, static_cast<std::uint8_t>(kind));
    return with_header(ActionKind::CreateNote, std::move(p));
}

Bytes encode_set_field(NoteId note, const Field& field) {
    Bytes p;
    wire::put_u64(p, note.value);
    wire::write_field(p, field);
    return with_header(ActionKind::SetField, std::move(p));
}

Bytes encode_delete_note(NoteId note) {
    Bytes p;
    wire::put_u64(p, note.value);
    return with_header(ActionKind::DeleteNote, std::move(p));
}

Bytes encode_delete_field(NoteId note, std::string_view name) {
    Bytes p;
    wire::put_u64(p, note.value);
    wire::put_u8(p, static_cast<std::uint8_t>(name.size()));
    wire::put_bytes(p, name.data(), name.size());
    return with_header(ActionKind::DeleteField, std::move(p));
}

Bytes encode_bind_field(NoteId note, std::string_view name, const std::vector<std::uint8_t>& bytecode) {
    Bytes p;
    wire::put_u64(p, note.value);
    wire::put_u8(p, static_cast<std::uint8_t>(name.size()));
    wire::put_bytes(p, name.data(), name.size());
    wire::put_u32(p, static_cast<std::uint32_t>(bytecode.size()));
    wire::put_bytes(p, bytecode.data(), bytecode.size());
    return with_header(ActionKind::BindField, std::move(p));
}

Error World::apply(const std::uint8_t* bytes, std::size_t len) {
    if (bytes == nullptr || len < ACTION_HEADER_BYTES) {
        return Error::BadAction;
    }
    ddsim::ByteReader r(bytes, len);
    ddsim::ActionHeader h;
    if (ddsim::decode_header(r, h) != DD_OK || h.payload_len != len - ACTION_HEADER_BYTES) {
        return Error::BadAction;
    }
    switch (static_cast<ActionKind>(h.kind)) {
    case ActionKind::CreateSpace: {
        NoteId id;
        std::uint8_t dim = 0;
        if (!r.read_u64(id.value) || !r.read_u8(dim) || !r.at_end()) {
            return Error::BadAction;
        }
        return create_space(id, dim);
    }
    case ActionKind::CreateNote: {
        NoteId id;
        SpaceId space;
        std::uint8_t kind = 0;
        if (!r.read_u64(id.value) || !r.read_u64(space.value) || !r.read_u8(kind) || !r.at_end()) {
            return Error::BadAction;
        }
        if (kind > static_cast<std::uint8_t>(NoteKind::View)) {
            return Error::BadKind;
        }
        return create_note(id, space, static_cast<NoteKind>(kind));
    }
    case ActionKind::SetField: {
        NoteId note;
        Field f;
        if (!r.read_u64(note.value) || !wire::read_field(r, f) || !r.at_end()) {
            return Error::BadAction;
        }
        return set_field(note, std::move(f));
    }
    case ActionKind::DeleteNote: {
        NoteId note;
        if (!r.read_u64(note.value) || !r.at_end()) {
            return Error::BadAction;
        }
        return delete_note(note);
    }
    case ActionKind::DeleteField: {
        NoteId note;
        std::string name;
        if (!r.read_u64(note.value) || !read_name(r, name) || !r.at_end()) {
            return Error::BadAction;
        }
        return delete_field(note, name);
    }
    case ActionKind::BindField: {
        NoteId note;
        std::string name;
        std::uint32_t code_len = 0;
        if (!r.read_u64(note.value) || !read_name(r, name) || !r.read_u32(code_len) ||
            code_len > wire::MAX_BYTECODE || r.remaining() != code_len) {
            return Error::BadAction;
        }
        std::vector<std::uint8_t> code(r.cursor(), r.cursor() + code_len);
        return bind_field(note, name, std::move(code));
    }
    }
    return Error::BadAction;
}

} // namespace mathspace
