#include "kernel/World.hpp"

#include "kernel/Time.hpp"

#include <cmath>
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

} // namespace

const Node* World::node(NodeId id) const {
    const auto it = m_nodes.find(id);
    return it == m_nodes.end() ? nullptr : &it->second;
}

const Edge* World::edge(EdgeId) const { return nullptr; }

std::vector<NodeId> World::nodeIds() const {
    std::vector<NodeId> ids;
    ids.reserve(m_nodes.size());
    for (const auto& [id, node] : m_nodes) {
        (void)node;
        ids.push_back(id);
    }
    return ids;
}

std::vector<EdgeId> World::edgeIds() const { return {}; }

std::size_t World::nodeCount() const { return m_nodes.size(); }
std::size_t World::edgeCount() const { return 0; }
Tick World::tick() const { return m_tick; }
NodeId World::nextNodeId() const { return m_nextNode; }
EdgeId World::nextEdgeId() const { return m_nextEdge; }
bool World::wasDeleted(NodeId) const { return false; }
bool World::wasDeleted(EdgeId) const { return false; }

std::optional<Rejection> World::prepare(Op& op) const {
    using Kind = Rejection::Kind;

    // A value the file can carry and a later reader can resolve. Text must be
    // UTF-8 without NUL (the decoder refuses anything else, so the file would
    // never reopen); reals must be finite; times must satisfy the event-time
    // grammar; refs must name a node or edge that exists right now.
    const auto checkValue = [this](const std::string& key, const Value& value) -> std::optional<Rejection> {
        switch (value.type) {
        case ValueType::Text:
            if (!isValidText(value.text)) {
                return Rejection{Kind::BadValue, key + ": text is not valid UTF-8"};
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
            if (m_nodes.find(*nodeId) == m_nodes.end()) {
                return Rejection{Kind::RefMissing, key + ": " + value.text};
            }
            return std::nullopt;
        }
        if (const auto edgeId = parseEdgeId(value.text)) {
            if (m_edges.find(*edgeId) == m_edges.end()) {
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
            // The one place ids are assigned. A replayed record arrives with
            // its committed id, which must be exactly the next one — the
            // counter is restored from the journal, never re-derived.
            if (!create.id.assigned()) {
                create.id = m_nextNode;
            } else if (create.id != m_nextNode) {
                if (m_nodes.find(create.id) != m_nodes.end()) {
                    return Rejection{Kind::DuplicateId, format(create.id)};
                }
                return Rejection{Kind::IdOutOfOrder, format(create.id) + " (next is " + format(m_nextNode) + ")"};
            }
            if (!isToken(create.type) || !isValidText(create.type)) {
                return Rejection{Kind::BadType, create.type};
            }
            return checkProps(create.props);
        },
        [&](const SetProperty& set) -> std::optional<Rejection> {
            bool exists = false;
            if (const auto* nodeId = std::get_if<NodeId>(&set.target)) {
                exists = m_nodes.find(*nodeId) != m_nodes.end();
            } else {
                exists = m_edges.find(std::get<EdgeId>(set.target)) != m_edges.end();
            }
            if (!exists) {
                return Rejection{Kind::UnknownTarget, formatTarget(set.target)};
            }
            if (!isValidKey(set.key)) {
                return Rejection{Kind::BadKey, set.key};
            }
            return checkValue(set.key, set.value);
        },
        // RED stubs: accepted and ignored until the GREEN commit.
        [](const UnsetProperty&) -> std::optional<Rejection> { return std::nullopt; },
        [](CreateEdge&) -> std::optional<Rejection> { return std::nullopt; },
        [](const DeleteNode&) -> std::optional<Rejection> { return std::nullopt; },
        [](const DeleteEdge&) -> std::optional<Rejection> { return std::nullopt; },
        [](const Advance&) -> std::optional<Rejection> { return std::nullopt; },
    }, op);
}

void World::apply(const Op& op) {
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
        [&](const SetProperty& set) {
            if (const auto* nodeId = std::get_if<NodeId>(&set.target)) {
                m_nodes.at(*nodeId).props[set.key] = set.value;
                return;
            }
            m_edges.at(std::get<EdgeId>(set.target)).props[set.key] = set.value;
        },
        // RED stubs: no effect until the GREEN commit.
        [](const UnsetProperty&) {},
        [](const CreateEdge&) {},
        [](const DeleteNode&) {},
        [](const DeleteEdge&) {},
        [](const Advance&) {},
    }, op);
}

} // namespace tapestry::kernel
