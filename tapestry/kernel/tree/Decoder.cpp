// bytes -> struct. Works on an in-memory string_view, never a stream, so the
// same code serves the journal scan and the truncation and bit-flip sweeps.
// Strict on purpose: a record either verifies completely or fails with the
// offset of the offending bytes; nothing is skipped and nothing is guessed.

#include "kernel/tree/Codec.hpp"

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"

#include <charconv>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace tapestry::kernel::tree {
namespace {

using Reason = DecodeFailure::Reason;

constexpr std::string_view kEndPrefix = "@end sha256:";
constexpr std::size_t kDigestHexLength = 64;

DecodeFailure fail(Reason reason, std::size_t offset, std::string detail, bool atEof = false) {
    return DecodeFailure{reason, offset, std::move(detail), atEof};
}

// Canonical unsigned decimal: "0" or a first digit 1..9 followed by digits,
// no sign, no leading zero, fits in 64 bits.
std::optional<std::uint64_t> parseCount(std::string_view text) {
    if (text.empty() || (text.size() > 1 && text[0] == '0')) {
        return std::nullopt;
    }
    for (const char c : text) {
        if (c < '0' || c > '9') {
            return std::nullopt;
        }
    }
    std::uint64_t value = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec != std::errc{} || result.ptr != text.data() + text.size()) {
        return std::nullopt;
    }
    return value;
}

// The value part of a "key value" line, if the key matches (port of the
// prototype's valueAfter, on string_view).
std::optional<std::string_view> valueAfter(std::string_view line, std::string_view key) {
    if (line.size() < key.size() + 1 || line.substr(0, key.size()) != key || line[key.size()] != ' ') {
        return std::nullopt;
    }
    return line.substr(key.size() + 1);
}

// Every token of a line separated by single spaces; an empty token (a double,
// leading or trailing space) makes the line malformed.
std::optional<std::vector<std::string_view>> tokenize(std::string_view line) {
    std::vector<std::string_view> out;
    std::size_t pos = 0;
    for (;;) {
        const auto space = line.find(' ', pos);
        const std::string_view token =
            line.substr(pos, space == std::string_view::npos ? std::string_view::npos : space - pos);
        if (token.empty()) {
            return std::nullopt;
        }
        out.push_back(token);
        if (space == std::string_view::npos) {
            return out;
        }
        pos = space + 1;
    }
}

// The first four tokens of a set line and the value text after them, which
// may itself contain spaces (an inline quoted string). `value` is empty when
// the line stops after the type, so the caller can name that failure.
struct SetFields {
    std::string_view target;
    std::string_view key;
    std::string_view type;
    std::string_view value;
};

std::optional<SetFields> splitSetLine(std::string_view line) {
    std::string_view fields[4];
    std::size_t pos = 0;
    for (std::size_t i = 0; i < 4; ++i) {
        const auto space = line.find(' ', pos);
        const std::size_t end = space == std::string_view::npos ? line.size() : space;
        if (end == pos) {
            return std::nullopt;
        }
        fields[i] = line.substr(pos, end - pos);
        if (space == std::string_view::npos) {
            if (i < 3) {
                return std::nullopt;
            }
            return SetFields{fields[1], fields[2], fields[3], std::string_view()};
        }
        pos = space + 1;
    }
    return SetFields{fields[1], fields[2], fields[3], line.substr(pos)};
}

// `n<k>` or `e<k>`.
std::optional<Target> parseTarget(std::string_view text) {
    if (const auto nodeId = parseNodeId(text)) {
        return Target{*nodeId};
    }
    if (const auto edgeId = parseEdgeId(text)) {
        return Target{*edgeId};
    }
    return std::nullopt;
}

bool isPrefixOf(std::string_view text, std::string_view whole) {
    return text.size() <= whole.size() && whole.substr(0, text.size()) == text;
}

bool isLowerHex(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }

// Could `tail` be the beginning of a valid @end line that was cut short?
bool couldBeTornEndLine(std::string_view tail) {
    if (tail.size() > kEndPrefix.size() + kDigestHexLength) {
        return false;
    }
    if (tail.size() <= kEndPrefix.size()) {
        return isPrefixOf(tail, kEndPrefix);
    }
    if (tail.substr(0, kEndPrefix.size()) != kEndPrefix) {
        return false;
    }
    for (const char c : tail.substr(kEndPrefix.size())) {
        if (!isLowerHex(c)) {
            return false;
        }
    }
    return true;
}

struct Line {
    std::string_view text;
    std::size_t offset; // in the file
};

