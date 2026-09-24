#pragma once

#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Record.hpp"

#include <optional>
#include <vector>

namespace tapestry::kernel {

// Who made a node, and who changed it last — derived from the commits that
// created and touched it, never stored as a property.
//
// Authorship that lives in a property is authorship a writer can set. The
// actor line of the commit carrying `create-node n7` is the only claim about
// who made n7 that exists in the file, so it is the only one this index will
// report (HIST-08: derive rather than store).
//
// createdSeq/createdBy come from the CreateNode op. changedSeq/changedBy start
// equal to them and move forward with every property write on the node, so a
// node nobody has edited since creation reports its creator as its last
// changer. deletedSeq/deletedBy are set only once the node is gone.
struct NodeHistory {
    NodeId id;
    CommitSeq createdSeq = 0;
    Actor createdBy;
    CommitSeq changedSeq = 0;
    Actor changedBy;
    std::optional<CommitSeq> deletedSeq;
    std::optional<Actor> deletedBy;
};

// The same for an edge, plus the endpoints it was created with. An edge has no
// changedBy: its properties are not shown as authorship anywhere, and the
// endpoints never change.
struct EdgeHistory {
    EdgeId id;
    NodeId from;
    NodeId to;
    CommitSeq createdSeq = 0;
    Actor createdBy;
    std::optional<CommitSeq> deletedSeq;
    std::optional<Actor> deletedBy;
};

// Every node and edge the scanned commits mention, each vector in ascending id
// order. Deleted entries stay in the index: a reader asking "who deleted this?"
// is asking a history question, and tombstoned ids are never reused.
struct HistoryIndex {
    std::vector<NodeHistory> nodes;
    std::vector<EdgeHistory> edges;
};

// Walk `commits` in order and stop after seq `maxSeq`, building the index the
// world at that point would be described by.
//
// maxSeq is what makes this honest under undo: a rewound view must not show a
// last-changer from a commit the reader cannot see. Passing the replay position
// rather than lastSeq() is the caller's job.
//
// A delete-node line is the only record of a cascade — the kernel removes every
// edge touching the node without writing a delete-edge line for each — so this
// function reproduces that cascade rather than looking for lines that are not
// there.
HistoryIndex buildHistoryIndex(const std::vector<CommitRecord>& commits, CommitSeq maxSeq);

} // namespace tapestry::kernel
