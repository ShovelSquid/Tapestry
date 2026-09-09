// Codec invariants.
//
// The .tree file is the only copy of a person's history, so the property that
// matters is exactness in both directions: every v1 op and every value type
// must encode to readable lines and decode back to the same record, and
// encoding the decoded record must reproduce the original bytes exactly.
// The reader is strict — a line it does not understand stops the load with
// the offset of that line; nothing is skipped, guessed or normalized. This
// suite is pure: records are built in memory and no file is touched, so the
// same encoder can build fixtures for the journal sweeps later.

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Record.hpp"
#include "kernel/Result.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"
#include "kernel/World.hpp"
#include "kernel/tree/Codec.hpp"

#include <doctest.h>

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::Advance;
using tapestry::kernel::CommitRecord;
using tapestry::kernel::CommitSeq;
using tapestry::kernel::CreateEdge;
using tapestry::kernel::CreateNode;
using tapestry::kernel::DeleteEdge;
using tapestry::kernel::DeleteNode;
using tapestry::kernel::Digest;
using tapestry::kernel::EdgeId;
using tapestry::kernel::Expected;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::Rejection;
using tapestry::kernel::SetProperty;
using tapestry::kernel::sha256;
using tapestry::kernel::Tick;
using tapestry::kernel::UnsetProperty;
using tapestry::kernel::Value;
using tapestry::kernel::World;
namespace tree = tapestry::kernel::tree;
using Reason = tree::DecodeFailure::Reason;

const Digest kParent = sha256("the record before this one");
const char* const kStamp = "2026-09-08T21:15:07Z";
const std::string kEndLine = "@end sha256:"; // + 64 hex + LF
constexpr std::size_t kEndLineBytes = 12 + 64 + 1;

template <class T, class E>
std::string detailOf(const Expected<T, E>& result) {
    return result.ok() ? std::string("ok") : result.error().detail;
}

const char* reasonName(Reason reason) {
    switch (reason) {
    case Reason::Truncated:      return "Truncated";
    case Reason::BadEnvelope:    return "BadEnvelope";
    case Reason::DigestMismatch: return "DigestMismatch";
    case Reason::ChainBreak:     return "ChainBreak";
    case Reason::SeqGap:         return "SeqGap";
    case Reason::TickMismatch:   return "TickMismatch";
    case Reason::UnsupportedOp:  return "UnsupportedOp";
    case Reason::BadLine:        return "BadLine";
    case Reason::BadValue:       return "BadValue";
    case Reason::InvalidUtf8:    return "InvalidUtf8";
    case Reason::LimitExceeded:  return "LimitExceeded";
    case Reason::NotATree:       break;
    }
    return "NotATree";
}

// A commit with the fixed header lines filled in; ops are added per case.
CommitRecord baseRecord(CommitSeq seq, Tick tick = 0) {
    CommitRecord record;
    record.seq = seq;
    record.parent = kParent;
    record.branch = "main";
    record.recorded = *RecordedAt::parse(kStamp);
    record.tick = tick;
    record.actor = Actor{"human", "kaelen"};
    record.message = "every op and value";
    return record;
}

// The five fixed header lines as the encoder writes them, for hand-built
// bodies (no message line, so the op lines follow directly).
std::string headerLines(Tick tick = 0) {
    return "parent sha256:" + kParent.hex + "\nbranch main\nrecorded " + kStamp + "\ntick " + std::to_string(tick)
        + "\nactor human kaelen\n";
}

// Seals a body into a record with the head line and @end digest computed
// here, independently of the encoder, so a hand-edited body verifies.
std::string frame(CommitSeq seq, const std::string& body) {
    std::string bytes = "@commit " + std::to_string(seq) + ' ' + std::to_string(body.size()) + '\n' + body;
    const Digest digest = sha256(bytes);
    bytes += kEndLine + digest.hex + '\n';
    return bytes;
}

// Offset of the first body byte: just past the head line.
std::size_t bodyOffset(std::string_view bytes) { return bytes.find('\n') + 1; }

// Offset of the first line in the body that starts with `prefix`.
std::size_t offsetOfLine(std::string_view bytes, std::string_view prefix) {
    std::size_t pos = bodyOffset(bytes);
    while (pos < bytes.size()) {
        if (bytes.substr(pos, prefix.size()) == prefix) {
            return pos;
        }
        const auto lf = bytes.find('\n', pos);
        REQUIRE(lf != std::string_view::npos);
        pos = lf + 1;
    }
    FAIL("no line starts with " << std::string(prefix));
    return 0;
}