struct Envelope {
    std::string_view number; // the seq (or version) token of the head line
    std::string_view body;
    std::size_t bodyOffset;
    Digest digest;
    std::size_t end;
};

// Head line, counted body, @end line, digest. `keyword` is "@tree" or
// "@commit"; `badHead` is the reason a malformed head line reports (NotATree
// for the header, BadEnvelope for a commit).
Expected<Envelope, DecodeFailure> readEnvelope(std::string_view file, std::size_t offset, std::string_view keyword,
    Reason badHead) {
    const std::string headStart = std::string(keyword) + ' ';
    if (offset >= file.size()) {
        return fail(Reason::Truncated, offset, "no bytes where a record should begin", true);
    }
    const auto lf = file.find('\n', offset);
    if (lf == std::string_view::npos) {
        const std::string_view tail = file.substr(offset);
        if (isPrefixOf(tail, headStart) || isPrefixOf(headStart, tail)) {
            return fail(Reason::Truncated, offset, "record head line is incomplete", true);
        }
        return fail(badHead, offset, "record head line is not " + headStart + "<n> <bytes>");
    }
    const std::string_view head = file.substr(offset, lf - offset);
    const auto tokens = tokenize(head);
    if (!tokens || tokens->size() != 3 || (*tokens)[0] != keyword || !parseCount((*tokens)[1])) {
        return fail(badHead, offset, "record head line is not " + headStart + "<n> <bytes>");
    }
    const auto count = parseCount((*tokens)[2]);
    if (!count) {
        return fail(badHead, offset, "record byte count is not a canonical decimal");
    }
    if (*count > kMaxRecordBytes) {
        return fail(Reason::LimitExceeded, offset, "record body exceeds " + std::to_string(kMaxRecordBytes) + " bytes");
    }
    const std::size_t bodyStart = lf + 1;
    const std::size_t bytes = static_cast<std::size_t>(*count);
    if (file.size() - bodyStart < bytes) {
        return fail(Reason::Truncated, offset, "record body is shorter than its byte count", true);
    }
    const std::size_t endStart = bodyStart + bytes;
    const auto endLf = file.find('\n', endStart);
    if (endLf == std::string_view::npos) {
        if (couldBeTornEndLine(file.substr(endStart))) {
            return fail(Reason::Truncated, offset, "record @end line is incomplete", true);
        }
        return fail(Reason::BadEnvelope, endStart, "expected an @end line after the counted body");
    }
    const std::string_view endLine = file.substr(endStart, endLf - endStart);
    if (endLine.size() != kEndPrefix.size() + kDigestHexLength || endLine.substr(0, kEndPrefix.size()) != kEndPrefix) {
        return fail(Reason::BadEnvelope, endStart, "expected @end sha256:<64 hex> after the counted body");
    }
    const auto claimed = parseDigestHex(endLine.substr(kEndPrefix.size()));
    if (!claimed) {
        return fail(Reason::BadEnvelope, endStart, "@end digest is not 64 lowercase hex characters");
    }
    const Digest actual = sha256(file.substr(offset, endStart - offset));
    if (actual != *claimed) {
        return fail(Reason::DigestMismatch, offset,
            "@end digest at offset " + std::to_string(endStart) + " is not the SHA-256 of the record bytes");
    }
    return Envelope{(*tokens)[1], file.substr(bodyStart, bytes), bodyStart, actual, endLf + 1};
}

// UTF-8 and NUL check over the whole body, then a split into LF-terminated
// lines with their file offsets, each within the line limit.
Expected<std::vector<Line>, DecodeFailure> splitBody(std::string_view body, std::size_t bodyOffset) {
    const std::size_t bad = findInvalidText(body);
    if (bad != std::string_view::npos) {
        const auto previousLf = bad == 0 ? std::string_view::npos : body.rfind('\n', bad - 1);
        const std::size_t lineStart = previousLf == std::string_view::npos ? 0 : previousLf + 1;
        return fail(Reason::InvalidUtf8, bodyOffset + lineStart,
            "NUL byte or invalid UTF-8 at offset " + std::to_string(bodyOffset + bad) + " in record body");
    }
    if (!body.empty() && body.back() != '\n') {
        return fail(Reason::BadLine, bodyOffset + body.size(), "record body does not end with a line feed");
    }
    std::vector<Line> lines;
    std::size_t pos = 0;
    while (pos < body.size()) {
        const auto lf = body.find('\n', pos);
        const std::string_view text = body.substr(pos, lf - pos);
        if (text.size() > kMaxLineBytes) {
            return fail(Reason::LimitExceeded, bodyOffset + pos, "line exceeds " + std::to_string(kMaxLineBytes) + " bytes");
        }
        lines.push_back(Line{text, bodyOffset + pos});
        pos = lf + 1;
    }
    return lines;
}

