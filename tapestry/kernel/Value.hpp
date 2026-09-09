#pragma once

#include "kernel/Ids.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace tapestry::kernel {

// The six value types every `set` line is made of. Plugins compose all of
// their data from these; the kernel never learns a seventh type from a plugin.
enum class ValueType { Text, Int, Real, Bool, Ref, Time };

// The lowercase names used in the file: text int real bool ref time.
const char* typeName(ValueType type);
std::optional<ValueType> parseTypeName(std::string_view name);

// A typed value. A plain aggregate on purpose: the codec and the world both
// read it directly, and there is nothing to hide. `text` carries the payload
// for Text, Ref (as `n<k>`/`e<k>`) and Time (as the validated time string);
// the other fields are meaningful only for their own type.
struct Value {
    ValueType type = ValueType::Text;
    std::string text;
    std::int64_t integer = 0;
    double real = 0.0;
    bool boolean = false;

    static Value ofText(std::string text);
    static Value ofInt(std::int64_t integer);
    static Value ofReal(double real);
    static Value ofBool(bool boolean);
    static Value ofRef(std::string ref);
    static Value ofRef(NodeId id);
    static Value ofRef(EdgeId id);
    static Value ofTime(std::string time);

    // Equal when the file text would be identical: same type and same payload.
    // Reals compare by bit pattern, so -0 and 0 differ exactly as their text
    // forms do.
    friend bool operator==(const Value& a, const Value& b);
    friend bool operator!=(const Value& a, const Value& b) { return !(a == b); }
};

// Shortest text that reads back to exactly the same double: 1.5,
// 0.30000000000000004, 1e+300, -0. Independent of the process locale.
std::string formatReal(double value);

// Inverse of formatReal, locale-independent. Rejects NaN, infinities, a
// decimal comma, empty input, leading whitespace or sign '+', and anything
// trailing the number.
std::optional<double> parseReal(std::string_view text);

// Inline text form: double-quoted, JSON-style escapes for quote, backslash,
// LF, tab, CR and \uXXXX for any other byte below 0x20; every other byte
// (including non-ASCII UTF-8) is written raw.
std::string quoteText(std::string_view text);

// Inverse of quoteText. Rejects anything that is not exactly one quoted
// string: missing quotes, unknown escapes, raw control bytes, trailing text.
std::optional<std::string> unquoteText(std::string_view quoted);

// True when the inline form is not readable enough and the writer must use a
// <<TEXT block instead: the text contains a newline or is longer than 80 bytes.
bool textNeedsBlock(std::string_view text);

// The single-token file form of a value: Text via quoteText, Int decimal,
// Real via formatReal, Bool true/false, Ref and Time verbatim.
std::string formatInline(const Value& value);

// Strict inverse of formatInline for one declared type. Int accepts only a
// decimal int64 with an optional leading minus; Ref must parse as a node or
// edge id; Time must satisfy isValidEventTime.
std::optional<Value> parseValue(ValueType type, std::string_view token);

// Text the file can carry: UTF-8 (RFC 3629, no overlongs, no surrogates,
// nothing above U+10FFFF) with no NUL byte. The decoder rejects anything
// else, so the world refuses it before it is ever written; returns the index
// of the first offending byte, or npos when the whole text is valid.
std::size_t findInvalidText(std::string_view text);
inline bool isValidText(std::string_view text) { return findInvalidText(text) == std::string_view::npos; }

} // namespace tapestry::kernel
