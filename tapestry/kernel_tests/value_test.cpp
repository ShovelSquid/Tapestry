// Value-level invariants.
//
// Every byte of a .tree file is made of these primitives: the digest that seals
// a record, the numbers and text inside a `set` line, the three kinds of time,
// and the n<k>/e<k> identifiers. If any of them prints differently on another
// machine or under another locale, every file's digest chain breaks, so the
// property under test is exact, machine-independent text forms.

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"

#include <doctest.h>

#include <clocale>
#include <cstdlib>
#include <string>

namespace {

using tapestry::kernel::EdgeId;
using tapestry::kernel::FixedClock;
using tapestry::kernel::format;
using tapestry::kernel::formatInline;
using tapestry::kernel::formatReal;
using tapestry::kernel::isValidEventTime;
using tapestry::kernel::NodeId;
using tapestry::kernel::parseDigestHex;
using tapestry::kernel::parseEdgeId;
using tapestry::kernel::parseNodeId;
using tapestry::kernel::parseReal;
using tapestry::kernel::parseTypeName;
using tapestry::kernel::parseValue;
using tapestry::kernel::quoteText;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::sha256;
using tapestry::kernel::SystemClock;
using tapestry::kernel::textNeedsBlock;
using tapestry::kernel::typeName;
using tapestry::kernel::unquoteText;
using tapestry::kernel::Value;
using tapestry::kernel::ValueType;

// Switches the whole process locale for one scope and puts it back even when
// an assertion throws out of the scope.
struct ScopedLocale {
    std::string previous;
    const char* applied = nullptr;

