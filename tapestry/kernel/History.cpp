#include "kernel/History.hpp"

#include <map>
#include <variant>

namespace tapestry::kernel {
namespace {

// One operator() per Op alternative, as everywhere else the kernel visits an
// Op: std::visit refuses to compile when an alternative is missing, so an
// eighth verb is a compile error here rather than a silently unrecorded change.
template <class... Fs>
struct Overload : Fs... {
    using Fs::operator()...;
};
template <class... Fs>
Overload(Fs...) -> Overload<Fs...>;

} // namespace

HistoryIndex buildHistoryIndex(const std::vector<CommitRecord>& commits, CommitSeq maxSeq) {
    // Ordered containers, so the flattened vectors come out in ascending id
    // order without a sort pass.
    std::map<NodeId, NodeHistory> nodes;
    std::map<EdgeId, EdgeHistory> edges;

    for (const CommitRecord& commit : commits) {
        if (commit.seq > maxSeq) {
            break;
        }
        const CommitSeq seq = commit.seq;
        const Actor& actor = commit.actor;

        // A property write counts as a change only when it addresses a node.
        // An edge-targeted set or unset changes no node's authorship.
        const auto touchNode = [&](const Target& target) {
            const auto* nodeId = std::get_if<NodeId>(&target);
            if (nodeId == nullptr) {
                return;
            }
            const auto found = nodes.find(*nodeId);
            if (found == nodes.end()) {
                return;
            }
            found->second.changedSeq = seq;
            found->second.changedBy = actor;
        };

        for (const Op& op : commit.ops) {
            std::visit(
                Overload{
                    [&](const CreateNode& create) {
                        NodeHistory& entry = nodes[create.id];
                        entry.id = create.id;
                        entry.createdSeq = seq;
                        entry.createdBy = actor;
                        // A node nobody has edited yet reports its creator as
                        // its last changer, so the footer never has a blank.
                        entry.changedSeq = seq;
                        entry.changedBy = actor;
                    },
                    [&](const SetProperty& set) { touchNode(set.target); },
                    [&](const UnsetProperty& unset) { touchNode(unset.target); },
                    [&](const CreateEdge& create) {
                        EdgeHistory& entry = edges[create.id];
                        entry.id = create.id;
                        entry.from = create.from;
                        entry.to = create.to;
                        entry.createdSeq = seq;
                        entry.createdBy = actor;
                    },
                    [&](const DeleteNode& remove) {
                        const auto found = nodes.find(remove.id);
                        if (found != nodes.end()) {
                            found->second.deletedSeq = seq;
                            found->second.deletedBy = actor;
                        }
                        // The cascade the kernel performs but does not write:
                        // every live edge touching the node goes with it, by
                        // the same actor and in the same commit.
                        for (auto& entry : edges) {
                            EdgeHistory& edge = entry.second;
                            if (edge.deletedSeq.has_value()) {
                                continue;
                            }
                            if (edge.from == remove.id || edge.to == remove.id) {
                                edge.deletedSeq = seq;
                                edge.deletedBy = actor;
                            }
                        }
                    },
                    [&](const DeleteEdge& remove) {
                        const auto found = edges.find(remove.id);
                        if (found != edges.end()) {
                            found->second.deletedSeq = seq;
                            found->second.deletedBy = actor;
                        }
                    },
                    // A tick move is not a change to anything's authorship.
                    [](const Advance&) {},
                },
                op);
        }
    }

    HistoryIndex index;
    index.nodes.reserve(nodes.size());
    for (const auto& entry : nodes) {
        index.nodes.push_back(entry.second);
    }
    index.edges.reserve(edges.size());
    for (const auto& entry : edges) {
        index.edges.push_back(entry.second);
    }
    return index;
}

} // namespace tapestry::kernel
