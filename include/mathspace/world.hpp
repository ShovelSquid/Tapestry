// mathspace/world.hpp — the store: every note of every space, in id order.
//
// World is the engine image of the kernel's nodes. Notes live in one
// vector sorted by id (a lower_bound insert, exactly as ddsim's
// state.nodes), so the hash walk, serialize and every rule iterate in id
// order without a map. Ids are the kernel's (ids.hpp): the caller of
// create_space/create_note supplies them, and the store only refuses zero
// and a duplicate. Spaces are notes of kind Space.
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
// rather than throwing because World::apply (the action decoder) needs
// to turn the same outcomes into a replayable result code.
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
    DuplicateId,     // create_* with id zero or an id already in the store
    TooManyFields,   // set_field of a new name on a note that already has MAX_FIELDS
    BadBytes,        // restore: bytes are not a canonical walk of a well-formed world
    BadAction,       // apply: header, kind, or payload bytes malformed (action.hpp)
    BadBytecode,     // a bound field whose bytecode does not decode, or whose dim differs
                     // from the program's; unbind of a field that is not there
};

const char* error_name(Error e);

struct World {
    std::uint64_t seed = 0;
    std::uint64_t tick = 0;
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

    Error create_space(NoteId id, std::uint8_t dim);
    Error create_note(NoteId id, SpaceId space, NoteKind kind);
    // A bound field must carry bytecode that expr::decode accepts at the
    // field's dim, and an unbound one none (Error::BadBytecode otherwise).
    Error set_field(NoteId note, Field field);
    // Binds `name` on `note` to `bytecode` (the encoded Program): the field
    // takes the program's dim, keeps its lanes when the dim is unchanged
    // and starts at zero otherwise. Empty bytecode unbinds, keeping the
    // lanes and the dim (NoSuchField when there is nothing to unbind).
    Error bind_field(NoteId note, std::string_view name, std::vector<std::uint8_t> bytecode);
    Error delete_note(NoteId note);
    Error delete_field(NoteId note, std::string_view name);

    // Decodes one action (action.hpp) and calls the mutator it names.
    // Any outcome other than Ok leaves the world byte-identical.
    Error apply(const std::uint8_t* bytes, std::size_t len);
    Error apply(const std::vector<std::uint8_t>& bytes) { return apply(bytes.data(), bytes.size()); }

    // One tick (step.cpp): the bootstrap integrate rule, then every bound
    // field evaluated in id then name order, then ++tick.
    void step();

    // Sorted, unique ids and well-formed fields; the tests' invariant check.
    bool well_formed() const;

    // The snapshot (snapshot.cpp): what the plugin diffs against the
    // kernel after a step. Per note in id order:
    //   u64 id | u8 field_count | per field in name order:
    //     u8 name_len | name | u8 dim | dim x i64 (raw fx64)
    // No seed, tick, space id, kind, bound flag or bytecode: the kernel
    // already holds those, or they are not state a step can change.
    // Rebuilt lazily, so mutators pay nothing and a rejected apply never
    // touches it. Both cache members are excluded from operator== and
    // from the hash walk: they are a view of the notes, not state.
    const std::vector<std::uint8_t>& notes_bytes() const;
    mutable bool notes_dirty = true;
    mutable std::vector<std::uint8_t> notes_cache;

    friend bool operator==(const World& a, const World& b) {
        return a.seed == b.seed && a.tick == b.tick && a.notes == b.notes;
    }
    friend bool operator!=(const World& a, const World& b) { return !(a == b); }
};

// The one field name the store knows; see the header comment.
inline constexpr std::string_view POS_FIELD = "pos";
// The one field name the bootstrap rule knows (step.cpp, version.hpp).
inline constexpr std::string_view VELOCITY_FIELD = "velocity";

// Bumped whenever the canonical walk (hash.cpp) changes shape. Pinned in
// the walk itself so old bytes are rejected instead of misread.
//   1: initial walk. 2: next_group dropped, the step version pin added
//   (named MS_RULE_INTEGRATE_VERSION then, MS_STEP_VERSION now, same slot).
inline constexpr std::uint32_t FORMAT_VERSION = 2u;

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
