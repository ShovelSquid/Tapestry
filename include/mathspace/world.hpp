// mathspace/world.hpp — the store: every note of every space, in id order.
//
// World is the authoritative state. Notes live in one vector sorted by id
// (a lower_bound insert, exactly as ddsim's state.nodes), so the hash walk,
// serialize and every rule iterate in id order without a map. Spaces are
// notes of kind Space and take the next group ordinal like anything else;
// a note created by hand is a group of one (index 0).
//
// A space's dimension is the dim of its own `pos` field: create_space
// gives the space note a zero `pos` of that dim, and `pos` on any note in
// the space must have the same dim. `pos` is the one field name the store
// knows, because "a note's pos has exactly its space's dimension" is a
// structural invariant (plan, Foundational decisions), not a preset.
//
// Every mutator validates everything first and only then writes, so a
// rejected call leaves the world byte-identical; the tests check this by
// comparing the whole World before and after. Mutators return an Error
// rather than throwing because World::apply (the action decoder, next
// step) needs to turn the same outcomes into a replayable result code.
//
// next_group is state: it must survive serialize/restore, otherwise a
// restored world could reuse the ordinal of a deleted group and diverge
// from the original on the next create. The hash walk therefore carries
// it (see hash.cpp when it lands, and STATE.md Decisions).
#pragma once

#include <cstdint>
#include <string_view>
#include <vector>

#include "mathspace/ids.hpp"
#include "mathspace/note.hpp"

namespace mathspace {

enum class Error : std::uint8_t {
    Ok = 0,
    BadDim,          // dim outside 1..8
    BadName,         // field name outside the valid_field_name rule
    BadKind,         // create_note asked for kind Space (use create_space)
    NoSuchSpace,     // space id unassigned, missing, or not a Space note
    NoSuchNote,      // note id unassigned or missing
    NoSuchField,     // delete_field of a name the note does not have
    PosDimMismatch,  // `pos` dim differs from the note's space dim
    SpaceNotEmpty,   // delete_note of a Space that still holds notes
    LockedField,     // delete_field `pos` on a Space note
    IdExhausted,     // group ordinal space (32 bits) used up
    TooManyFields,   // set_field of a new name on a note that already has MAX_FIELDS
    BadBytes,        // restore: bytes are not a canonical walk of a well-formed world
    BadAction,       // apply: header, kind, or payload bytes malformed (action.hpp)
};

const char* error_name(Error e);

struct World {
    std::uint64_t seed = 0;
    std::uint64_t tick = 0;
    std::uint32_t next_group = 1;
    std::vector<Note> notes; // sorted by id, unique

    World() = default;
    explicit World(std::uint64_t seed_) : seed(seed_) {}

    // Position of `id` in notes, or the insertion point.
    std::size_t note_lower_bound(NoteId id) const;
    const Note* find(NoteId id) const;
    Note* find(NoteId id);
    // The Space note for `space`, or nullptr when it is not a Space.
    const Note* find_space(SpaceId space) const;
    // Dimension of a space (dim of its `pos`), 0 when not a Space.
    std::uint8_t space_dim(SpaceId space) const;
    // Count of notes whose space is `space` (the space itself excluded).
    std::size_t notes_in(SpaceId space) const;

    Error create_space(std::uint8_t dim, NoteId* out);
    Error create_note(SpaceId space, NoteKind kind, NoteId* out);
    Error set_field(NoteId note, Field field);
    Error delete_note(NoteId note);
    Error delete_field(NoteId note, std::string_view name);

    // Decodes one action (action.hpp) and calls the mutator it names.
    // `created` receives the new id for CreateSpace/CreateNote; it may be
    // null. Any outcome other than Ok leaves the world byte-identical.
    Error apply(const std::uint8_t* bytes, std::size_t len, NoteId* created = nullptr);
    Error apply(const std::vector<std::uint8_t>& bytes, NoteId* created = nullptr) {
        return apply(bytes.data(), bytes.size(), created);
    }

    // Advances tick only. Rules and bound expressions come in later phases.
    void step();

    // Sorted, unique ids and well-formed fields; the tests' invariant check.
    bool well_formed() const;

    friend bool operator==(const World& a, const World& b) {
        return a.seed == b.seed && a.tick == b.tick && a.next_group == b.next_group &&
               a.notes == b.notes;
    }
    friend bool operator!=(const World& a, const World& b) { return !(a == b); }
};

// The one field name the store knows; see the header comment.
inline constexpr std::string_view POS_FIELD = "pos";

// Bumped whenever the canonical walk (hash.cpp) changes shape. Pinned in
// the walk itself so old bytes are rejected instead of misread.
inline constexpr std::uint32_t FORMAT_VERSION = 1u;

// The canonical walk (hash.cpp): serialize() is exactly the bytes that
// hash() digests, restore() is their strict inverse. restore decodes into
// a local World, checks well_formed(), and swaps only on success, so a
// failed restore leaves `world` byte-identical.
void hash(const World& world, std::uint8_t out[32]);
std::vector<std::uint8_t> serialize(const World& world);
Error restore(World& world, const std::uint8_t* bytes, std::size_t len);
inline Error restore(World& world, const std::vector<std::uint8_t>& bytes) {
    return restore(world, bytes.data(), bytes.size());
}

} // namespace mathspace