    ScopedLocale() : previous(std::setlocale(LC_ALL, nullptr)) {
        for (const char* name : {"de_DE.UTF-8", "de_DE.utf8", "fr_FR.UTF-8", "fr_FR.utf8"}) {
            applied = std::setlocale(LC_ALL, name);
            if (applied != nullptr) {
                break;
            }
        }
    }
    ~ScopedLocale() { std::setlocale(LC_ALL, previous.c_str()); }
    ScopedLocale(const ScopedLocale&) = delete;
    ScopedLocale& operator=(const ScopedLocale&) = delete;
};

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

TEST_CASE("value: reals format as shortest round-trip text") {
    CHECK(formatReal(1.5) == "1.5");
    CHECK(formatReal(0.1 + 0.2) == "0.30000000000000004");
    CHECK(formatReal(0.1) == "0.1");
    CHECK(formatReal(1e300) == "1e+300");
    CHECK(formatReal(-0.0) == "-0");
    CHECK(formatReal(4.35) == "4.35");
    CHECK(formatReal(0.000125) == "0.000125");
    CHECK(formatReal(-123.456789012345) == "-123.456789012345");

    // What is written reads back as the same double, bit for bit.
    for (const double v : {1.5, 0.1 + 0.2, 1e300, 4.35, 0.000125, -123.456789012345, 5e-324}) {
        const auto back = parseReal(formatReal(v));
        REQUIRE(back.has_value());
        CHECK(*back == v);
    }
}

TEST_CASE("value: reals are locale-proof and reject nan inf comma empty trailing") {
    {
        ScopedLocale locale;
        if (locale.applied == nullptr) {
            MESSAGE("no comma-decimal locale installed; skipping the in-locale checks");
        } else {
            // Proof the locale is really in effect: the C library now reads a comma.
            CHECK(std::strtod("1,5", nullptr) == 1.5);

            const auto parsed = parseReal("1.5");
            REQUIRE(parsed.has_value());
            CHECK(*parsed == 1.5);
            CHECK(formatReal(1.5) == "1.5");
            CHECK(formatReal(-0.0) == "-0");
            CHECK(formatReal(1e300) == "1e+300");
            CHECK(formatReal(4.35) == "4.35");
        }
    }
    // Locale restored: the comma no longer parses as a decimal point.
    CHECK(std::strtod("1,5", nullptr) == 1.0);

    CHECK_FALSE(parseReal("nan").has_value());
    CHECK_FALSE(parseReal("NaN").has_value());
    CHECK_FALSE(parseReal("inf").has_value());
    CHECK_FALSE(parseReal("-inf").has_value());
    CHECK_FALSE(parseReal("infinity").has_value());
    CHECK_FALSE(parseReal("1,5").has_value());
    CHECK_FALSE(parseReal("").has_value());
    CHECK_FALSE(parseReal("1.5x").has_value());
    CHECK_FALSE(parseReal(" 1.5").has_value());
    CHECK_FALSE(parseReal("+1.5").has_value());
    CHECK_FALSE(parseReal("0x10").has_value());
    CHECK_FALSE(parseReal("1e").has_value());
}

TEST_CASE("value: inline text quoting round-trips and block selection") {
    CHECK(quoteText("He said \"hi\"\n\t") == R"("He said \"hi\"\n\t")");
    CHECK(quoteText("") == R"("")");
    CHECK(quoteText("plain") == R"("plain")");

    const std::string sample =
        "quote\" backslash\\ lf\n tab\t cr\r ctl\x01 caf\xC3\xA9 \xE2\x98\x95";
    const std::string quoted = quoteText(sample);
    // Control bytes without a short escape use \u00XX; UTF-8 stays raw.
    CHECK(quoted.find("\\u0001") != std::string::npos);
    CHECK(quoted.find("\\r") != std::string::npos);
    CHECK(quoted.find("caf\xC3\xA9 \xE2\x98\x95") != std::string::npos);
    CHECK(quoted.find('\n') == std::string::npos);
    CHECK(quoted.find('\x01') == std::string::npos);

    const auto back = unquoteText(quoted);
    REQUIRE(back.has_value());
    CHECK(*back == sample);

    // A hand-written \u escape for a non-control character decodes to UTF-8.
    const auto accented = unquoteText(R"("caf\u00e9")");
    REQUIRE(accented.has_value());
    CHECK(*accented == "caf\xC3\xA9");
    // Surrogate pairs decode to one four-byte code point.
    const auto emoji = unquoteText(R"("\ud83d\ude00")");
    REQUIRE(emoji.has_value());
    CHECK(*emoji == "\xF0\x9F\x98\x80");

    CHECK_FALSE(unquoteText("plain").has_value());
    CHECK_FALSE(unquoteText("\"unterminated").has_value());
    CHECK_FALSE(unquoteText("\"bad \\q escape\"").has_value());
    CHECK_FALSE(unquoteText("\"trailing\" x").has_value());
    CHECK_FALSE(unquoteText("\"raw\nnewline\"").has_value());
    CHECK_FALSE(unquoteText("\"\\u12\"").has_value());
    CHECK_FALSE(unquoteText("\"\\ud83d\"").has_value());
    CHECK_FALSE(unquoteText(R"("a\u0000b")").has_value());
    CHECK_FALSE(unquoteText("").has_value());

    CHECK(textNeedsBlock("a\nb"));
    CHECK(textNeedsBlock(std::string(81, 'a')));
    CHECK_FALSE(textNeedsBlock(std::string(80, 'a')));
    CHECK_FALSE(textNeedsBlock("short and single-line"));
    CHECK_FALSE(textNeedsBlock(""));
}

TEST_CASE("value: parseValue and formatInline per type") {
    // Int: decimal int64, optional leading minus, nothing else.
    const auto negative = parseValue(ValueType::Int, "-42");
    REQUIRE(negative.has_value());
    CHECK(*negative == Value::ofInt(-42));
    CHECK(negative->integer == -42);
    CHECK_FALSE(parseValue(ValueType::Int, "+1").has_value());
    CHECK_FALSE(parseValue(ValueType::Int, "1.0").has_value());
    CHECK_FALSE(parseValue(ValueType::Int, "").has_value());
    CHECK_FALSE(parseValue(ValueType::Int, "99999999999999999999").has_value());
    CHECK_FALSE(parseValue(ValueType::Int, "12 ").has_value());
    CHECK_FALSE(parseValue(ValueType::Int, "-0").has_value());
    CHECK_FALSE(parseValue(ValueType::Int, "007").has_value());

    // Bool: exactly true or false.
    CHECK(parseValue(ValueType::Bool, "true") == Value::ofBool(true));
    CHECK(parseValue(ValueType::Bool, "false") == Value::ofBool(false));
    CHECK_FALSE(parseValue(ValueType::Bool, "True").has_value());
    CHECK_FALSE(parseValue(ValueType::Bool, "1").has_value());
    CHECK_FALSE(parseValue(ValueType::Bool, "").has_value());

    // Ref: a node or edge id in its strict text form.
    CHECK(parseValue(ValueType::Ref, "n7") == Value::ofRef("n7"));
    CHECK(parseValue(ValueType::Ref, "e2") == Value::ofRef(EdgeId{2}));
    CHECK(Value::ofRef(NodeId{7}) == Value::ofRef("n7"));
    CHECK_FALSE(parseValue(ValueType::Ref, "x1").has_value());
    CHECK_FALSE(parseValue(ValueType::Ref, "n0").has_value());

    // Real, Text and Time go through their own parsers.
    CHECK(parseValue(ValueType::Real, "1.5") == Value::ofReal(1.5));
    CHECK_FALSE(parseValue(ValueType::Real, "nan").has_value());
    CHECK_FALSE(parseValue(ValueType::Real, ".5").has_value());
    CHECK_FALSE(parseValue(ValueType::Real, "5.").has_value());
    CHECK_FALSE(parseValue(ValueType::Real, "1E5").has_value());
    CHECK(parseValue(ValueType::Text, R"("hi")") == Value::ofText("hi"));
    CHECK_FALSE(parseValue(ValueType::Text, R"("\/")").has_value());
    CHECK_FALSE(parseValue(ValueType::Text, R"("\u0041")").has_value());
    CHECK_FALSE(parseValue(ValueType::Text, "hi").has_value());
    CHECK(parseValue(ValueType::Time, "2026-09-07") == Value::ofTime("2026-09-07"));
    CHECK_FALSE(parseValue(ValueType::Time, "yesterday").has_value());

    // Payload fields are set by the factories and compared by operator==.
    CHECK(Value::ofText("a").type == ValueType::Text);
    CHECK(Value::ofReal(1.5).real == 1.5);
    CHECK(Value::ofBool(true).boolean);
    CHECK(Value::ofTime("2026").text == "2026");
    CHECK(Value::ofReal(0.0) != Value::ofReal(-0.0));
    CHECK(Value::ofInt(1) != Value::ofReal(1.0));

    CHECK(formatInline(Value::ofText("hi")) == R"("hi")");
    CHECK(formatInline(Value::ofInt(-42)) == "-42");
    CHECK(formatInline(Value::ofReal(1.5)) == "1.5");
    CHECK(formatInline(Value::ofBool(true)) == "true");
    CHECK(formatInline(Value::ofBool(false)) == "false");
    CHECK(formatInline(Value::ofRef("n7")) == "n7");
    CHECK(formatInline(Value::ofTime("2026-09-07")) == "2026-09-07");
}

TEST_CASE("value: event time whitelist grammar (EDTF level 0/1 and RFC 3339)") {
    for (const char* ok : {"2026-09-07", "2026-09", "2026", "2026-09-08T21:15:07Z",
             "2026-09-08T21:15:07+02:00", "2026-09-08T21:15:07-05:30", "1984?", "2004-06~",
             "2004-06-11%", "199X", "19XX", "1999-XX", "1999-03-XX", "1999-XX-XX", "2001-21",
             "2001-24", "-0999", "Y17000", "Y-17000", "2004-06/2006-08", "../1985", "1985/..",
             "/1985", "1985/", "2004-02-29", "2000-02-29", "1984?/2004-06~"}) {
        CHECK_MESSAGE(isValidEventTime(ok), ok);
    }
    for (const char* bad : {"yesterday", "2026-13", "2026-09-31", "09/07/2026", "2026-09-07 21:15",
             "", "2026-09-07T25:00:00Z", "2026-09-08T21:15:07", "2026-09-08T21:15:07z",
             "2026-09-08T21:15:07+24:00", "2026-00-01", "2026-09-00", "2023-02-29",
             "1900-02-29", "2026-20", "2026-25", "2001-21-05", "2026-9-7", "202X-09", "1999-0X",
             "1999-XX-15", "Y2026", "Y-", "2026?~", "?2026", "../..", "/", "2004-06/2006-08/2008",
             "2026-09-08T21:15:07Z/2026-09-09T00:00:00Z", "2026-09-07T", " 2026", "2026 "}) {
        CHECK_MESSAGE(!isValidEventTime(bad), bad);
    }
}

TEST_CASE("value: recorded stamps round-trip as RFC 3339 UTC seconds") {
    const auto parsed = RecordedAt::parse("2026-09-08T21:15:07Z");
    REQUIRE(parsed.has_value());
    CHECK(parsed->unixSeconds == 1788902107);
    CHECK(parsed->rfc3339Z() == "2026-09-08T21:15:07Z");

    CHECK(RecordedAt{0}.rfc3339Z() == "1970-01-01T00:00:00Z");
    CHECK(RecordedAt{-1}.rfc3339Z() == "1969-12-31T23:59:59Z");
    CHECK(RecordedAt{951782400}.rfc3339Z() == "2000-02-29T00:00:00Z");
    CHECK(RecordedAt{4102444799}.rfc3339Z() == "2099-12-31T23:59:59Z");
    for (const std::int64_t seconds : {std::int64_t{0}, std::int64_t{-1}, std::int64_t{951782400},
             std::int64_t{1788902107}, std::int64_t{4102444799}}) {
        const auto back = RecordedAt::parse(RecordedAt{seconds}.rfc3339Z());
        REQUIRE(back.has_value());
        CHECK(back->unixSeconds == seconds);
    }

    CHECK_FALSE(RecordedAt::parse("2026-09-08T21:15:07.000Z").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-09-08T21:15:07+00:00").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-09-08T21:15:07+02:00").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-09-08T21:15:07z").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-09-08T21:15:07").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-09-08 21:15:07Z").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-02-30T00:00:00Z").has_value());
    CHECK_FALSE(RecordedAt::parse("2026-09-08T24:00:00Z").has_value());
    CHECK_FALSE(RecordedAt::parse("").has_value());

    FixedClock fixed;
    fixed.at = *parsed;
    CHECK(fixed.now() == *parsed);
    fixed.at = RecordedAt{0};
    CHECK(fixed.now().rfc3339Z() == "1970-01-01T00:00:00Z");

    // The system clock produces the same shape and is not in the past.
    SystemClock system;
    const RecordedAt now = system.now();
    CHECK(now.unixSeconds >= parsed->unixSeconds);
    CHECK(now.rfc3339Z().size() == 20);
    CHECK(RecordedAt::parse(now.rfc3339Z()) == now);
}