Expected<tree::DecodedCommit, tree::DecodeFailure> decode(std::string_view bytes, CommitSeq seq, Tick tick = 0,
    const Digest& parent = kParent) {
    return tree::decodeCommit(bytes, 0, parent, seq, tick);
}

template <class T>
void expectFailure(const Expected<T, tree::DecodeFailure>& result, Reason reason, std::size_t offset) {
    REQUIRE_FALSE(result.ok());
    const tree::DecodeFailure& failure = result.error();
    CHECK_MESSAGE(failure.reason == reason,
        "expected " << reasonName(reason) << ", got " << reasonName(failure.reason) << ": " << failure.detail);
    CHECK_MESSAGE(failure.offset == offset, failure.detail);
    CHECK_FALSE(failure.atEof);
}

// The decoder keeps every `set` line as its own op (so re-encoding reproduces
// the file's line order); a record built with initial props compares equal
// to its decoded form once the props are flattened the same way.
std::vector<Op> flattened(const std::vector<Op>& ops) {
    std::vector<Op> out;
    for (const Op& op : ops) {
        if (const auto* node = std::get_if<CreateNode>(&op)) {
            out.push_back(CreateNode{node->id, node->type, {}});
            for (const auto& [key, value] : node->props) {
                out.push_back(SetProperty{node->id, key, value});
            }
        } else if (const auto* edge = std::get_if<CreateEdge>(&op)) {
            out.push_back(CreateEdge{edge->id, edge->from, edge->to, edge->label, {}});
            for (const auto& [key, value] : edge->props) {
                out.push_back(SetProperty{edge->id, key, value});
            }
        } else {
            out.push_back(op);
        }
    }
    return out;
}

// Every op alternative and every value type in one commit. The body has a
// line that is exactly TEXT, so the block delimiter must escalate to TEXT1.
CommitRecord everythingRecord() {
    CommitRecord record = baseRecord(7, 4);
    CreateNode node;
    node.id = NodeId{1};
    node.type = "example.people/person@2";
    node.props["title"] = Value::ofText("Sam");
    node.props["body"] = Value::ofText("Met Sam at dinner.\nTEXT\nLoves architecture and weird bird memes.");
    node.props["anger"] = Value::ofInt(3);
    node.props["weight"] = Value::ofReal(0.1);
    node.props["pinned"] = Value::ofBool(true);
    node.props["event"] = Value::ofTime("2026-09-07");
    record.ops.push_back(std::move(node));
    CreateEdge edge;
    edge.id = EdgeId{1};
    edge.from = NodeId{1};
    edge.to = NodeId{2};
    edge.label = "mentions";
    edge.props["note"] = Value::ofText("first meeting");
    record.ops.push_back(std::move(edge));
    record.ops.push_back(SetProperty{EdgeId{1}, "subject", Value::ofRef(NodeId{1})});
    record.ops.push_back(UnsetProperty{NodeId{1}, "anger"});
    record.ops.push_back(DeleteEdge{EdgeId{1}});
    record.ops.push_back(DeleteNode{NodeId{1}});
    record.ops.push_back(Advance{3});
    record.extensionLines = {"x-example.people mood curious", "x-acme.widgets flag 1"};
    return record;
}

// One `set n1 t text <value>` commit, for the block-selection cases.
std::string encodedTextLine(const std::string& text) {
    CommitRecord record = baseRecord(1);
    record.ops.push_back(SetProperty{NodeId{1}, "t", Value::ofText(text)});
    return tree::encodeCommit(record).bytes;
}

Value decodedTextValue(const std::string& bytes) {
    auto decoded = decode(bytes, 1);
    REQUIRE_MESSAGE(decoded.ok(), detailOf(decoded));
    REQUIRE(decoded.value().record.ops.size() == 1);
    const auto* set = std::get_if<SetProperty>(&decoded.value().record.ops[0]);
    REQUIRE(set != nullptr);
    return set->value;
}

std::optional<Rejection::Kind> prepared(const World& world, Op op) {
    const auto rejection = world.prepare(op);
    return rejection ? std::optional<Rejection::Kind>(rejection->kind) : std::nullopt;
}

// Prepares and applies, returning the op with its assigned id.
Op accept(World& world, Op op) {
    const auto rejection = world.prepare(op);
    REQUIRE_MESSAGE(!rejection, (rejection ? rejection->detail : std::string("accepted")));
    world.apply(op);
    return op;
}

} // namespace