bool isExtensionLine(std::string_view line) { return line.size() >= 2 && line.substr(0, 2) == "x-"; }

// One op line (plus the block lines it may consume). Advances `index` past
// everything it used. `seq` appears only in diagnostics. A line is BadLine
// when its shape is wrong (token count, an id or key that does not parse)
// and BadValue when the shape is right but the value is not.
std::optional<DecodeFailure> parseOp(const std::vector<Line>& lines, std::size_t& index, std::vector<Op>& ops,
    CommitSeq seq) {
    const Line& line = lines[index];
    const auto space = line.text.find(' ');
    const std::string_view verb = line.text.substr(0, space);
    std::optional<std::vector<std::string_view>> tokens;
    if (verb != "set") {
        tokens = tokenize(line.text);
        if (!tokens) {
            return fail(Reason::BadLine, line.offset, "op line has an empty token (double, leading or trailing space)");
        }
    }

    if (verb == "create-node") {
        if (tokens->size() != 3) {
            return fail(Reason::BadLine, line.offset, "create-node needs exactly <id> <type>");
        }
        const auto id = parseNodeId((*tokens)[1]);
        if (!id) {
            return fail(Reason::BadLine, line.offset, "create-node id is not n<k>: " + std::string((*tokens)[1]));
        }
        if (!isToken((*tokens)[2])) {
            return fail(Reason::BadLine, line.offset, "create-node type is not one token");
        }
        ops.push_back(CreateNode{*id, std::string((*tokens)[2]), {}});
        index += 1;
        return std::nullopt;
    }

    if (verb == "set") {
        const auto fields = splitSetLine(line.text);
        if (!fields) {
            return fail(Reason::BadLine, line.offset, "set needs <target> <key> <type> <value>");
        }
        const auto target = parseTarget(fields->target);
        if (!target) {
            return fail(Reason::BadLine, line.offset, "set target is not n<k> or e<k>: " + std::string(fields->target));
        }
        if (!isValidKey(fields->key)) {
            return fail(Reason::BadLine, line.offset, "set key is not a valid key: " + std::string(fields->key));
        }
        const auto type = parseTypeName(fields->type);
        if (!type) {
            return fail(Reason::BadValue, line.offset,
                "set type is not text|int|real|bool|ref|time: " + std::string(fields->type));
        }
        if (fields->value.empty()) {
            return fail(Reason::BadValue, line.offset, "set line has no value after its type");
        }
        if (fields->value.size() >= 2 && fields->value.substr(0, 2) == "<<") {
            // A delimited block: the following lines up to one equal to the
            // delimiter, all inside the counted body — never a byte beyond it.
            if (*type != ValueType::Text) {
                return fail(Reason::BadValue, line.offset, "a <<block is only valid for a text value");
            }
            const std::string_view delimiter = fields->value.substr(2);
            if (!isToken(delimiter)) {
                return fail(Reason::BadValue, line.offset, "block delimiter is not one token");
            }
            std::string text;
            std::size_t cursor = index + 1;
            bool closed = false;
            for (; cursor < lines.size(); ++cursor) {
                if (lines[cursor].text == delimiter) {
                    closed = true;
                    break;
                }
                if (cursor > index + 1) {
                    text += '\n';
                }
                text += lines[cursor].text;
            }
            if (!closed) {
                return fail(Reason::BadValue, line.offset,
                    "block is not closed by a line equal to " + std::string(delimiter) + " inside the record");
            }
            ops.push_back(SetProperty{*target, std::string(fields->key), Value::ofText(std::move(text))});
            index = cursor + 1;
            return std::nullopt;
        }
        auto value = parseValue(*type, fields->value);
        if (!value) {
            return fail(Reason::BadValue, line.offset,
                "value does not parse as " + std::string(fields->type) + ": " + std::string(fields->value));
        }
        ops.push_back(SetProperty{*target, std::string(fields->key), std::move(*value)});
        index += 1;
        return std::nullopt;
    }

    if (verb == "unset") {
        if (tokens->size() != 3) {
            return fail(Reason::BadLine, line.offset, "unset needs exactly <target> <key>");
        }
        const auto target = parseTarget((*tokens)[1]);
        if (!target) {
            return fail(Reason::BadLine, line.offset, "unset target is not n<k> or e<k>: " + std::string((*tokens)[1]));
        }
        if (!isValidKey((*tokens)[2])) {
            return fail(Reason::BadLine, line.offset, "unset key is not a valid key: " + std::string((*tokens)[2]));
        }
        ops.push_back(UnsetProperty{*target, std::string((*tokens)[2])});
        index += 1;
        return std::nullopt;
    }

    if (verb == "create-edge") {
        if (tokens->size() != 5) {
            return fail(Reason::BadLine, line.offset, "create-edge needs exactly <id> <from> <to> <label>");
        }
        const auto id = parseEdgeId((*tokens)[1]);
        const auto from = parseNodeId((*tokens)[2]);
        const auto to = parseNodeId((*tokens)[3]);
        if (!id || !from || !to) {
            return fail(Reason::BadLine, line.offset, "create-edge ids must be e<k> n<a> n<b>: " + std::string(line.text));
        }
        if (!isToken((*tokens)[4])) {
            return fail(Reason::BadLine, line.offset, "create-edge label is not one token");
        }
        ops.push_back(CreateEdge{*id, *from, *to, std::string((*tokens)[4]), {}});
        index += 1;
        return std::nullopt;
    }

    if (verb == "delete-node") {
        const auto id = tokens->size() == 2 ? parseNodeId((*tokens)[1]) : std::nullopt;
        if (!id) {
            return fail(Reason::BadLine, line.offset, "delete-node needs exactly one n<k>");
        }
        ops.push_back(DeleteNode{*id});
        index += 1;
        return std::nullopt;
    }

    if (verb == "delete-edge") {
        const auto id = tokens->size() == 2 ? parseEdgeId((*tokens)[1]) : std::nullopt;
        if (!id) {
            return fail(Reason::BadLine, line.offset, "delete-edge needs exactly one e<k>");
        }
        ops.push_back(DeleteEdge{*id});
        index += 1;
        return std::nullopt;
    }

    if (verb == "advance") {
        const auto ticks = tokens->size() == 2 ? parseCount((*tokens)[1]) : std::nullopt;
        if (!ticks) {
            return fail(Reason::BadLine, line.offset, "advance needs exactly one decimal count");
        }
        if (*ticks == 0) {
            return fail(Reason::BadValue, line.offset, "advance 0 changes nothing and is never written");
        }
        ops.push_back(Advance{*ticks});
        index += 1;
        return std::nullopt;
    }

    // A verb this kernel does not know — written by a newer Tapestry or by
    // hand. Never skipped: applying the rest would diverge from the history.
    // Plugin data belongs on x- lines, which are kept without being read.
    return fail(Reason::UnsupportedOp, line.offset,
        "UnsupportedOp: verb '" + std::string(verb) + "' in commit " + std::to_string(seq)
            + " is not a v1 op (create-node, set, unset, create-edge, delete-node, delete-edge, advance)");
}

} // namespace

