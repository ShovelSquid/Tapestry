// mathspace/action.hpp — the action byte grammar: the API of the store.
//
// Every mutation of a World is an action (mathspace_plan.md, "The action
// log is the API"): ddsim's header, `u8 kind | u8 version (=1) | u16
// reserved (=0) | u32 payload_len`, then a payload. Kinds start at 32 so
// they can never collide with ddsim's 1 to 6 once the two logs share a
// journal at plan phase 7. All fields little-endian.
//
//   Kind 32 CreateSpace: u64 id | u8 dim
//   Kind 33 CreateNote:  u64 id | u64 space | u8 kind
//   Kind 34 SetField:    u64 note | field record (u8 name_len | name
//                        | u8 dim | u8 bound | dim x i64 | u32 code_len
//                        | code; the same record the hash walk writes)
//   Kind 35 DeleteNote:  u64 note
//   Kind 36 DeleteField: u64 note | u8 name_len | name
//
// World::apply (world.hpp) decodes into locals, refuses any byte the
// grammar does not account for (Error::BadAction), and only then calls
// the mutator of the same name, so an action and a direct call agree on
// every outcome and a rejected action leaves the world byte-identical.
//
// The encoders below are the inverse. They write what they are given
// without validating it (a 40-byte name has its length truncated to a
// byte; dim is written as is), so tests and tools can build malformed
// actions on purpose; validation is apply's job, once.
#pragma once

#include <cstdint>
#include <string_view>
#include <vector>

#include "mathspace/ids.hpp"
#include "mathspace/note.hpp"

namespace mathspace {

enum class ActionKind : std::uint8_t {
    CreateSpace = 32,
    CreateNote = 33,
    SetField = 34,
    DeleteNote = 35,
    DeleteField = 36,
};

inline constexpr std::uint8_t ACTION_VERSION = 1;
inline constexpr std::size_t ACTION_HEADER_BYTES = 8;

std::vector<std::uint8_t> encode_create_space(NoteId id, std::uint8_t dim);
std::vector<std::uint8_t> encode_create_note(NoteId id, SpaceId space, NoteKind kind);
std::vector<std::uint8_t> encode_set_field(NoteId note, const Field& field);
std::vector<std::uint8_t> encode_delete_note(NoteId note);
std::vector<std::uint8_t> encode_delete_field(NoteId note, std::string_view name);

} // namespace mathspace
