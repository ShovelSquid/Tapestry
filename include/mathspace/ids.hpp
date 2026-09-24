// mathspace/ids.hpp — stable identifiers for notes and spaces.
//
// A NoteId is a uint64_t with the same layout as ddsim's NodeId, so that
// ascending numeric order is (branch, group, index) and the two stores can
// share ids when ddsim is folded in at plan phase 7:
//
//   bits 63..56  branch tag      (8 bits;  0 = main)
//   bits 55..24  group ordinal   (32 bits; starts at 1)
//   bits 23..0   index in group  (24 bits; 16.7M notes per group)
//
// A group is whatever created the notes together (a stroke, a paste, a
// preset load); a note placed by hand is a group of one. The widths and
// masks come straight from ddsim/ids.hpp so the layouts cannot drift.
// Zero is the unassigned marker. Spaces are notes too (kind Space), so a
// SpaceId is a NoteId under a distinct type: one can never be passed where
// the other is expected.
#pragma once

#include <cstdint>

#include "ddsim/ids.hpp"

namespace mathspace {

using Tick = std::uint32_t;

inline constexpr unsigned ID_BRANCH_BITS = ddsim::DD_ID_BRANCH_BITS;
inline constexpr unsigned ID_GROUP_BITS = ddsim::DD_ID_ORDINAL_BITS;
inline constexpr unsigned ID_INDEX_BITS = ddsim::DD_ID_INDEX_BITS;
inline constexpr unsigned ID_BRANCH_SHIFT = ddsim::DD_ID_BRANCH_SHIFT;
inline constexpr unsigned ID_GROUP_SHIFT = ddsim::DD_ID_ORDINAL_SHIFT;
inline constexpr std::uint64_t ID_BRANCH_MASK = ddsim::DD_ID_BRANCH_MASK;
inline constexpr std::uint64_t ID_GROUP_MASK = ddsim::DD_ID_ORDINAL_MASK;
inline constexpr std::uint64_t ID_INDEX_MASK = ddsim::DD_ID_INDEX_MASK;

struct NoteId {
    std::uint64_t value = 0;

    constexpr bool assigned() const { return value != 0; }

    friend constexpr bool operator==(NoteId a, NoteId b) { return a.value == b.value; }
    friend constexpr bool operator!=(NoteId a, NoteId b) { return a.value != b.value; }
    friend constexpr bool operator<(NoteId a, NoteId b) { return a.value < b.value; }
};

struct SpaceId {
    std::uint64_t value = 0;

    constexpr bool assigned() const { return value != 0; }

    friend constexpr bool operator==(SpaceId a, SpaceId b) { return a.value == b.value; }
    friend constexpr bool operator!=(SpaceId a, SpaceId b) { return a.value != b.value; }
    friend constexpr bool operator<(SpaceId a, SpaceId b) { return a.value < b.value; }
};

// Each field is masked to its width so an out-of-range input can never bleed
// into a neighbouring field.
constexpr NoteId make_note_id(std::uint8_t branch, std::uint32_t group, std::uint32_t index) {
    return NoteId{((std::uint64_t{branch} & ID_BRANCH_MASK) << ID_BRANCH_SHIFT) |
                  ((std::uint64_t{group} & ID_GROUP_MASK) << ID_GROUP_SHIFT) |
                  (std::uint64_t{index} & ID_INDEX_MASK)};
}

constexpr std::uint8_t note_branch(NoteId id) {
    return static_cast<std::uint8_t>((id.value >> ID_BRANCH_SHIFT) & ID_BRANCH_MASK);
}
constexpr std::uint32_t note_group(NoteId id) {
    return static_cast<std::uint32_t>((id.value >> ID_GROUP_SHIFT) & ID_GROUP_MASK);
}
constexpr std::uint32_t note_index(NoteId id) {
    return static_cast<std::uint32_t>(id.value & ID_INDEX_MASK);
}

// A space's id is the id of the note that is the space.
constexpr SpaceId space_of(NoteId id) { return SpaceId{id.value}; }
constexpr NoteId note_of(SpaceId id) { return NoteId{id.value}; }

} // namespace mathspace
