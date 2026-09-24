#include "kernel/Ids.hpp"

#include <charconv>
#include <system_error>

namespace tapestry::kernel {
namespace {

// The one strict parser both id kinds share: the prefix letter, then a
// canonical decimal — first digit 1..9 (so no sign, no leading zero and no
// zero), only digits after it, no overflow, nothing trailing.
std::optional<std::uint64_t> parseTagged(std::string_view text, char prefix) {
    if (text.size() < 2 || text[0] != prefix) {
        return std::nullopt;
    }
    const std::string_view digits = text.substr(1);
    if (digits[0] < '1' || digits[0] > '9') {
        return std::nullopt;
    }
    std::uint64_t value = 0;
    const auto result = std::from_chars(digits.data(), digits.data() + digits.size(), value);
    if (result.ec != std::errc{} || result.ptr != digits.data() + digits.size()) {
        return std::nullopt;
    }
    return value;
}

std::string formatTagged(char prefix, std::uint64_t value) {
    char buffer[24];
    const auto result = std::to_chars(buffer, buffer + sizeof buffer, value);
    std::string out(1, prefix);
    out.append(buffer, result.ptr);
    return out;
}

} // namespace

std::string format(NodeId id) { return formatTagged('n', id.value); }
std::string format(EdgeId id) { return formatTagged('e', id.value); }

std::optional<NodeId> parseNodeId(std::string_view text) {
    const auto value = parseTagged(text, 'n');
    if (!value) {
        return std::nullopt;
    }
    return NodeId{*value};
}

std::optional<EdgeId> parseEdgeId(std::string_view text) {
    const auto value = parseTagged(text, 'e');
    if (!value) {
        return std::nullopt;
    }
    return EdgeId{*value};
}

} // namespace tapestry::kernel
