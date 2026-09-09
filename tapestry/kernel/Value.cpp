#include "kernel/Value.hpp"

#include "kernel/Time.hpp"

#include <charconv>
#include <cmath>
#include <cstring>
#include <system_error>
#include <version>

// Apple libc++ 15 declares std::from_chars(double) but deletes it, and leaves
// __cpp_lib_to_chars undefined, so the fallback is strtod_l under a "C"
// numeric locale handle. Everything locale-sensitive is confined to this
// file; nothing here ever consults the process locale.
#if !(defined(__cpp_lib_to_chars) && __cpp_lib_to_chars >= 201611L)
#include <cstdlib>
#include <locale.h>
#if defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
#include <xlocale.h>
#endif
#endif

namespace tapestry::kernel {
namespace {

constexpr std::size_t kInlineTextLimit = 80;
constexpr char kHexDigits[] = "0123456789abcdef";

bool isDigit(char c) { return c >= '0' && c <= '9'; }

// The exact decimal grammar formatReal can produce, and nothing more: an
// optional minus, digits with an optional fraction, an optional exponent.
// Checked before any library call so that "nan", "inf", hex floats, a
// leading '+' or whitespace, and a decimal comma never reach the parser.
bool isDecimalLiteral(std::string_view s) {
    std::size_t i = 0;
    const std::size_t n = s.size();
    if (i < n && s[i] == '-') {
        ++i;
    }
    std::size_t digits = 0;
    while (i < n && isDigit(s[i])) {
        ++i;
        ++digits;
    }
    if (i < n && s[i] == '.') {
        ++i;
        while (i < n && isDigit(s[i])) {
            ++i;
            ++digits;
        }
    }
    if (digits == 0) {
        return false;
    }
    if (i < n && (s[i] == 'e' || s[i] == 'E')) {
        ++i;
        if (i < n && (s[i] == '+' || s[i] == '-')) {
            ++i;
        }
        std::size_t exponentDigits = 0;
        while (i < n && isDigit(s[i])) {
            ++i;
            ++exponentDigits;
        }
        if (exponentDigits == 0) {
            return false;
        }
    }
    return i == n;
}

std::optional<double> parseDecimalLiteral(std::string_view s) {
#if defined(__cpp_lib_to_chars) && __cpp_lib_to_chars >= 201611L
    double value = 0.0;
    const auto result = std::from_chars(s.data(), s.data() + s.size(), value);
    if (result.ec != std::errc{} || result.ptr != s.data() + s.size()) {
        return std::nullopt;
    }
    return value;
#else
    static const locale_t cLocale = newlocale(LC_NUMERIC_MASK, "C", static_cast<locale_t>(nullptr));
    const std::string copy(s);
    char* end = nullptr;
    const double value = strtod_l(copy.c_str(), &end, cLocale);
    if (end != copy.c_str() + copy.size()) {
        return std::nullopt;
    }
    return value;
#endif
}

std::optional<std::uint32_t> parseHex4(std::string_view s) {
    if (s.size() != 4) {
        return std::nullopt;
    }
    std::uint32_t value = 0;
    for (const char c : s) {
        value <<= 4;
        if (c >= '0' && c <= '9') {
            value |= static_cast<std::uint32_t>(c - '0');
        } else if (c >= 'a' && c <= 'f') {
            value |= static_cast<std::uint32_t>(c - 'a' + 10);
        } else if (c >= 'A' && c <= 'F') {
            value |= static_cast<std::uint32_t>(c - 'A' + 10);
        } else {
            return std::nullopt;
        }
    }
    return value;
}

void appendUtf8(std::string& out, std::uint32_t codePoint) {
    if (codePoint < 0x80) {
        out += static_cast<char>(codePoint);
    } else if (codePoint < 0x800) {
        out += static_cast<char>(0xC0 | (codePoint >> 6));
        out += static_cast<char>(0x80 | (codePoint & 0x3F));
    } else if (codePoint < 0x10000) {
        out += static_cast<char>(0xE0 | (codePoint >> 12));
        out += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (codePoint & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (codePoint >> 18));
        out += static_cast<char>(0x80 | ((codePoint >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (codePoint & 0x3F));
    }
}

std::optional<std::int64_t> parseInt64(std::string_view s) {
    std::int64_t value = 0;
    const auto result = std::from_chars(s.data(), s.data() + s.size(), value);
    if (result.ec != std::errc{} || result.ptr != s.data() + s.size()) {
        return std::nullopt;
    }
    return value;
}

} // namespace

const char* typeName(ValueType type) {
    switch (type) {
    case ValueType::Text: return "text";
    case ValueType::Int:  return "int";
    case ValueType::Real: return "real";
    case ValueType::Bool: return "bool";
    case ValueType::Ref:  return "ref";
    case ValueType::Time: break;
    }
    return "time";
}

std::optional<ValueType> parseTypeName(std::string_view name) {
    if (name == "text") return ValueType::Text;
    if (name == "int")  return ValueType::Int;
    if (name == "real") return ValueType::Real;
    if (name == "bool") return ValueType::Bool;
    if (name == "ref")  return ValueType::Ref;
    if (name == "time") return ValueType::Time;
    return std::nullopt;
}

Value Value::ofText(std::string text) {
    Value value;
    value.type = ValueType::Text;
    value.text = std::move(text);
    return value;
}

Value Value::ofInt(std::int64_t integer) {
    Value value;
    value.type = ValueType::Int;
    value.integer = integer;
    return value;
}

Value Value::ofReal(double real) {
    Value value;
    value.type = ValueType::Real;
    value.real = real;
    return value;
}

Value Value::ofBool(bool boolean) {
    Value value;
    value.type = ValueType::Bool;
    value.boolean = boolean;
    return value;
}

Value Value::ofRef(std::string ref) {
    Value value;
    value.type = ValueType::Ref;
    value.text = std::move(ref);
    return value;
}

Value Value::ofRef(NodeId id) { return ofRef(format(id)); }
Value Value::ofRef(EdgeId id) { return ofRef(format(id)); }

Value Value::ofTime(std::string time) {
    Value value;
    value.type = ValueType::Time;
    value.text = std::move(time);
    return value;
}

bool operator==(const Value& a, const Value& b) {
    if (a.type != b.type) {
        return false;
    }
    switch (a.type) {
    case ValueType::Text:
    case ValueType::Ref:
    case ValueType::Time:
        return a.text == b.text;
    case ValueType::Int:
        return a.integer == b.integer;
    case ValueType::Bool:
        return a.boolean == b.boolean;
    case ValueType::Real:
        break;
    }
    std::uint64_t x = 0;
    std::uint64_t y = 0;
    std::memcpy(&x, &a.real, sizeof x);
    std::memcpy(&y, &b.real, sizeof y);
    return x == y;
}

std::string formatReal(double value) {
    char buffer[64];
    const auto result = std::to_chars(buffer, buffer + sizeof buffer, value);
    return std::string(buffer, result.ptr);
}

std::optional<double> parseReal(std::string_view text) {
    if (!isDecimalLiteral(text)) {
        return std::nullopt;
    }
    const auto value = parseDecimalLiteral(text);
    if (!value || !std::isfinite(*value)) {
        return std::nullopt;
    }
    return value;
}

std::string quoteText(std::string_view text) {
    std::string out;
    out.reserve(text.size() + 2);
    out += '"';
    for (const char ch : text) {
        const auto c = static_cast<unsigned char>(ch);
        switch (c) {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n";  break;
        case '\t': out += "\\t";  break;
        case '\r': out += "\\r";  break;
        default:
            if (c < 0x20) {
                out += "\\u00";
                out += kHexDigits[c >> 4];
                out += kHexDigits[c & 0x0F];
            } else {
                out += ch;
            }
        }
    }
    out += '"';
    return out;
}

std::optional<std::string> unquoteText(std::string_view quoted) {
    if (quoted.size() < 2 || quoted.front() != '"' || quoted.back() != '"') {
        return std::nullopt;
    }
    std::string out;
    out.reserve(quoted.size() - 2);
    std::size_t i = 1;
    const std::size_t end = quoted.size() - 1;
    while (i < end) {
        const auto c = static_cast<unsigned char>(quoted[i]);
        if (c < 0x20 || c == '"') {
            return std::nullopt; // raw control byte, or a quote that is not the closing one
        }
        if (c != '\\') {
            out += quoted[i];
            ++i;
            continue;
        }
        ++i;
        if (i >= end) {
            return std::nullopt;
        }
        const char escape = quoted[i++];
        switch (escape) {
        case '"':  out += '"';  break;
        case '\\': out += '\\'; break;
        case '/':  out += '/';  break;
        case 'b':  out += '\b'; break;
        case 'f':  out += '\f'; break;
        case 'n':  out += '\n'; break;
        case 'r':  out += '\r'; break;
        case 't':  out += '\t'; break;
        case 'u': {
            if (i + 4 > end) {
                return std::nullopt;
            }
            const auto unit = parseHex4(quoted.substr(i, 4));
            if (!unit) {
                return std::nullopt;
            }
            i += 4;
            std::uint32_t codePoint = *unit;
            if (codePoint >= 0xD800 && codePoint <= 0xDBFF) {
                // High surrogate: the low half must follow as another \uXXXX.
                if (i + 6 > end || quoted[i] != '\\' || quoted[i + 1] != 'u') {
                    return std::nullopt;
                }
                const auto low = parseHex4(quoted.substr(i + 2, 4));
                if (!low || *low < 0xDC00 || *low > 0xDFFF) {
                    return std::nullopt;
                }
                i += 6;
                codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (*low - 0xDC00);
            } else if (codePoint >= 0xDC00 && codePoint <= 0xDFFF) {
                return std::nullopt; // a low surrogate on its own
            }
            appendUtf8(out, codePoint);
            break;
        }
        default:
            return std::nullopt;
        }
    }
    return out;
}

bool textNeedsBlock(std::string_view text) {
    return text.find('\n') != std::string_view::npos || text.size() > kInlineTextLimit;
}

std::string formatInline(const Value& value) {
    switch (value.type) {
    case ValueType::Text: return quoteText(value.text);
    case ValueType::Int: {
        char buffer[24];
        const auto result = std::to_chars(buffer, buffer + sizeof buffer, value.integer);
        return std::string(buffer, result.ptr);
    }
    case ValueType::Real: return formatReal(value.real);
    case ValueType::Bool: return value.boolean ? "true" : "false";
    case ValueType::Ref:
    case ValueType::Time:
        break;
    }
    return value.text;
}

std::optional<Value> parseValue(ValueType type, std::string_view token) {
    switch (type) {
    case ValueType::Text: {
        auto text = unquoteText(token);
        if (!text) {
            return std::nullopt;
        }
        return Value::ofText(std::move(*text));
    }
    case ValueType::Int: {
        const auto integer = parseInt64(token);
        if (!integer) {
            return std::nullopt;
        }
        return Value::ofInt(*integer);
    }
    case ValueType::Real: {
        const auto real = parseReal(token);
        if (!real) {
            return std::nullopt;
        }
        return Value::ofReal(*real);
    }
    case ValueType::Bool:
        if (token == "true") {
            return Value::ofBool(true);
        }
        if (token == "false") {
            return Value::ofBool(false);
        }
        return std::nullopt;
    case ValueType::Ref:
        if (!parseNodeId(token) && !parseEdgeId(token)) {
            return std::nullopt;
        }
        return Value::ofRef(std::string(token));
    case ValueType::Time:
        break;
    }
    if (!isValidEventTime(token)) {
        return std::nullopt;
    }
    return Value::ofTime(std::string(token));
}


std::size_t findInvalidText(std::string_view text) {
    const std::size_t n = text.size();
    const auto at = [&](std::size_t i) { return static_cast<unsigned char>(text[i]); };
    const auto continuation = [&](std::size_t i, unsigned char low, unsigned char high) {
        return i < n && at(i) >= low && at(i) <= high;
    };
    std::size_t i = 0;
    while (i < n) {
        const unsigned char c = at(i);
        if (c == 0) {
            return i;
        }
        if (c < 0x80) {
            i += 1;
            continue;
        }
        // Unicode Table 3-7: the well-formed byte sequences, by lead byte.
        std::size_t trailing = 0;
        unsigned char secondLow = 0x80;
        unsigned char secondHigh = 0xBF;
        if (c >= 0xC2 && c <= 0xDF) {
            trailing = 1;
        } else if (c == 0xE0) {
            trailing = 2;
            secondLow = 0xA0;
        } else if ((c >= 0xE1 && c <= 0xEC) || c == 0xEE || c == 0xEF) {
            trailing = 2;
        } else if (c == 0xED) {
            trailing = 2;
            secondHigh = 0x9F; // no surrogates
        } else if (c == 0xF0) {
            trailing = 3;
            secondLow = 0x90;
        } else if (c >= 0xF1 && c <= 0xF3) {
            trailing = 3;
        } else if (c == 0xF4) {
            trailing = 3;
            secondHigh = 0x8F; // nothing above U+10FFFF
        } else {
            return i;
        }
        if (!continuation(i + 1, secondLow, secondHigh)) {
            return i;
        }
        for (std::size_t k = 2; k <= trailing; ++k) {
            if (!continuation(i + k, 0x80, 0xBF)) {
                return i;
            }
        }
        i += trailing + 1;
    }
    return std::string_view::npos;
}

} // namespace tapestry::kernel
