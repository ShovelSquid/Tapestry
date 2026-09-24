#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace tapestry::kernel {

// A SHA-256 digest in the exact form the .tree file carries it: 64 lowercase
// hex characters. The kernel hashes record bytes as written and compares the
// text, so the digest is stored as text rather than as 32 raw bytes — there is
// never a reason to convert, and a Digest read from a file is trivially equal
// to one computed from the same bytes.
struct Digest {
    std::string hex;

    friend bool operator==(const Digest& a, const Digest& b) { return a.hex == b.hex; }
    friend bool operator!=(const Digest& a, const Digest& b) { return !(a == b); }
};

// SHA-256 of exactly the bytes given. This is the only place the kernel
// touches a hash implementation; the vendored PicoSHA2 header stays behind
// Digest.cpp so no other translation unit depends on it.
Digest sha256(std::string_view bytes);

// Accepts exactly 64 lowercase hex characters and nothing else. Uppercase,
// prefixes, and short or long strings are rejected: a digest that does not
// match the writer's form byte for byte cannot have been written by the kernel.
std::optional<Digest> parseDigestHex(std::string_view text);

} // namespace tapestry::kernel
