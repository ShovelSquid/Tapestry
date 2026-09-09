#pragma once

#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Value.hpp"

#include <cstddef>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace tapestry::kernel {

// A node is an id, an opaque type string and typed properties — nothing
// else. Notes, people, events and rules are all nodes whose meaning lives in
// plugins; the kernel loads, saves and displays a node whose type it has
// never seen exactly as well as one it has.
struct Node {
    NodeId id;
    std::string type;
    std::map<std::string, Value> props;
};

// A directed, labelled connection between two nodes, with its own properties.
// Deleting either endpoint deletes the edge with it.
struct Edge {
    EdgeId id;
    NodeId from;
    NodeId to;
    std::string label;
    std::map<std::string, Value> props;
};

// Why a proposal was refused. A rejection is the normal outcome of a bad
// request, not an exception: nothing was written and nothing changed.
struct Rejection {
    enum class Kind {
        UnknownTarget,   // set/unset/delete on a node, edge or property that does not exist
        DuplicateId,     // a creation op names an id that already exists
        IdOutOfOrder,    // a creation op names an id other than the next one (including a deleted one)
        BadType,         // a node type that is not one token
        BadKey,          // a property key outside [A-Za-z_][A-Za-z0-9_.:-]*
        BadValue,        // a value the file could not carry (NaN, bad time, bad text, bad label)
        RefMissing,      // a ref value or an edge endpoint that resolves to nothing live
        BadActor,        // an actor kind outside human|plugin|system, or an id that is not a token
        TickZero,        // advance by zero
        JournalNotClean, // the journal is torn or corrupt; repair first
        Io               // the durable write failed; the world is unchanged
    } kind;
    std::string detail;
};

// The in-memory graph state. It changes in exactly one way: an op that
// prepare() accepted is handed to apply(). There are no mutable accessors
// and no feature classes, so every change is a recorded op and the state
// after replaying a journal is the state the journal describes.
class World {
public:
    // Read-only queries. node()/edge() return nullptr for an unknown or
    // deleted id; the pointer is valid until the next apply().
    const Node* node(NodeId id) const;
    const Edge* edge(EdgeId id) const;
    std::vector<NodeId> nodeIds() const;
    std::vector<EdgeId> edgeIds() const;
    std::size_t nodeCount() const;
    std::size_t edgeCount() const;
    Tick tick() const;

    // The ids the next creation ops will receive: sequential per world, never
    // reused, restored from the highest id seen when a journal is replayed.
    NodeId nextNodeId() const;
    EdgeId nextEdgeId() const;

    // Tombstones. A deleted id is remembered for the life of the world so it
    // is never handed out again and so a reader can tell "deleted" from
    // "never existed".
    bool wasDeleted(NodeId id) const;
    bool wasDeleted(EdgeId id) const;

    // Validates one op against the current state and, for a creation op whose
    // id is 0, assigns nextNodeId()/nextEdgeId() in place — the only place
    // ids are ever assigned. A non-zero id must equal the next one or the op
    // is rejected IdOutOfOrder, so a decoded record replays with its
    // committed ids and never re-derives them. Returns the first Rejection
    // found, or nullopt when the op may be applied. Never changes the world.
    std::optional<Rejection> prepare(Op&) const;

    // Applies an op. Precondition: prepare() returned nullopt for this op
    // against this state. The only mutator.
    void apply(const Op&);

private:
    std::map<NodeId, Node> m_nodes;
    std::map<EdgeId, Edge> m_edges;
    std::set<NodeId> m_deletedNodes;
    std::set<EdgeId> m_deletedEdges;
    NodeId m_nextNode{1};
    EdgeId m_nextEdge{1};
    Tick m_tick = 0;
};

} // namespace tapestry::kernel