TEST_CASE("value: node and edge ids format as n<k>/e<k> and parse strictly") {
    CHECK(format(NodeId{12}) == "n12");
    CHECK(format(EdgeId{3}) == "e3");
    CHECK(format(NodeId{1}) == "n1");
    CHECK_FALSE(NodeId{}.assigned());
    CHECK(NodeId{1}.assigned());
    CHECK(NodeId{1} < NodeId{2});
    CHECK(EdgeId{1} != EdgeId{2});

    const auto one = parseNodeId("n1");
    REQUIRE(one.has_value());
    CHECK(*one == NodeId{1});
    const auto max = parseNodeId("n18446744073709551615");
    REQUIRE(max.has_value());
    CHECK(max->value == 18446744073709551615ull);
    CHECK_FALSE(parseNodeId("n18446744073709551616").has_value());
    CHECK_FALSE(parseNodeId("n99999999999999999999").has_value());

    for (const char* bad : {"n0", "n01", "n", "N1", "n1 ", " n1", "e1", "n-1", "n+1", "n1.0", "nx", "1", ""}) {
        CHECK_MESSAGE(!parseNodeId(bad).has_value(), bad);
    }

    const auto edge = parseEdgeId("e5");
    REQUIRE(edge.has_value());
    CHECK(*edge == EdgeId{5});
    for (const char* bad : {"e0", "e01", "e", "E1", "e1 ", "n5", "e-1", ""}) {
        CHECK_MESSAGE(!parseEdgeId(bad).has_value(), bad);
    }
}

TEST_CASE("value: type names round-trip") {
    CHECK(std::string(typeName(ValueType::Text)) == "text");
    CHECK(std::string(typeName(ValueType::Int)) == "int");
    CHECK(std::string(typeName(ValueType::Real)) == "real");
    CHECK(std::string(typeName(ValueType::Bool)) == "bool");
    CHECK(std::string(typeName(ValueType::Ref)) == "ref");
    CHECK(std::string(typeName(ValueType::Time)) == "time");
    for (const ValueType type : {ValueType::Text, ValueType::Int, ValueType::Real, ValueType::Bool,
             ValueType::Ref, ValueType::Time}) {
        const auto back = parseTypeName(typeName(type));
        REQUIRE(back.has_value());
        CHECK(*back == type);
    }
    CHECK_FALSE(parseTypeName("Text").has_value());
    CHECK_FALSE(parseTypeName("string").has_value());
    CHECK_FALSE(parseTypeName("").has_value());
}

} // TEST_SUITE("value")
