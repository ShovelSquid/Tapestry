// mathspace/note.hpp — the record types of the store: Field and Note.
//
// A Field is a fixed-length fx64 vector (dim 1 to 8) under a short name,
// plus an optional bound expression (bytecode, empty until plan phase 2).
// Stored values are state and are hashed; a bound field is hashed by its
// bytecode instead, because its value is recomputed every tick.
//
// A Note is an id, the id of the space it lives in, a kind, and its fields
// kept sorted by name with no duplicates. Sorted storage is what lets the
// hash walk and every rule iterate in name order without a map (the
// invariant: no hash containers, every walk in id or name order).
// Kinds exist so the bridge and the renderer can find things; the store
// itself never branches on them beyond structural checks.
//
// Everything here is plain data with value semantics. The helpers below
// are the only way fields should be added or removed, so the sort order
// and the "unused lanes are zero" rule cannot be broken by accident. They
// validate and return false without touching the note, which is the same
// contract World::apply will give to actions.
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "ddsim/fx64.hpp"
#include "mathspace/ids.hpp"

namespace mathspace {

using ddsim::fx64;

inline constexpr std::size_t MAX_FIELD_NAME = 31;
inline constexpr std::uint8_t MAX_DIM = 8;
// The hash walk counts a note's fields in one byte.
inline constexpr std::size_t MAX_FIELDS = 255;

enum class NoteKind : std::uint8_t { Space = 0, Note = 1, Rule = 2, View = 3 };

// A name is 1 to 31 bytes with no control bytes (below 0x20). The hash
// walk writes the raw bytes, so anything else is allowed; the text grammar
// of phase 2 narrows what it will parse, not what the store will hold.
constexpr bool valid_field_name(std::string_view name) {
    if (name.empty() || name.size() > MAX_FIELD_NAME) {
        return false;
    }
    for (const char c : name) {
        if (static_cast<unsigned char>(c) < 0x20) {
            return false;
        }
    }
    return true;
}

constexpr bool valid_dim(std::uint8_t dim) { return dim >= 1 && dim <= MAX_DIM; }

struct Field {
    std::string name;
    std::uint8_t dim = 1;
    bool bound = false;
    // Lanes at index >= dim are always zero, so two fields with the same
    // dim compare equal exactly when their hashed bytes would.
    std::array<fx64, MAX_DIM> value{};
    std::vector<std::uint8_t> bytecode;

    bool valid() const { return valid_field_name(name) && valid_dim(dim); }

    friend bool operator==(const Field& a, const Field& b) {
        return a.name == b.name && a.dim == b.dim && a.bound == b.bound && a.value == b.value &&
               a.bytecode == b.bytecode;
    }
    friend bool operator!=(const Field& a, const Field& b) { return !(a == b); }
};

struct Note {
    NoteId id;
    // The space this note lives in. A Space note is top level and has an
    // unassigned space id.
    SpaceId space;
    NoteKind kind = NoteKind::Note;
    std::vector<Field> fields; // sorted by name, unique

    friend bool operator==(const Note& a, const Note& b) {
        return a.id == b.id && a.space == b.space && a.kind == b.kind && a.fields == b.fields;
    }
    friend bool operator!=(const Note& a, const Note& b) { return !(a == b); }
};

// Position of `name` in the sorted field vector, or the insertion point.
std::size_t field_lower_bound(const Note& note, std::string_view name);

const Field* find_field(const Note& note, std::string_view name);
Field* find_field(Note& note, std::string_view name);

// Insert `field` in name order or replace the field of the same name.
// Lanes beyond `field.dim` are zeroed. Returns false, leaving the note
// untouched, when the field is not valid or a new name would exceed
// MAX_FIELDS.
bool set_field(Note& note, Field field);

// Returns false when there is no such field.
bool erase_field(Note& note, std::string_view name);

// True when there are at most MAX_FIELDS fields, strictly ascending by
// name, each valid with its unused lanes zero. The debugging check the tests and restore use.
bool fields_well_formed(const Note& note);

} // namespace mathspace
