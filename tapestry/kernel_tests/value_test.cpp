// Value-level invariants.
//
// Every byte of a .tree file is made of these primitives: the digest that seals
// a record, the numbers and text inside a `set` line, the three kinds of time,
// and the n<k>/e<k> identifiers. If any of them prints differently on another
// machine or under another locale, every file's digest chain breaks, so the
// property under test is exact, machine-independent text forms.

#include "kernel/Digest.hpp"

#include <doctest.h>

#include <string>

namespace {

using tapestry::kernel::parseDigestHex;
using tapestry::kernel::sha256;

} // namespace

TEST_SUITE("value") {

TEST_CASE("value: sha256 known answer") {
    // FIPS 180-4 test vector for the message "abc".
    const std::string expected =
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    CHECK(sha256("abc").hex == expected);
    CHECK(sha256("abc") == tapestry::kernel::Digest{expected});

    const auto parsed = parseDigestHex(expected);
    REQUIRE(parsed.has_value());
    CHECK(parsed->hex == expected);

    // 63 characters: one short.
    CHECK_FALSE(parseDigestHex(expected.substr(0, 63)).has_value());
    // 65 characters: one long.
    CHECK_FALSE(parseDigestHex(expected + "0").has_value());
    // Uppercase is not the writer's form even though it names the same value.
    CHECK_FALSE(parseDigestHex(
        "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD").has_value());
    // A non-hex character in an otherwise valid position.
    CHECK_FALSE(parseDigestHex(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ag").has_value());
}

} // TEST_SUITE("value")