TEST_SUITE("codec") {

TEST_CASE("codec: every op and value type round-trips byte-identically") {
    const CommitRecord original = everythingRecord();
    const tree::Encoded encoded = tree::encodeCommit(original);

    // Readable lines, in the fixed order, with the block delimiter escalated
    // because a body line equals TEXT.
    const std::string& bytes = encoded.bytes;
    for (const char* needle : {"@commit 7 ", "parent sha256:", "branch main\n", "recorded 2026-09-08T21:15:07Z\n",
             "tick 4\n", "actor human kaelen\n", "message \"every op and value\"\n",
             "create-node n1 example.people/person@2\n", "set n1 anger int 3\n",
             "set n1 body text <<TEXT1\nMet Sam at dinner.\nTEXT\nLoves architecture and weird bird memes.\nTEXT1\n",
             "set n1 event time 2026-09-07\n", "set n1 pinned bool true\n", "set n1 title text \"Sam\"\n",
             "set n1 weight real 0.1\n", "create-edge e1 n1 n2 mentions\n", "set e1 note text \"first meeting\"\n",
             "set e1 subject ref n1\n", "unset n1 anger\n", "delete-edge e1\n", "delete-node n1\n", "advance 3\n",
             "x-example.people mood curious\nx-acme.widgets flag 1\n@end sha256:"}) {
        CHECK_MESSAGE(bytes.find(needle) != std::string::npos, needle);
    }
    CHECK(bytes.find("<<TEXT\n") == std::string::npos);
    CHECK(bytes.find("\\n") == std::string::npos);

    auto decoded = decode(bytes, 7, 4);
    REQUIRE_MESSAGE(decoded.ok(), detailOf(decoded));
    const CommitRecord& record = decoded.value().record;
    CHECK(record.seq == 7);
    CHECK(record.parent == kParent);
    CHECK(record.branch == "main");
    CHECK(record.recorded.rfc3339Z() == kStamp);
    CHECK(record.tick == 4);
    CHECK(record.actor == original.actor);
    CHECK(record.message == original.message);
    CHECK(record.extensionLines == original.extensionLines);
    REQUIRE(record.ops.size() == flattened(original.ops).size());
    CHECK(record.ops == flattened(original.ops));
    CHECK(decoded.value().digest == encoded.digest);
    CHECK(decoded.value().begin == 0);
    CHECK(decoded.value().end == bytes.size());

    const tree::Encoded again = tree::encodeCommit(record);
    CHECK(again.bytes == bytes);
    CHECK(again.digest == encoded.digest);
}

TEST_CASE("codec: text is inline up to 80 bytes and a block beyond that or with a newline") {
    const std::string eighty(80, 'a');
    const std::string eightyOne(81, 'a');

    CHECK(encodedTextLine(eighty).find("set n1 t text \"" + eighty + "\"\n") != std::string::npos);
    CHECK(encodedTextLine(eightyOne).find("set n1 t text <<TEXT\n" + eightyOne + "\nTEXT\n") != std::string::npos);
    CHECK(encodedTextLine("a\nb").find("set n1 t text <<TEXT\na\nb\nTEXT\n") != std::string::npos);
    CHECK(encodedTextLine("").find("set n1 t text \"\"\n") != std::string::npos);

    for (const std::string& text : {eighty, eightyOne, std::string("a\nb"), std::string(), std::string("a  b"),
             std::string(" a"), std::string("a "), std::string("  ")}) {
        CHECK(decodedTextValue(encodedTextLine(text)) == Value::ofText(text));
    }

    CommitRecord messageRecord = baseRecord(1);
    messageRecord.message = "message  with  spaces";
    const tree::Encoded messageEncoded = tree::encodeCommit(messageRecord);
    auto messageDecoded = decode(messageEncoded.bytes, 1);
    REQUIRE_MESSAGE(messageDecoded.ok(), detailOf(messageDecoded));
    CHECK(messageDecoded.value().record.message == messageRecord.message);
}

TEST_CASE("codec: non-ASCII text round-trips byte-identically and the byte count is UTF-8 length") {
    const std::string text = "café ☕ — 日本語";

    CommitRecord record = baseRecord(1);
    record.message.clear();
    record.ops.push_back(SetProperty{NodeId{1}, "title", Value::ofText(text)});
    const tree::Encoded inlineForm = tree::encodeCommit(record);
    CHECK(inlineForm.bytes.find("set n1 title text \"" + text + "\"\n") != std::string::npos);
    CHECK(decodedTextValue(inlineForm.bytes) == Value::ofText(text));
    CHECK(tree::encodeCommit(decode(inlineForm.bytes, 1).value().record).bytes == inlineForm.bytes);

    // The counted body is exactly these bytes — counted in bytes, not
    // characters — and the head line says so.
    const std::string body = headerLines() + "set n1 title text \"" + text + "\"\n";
    CHECK(inlineForm.bytes.substr(0, bodyOffset(inlineForm.bytes)) == "@commit 1 " + std::to_string(body.size()) + "\n");
    CHECK(inlineForm.bytes.substr(bodyOffset(inlineForm.bytes), body.size()) == body);
    CHECK(inlineForm.bytes.size() == bodyOffset(inlineForm.bytes) + body.size() + kEndLineBytes);

    const std::string twoLines = text + "\n" + text;
    const std::string blockForm = encodedTextLine(twoLines);
    CHECK(blockForm.find("set n1 t text <<TEXT\n" + twoLines + "\nTEXT\n") != std::string::npos);
    CHECK(decodedTextValue(blockForm) == Value::ofText(twoLines));
    CHECK(tree::encodeCommit(decode(blockForm, 1).value().record).bytes == blockForm);
}

TEST_CASE("codec: a NUL byte or invalid UTF-8 in the body is InvalidUtf8 at that line") {
    const std::string nul = frame(1, headerLines() + "create-node n1 t\nset n1 a text \"a" + std::string(1, '\0') + "b\"\n");
    expectFailure(decode(nul, 1), Reason::InvalidUtf8, offsetOfLine(nul, "set n1 a"));

    const std::string bad = frame(1, headerLines() + "create-node n1 t\nset n1 a text \"a\xC3\x28" "b\"\n");
    expectFailure(decode(bad, 1), Reason::InvalidUtf8, offsetOfLine(bad, "set n1 a"));

    const std::string inBlock = frame(1, headerLines() + "set n1 a text <<TEXT\nfine\nbad\xC3\x28\nTEXT\n");
    expectFailure(decode(inBlock, 1), Reason::InvalidUtf8, offsetOfLine(inBlock, "bad"));
}

TEST_CASE("codec: a line over kMaxLineBytes or a count over kMaxRecordBytes is LimitExceeded") {
    const std::string longLine = encodedTextLine(std::string(tree::kMaxLineBytes + 1, 'a'));
    expectFailure(decode(longLine, 1), Reason::LimitExceeded, offsetOfLine(longLine, "aaaa"));
    CHECK(decodedTextValue(encodedTextLine(std::string(tree::kMaxLineBytes, 'a'))).text.size() == tree::kMaxLineBytes);

    // The head line alone; a reader that trusted the count would try to read
    // (or allocate) 64 MiB before finding out there is nothing there.
    const std::string bomb = "@commit 1 " + std::to_string(tree::kMaxRecordBytes + 1) + "\n";
    auto result = decode(bomb, 1);
    REQUIRE_FALSE(result.ok());
    CHECK(result.error().reason == Reason::LimitExceeded);
    CHECK(result.error().offset == 0);
    CHECK_FALSE(result.error().atEof);
}

TEST_CASE("codec: x- lines survive verbatim, unknown verbs stop the load, malformed lines are named") {
    const std::string withExtension =
        frame(7, headerLines() + "create-node n1 t\nx-example.people mood curious\nset n1 a int 1\n");
    auto decoded = decode(withExtension, 7);
    REQUIRE_MESSAGE(decoded.ok(), detailOf(decoded));
    CHECK(decoded.value().record.extensionLines == std::vector<std::string>{"x-example.people mood curious"});
    REQUIRE(decoded.value().record.ops.size() == 2);
    CHECK(std::holds_alternative<CreateNode>(decoded.value().record.ops[0]));
    CHECK(std::holds_alternative<SetProperty>(decoded.value().record.ops[1]));
    // Re-emitted after the op lines, verbatim.
    CHECK(tree::encodeCommit(decoded.value().record).bytes.find(
              "create-node n1 t\nset n1 a int 1\nx-example.people mood curious\n@end sha256:")
        != std::string::npos);

    const std::string unknownVerb = frame(7, headerLines() + "create-node n1 t\nfrobnicate n1\nset n1 a int 1\n");
    auto unsupported = decode(unknownVerb, 7);
    expectFailure(unsupported, Reason::UnsupportedOp, offsetOfLine(unknownVerb, "frobnicate"));
    CHECK(unsupported.error().detail.find("frobnicate") != std::string::npos);
    CHECK(unsupported.error().detail.find("7") != std::string::npos);

    const std::string missingValue = frame(7, headerLines() + "create-node n1 t\nset n1 title text\n");
    expectFailure(decode(missingValue, 7), Reason::BadValue, offsetOfLine(missingValue, "set n1 title"));

    const std::string unknownType = frame(7, headerLines() + "create-node n1 t\nset n1 title blob x\n");
    expectFailure(decode(unknownType, 7), Reason::BadValue, offsetOfLine(unknownType, "set n1 title"));

    const std::string badTick = frame(7,
        "parent sha256:" + kParent.hex + "\nbranch main\nrecorded " + kStamp + "\ntick abc\nactor human kaelen\n");
    expectFailure(decode(badTick, 7), Reason::BadLine, offsetOfLine(badTick, "tick abc"));
}

TEST_CASE("codec: seq gaps, chain breaks and any flipped body byte are refused") {
    const tree::Encoded eight = tree::encodeCommit(baseRecord(8));
    expectFailure(decode(eight.bytes, 7), Reason::SeqGap, 0);

    const tree::Encoded seven = tree::encodeCommit(baseRecord(7));
    expectFailure(decode(seven.bytes, 7, 0, sha256("some other record")), Reason::ChainBreak,
        offsetOfLine(seven.bytes, "parent"));

    const std::size_t first = bodyOffset(seven.bytes);
    const std::size_t last = seven.bytes.size() - kEndLineBytes;
    for (std::size_t i = first; i < last; ++i) {
        std::string flipped = seven.bytes;
        flipped[i] = static_cast<char>(static_cast<unsigned char>(flipped[i]) ^ 0x40);
        auto result = decode(flipped, 7);
        REQUIRE_FALSE(result.ok());
        CHECK_MESSAGE(result.error().reason == Reason::DigestMismatch, "byte " << i << ": " << result.error().detail);
        CHECK(result.error().offset == 0);
    }
}

TEST_CASE("codec: an unclosed block and a short @end digest are refused") {
    // The closing delimiter sits outside the counted body: never reached.
    const std::string unclosed = frame(1, headerLines() + "set n1 a text <<TEXT\nline one\n") + "TEXT\n";
    expectFailure(decode(unclosed, 1), Reason::BadValue, offsetOfLine(unclosed, "set n1 a"));

    const tree::Encoded good = tree::encodeCommit(baseRecord(1));
    std::string shortDigest = good.bytes;
    shortDigest.erase(shortDigest.size() - 2, 1); // drop the last hex char, keep the LF
    expectFailure(decode(shortDigest, 1), Reason::BadEnvelope, good.bytes.size() - kEndLineBytes);
}

TEST_CASE("codec: the world validates every op and assigns ids only in prepare") {
    using Kind = Rejection::Kind;
    World world;
    CHECK(std::get<CreateNode>(accept(world, CreateNode{NodeId{}, "t", {{"title", Value::ofText("one")}}})).id
        == NodeId{1});
    CHECK(std::get<CreateNode>(accept(world, CreateNode{NodeId{}, "t", {}})).id == NodeId{2});

    CHECK(prepared(world, CreateEdge{EdgeId{}, NodeId{1}, NodeId{9}, "knows", {}}) == Kind::RefMissing);
    CHECK(prepared(world, CreateEdge{EdgeId{}, NodeId{9}, NodeId{1}, "knows", {}}) == Kind::RefMissing);
    CHECK(prepared(world, CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "has space", {}}) == Kind::BadValue);
    CHECK(prepared(world, CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "", {}}) == Kind::BadValue);
    CHECK(prepared(world, CreateEdge{EdgeId{2}, NodeId{1}, NodeId{2}, "knows", {}}) == Kind::IdOutOfOrder);
    CHECK(prepared(world, DeleteNode{NodeId{9}}) == Kind::UnknownTarget);
    CHECK(prepared(world, DeleteEdge{EdgeId{1}}) == Kind::UnknownTarget);
    CHECK(prepared(world, UnsetProperty{NodeId{1}, "nope"}) == Kind::UnknownTarget);
    CHECK(prepared(world, UnsetProperty{NodeId{9}, "title"}) == Kind::UnknownTarget);
    CHECK(prepared(world, Advance{0}) == Kind::TickZero);
    CHECK_FALSE(prepared(world, Advance{1}));
    CHECK_FALSE(prepared(world, UnsetProperty{NodeId{1}, "title"}));

    const Op edge = accept(world, CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "knows", {}});
    CHECK(std::get<CreateEdge>(edge).id == EdgeId{1});
    CHECK(prepared(world, CreateEdge{EdgeId{1}, NodeId{1}, NodeId{2}, "knows", {}}) == Kind::DuplicateId);
    CHECK_FALSE(prepared(world, SetProperty{NodeId{1}, "link", Value::ofRef(EdgeId{1})}));

    accept(world, DeleteNode{NodeId{2}});
    CHECK(prepared(world, SetProperty{NodeId{1}, "friend", Value::ofRef(NodeId{2})}) == Kind::RefMissing);
    CHECK(prepared(world, SetProperty{NodeId{1}, "link", Value::ofRef(EdgeId{1})}) == Kind::RefMissing);
    CHECK(prepared(world, SetProperty{NodeId{2}, "title", Value::ofText("gone")}) == Kind::UnknownTarget);
    CHECK(prepared(world, DeleteNode{NodeId{2}}) == Kind::UnknownTarget);
    CHECK(prepared(world, CreateNode{NodeId{2}, "t", {}}) == Kind::IdOutOfOrder);
    CHECK(prepared(world, CreateNode{NodeId{1}, "t", {}}) == Kind::DuplicateId);
    CHECK(prepared(world, CreateEdge{EdgeId{1}, NodeId{1}, NodeId{1}, "self", {}}) == Kind::IdOutOfOrder);
}

