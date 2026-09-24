// mathspace/ids.hpp — stable identifiers for notes and spaces.
//
// A NoteId is the kernel's NodeId: a plain sequential u64 that the kernel
// assigns and never reuses (mathspace_plan.md, "Identity"). The engine
// image is derived from kernel nodes, so it never allocates ids of its
// own: CreateSpace and CreateNote actions carry the id the kernel gave
// the node, and the store only requires it to be nonzero and unique.
// Grouping and branching are the kernel's job, not an id-layout trick;
// the earlier ddsim-style (branch, group, index) packing is gone.
//
// Zero is the unassigned marker. Spaces are notes too (kind Space), so a
// SpaceId is a NoteId under a distinct type: one can never be passed
// where the other is expected.
#pragma once

#include <cstdint>

namespace mathspace {

using Tick = std::uint32_t;

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

// A space's id is the id of the note that is the space.
constexpr SpaceId space_of(NoteId id) { return SpaceId{id.value}; }
constexpr NoteId note_of(SpaceId id) { return NoteId{id.value}; }

} // namespace mathspace
