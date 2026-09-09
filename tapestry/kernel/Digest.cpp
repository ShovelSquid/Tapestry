#include "kernel/Digest.hpp"

#include <picosha2.h>

namespace tapestry::kernel {
namespace {

constexpr std::size_t kHexLength = 64;

bool isLowerHex(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
}

} // namespace

Digest sha256(std::string_view bytes) {
    return Digest{picosha2::hash256_hex_string(bytes.begin(), bytes.end())};
}

std::optional<Digest> parseDigestHex(std::string_view text) {
    if (text.size() != kHexLength) {
        return std::nullopt;
    }
    for (const char c : text) {
        if (!isLowerHex(c)) {
            return std::nullopt;
        }
    }
    return Digest{std::string(text)};
}

} // namespace tapestry::kernel
