// ddsim/ids.hpp — stable identifiers for nodes, strokes and brush versions.
//
// A NodeId is a uint64_t laid out so that ascending numeric order is
// (branch, stroke, index):
//
//   bits 63..56  branch tag      (8 bits;  0 = main)
//   bits 55..24  stroke ordinal  (32 bits; starts at 1)
//   bits 23..0   emission index  (24 bits; 16.7M nodes per stroke)
//
// StrokeId = (branch << 32) | ordinal. Zero is the unassigned marker for all
// three, as in the kernel's Ids.hpp. They are separate struct types so a
// stroke id can never be passed where a node id is expected.
#pragma once

#include <cstdint>

namespace ddsim {

using Tick = std::uint32_t;

inline constexpr unsigned DD_ID_BRANCH_BITS = 8;
inline constexpr unsigned DD_ID_ORDINAL_BITS = 32;
inline constexpr unsigned DD_ID_INDEX_BITS = 24;
inline constexpr unsigned DD_ID_BRANCH_SHIFT = 56;
inline constexpr unsigned DD_ID_ORDINAL_SHIFT = 24;
inline constexpr std::uint64_t DD_ID_BRANCH_MASK = (std::uint64_t{1} << DD_ID_BRANCH_BITS) - 1;
inline constexpr std::uint64_t DD_ID_ORDINAL_MASK = (std::uint64_t{1} << DD_ID_ORDINAL_BITS) - 1;
inline constexpr std::uint64_t DD_ID_INDEX_MASK = (std::uint64_t{1} << DD_ID_INDEX_BITS) - 1;

struct NodeId {
    std::uint64_t value = 0;

    constexpr bool assigned() const { return value != 0; }

    friend constexpr bool operator==(NodeId a, NodeId b) { return a.value == b.value; }
    friend constexpr bool operator!=(NodeId a, NodeId b) { return a.value != b.value; }
    friend constexpr bool operator<(NodeId a, NodeId b) { return a.value < b.value; }
};

struct StrokeId {
    std::uint64_t value = 0;

    constexpr bool assigned() const { return value != 0; }

    friend constexpr bool operator==(StrokeId a, StrokeId b) { return a.value == b.value; }
    friend constexpr bool operator!=(StrokeId a, StrokeId b) { return a.value != b.value; }
    friend constexpr bool operator<(StrokeId a, StrokeId b) { return a.value < b.value; }
};

struct BrushVersionId {
    std::uint32_t value = 0;

    constexpr bool assigned() const { return value != 0; }

    friend constexpr bool operator==(BrushVersionId a, BrushVersionId b) { return a.value == b.value; }
    friend constexpr bool operator!=(BrushVersionId a, BrushVersionId b) { return a.value != b.value; }
    friend constexpr bool operator<(BrushVersionId a, BrushVersionId b) { return a.value < b.value; }
};

// Each field is masked to its width so an out-of-range input can never bleed
// into a neighbouring field.
constexpr NodeId make_node_id(std::uint8_t branch, std::uint32_t ordinal, std::uint32_t index) {
    return NodeId{((std::uint64_t{branch} & DD_ID_BRANCH_MASK) << DD_ID_BRANCH_SHIFT) |
                  ((std::uint64_t{ordinal} & DD_ID_ORDINAL_MASK) << DD_ID_ORDINAL_SHIFT) |
                  (std::uint64_t{index} & DD_ID_INDEX_MASK)};
}

constexpr StrokeId make_stroke_id(std::uint8_t branch, std::uint32_t ordinal) {
    return StrokeId{((std::uint64_t{branch} & DD_ID_BRANCH_MASK) << 32) |
                    (std::uint64_t{ordinal} & DD_ID_ORDINAL_MASK)};
}

constexpr std::uint8_t node_branch(NodeId id) {
    return static_cast<std::uint8_t>((id.value >> DD_ID_BRANCH_SHIFT) & DD_ID_BRANCH_MASK);
}
constexpr std::uint32_t node_ordinal(NodeId id) {
    return static_cast<std::uint32_t>((id.value >> DD_ID_ORDINAL_SHIFT) & DD_ID_ORDINAL_MASK);
}
constexpr std::uint32_t node_index(NodeId id) {
    return static_cast<std::uint32_t>(id.value & DD_ID_INDEX_MASK);
}

} // namespace ddsim
