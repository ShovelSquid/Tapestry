#include "kernel/PropertyValues.hpp"

#include <variant>

namespace tapestry::kernel {

std::vector<PropertyValueEntry> getPropertyValues(
    const Journal& journal, NodeId node, std::string_view key, CommitSeq fromSeq) {
    std::vector<PropertyValueEntry> result;

    for (const CommitRecord& commit : journal.commits()) {
        if (commit.seq <= fromSeq) {
            continue;
        }
        for (const Op& op : commit.ops) {
            const auto* set = std::get_if<SetProperty>(&op);
            if (set == nullptr) {
                continue;
            }
            const auto* targetNode = std::get_if<NodeId>(&set->target);
            if (targetNode == nullptr || *targetNode != node || set->key != key) {
                continue;
            }
            result.push_back(PropertyValueEntry{commit.seq, commit.recorded, commit.actor, set->value});
        }
    }

    return result;
}

} // namespace tapestry::kernel
