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

} // namespace tapestry::kernel
