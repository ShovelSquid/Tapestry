#include "kernel/Ids.hpp"

namespace tapestry::kernel {

std::string format(NodeId) { return {}; }
std::string format(EdgeId) { return {}; }
std::optional<NodeId> parseNodeId(std::string_view) { return std::nullopt; }
std::optional<EdgeId> parseEdgeId(std::string_view) { return std::nullopt; }

} // namespace tapestry::kernel
