#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace tapestry::kernel {

// Kernel-assigned node identifier. Ids are sequential per world, start at 1,
// are written into the committed op (`create-node n7 …`) and are never reused
// after deletion, so a reader can follow `n7` through the whole history. Zero
// is the unassigned marker: a proposal carries NodeId{} until the kernel
// numbers it at commit time.
struct NodeId {
    std::uint64_t value = 0;

    bool assigned() const { return value != 0; }

    friend bool operator==(NodeId a, NodeId b) { return a.value == b.value; }
    friend bool operator!=(NodeId a, NodeId b) { return a.value != b.value; }
    friend bool operator<(NodeId a, NodeId b) { return a.value < b.value; }
};

// Edge identifier with the same rules as NodeId; a separate type so an edge id
// can never be passed where a node id is expected, and vice versa.
struct EdgeId {
    std::uint64_t value = 0;

    bool assigned() const { return value != 0; }

    friend bool operator==(EdgeId a, EdgeId b) { return a.value == b.value; }
    friend bool operator!=(EdgeId a, EdgeId b) { return a.value != b.value; }
    friend bool operator<(EdgeId a, EdgeId b) { return a.value < b.value; }
};

// The commit sequence number (`@commit <seq>`), 1-based, and the simulation
// tick (`tick <n>`) a commit applies at. Plain integers by design: they are
// counted and compared, never parsed with a prefix.
using CommitSeq = std::uint64_t;
using Tick = std::uint64_t;

// Text forms as they appear in a .tree file: `n12`, `e3`.
std::string format(NodeId id);
std::string format(EdgeId id);

// Strict inverses of format(): the prefix letter, then decimal digits with no
// leading zero, value >= 1, no overflow, nothing before or after. `n0`, `n01`,
// `n`, `N1`, `n1 ` and an edge id passed to parseNodeId are all rejected — an
// id that the writer would not have produced is not an id.
std::optional<NodeId> parseNodeId(std::string_view text);
std::optional<EdgeId> parseEdgeId(std::string_view text);

} // namespace tapestry::kernel