Expected<DecodedHeader, DecodeFailure> decodeHeader(std::string_view file) {
    if (file.empty()) {
        return fail(Reason::NotATree, 0, "empty input");
    }
    auto envelope = readEnvelope(file, 0, "@tree", Reason::NotATree);
    if (!envelope) {
        return envelope.error();
    }
    const Envelope& env = envelope.value();
    if (env.number != "1") {
        return fail(Reason::NotATree, 0, "unsupported .tree version: " + std::string(env.number));
    }
    auto split = splitBody(env.body, env.bodyOffset);
    if (!split) {
        return split.error();
    }
    const std::vector<Line>& lines = split.value();
    if (lines.size() < 2) {
        return fail(Reason::BadLine, env.bodyOffset + env.body.size(), "header needs world and created lines");
    }

    DecodedHeader decoded;
    decoded.record.version = 1;
    const auto world = valueAfter(lines[0].text, "world");
    if (!world || !isToken(*world)) {
        return fail(Reason::BadLine, lines[0].offset, "expected: world <slug>");
    }
    decoded.record.world = std::string(*world);
    const auto created = valueAfter(lines[1].text, "created");
    if (!created) {
        return fail(Reason::BadLine, lines[1].offset, "expected: created <YYYY-MM-DDTHH:MM:SSZ>");
    }
    const auto stamp = RecordedAt::parse(*created);
    if (!stamp) {
        return fail(Reason::BadLine, lines[1].offset, "created is not an RFC 3339 UTC stamp: " + std::string(*created));
    }
    decoded.record.created = *stamp;
    for (std::size_t i = 2; i < lines.size(); ++i) {
        if (!isExtensionLine(lines[i].text)) {
            return fail(Reason::BadLine, lines[i].offset, "unexpected header line: " + std::string(lines[i].text));
        }
        decoded.record.extensionLines.emplace_back(lines[i].text);
    }
    decoded.digest = env.digest;
    decoded.end = env.end;
    return decoded;
}