TEST_CASE("codec: the world applies edges, cascading deletes, unset and advance with tombstoned ids") {
    World world;
    accept(world, CreateNode{NodeId{}, "t", {{"title", Value::ofText("one")}, {"anger", Value::ofInt(3)}}});
    accept(world, CreateNode{NodeId{}, "t", {}});
    accept(world, CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "knows", {{"since", Value::ofTime("2026")}}});

    REQUIRE(world.edgeCount() == 1);
    CHECK(world.edgeIds() == std::vector<EdgeId>{EdgeId{1}});
    const tapestry::kernel::Edge* e1 = world.edge(EdgeId{1});
    REQUIRE(e1 != nullptr);
    CHECK(e1->id == EdgeId{1});
    CHECK(e1->from == NodeId{1});
    CHECK(e1->to == NodeId{2});
    CHECK(e1->label == "knows");
    CHECK(e1->props.at("since") == Value::ofTime("2026"));
    CHECK(world.nextEdgeId() == EdgeId{2});

    accept(world, UnsetProperty{NodeId{1}, "anger"});
    CHECK(world.node(NodeId{1})->props.count("anger") == 0);
    CHECK(world.node(NodeId{1})->props.at("title") == Value::ofText("one"));

    accept(world, Advance{3});
    CHECK(world.tick() == 3);
    accept(world, Advance{2});
    CHECK(world.tick() == 5);

    // Deleting n2 takes e1 with it; both ids are remembered, never reused.
    accept(world, DeleteNode{NodeId{2}});
    CHECK(world.node(NodeId{2}) == nullptr);
    CHECK(world.edge(EdgeId{1}) == nullptr);
    CHECK(world.nodeCount() == 1);
    CHECK(world.edgeCount() == 0);
    CHECK(world.wasDeleted(NodeId{2}));
    CHECK(world.wasDeleted(EdgeId{1}));
    CHECK_FALSE(world.wasDeleted(NodeId{1}));
    CHECK_FALSE(world.wasDeleted(NodeId{3}));
    CHECK_FALSE(world.wasDeleted(EdgeId{2}));
    CHECK(world.nextNodeId() == NodeId{3});
    CHECK(world.nextEdgeId() == EdgeId{2});

    CHECK(std::get<CreateNode>(accept(world, CreateNode{NodeId{}, "t", {}})).id == NodeId{3});
    CHECK(std::get<CreateEdge>(accept(world, CreateEdge{EdgeId{}, NodeId{1}, NodeId{3}, "knows", {}})).id == EdgeId{2});
    accept(world, DeleteEdge{EdgeId{2}});
    CHECK(world.edgeCount() == 0);
    CHECK(world.wasDeleted(EdgeId{2}));
    CHECK(world.nextEdgeId() == EdgeId{3});
    CHECK(world.nodeIds() == std::vector<NodeId>{NodeId{1}, NodeId{3}});
}

} // TEST_SUITE("codec")
