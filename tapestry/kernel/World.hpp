#pragma once

#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Value.hpp"

#include <cstddef>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
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

    // A narrow scratch over one commit. Before each op is applied it saves the
    // entities that op is about to change — and only those — so a commit that
    // does not complete can be put back exactly as it was. What it saves are
    // values, never inverse ops: rollback puts a saved entity back without
    // knowing which op removed it, so there is no per-op inverse to get wrong.
    //
    // The destructor rolls back unless commit() ran, so every early return from
    // a caller — a Rejection, a record that would not decode, a failed append —
    // restores the world without the return site having to remember to.
    //
    // World::prepare and World::apply run unchanged underneath it: the
    // transaction narrows what is copied, never what a commit means.
    //
    // Neither copyable nor movable — it borrows the world it was opened on.
    class Transaction {
    public:
        explicit Transaction(World& world);
        ~Transaction();

        Transaction(const Transaction&) = delete;
        Transaction& operator=(const Transaction&) = delete;
        Transaction(Transaction&&) = delete;
        Transaction& operator=(Transaction&&) = delete;

        // World::prepare, forwarded unchanged.
        std::optional<Rejection> prepare(Op& op) const;

        // Saves this op's footprint, then World::apply, unchanged.
        // Precondition, as for World::apply(): prepare() returned nullopt for
        // this op against this state — which is also what assigns a creation
        // op its id, so the footprint knows which id to save.
        void apply(const Op& op);

        // Keep everything applied so far and drop the saved copies.
        void commit();

        // Put the saved copies back, restoring the world to the state it had
        // when the transaction opened. Idempotent; the destructor calls it.
        void rollback();

    private:
        // First touch of an id wins, and one saved entry carries all three
        // states an id can be in: live (a value), tombstoned, or absent
        // (neither). Rollback is then uniform and needs no knowledge of which
        // op did what — and the absent case is what leaves no tombstone behind
        // when one rejected commit both created and deleted an id.
        template <class T>
        struct Saved {
            std::optional<T> value;
            bool tombstoned = false;
        };

        // A property write saves one property, not the node or edge holding
        // it: a note that has accumulated tens of thousands of properties must
        // not cost a copy of all of them to set one more. First touch of an
        // (id, key) wins, and nullopt means the key was not there.
        //
        // Restoring is two passes in this order — every entity, then every
        // property — because a commit may set a property on a node and then
        // delete that node, in which case the saved entity is the node as it
        // stood after the set and the saved property is what it held before.
        // A property whose entity is not live after the first pass has nothing
        // to restore into: the entity save already put that id back as it was.
        void record(const Op& op);
        void saveNode(NodeId id);
        void saveEdge(EdgeId id);
        void saveProperty(const Target& target, const std::string& key);

        World& m_world;
        std::map<NodeId, Saved<Node>> m_savedNodes;
        std::map<EdgeId, Saved<Edge>> m_savedEdges;
        std::map<std::pair<NodeId, std::string>, std::optional<Value>> m_savedNodeProps;
        std::map<std::pair<EdgeId, std::string>, std::optional<Value>> m_savedEdgeProps;
        NodeId m_savedNextNode;
        EdgeId m_savedNextEdge;
        Tick m_savedTick = 0;
        bool m_open = true;
    };

    // Opens a transaction over this world. The world is changed in place from
    // here on; nothing is kept until commit().
    Transaction begin();

private:
    // Every member below must be covered by Transaction::rollback(): the three
    // scalars are saved when the transaction opens, the four containers by
    // Transaction::record() per op. A field added here that rollback does not
    // restore is a field a rejected commit can leave changed.
    std::map<NodeId, Node> m_nodes;
    std::map<EdgeId, Edge> m_edges;
    std::set<NodeId> m_deletedNodes;
    std::set<EdgeId> m_deletedEdges;
    NodeId m_nextNode{1};
    EdgeId m_nextEdge{1};
    Tick m_tick = 0;
};

} // namespace tapestry::kernel
