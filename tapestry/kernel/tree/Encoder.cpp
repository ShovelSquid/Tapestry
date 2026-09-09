// struct -> bytes. Builds the body as one string of LF-terminated lines,
// prepends the counted head line, seals it with the digest of exactly those
// bytes, and never performs I/O.

#include "kernel/tree/Codec.hpp"

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Value.hpp"

#include <charconv>
#include <cstdint>
#include <string>
#include <string_view>
#include <variant>

namespace tapestry::kernel::tree {
namespace {

std::string decimal(std::uint64_t value) {
    char buffer[24];
    const auto result = std::to_chars(buffer, buffer + sizeof buffer, value);
    return std::string(buffer, result.ptr);
}

bool hasLineEqualTo(std::string_view text, std::string_view line) {
    std::size_t pos = 0;
    for (;;) {
        const auto lf = text.find('\n', pos);
        const std::string_view current =
            text.substr(pos, lf == std::string_view::npos ? std::string_view::npos : lf - pos);
        if (current == line) {
            return true;
        }
        if (lf == std::string_view::npos) {
            return false;
        }
        pos = lf + 1;
    }
}

// TEXT, then TEXT1, TEXT2 … — the first that equals no line of the text, so
// the block's end is never ambiguous (git fast-import's rule).
std::string blockDelimiter(std::string_view text) {
    for (std::uint64_t i = 0;; ++i) {
        std::string delimiter = "TEXT";
        if (i > 0) {
            delimiter += decimal(i);
        }
        if (!hasLineEqualTo(text, delimiter)) {
            return delimiter;
        }
    }
}

// The value part of a set line including its line feed: inline for anything
// short and single-line, a block for text with a newline or over 80 bytes,
// so a raw LF never lands inside an inline token.
void appendValue(std::string& body, const Value& value) {
    if (value.type == ValueType::Text && textNeedsBlock(value.text)) {
        const std::string delimiter = blockDelimiter(value.text);
        body += "<<";
        body += delimiter;
        body += '\n';
        body += value.text;
        body += '\n';
        body += delimiter;
        body += '\n';
        return;
    }
    body += formatInline(value);
    body += '\n';
}

void appendSet(std::string& body, std::string_view target, const std::string& key, const Value& value) {
    body += "set ";
    body += target;
    body += ' ';
    body += key;
    body += ' ';
    body += typeName(value.type);
    body += ' ';
    appendValue(body, value);
}

std::string formatTarget(const Target& target) {
    if (const auto* node = std::get_if<NodeId>(&target)) {
        return format(*node);
    }
    return format(std::get<EdgeId>(target));
}

// One operator() per Op alternative; std::visit refuses to compile when an
// alternative is missing — there is no default branch to hide a new verb.
template <class... Fs>
struct Overload : Fs... {
    using Fs::operator()...;
};
template <class... Fs>
Overload(Fs...) -> Overload<Fs...>;

void appendOp(std::string& body, const Op& op) {
    std::visit(Overload{
        [&](const CreateNode& create) {
            const std::string id = format(create.id);
            body += "create-node ";
            body += id;
            body += ' ';
            body += create.type;
            body += '\n';
            for (const auto& [key, value] : create.props) {
                appendSet(body, id, key, value);
            }
        },
        [&](const SetProperty& set) { appendSet(body, formatTarget(set.target), set.key, set.value); },
        // RED stubs: emit nothing until the GREEN commit.
        [](const UnsetProperty&) {},
        [](const CreateEdge&) {},
        [](const DeleteNode&) {},
        [](const DeleteEdge&) {},
        [](const Advance&) {},
    }, op);
}

// "<head> <bytes>\n" + body, digested exactly as written, then the @end line.
Encoded seal(const std::string& head, const std::string& body) {
    Encoded encoded;
    encoded.bytes = head;
    encoded.bytes += ' ';
    encoded.bytes += decimal(body.size());
    encoded.bytes += '\n';
    encoded.bytes += body;
    encoded.digest = sha256(encoded.bytes);
    encoded.bytes += "@end sha256:";
    encoded.bytes += encoded.digest.hex;
    encoded.bytes += '\n';
    return encoded;
}

} // namespace

Encoded encodeHeader(const HeaderRecord& record) {
    std::string body;
    body += "world ";
    body += record.world;
    body += '\n';
    body += "created ";
    body += record.created.rfc3339Z();
    body += '\n';
    for (const std::string& line : record.extensionLines) {
        body += line;
        body += '\n';
    }
    return seal("@tree " + decimal(static_cast<std::uint64_t>(record.version)), body);
}

Encoded encodeCommit(const CommitRecord& record) {
    std::string body;
    body += "parent sha256:";
    body += record.parent.hex;
    body += '\n';
    body += "branch ";
    body += record.branch;
    body += '\n';
    body += "recorded ";
    body += record.recorded.rfc3339Z();
    body += '\n';
    body += "tick ";
    body += decimal(record.tick);
    body += '\n';
    body += "actor ";
    body += record.actor.kind;
    body += ' ';
    body += record.actor.id;
    body += '\n';
    if (!record.message.empty()) {
        body += "message ";
        body += quoteText(record.message);
        body += '\n';
    }
    for (const Op& op : record.ops) {
        appendOp(body, op);
    }
    for (const std::string& line : record.extensionLines) {
        body += line;
        body += '\n';
    }
    return seal("@commit " + decimal(record.seq), body);
}

} // namespace tapestry::kernel::tree
