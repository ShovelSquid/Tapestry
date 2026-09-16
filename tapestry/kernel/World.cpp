#include "kernel/World.hpp"

#include "kernel/Time.hpp"
#include "kernel/tree/Codec.hpp"

#include <cmath>
#include <limits>
#include <string_view>
#include <utility>
#include <variant>

namespace tapestry::kernel {
namespace {

// One operator() per Op alternative; std::visit refuses to compile when an
// alternative is missing, which is the point — there is no default branch.
template <class... Fs>
struct Overload : Fs... {
    using Fs::operator()...;
};
template <class... Fs>
Overload(Fs...) -> Overload<Fs...>;

std::string formatTarget(const Target& target) {
    if (const auto* node = std::get_if<NodeId>(&target)) {
        return format(*node);
    }
    return format(std::get<EdgeId>(target));
}

// True when any LF-separated line of the text is longer than `limit` bytes.
// The decoder refuses such a line, so the world refuses it first.
bool hasLineLongerThan(std::string_view text, std::size_t limit) {
    std::size_t pos = 0;
    for (;;) {
        const auto lf = text.find('\n', pos);
        const std::size_t end = lf == std::string_view::npos ? text.size() : lf;
        if (end - pos > limit) {
            return true;
        }
        if (lf == std::string_view::npos) {
            return false;
        }
        pos = lf + 1;
    }
}

} // namespace

const Node* World::node(NodeId id) const {
    const auto it = m_nodes.find(id);
    return it == m_nodes.end() ? nullptr : &it->second;
}

const Edge* World::edge(EdgeId id) const {
    const auto it = m_edges.find(id);
    return it == m_edges.end() ? nullptr : &it->second;
}

std::vector<NodeId> World::nodeIds() const {
    std::vector<NodeId> ids;
    ids.reserve(m_nodes.size());
    for (const auto& [id, node] : m_nodes) {
        (void)node;
        ids.push_back(id);
    }
    return ids;
}

std::vector<EdgeId> World::edgeIds() const {
    std::vector<EdgeId> ids;
    ids.reserve(m_edges.size());
    for (const auto& [id, edge] : m_edges) {
        (void)edge;
        ids.push_back(id);
    }
    return ids;
}

std::size_t World::nodeCount() const { return m_nodes.size(); }
std::size_t World::edgeCount() const { return m_edges.size(); }
Tick World::tick() const { return m_tick; }
NodeId World::nextNodeId() const { return m_nextNode; }
EdgeId World::nextEdgeId() const { return m_nextEdge; }
bool World::wasDeleted(NodeId id) const { return m_deletedNodes.count(id) != 0; }
bool World::wasDeleted(EdgeId id) const { return m_deletedEdges.count(id) != 0; }

std::optional<Rejection> World::prepare(Op& op) const {
    using Kind = Rejection::Kind;

    const auto liveNode = [this](NodeId id) { return m_nodes.find(id) != m_nodes.end(); };
    const auto liveEdge = [this](EdgeId id) { return m_edges.find(id) != m_edges.end(); };
    const auto liveTarget = [&](const Target& target) {
        if (const auto* nodeId = std::get_if<NodeId>(&target)) {
            return liveNode(*nodeId);
        }
        return liveEdge(std::get<EdgeId>(target));
    };
    // Precondition: liveTarget(target).
    const auto propsOf = [this](const Target& target) -> const std::map<std::string, Value>& {
        if (const auto* nodeId = std::get_if<NodeId>(&target)) {
            return m_nodes.at(*nodeId).props;
        }
        return m_edges.at(std::get<EdgeId>(target)).props;
    };

    // A value the file can carry and a later reader can resolve. Text must be
    // UTF-8 without NUL and within the codec's line limit (the decoder refuses
    // anything else, so the file would never reopen); reals must be finite;
    // times must satisfy the event-time grammar; refs must name a node or
    // edge that is live right now — a deleted one resolves to nothing.
    const auto checkValue = [&](const std::string& key, const Value& value) -> std::optional<Rejection> {
        switch (value.type) {
        case ValueType::Text:
            if (!isValidText(value.text)) {
                return Rejection{Kind::BadValue, key + ": text is not valid UTF-8"};
            }
            if (hasLineLongerThan(value.text, tree::kMaxLineBytes)) {
                return Rejection{Kind::BadValue, key + ": a line of the text exceeds " + std::to_string(tree::kMaxLineBytes) + " bytes"};
            }
            return std::nullopt;
        case ValueType::Int:
        case ValueType::Bool:
            return std::nullopt;
        case ValueType::Real:
            if (!std::isfinite(value.real)) {
                return Rejection{Kind::BadValue, key + ": real is not finite"};
            }
            return std::nullopt;
        case ValueType::Time:
            if (!isValidEventTime(value.text)) {
                return Rejection{Kind::BadValue, key + ": not a valid time: " + value.text};
            }
            return std::nullopt;
        case ValueType::Ref:
            break;
        }
        if (const auto nodeId = parseNodeId(value.text)) {
            if (!liveNode(*nodeId)) {
                return Rejection{Kind::RefMissing, key + ": " + value.text};
            }
            return std::nullopt;
        }
        if (const auto edgeId = parseEdgeId(value.text)) {
            if (!liveEdge(*edgeId)) {
                return Rejection{Kind::RefMissing, key + ": " + value.text};
            }
            return std::nullopt;
        }
        return Rejection{Kind::BadValue, key + ": not a node or edge id: " + value.text};
    };

    const auto checkProps = [&](const std::map<std::string, Value>& props) -> std::optional<Rejection> {
        for (const auto& [key, value] : props) {
            if (!isValidKey(key)) {
                return Rejection{Kind::BadKey, key};
            }
            if (auto rejection = checkValue(key, value)) {
                return rejection;
            }
        }
        return std::nullopt;
    };

    return std::visit(Overload{
        [&](CreateNode& create) -> std::optional<Rejection> {
            // The one place node ids are assigned. A replayed record arrives
            // with its committed id, which must be exactly the next one — the
            // counter is restored from the journal, never re-derived, and a
            // deleted id is below the counter so it can never come back.
            if (!create.id.assigned()) {
                create.id = m_nextNode;
            } else if (create.id != m_nextNode) {
                if (liveNode(create.id)) {
                    return Rejection{Kind::DuplicateId, format(create.id)};
                }
                return Rejection{Kind::IdOutOfOrder, format(create.id) + " (next is " + format(m_nextNode) + ")"};
            }
            if (!isToken(create.type) || !isValidText(create.type)) {
                return Rejection{Kind::BadType, create.type};
            }
            if (create.type.size() > tree::kMaxLineBytes) {
                return Rejection{Kind::BadType,
                    "node type exceeds " + std::to_string(tree::kMaxLineBytes) + " bytes"};
            }
            return checkProps(create.props);
        },
        [&](const SetProperty& set) -> std::optional<Rejection> {
            if (!liveTarget(set.target)) {
                return Rejection{Kind::UnknownTarget, formatTarget(set.target)};
            }
            if (!isValidKey(set.key)) {
                return Rejection{Kind::BadKey, set.key};
            }
            return checkValue(set.key, set.value);
        },
        [&](const UnsetProperty& unset) -> std::optional<Rejection> {
            if (!liveTarget(unset.target)) {
                return Rejection{Kind::UnknownTarget, formatTarget(unset.target)};
            }
            if (!isValidKey(unset.key)) {
                return Rejection{Kind::BadKey, unset.key};
            }
            const auto& props = propsOf(unset.target);
            if (props.find(unset.key) == props.end()) {
                return Rejection{Kind::UnknownTarget, formatTarget(unset.target) + " has no property " + unset.key};
            }
            return std::nullopt;
        },
        [&](CreateEdge& create) -> std::optional<Rejection> {
            // Edge ids follow the same rule as node ids, on their own counter.
            if (!create.id.assigned()) {
                create.id = m_nextEdge;
            } else if (create.id != m_nextEdge) {
                if (liveEdge(create.id)) {
                    return Rejection{Kind::DuplicateId, format(create.id)};
                }
                return Rejection{Kind::IdOutOfOrder, format(create.id) + " (next is " + format(m_nextEdge) + ")"};
            }
            if (!liveNode(create.from)) {
                return Rejection{Kind::RefMissing, "from: " + format(create.from)};
            }
            if (!liveNode(create.to)) {
                return Rejection{Kind::RefMissing, "to: " + format(create.to)};
            }
            if (!isToken(create.label) || !isValidText(create.label)) {
                return Rejection{Kind::BadValue, "edge label is not one token: " + create.label};
            }
            if (create.label.size() > tree::kMaxLineBytes) {
                return Rejection{Kind::BadValue,
                    "edge label exceeds " + std::to_string(tree::kMaxLineBytes) + " bytes"};
            }
            return checkProps(create.props);
        },
        [&](const DeleteNode& del) -> std::optional<Rejection> {
            if (!liveNode(del.id)) {
                return Rejection{Kind::UnknownTarget, format(del.id) + (wasDeleted(del.id) ? " (already deleted)" : "")};
            }
            return std::nullopt;
        },
        [&](const DeleteEdge& del) -> std::optional<Rejection> {
            if (!liveEdge(del.id)) {
                return Rejection{Kind::UnknownTarget, format(del.id) + (wasDeleted(del.id) ? " (already deleted)" : "")};
            }
            return std::nullopt;
        },
        [&](const Advance& advance) -> std::optional<Rejection> {
            if (advance.ticks == 0) {
                return Rejection{Kind::TickZero, "advance 0 changes nothing"};
            }
            if (advance.ticks > std::numeric_limits<Tick>::max() - m_tick) {
                return Rejection{Kind::BadValue, "advance would overflow the tick counter"};
            }
            return std::nullopt;
        },
    }, op);
}

void World::apply(const Op& op) {
    // Precondition (from prepare): the target is live.
    const auto propsOf = [this](const Target& target) -> std::map<std::string, Value>& {
        if (const auto* nodeId = std::get_if<NodeId>(&target)) {
            return m_nodes.at(*nodeId).props;
        }
        return m_edges.at(std::get<EdgeId>(target)).props;
    };

    std::visit(Overload{
        [&](const CreateNode& create) {
            Node node;
            node.id = create.id;
            node.type = create.type;
            node.props = create.props;
            m_nodes[create.id] = std::move(node);
            // Move the counter past any adopted id so later assignments never
            // collide, whether the id came from a live proposal or a replay.
            if (!(create.id < m_nextNode)) {
                m_nextNode = NodeId{create.id.value + 1};
            }
        },
        [&](const SetProperty& set) { propsOf(set.target)[set.key] = set.value; },
        [&](const UnsetProperty& unset) { propsOf(unset.target).erase(unset.key); },
        [&](const CreateEdge& create) {
            Edge edge;
            edge.id = create.id;
            edge.from = create.from;
            edge.to = create.to;
            edge.label = create.label;
            edge.props = create.props;
            m_edges[create.id] = std::move(edge);
            if (!(create.id < m_nextEdge)) {
                m_nextEdge = EdgeId{create.id.value + 1};
            }
        },
        [&](const DeleteNode& del) {
            // Every edge touching the node goes with it; each removed id is
            // tombstoned so the history can be read back and never aliased.
            for (auto it = m_edges.begin(); it != m_edges.end();) {
                if (it->second.from == del.id || it->second.to == del.id) {
                    m_deletedEdges.insert(it->first);
                    it = m_edges.erase(it);
                } else {
                    ++it;
                }
            }
            m_nodes.erase(del.id);
            m_deletedNodes.insert(del.id);
        },
        [&](const DeleteEdge& del) {
            m_edges.erase(del.id);
            m_deletedEdges.insert(del.id);
        },
        [&](const Advance& advance) { m_tick += advance.ticks; },
    }, op);
}

World::Transaction World::begin() { return Transaction(*this); }

World::Transaction::Transaction(World& world)
    : m_world(world),
      m_savedNextNode(world.m_nextNode),
      m_savedNextEdge(world.m_nextEdge),
      m_savedTick(world.m_tick) {}

World::Transaction::~Transaction() {
    if (m_open) {
        rollback();
    }
}

std::optional<Rejection> World::Transaction::prepare(Op& op) const { return m_world.prepare(op); }

void World::Transaction::apply(const Op& op) {
    // Saved first, applied second: once World::apply has run, what the op
    // replaced or removed is gone.
    record(op);
    m_world.apply(op);
}

void World::Transaction::commit() {
    m_savedNodes.clear();
    m_savedEdges.clear();
    m_savedNodeProps.clear();
    m_savedEdgeProps.clear();
    m_open = false;
}

void World::Transaction::rollback() {
    // Pass one: whole entities, each back to the state it was in the first
    // time this commit touched it.
    for (auto& [id, saved] : m_savedNodes) {
        if (saved.value) {
            m_world.m_nodes[id] = std::move(*saved.value);
        } else {
            m_world.m_nodes.erase(id);
        }
        if (saved.tombstoned) {
            m_world.m_deletedNodes.insert(id);
        } else {
            m_world.m_deletedNodes.erase(id);
        }
    }
    for (auto& [id, saved] : m_savedEdges) {
        if (saved.value) {
            m_world.m_edges[id] = std::move(*saved.value);
        } else {
            m_world.m_edges.erase(id);
        }
        if (saved.tombstoned) {
            m_world.m_deletedEdges.insert(id);
        } else {
            m_world.m_deletedEdges.erase(id);
        }
    }

    // Pass two: single properties, into the entities pass one just restored.
    // An entity that is not live now was absent when this commit found it, so
    // there is nothing left for its properties to be restored into.
    for (auto& [slot, previous] : m_savedNodeProps) {
        const auto found = m_world.m_nodes.find(slot.first);
        if (found == m_world.m_nodes.end()) {
            continue;
        }
        if (previous) {
            found->second.props[slot.second] = std::move(*previous);
        } else {
            found->second.props.erase(slot.second);
        }
    }
    for (auto& [slot, previous] : m_savedEdgeProps) {
        const auto found = m_world.m_edges.find(slot.first);
        if (found == m_world.m_edges.end()) {
            continue;
        }
        if (previous) {
            found->second.props[slot.second] = std::move(*previous);
        } else {
            found->second.props.erase(slot.second);
        }
    }

    m_world.m_nextNode = m_savedNextNode;
    m_world.m_nextEdge = m_savedNextEdge;
    m_world.m_tick = m_savedTick;
    commit();
}

void World::Transaction::saveNode(NodeId id) {
    if (m_savedNodes.find(id) != m_savedNodes.end()) {
        return; // First touch wins: it holds the state the commit started from.
    }
    Saved<Node> saved;
    const auto found = m_world.m_nodes.find(id);
    if (found != m_world.m_nodes.end()) {
        saved.value = found->second;
    }
    saved.tombstoned = m_world.m_deletedNodes.count(id) != 0;
    m_savedNodes.emplace(id, std::move(saved));
}

void World::Transaction::saveEdge(EdgeId id) {
    if (m_savedEdges.find(id) != m_savedEdges.end()) {
        return;
    }
    Saved<Edge> saved;
    const auto found = m_world.m_edges.find(id);
    if (found != m_world.m_edges.end()) {
        saved.value = found->second;
    }
    saved.tombstoned = m_world.m_deletedEdges.count(id) != 0;
    m_savedEdges.emplace(id, std::move(saved));
}

void World::Transaction::saveProperty(const Target& target, const std::string& key) {
    if (const auto* nodeId = std::get_if<NodeId>(&target)) {
        auto slot = std::make_pair(*nodeId, key);
        if (m_savedNodeProps.find(slot) != m_savedNodeProps.end()) {
            return;
        }
        std::optional<Value> previous;
        const auto found = m_world.m_nodes.find(*nodeId);
        if (found != m_world.m_nodes.end()) {
            const auto held = found->second.props.find(key);
            if (held != found->second.props.end()) {
                previous = held->second;
            }
        }
        m_savedNodeProps.emplace(std::move(slot), std::move(previous));
        return;
    }
    const EdgeId edgeId = std::get<EdgeId>(target);
    auto slot = std::make_pair(edgeId, key);
    if (m_savedEdgeProps.find(slot) != m_savedEdgeProps.end()) {
        return;
    }
    std::optional<Value> previous;
    const auto found = m_world.m_edges.find(edgeId);
    if (found != m_world.m_edges.end()) {
        const auto held = found->second.props.find(key);
        if (held != found->second.props.end()) {
            previous = held->second;
        }
    }
    m_savedEdgeProps.emplace(std::move(slot), std::move(previous));
}

// What one op can change, and therefore all that has to be copied to undo it.
// One branch per alternative and no default branch, as everywhere else the
// kernel visits an Op, so an eighth verb is a compile error here too rather
// than an op whose footprint is silently empty.
void World::Transaction::record(const Op& op) {
    std::visit(Overload{
        // prepare() has already assigned the id, so there is one to save.
        [&](const CreateNode& create) { saveNode(create.id); },
        // One property, not the whole node or edge holding it.
        [&](const SetProperty& set) { saveProperty(set.target, set.key); },
        [&](const UnsetProperty& unset) { saveProperty(unset.target, unset.key); },
        [&](const CreateEdge& create) { saveEdge(create.id); },
        [&](const DeleteNode& del) {
            saveNode(del.id);
            // The cascade apply() is about to perform. No line in the file
            // names these edges, so this scan is the only thing that can bring
            // them back — and it is the same scan apply() already does for
            // this op, so it adds no order of growth.
            for (const auto& [live, touching] : m_world.m_edges) {
                if (touching.from == del.id || touching.to == del.id) {
                    saveEdge(live);
                }
            }
        },
        [&](const DeleteEdge& del) { saveEdge(del.id); },
        // Nothing: the tick was saved when the transaction opened.
        [](const Advance&) {},
    }, op);
}

} // namespace tapestry::kernel