Expected<DecodedCommit, DecodeFailure> decodeCommit(std::string_view file, std::size_t offset,
    const Digest& expectedParent, CommitSeq expectedSeq, Tick expectedTick) {
    auto envelope = readEnvelope(file, offset, "@commit", Reason::BadEnvelope);
    if (!envelope) {
        return envelope.error();
    }
    const Envelope& env = envelope.value();
    const auto seq = parseCount(env.number);
    if (!seq || *seq != expectedSeq) {
        return fail(Reason::SeqGap, offset,
            "expected @commit " + std::to_string(expectedSeq) + ", found " + std::string(env.number));
    }
    auto split = splitBody(env.body, env.bodyOffset);
    if (!split) {
        return split.error();
    }
    const std::vector<Line>& lines = split.value();
    if (lines.size() < 5) {
        return fail(Reason::BadLine, env.bodyOffset + env.body.size(),
            "commit needs parent, branch, recorded, tick and actor lines");
    }

    DecodedCommit decoded;
    CommitRecord& record = decoded.record;
    record.seq = *seq;

    const auto parent = valueAfter(lines[0].text, "parent");
    if (!parent || !isPrefixOf("sha256:", *parent)) {
        return fail(Reason::BadLine, lines[0].offset, "expected: parent sha256:<64 hex>");
    }
    const auto parentDigest = parseDigestHex(parent->substr(7));
    if (!parentDigest) {
        return fail(Reason::BadLine, lines[0].offset, "parent digest is not 64 lowercase hex characters");
    }
    if (*parentDigest != expectedParent) {
        return fail(Reason::ChainBreak, lines[0].offset, "parent is not the digest of the previous record");
    }
    record.parent = *parentDigest;

    const auto branch = valueAfter(lines[1].text, "branch");
    if (!branch || !isToken(*branch)) {
        return fail(Reason::BadLine, lines[1].offset, "expected: branch <name>");
    }
    record.branch = std::string(*branch);

    const auto recorded = valueAfter(lines[2].text, "recorded");
    const auto stamp = recorded ? RecordedAt::parse(*recorded) : std::nullopt;
    if (!stamp) {
        return fail(Reason::BadLine, lines[2].offset, "expected: recorded <YYYY-MM-DDTHH:MM:SSZ>");
    }
    record.recorded = *stamp;

    const auto tickText = valueAfter(lines[3].text, "tick");
    const auto tick = tickText ? parseCount(*tickText) : std::nullopt;
    if (!tick) {
        return fail(Reason::BadLine, lines[3].offset, "expected: tick <n>");
    }
    if (*tick != expectedTick) {
        return fail(Reason::TickMismatch, lines[3].offset,
            "TickMismatch: expected tick " + std::to_string(expectedTick) + " (the tick the replayed world is at), found "
                + std::to_string(*tick));
    }
    record.tick = *tick;

    const auto actor = tokenize(lines[4].text);
    if (!actor || actor->size() != 3 || (*actor)[0] != "actor" || !isValidActorKind((*actor)[1])
        || !isToken((*actor)[2])) {
        return fail(Reason::BadLine, lines[4].offset, "expected: actor <human|plugin|system> <id>");
    }
    record.actor = Actor{std::string((*actor)[1]), std::string((*actor)[2])};

    std::size_t index = 5;
    if (index < lines.size()) {
        if (const auto message = valueAfter(lines[index].text, "message")) {
            auto text = unquoteText(*message);
            if (!text) {
                return fail(Reason::BadLine, lines[index].offset, "message is not one quoted string");
            }
            record.message = std::move(*text);
            index += 1;
        }
    }
    while (index < lines.size()) {
        if (isExtensionLine(lines[index].text)) {
            record.extensionLines.emplace_back(lines[index].text);
            index += 1;
            continue;
        }
        if (auto failure = parseOp(lines, index, record.ops, *seq)) {
            return *failure;
        }
    }

    decoded.digest = env.digest;
    decoded.begin = offset;
    decoded.end = env.end;
    return decoded;
}

} // namespace tapestry::kernel::tree
