// The tracer: one node, created through Kernel::submit, appended durably to
// a .tree file, reopened by a fresh kernel and read back with the same id.
// Alongside it, the three properties that make the path trustworthy:
// a rejection changes nothing, every commit is written then synced before
// submit returns, and open() never creates or touches a file it refuses.
//
// Then the guarantees that let plugins own meaning while the kernel stays
// small (TREE-02): a node of a type the kernel has never seen loads as
// readable typed data, x- extension lines survive reopen verbatim, an op
// verb the kernel does not know stops the load loudly, ids stay stable and
// are never reused after a delete, tick lines follow advance, and text is
// bytes — non-ASCII round-trips and byte counts are UTF-8 lengths.

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Kernel.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Record.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"
#include "kernel/journal/Journal.hpp"
#include "kernel/journal/Sink.hpp"
#include "kernel/tree/Codec.hpp"
#include "kernel_tests/support.hpp"

#include <doctest.h>

#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::Advance;
using tapestry::kernel::Clock;
using tapestry::kernel::CommitRecord;
using tapestry::kernel::CommitResult;
using tapestry::kernel::CommitSeq;
using tapestry::kernel::CreateEdge;
using tapestry::kernel::CreateNode;
using tapestry::kernel::DeleteNode;
using tapestry::kernel::Digest;
using tapestry::kernel::Edge;
using tapestry::kernel::EdgeId;
using tapestry::kernel::Expected;
using tapestry::kernel::FixedClock;
using tapestry::kernel::formatInline;
using tapestry::kernel::IoError;
using tapestry::kernel::JournalStatus;
using tapestry::kernel::Kernel;
using tapestry::kernel::Node;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::OpenFailure;
using tapestry::kernel::OpenPolicy;
using tapestry::kernel::Proposal;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::Rejection;
using tapestry::kernel::SetProperty;
using tapestry::kernel::sha256;
using tapestry::kernel::Sink;
using tapestry::kernel::Tick;
using tapestry::kernel::Value;
namespace tree = tapestry::kernel::tree;
using tapestry::kernel::test::fileExists;
using tapestry::kernel::test::fileSize;
using tapestry::kernel::test::readFile;
using tapestry::kernel::test::scratchPath;
using tapestry::kernel::test::writeFile;

const char* const kTracerType = "tapestry.notes/note@1";
const char* const kTracerBody = "Met Sam at dinner.\nLoves architecture and weird bird memes.";

// A fixed name (not scratchPath) so the verify step can print the journal
// after the run: stale files are removed at the start, never at the end.
std::string tracerPath() {
    const char* base = std::getenv("TMPDIR");
    std::string path = (base != nullptr) ? base : "/tmp";
    if (!path.empty() && path.back() != '/') {
        path += '/';
    }
    path += "tapestry-kernel-tracer.tree";
    return path;
}

std::unique_ptr<Clock> fixedClock(const char* stamp) {
    auto clock = std::make_unique<FixedClock>();
    clock->at = *RecordedAt::parse(stamp);
    return clock;
}

Proposal firstNote() {
    Proposal proposal;
    proposal.actor = Actor{"human", "kaelen"};
    proposal.message = "first note";
    CreateNode note;
    note.type = kTracerType;
    note.props["title"] = Value::ofText("Sam");
    note.props["body"] = Value::ofText(kTracerBody);
    proposal.ops.push_back(std::move(note));
    return proposal;
}

template <class T, class E>
std::string detailOf(const Expected<T, E>& result) {
    return result.ok() ? std::string("ok") : result.error().detail;
}

// Records the order of write and sync calls and keeps every byte written.
struct RecordingSink final : Sink {
    std::vector<std::string> calls;
    std::string data;
    bool failSync = false;

    std::optional<IoError> writeAll(std::string_view bytes) override {
        calls.emplace_back("w");
        data.append(bytes.data(), bytes.size());
        return std::nullopt;
    }
    std::optional<IoError> sync() override {
        calls.emplace_back("s");
        if (failSync) {
            return IoError{5, "injected sync failure"};
        }
        return std::nullopt;
    }
    std::uint64_t size() const override { return data.size(); }
    std::optional<IoError> truncate(std::uint64_t newSize) override {
        data.resize(static_cast<std::size_t>(std::min<std::uint64_t>(newSize, data.size())));
        return std::nullopt;
    }
};

// The head line plus counted body of the record that starts at `offset`,
// recomputed from the file text alone (no kernel code involved).
std::string countedBytesAt(const std::string& text, std::size_t offset) {
    const std::size_t lf = text.find('\n', offset);
    REQUIRE(lf != std::string::npos);
    const std::string head = text.substr(offset, lf - offset);
    const std::size_t lastSpace = head.rfind(' ');
    REQUIRE(lastSpace != std::string::npos);
    const unsigned long long count = std::strtoull(head.c_str() + lastSpace + 1, nullptr, 10);
    return text.substr(offset, lf + 1 - offset + static_cast<std::size_t>(count));
}

void checkTracerNode(const Node* node) {
    REQUIRE(node != nullptr);
    CHECK(node->id == NodeId{1});
    CHECK(node->type == kTracerType);
    REQUIRE(node->props.size() == 2);
    CHECK(node->props.at("title") == Value::ofText("Sam"));
    CHECK(node->props.at("body") == Value::ofText(kTracerBody));
}

const char* const kClockStamp = "2026-09-08T21:15:07Z";
constexpr std::size_t kEndLineBytes = 12 + 64 + 1; // "@end sha256:" + hex + LF

Proposal proposalOf(std::vector<Op> ops, const char* message = "") {
    Proposal proposal;
    proposal.actor = Actor{"human", "kaelen"};
    proposal.message = message;
    proposal.ops = std::move(ops);
    return proposal;
}

CommitResult submitOk(Kernel& kernel, const Proposal& proposal) {
    auto result = kernel.submit(proposal);
    REQUIRE_MESSAGE(result.ok(), detailOf(result));
    return result.value();
}

std::unique_ptr<Kernel> createOk(const std::string& path, const char* world) {
    auto created = Kernel::create(path, world, fixedClock(kClockStamp));
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    return std::move(created.value());
}

std::unique_ptr<Kernel> openOk(const std::string& path, OpenPolicy policy) {
    auto opened = Kernel::open(path, policy);
    REQUIRE_MESSAGE(opened.ok(), detailOf(opened));
    return std::move(opened.value());
}

// Every commit record of a journal, decoded with the pure codec alone (the
// chain, seqs and ticks are tracked here, independently of the Journal), so
// a test can locate and rewrite one record's bytes.
std::vector<tree::DecodedCommit> decodeAll(const std::string& bytes) {
    auto header = tree::decodeHeader(bytes);
    REQUIRE_MESSAGE(header.ok(), detailOf(header));
    std::vector<tree::DecodedCommit> commits;
    Digest parent = header.value().digest;
    std::size_t position = header.value().end;
    CommitSeq seq = 1;
    Tick tick = 0;
    while (position < bytes.size()) {
        auto commit = tree::decodeCommit(bytes, position, parent, seq, tick);
        REQUIRE_MESSAGE(commit.ok(), detailOf(commit));
        for (const Op& op : commit.value().record.ops) {
            if (const auto* advance = std::get_if<Advance>(&op)) {
                tick += advance->ticks;
            }
        }
        parent = commit.value().digest;
        position = commit.value().end;
        seq += 1;
        commits.push_back(std::move(commit.value()));
    }
    return commits;
}

// The counted body of a decoded record: the bytes between its head line and
// its @end line.
std::string bodyOf(const std::string& bytes, const tree::DecodedCommit& commit) {
    const std::size_t bodyStart = bytes.find('\n', commit.begin) + 1;
    return bytes.substr(bodyStart, commit.end - kEndLineBytes - bodyStart);
}

// Seals a hand-edited body into a record — head line and @end digest
// recomputed here with sha256, no encoder involved.
std::string frame(CommitSeq seq, const std::string& body) {
    std::string record = "@commit " + std::to_string(seq) + ' ' + std::to_string(body.size()) + '\n' + body;
    const Digest digest = sha256(record);
    record += "@end sha256:" + digest.hex + '\n';
    return record;
}

// The journal bytes with one commit's record swapped for `replacement`.
std::string withRecordReplaced(const std::string& bytes, const tree::DecodedCommit& commit,
    const std::string& replacement) {
    return bytes.substr(0, commit.begin) + replacement + bytes.substr(commit.end);
}

// How many lines of `text` begin with `prefix` — the shape a reader relies
// on: a header key starts its line, a property value never does.
std::size_t countLinesStartingWith(const std::string& text, const std::string& prefix) {
    std::size_t count = 0;
    std::size_t pos = 0;
    while (pos < text.size()) {
        if (text.compare(pos, prefix.size(), prefix) == 0) {
            ++count;
        }
        const std::size_t lf = text.find('\n', pos);
        if (lf == std::string::npos) {
            break;
        }
        pos = lf + 1;
    }
    return count;
}

// A kernel on a fresh file whose clock the test keeps a handle to, so the
// wall clock can be moved — forwards or backwards — between commits.
std::unique_ptr<Kernel> createWithClock(const std::string& path, const char* world, FixedClock*& clock) {
    auto owned = std::make_unique<FixedClock>();
    clock = owned.get();
    clock->at = *RecordedAt::parse(kClockStamp);
    auto created = Kernel::create(path, world, std::move(owned));
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    return std::move(created.value());
}

} // namespace

TEST_SUITE("kernel") {

TEST_CASE("kernel: create a node, commit durably, reopen from disk, read it back") {
    const std::string path = tracerPath();
    std::remove(path.c_str());

    CommitResult committed;
    {
        auto created = Kernel::create(path, "tracer", fixedClock("2026-09-08T21:15:07Z"));
        REQUIRE_MESSAGE(created.ok(), detailOf(created));
        std::unique_ptr<Kernel> kernel = std::move(created.value());
        CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
        CHECK(kernel->world().nodeCount() == 0);

        auto submitted = kernel->submit(firstNote());
        REQUIRE_MESSAGE(submitted.ok(), detailOf(submitted));
        committed = submitted.value();
        CHECK(committed.seq == 1);
        REQUIRE(committed.nodeIds.size() == 1);
        CHECK(committed.nodeIds[0] == NodeId{1});
        CHECK(committed.edgeIds.empty());
        CHECK(committed.digest.hex.size() == 64);

        CHECK(kernel->world().nodeCount() == 1);
        checkTracerNode(kernel->world().node(NodeId{1}));
        CHECK(kernel->journal().commitCount() == 1);
        CHECK(kernel->journal().lastSeq() == 1);
        CHECK(kernel->journal().lastDigest() == committed.digest);
        CHECK(kernel->journal().verifiedBytes() == static_cast<std::uint64_t>(fileSize(path)));
    }

    // A fresh kernel, from the bytes on disk alone.
    auto reopened = Kernel::open(path, OpenPolicy::Existing);
    REQUIRE_MESSAGE(reopened.ok(), detailOf(reopened));
    const std::unique_ptr<Kernel>& kernel = reopened.value();
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    CHECK(kernel->journal().commitCount() == 1);
    CHECK(kernel->journal().header().world == "tracer");
    CHECK(kernel->journal().header().created.rfc3339Z() == "2026-09-08T21:15:07Z");
    CHECK(kernel->journal().lastDigest() == committed.digest);
    CHECK(kernel->world().nodeCount() == 1);
    checkTracerNode(kernel->world().node(NodeId{1}));
    CHECK(kernel->world().nextNodeId() == NodeId{2});
    CHECK(kernel->world().tick() == 0);

    // The journal is readable text.
    const std::string text = readFile(path);
    for (const char* needle : {"@tree 1 ", "world tracer\n", "created 2026-09-08T21:15:07Z\n", "@commit 1 ",
             "parent sha256:", "branch main\n", "recorded 2026-09-08T21:15:07Z\n", "tick 0\n",
             "actor human kaelen\n", "message \"first note\"\n", "create-node n1 tapestry.notes/note@1\n",
             "set n1 title text \"Sam\"\n", "set n1 body text <<TEXT\n",
             "Loves architecture and weird bird memes.\n", "@end sha256:"}) {
        CHECK_MESSAGE(text.find(needle) != std::string::npos, needle);
    }
    CHECK(text.find("set n1 body text <<TEXT\nMet Sam at dinner.\nLoves architecture and weird bird memes.\nTEXT\n")
        != std::string::npos);
    CHECK(text.find("\\n") == std::string::npos);

    // The digest chain, recomputed from the bytes as written.
    const std::string headerBytes = countedBytesAt(text, 0);
    const std::string headerEnd = "@end sha256:" + sha256(headerBytes).hex + "\n";
    CHECK(text.compare(headerBytes.size(), headerEnd.size(), headerEnd) == 0);

    const std::size_t commitStart = headerBytes.size() + headerEnd.size();
    CHECK(text.compare(commitStart, 10, "@commit 1 ") == 0);
    const std::string commitBytes = countedBytesAt(text, commitStart);
    CHECK(commitBytes.find("parent sha256:" + sha256(headerBytes).hex + "\n") != std::string::npos);
    const std::string commitEnd = "@end sha256:" + sha256(commitBytes).hex + "\n";
    CHECK(text.compare(commitStart + commitBytes.size(), commitEnd.size(), commitEnd) == 0);
    CHECK(commitStart + commitBytes.size() + commitEnd.size() == text.size());
    CHECK(sha256(commitBytes) == committed.digest);
    // The file stays on disk for the verify step to print.
}

TEST_CASE("kernel: a rejected proposal writes nothing and leaves the world untouched") {
    const std::string path = scratchPath("rejected");
    auto created = Kernel::create(path, "rejected", fixedClock("2026-09-08T21:15:07Z"));
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    std::unique_ptr<Kernel> kernel = std::move(created.value());
    REQUIRE(kernel->submit(firstNote()).ok());

    const long sizeBefore = fileSize(path);
    const std::string bytesBefore = readFile(path);
    REQUIRE(sizeBefore > 0);

    const auto expectRejected = [&](const Proposal& proposal, Rejection::Kind kind) {
        auto result = kernel->submit(proposal);
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().kind == kind);
        CHECK(fileSize(path) == sizeBefore);
        CHECK(readFile(path) == bytesBefore);
        CHECK(kernel->world().nodeCount() == 1);
        CHECK(kernel->journal().commitCount() == 1);
        CHECK(kernel->journal().lastSeq() == 1);
    };

    Proposal missingTarget;
    missingTarget.actor = Actor{"human", "kaelen"};
    missingTarget.ops.push_back(SetProperty{NodeId{9}, "title", Value::ofText("nobody")});
    expectRejected(missingTarget, Rejection::Kind::UnknownTarget);

    // A rejection mid-proposal discards the accepted ops before it too.
    Proposal partlyGood;
    partlyGood.actor = Actor{"human", "kaelen"};
    partlyGood.ops.push_back(SetProperty{NodeId{1}, "title", Value::ofText("changed")});
    partlyGood.ops.push_back(SetProperty{NodeId{1}, "friend", Value::ofRef("n5")});
    expectRejected(partlyGood, Rejection::Kind::RefMissing);
    CHECK(kernel->world().node(NodeId{1})->props.at("title") == Value::ofText("Sam"));

    Proposal badKey;
    badKey.actor = Actor{"human", "kaelen"};
    badKey.ops.push_back(SetProperty{NodeId{1}, "9lives", Value::ofInt(9)});
    expectRejected(badKey, Rejection::Kind::BadKey);

    Proposal badActor;
    badActor.actor = Actor{"robot", "kaelen"};
    badActor.ops.push_back(SetProperty{NodeId{1}, "title", Value::ofText("x")});
    expectRejected(badActor, Rejection::Kind::BadActor);

    Proposal longActor = proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("x")}});
    longActor.actor.id.assign(tree::kMaxLineBytes + 1, 'a');
    expectRejected(longActor, Rejection::Kind::BadActor);

    Proposal longMessage = proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("x")}});
    longMessage.message.assign(tree::kMaxLineBytes + 1, 'm');
    expectRejected(longMessage, Rejection::Kind::BadValue);

    Proposal longType = proposalOf({CreateNode{NodeId{}, std::string(tree::kMaxLineBytes + 1, 't'), {}}});
    expectRejected(longType, Rejection::Kind::BadType);

    std::string oversizedBody;
    oversizedBody.reserve(tree::kMaxRecordBytes + 128);
    const std::string line(tree::kMaxLineBytes, 'x');
    while (oversizedBody.size() <= tree::kMaxRecordBytes) {
        if (!oversizedBody.empty()) {
            oversizedBody += '\n';
        }
        oversizedBody += line;
    }
    Proposal longRecord = proposalOf({SetProperty{NodeId{1}, "body", Value::ofText(std::move(oversizedBody))}});
    expectRejected(longRecord, Rejection::Kind::BadValue);

    Proposal badTime;
    badTime.actor = Actor{"plugin", "tapestry.timeline"};
    badTime.ops.push_back(SetProperty{NodeId{1}, "event", Value::ofTime("yesterday")});
    expectRejected(badTime, Rejection::Kind::BadValue);

    // The kernel is still usable afterwards.
    Proposal good;
    good.actor = Actor{"human", "kaelen"};
    good.ops.push_back(SetProperty{NodeId{1}, "event", Value::ofTime("2026-09-07")});
    auto accepted = kernel->submit(good);
    REQUIRE_MESSAGE(accepted.ok(), detailOf(accepted));
    CHECK(accepted.value().seq == 2);
    CHECK(fileSize(path) > sizeBefore);
    CHECK(kernel->world().node(NodeId{1})->props.at("event") == Value::ofTime("2026-09-07"));
    std::remove(path.c_str());
}

TEST_CASE("kernel: every submit writes once then syncs once before returning") {
    auto owned = std::make_unique<RecordingSink>();
    RecordingSink* sink = owned.get();
    auto created = Kernel::createWithSink(std::move(owned), "recorded", fixedClock("2026-09-08T21:15:07Z"));
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    std::unique_ptr<Kernel> kernel = std::move(created.value());
    CHECK(sink->calls == std::vector<std::string>{"w", "s"});

    auto submitted = kernel->submit(firstNote());
    REQUIRE_MESSAGE(submitted.ok(), detailOf(submitted));
    CHECK(sink->calls == std::vector<std::string>{"w", "s", "w", "s"});

    // What went through the sink is a journal the decoder accepts.
    auto header = tapestry::kernel::tree::decodeHeader(sink->data);
    REQUIRE_MESSAGE(header.ok(), detailOf(header));
    CHECK(header.value().record.world == "recorded");
    auto commit = tapestry::kernel::tree::decodeCommit(sink->data, header.value().end, header.value().digest, 1, 0);
    REQUIRE_MESSAGE(commit.ok(), detailOf(commit));
    CHECK(commit.value().end == sink->data.size());
    CHECK(commit.value().digest == submitted.value().digest);
    CHECK(commit.value().record.actor.kind == "human");
    CHECK(commit.value().record.actor.id == "kaelen");
    CHECK(commit.value().record.message == "first note");
    // create-node plus one set per property, decoded in file order.
    REQUIRE(commit.value().record.ops.size() == 3);
    const auto* create = std::get_if<CreateNode>(&commit.value().record.ops[0]);
    REQUIRE(create != nullptr);
    CHECK(create->id == NodeId{1});
    CHECK(create->type == kTracerType);

    // A rejected proposal never reaches the sink.
    Proposal bad;
    bad.actor = Actor{"human", "kaelen"};
    bad.ops.push_back(SetProperty{NodeId{9}, "title", Value::ofText("nobody")});
    CHECK_FALSE(kernel->submit(bad).ok());
    CHECK(sink->calls.size() == 4);
}

TEST_CASE("kernel: a failed sync is reported as Io and applies nothing") {
    auto owned = std::make_unique<RecordingSink>();
    RecordingSink* sink = owned.get();
    auto created = Kernel::createWithSink(std::move(owned), "unsynced", fixedClock("2026-09-08T21:15:07Z"));
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    std::unique_ptr<Kernel> kernel = std::move(created.value());
    const std::size_t headerBytes = sink->data.size();

    sink->failSync = true;
    auto result = kernel->submit(firstNote());
    REQUIRE_FALSE(result.ok());
    CHECK(result.error().kind == Rejection::Kind::Io);
    CHECK(sink->calls == std::vector<std::string>{"w", "s", "w", "s"});
    // The bytes were written but never acknowledged: nothing moved.
    CHECK(sink->data.size() > headerBytes);
    CHECK(kernel->world().nodeCount() == 0);
    CHECK(kernel->world().nextNodeId() == NodeId{1});
    CHECK(kernel->journal().commitCount() == 0);
    CHECK(kernel->journal().lastSeq() == 0);
    CHECK(kernel->journal().verifiedBytes() == headerBytes);
}

TEST_CASE("kernel: opening a missing path reports Missing and a foreign file reports NotATree") {
    const std::string missing = scratchPath("missing");
    for (const OpenPolicy policy : {OpenPolicy::Existing, OpenPolicy::ReadOnly}) {
        auto result = Kernel::open(missing, policy);
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().kind == OpenFailure::Kind::Missing);
        CHECK_FALSE(fileExists(missing));
    }

    const std::string foreign = scratchPath("foreign");
    const std::string contents = "definitely not a tapestry tree\n";
    writeFile(foreign, contents);
    for (const OpenPolicy policy : {OpenPolicy::Existing, OpenPolicy::ReadOnly}) {
        auto result = Kernel::open(foreign, policy);
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().kind == OpenFailure::Kind::NotATree);
        CHECK(readFile(foreign) == contents);
    }

    const std::string empty = scratchPath("empty");
    writeFile(empty, "");
    auto result = Kernel::open(empty, OpenPolicy::Existing);
    REQUIRE_FALSE(result.ok());
    CHECK(result.error().kind == OpenFailure::Kind::NotATree);
    CHECK(fileSize(empty) == 0);

    std::remove(foreign.c_str());
    std::remove(empty.c_str());
}

TEST_CASE("kernel: an unknown node type loads with readable typed fallback values") {
    const std::string path = scratchPath("unknown-type");
    const char* const type = "acme.widgets/gizmo@7"; // no kernel source knows this type
    const char* const body = "A gizmo.\nIt has three lines of description.\nNobody in the kernel knows what it is.";
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "widgets");
        CreateNode gizmo;
        gizmo.type = type;
        gizmo.props["title"] = Value::ofText("Gizmo");
        gizmo.props["body"] = Value::ofText(body);
        gizmo.props["anger"] = Value::ofInt(3);
        gizmo.props["position.x"] = Value::ofReal(12.5);
        gizmo.props["position.y"] = Value::ofReal(-3);
        gizmo.props["pinned"] = Value::ofBool(true);
        gizmo.props["event"] = Value::ofTime("2026-09-07");
        const CommitResult committed = submitOk(*kernel, proposalOf({gizmo}, "a widget"));
        REQUIRE(committed.nodeIds.size() == 1);
        CHECK(committed.nodeIds[0] == NodeId{1});
    }

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    REQUIRE(kernel->world().nodeCount() == 1);
    const Node* node = kernel->world().node(NodeId{1});
    REQUIRE(node != nullptr);
    CHECK(node->id == NodeId{1});
    CHECK(node->type == type);
    REQUIRE(node->props.size() == 7);
    CHECK(node->props.at("title") == Value::ofText("Gizmo"));
    CHECK(node->props.at("body") == Value::ofText(body));
    CHECK(node->props.at("anger") == Value::ofInt(3));
    CHECK(node->props.at("position.x") == Value::ofReal(12.5));
    CHECK(node->props.at("position.y") == Value::ofReal(-3));
    CHECK(node->props.at("pinned") == Value::ofBool(true));
    CHECK(node->props.at("event") == Value::ofTime("2026-09-07"));

    // Every value has a readable fallback form without any plugin present.
    CHECK(formatInline(node->props.at("title")) == "\"Gizmo\"");
    CHECK(formatInline(node->props.at("anger")) == "3");
    CHECK(formatInline(node->props.at("position.x")) == "12.5");
    CHECK(formatInline(node->props.at("position.y")) == "-3");
    CHECK(formatInline(node->props.at("pinned")) == "true");
    CHECK(formatInline(node->props.at("event")) == "2026-09-07");

    // And the file says the same, in plain lines.
    const std::string text = readFile(path);
    for (const char* needle : {"create-node n1 acme.widgets/gizmo@7\n", "set n1 anger int 3\n",
             "set n1 body text <<TEXT\nA gizmo.\nIt has three lines of description.\nNobody in the kernel knows what it is.\nTEXT\n",
             "set n1 event time 2026-09-07\n", "set n1 pinned bool true\n", "set n1 position.x real 12.5\n",
             "set n1 position.y real -3\n", "set n1 title text \"Gizmo\"\n"}) {
        CHECK_MESSAGE(text.find(needle) != std::string::npos, needle);
    }
    std::remove(path.c_str());
}

TEST_CASE("kernel: ids are stable across reopen and never reused after delete") {
    const std::string path = scratchPath("ids");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "ids");
        const CommitResult created = submitOk(*kernel,
            proposalOf({CreateNode{NodeId{}, "example.people/person@1", {{"name", Value::ofText("Sam")}}},
                           CreateNode{NodeId{}, "example.people/person@1", {{"name", Value::ofText("Alex")}}},
                           CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "knows", {}}},
                "two people"));
        CHECK(created.nodeIds == std::vector<NodeId>{NodeId{1}, NodeId{2}});
        CHECK(created.edgeIds == std::vector<EdgeId>{EdgeId{1}});
        CHECK(kernel->world().edgeCount() == 1);

        submitOk(*kernel, proposalOf({DeleteNode{NodeId{2}}}, "Alex leaves"));
        CHECK(kernel->world().node(NodeId{2}) == nullptr);
        CHECK(kernel->world().edge(EdgeId{1}) == nullptr);
        CHECK(kernel->world().wasDeleted(NodeId{2}));
        CHECK(kernel->world().wasDeleted(EdgeId{1}));
    }

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::Existing);
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    CHECK(kernel->journal().commitCount() == 2);
    REQUIRE(kernel->world().node(NodeId{1}) != nullptr);
    CHECK(kernel->world().node(NodeId{1})->props.at("name") == Value::ofText("Sam"));
    CHECK(kernel->world().node(NodeId{2}) == nullptr);
    CHECK(kernel->world().edge(EdgeId{1}) == nullptr);
    CHECK(kernel->world().nodeCount() == 1);
    CHECK(kernel->world().edgeCount() == 0);
    CHECK(kernel->world().wasDeleted(NodeId{2}));
    CHECK(kernel->world().wasDeleted(EdgeId{1}));
    CHECK_FALSE(kernel->world().wasDeleted(NodeId{1}));
    CHECK(kernel->world().nextNodeId() == NodeId{3});
    CHECK(kernel->world().nextEdgeId() == EdgeId{2});

    // New ids continue above every id ever used; the deleted ones stay dead.
    const CommitResult third = submitOk(*kernel,
        proposalOf({CreateNode{NodeId{}, "example.people/person@1", {{"name", Value::ofText("Kim")}}}}, "Kim"));
    CHECK(third.nodeIds == std::vector<NodeId>{NodeId{3}});
    const CommitResult link = submitOk(*kernel, proposalOf({CreateEdge{EdgeId{}, NodeId{1}, NodeId{3}, "knows", {}}}));
    CHECK(link.edgeIds == std::vector<EdgeId>{EdgeId{2}});
    const Edge* e2 = kernel->world().edge(EdgeId{2});
    REQUIRE(e2 != nullptr);
    CHECK(e2->from == NodeId{1});
    CHECK(e2->to == NodeId{3});

    auto onDeleted = kernel->submit(proposalOf({SetProperty{NodeId{2}, "name", Value::ofText("ghost")}}));
    REQUIRE_FALSE(onDeleted.ok());
    CHECK(onDeleted.error().kind == Rejection::Kind::UnknownTarget);
    auto toDeleted = kernel->submit(proposalOf({CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "knows", {}}}));
    REQUIRE_FALSE(toDeleted.ok());
    CHECK(toDeleted.error().kind == Rejection::Kind::RefMissing);
    auto refDeleted = kernel->submit(proposalOf({SetProperty{NodeId{1}, "friend", Value::ofRef(NodeId{2})}}));
    REQUIRE_FALSE(refDeleted.ok());
    CHECK(refDeleted.error().kind == Rejection::Kind::RefMissing);

    const std::string text = readFile(path);
    for (const char* needle : {"create-edge e1 n1 n2 knows\n", "delete-node n2\n", "create-node n3 ",
             "create-edge e2 n1 n3 knows\n"}) {
        CHECK_MESSAGE(text.find(needle) != std::string::npos, needle);
    }
    std::remove(path.c_str());
}

TEST_CASE("kernel: x- extension lines survive reopen verbatim and in order") {
    const std::string path = scratchPath("extension");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "extension");
        submitOk(*kernel, firstNote());
        submitOk(*kernel, proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("Sam again")}}, "rename"));
    }

    // Plant two plugin-owned lines in commit 2, re-sealed by the same codec.
    std::string bytes = readFile(path);
    const std::vector<tree::DecodedCommit> commits = decodeAll(bytes);
    REQUIRE(commits.size() == 2);
    CommitRecord edited = commits[1].record;
    edited.extensionLines = {"x-example.people mood curious", "x-acme.widgets flag 1"};
    bytes = withRecordReplaced(bytes, commits[1], tree::encodeCommit(edited).bytes);
    writeFile(path, bytes);

    {
        std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::Existing);
        CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
        REQUIRE(kernel->journal().commitCount() == 2);
        CHECK(kernel->journal().commits()[0].extensionLines.empty());
        CHECK(kernel->journal().commits()[1].extensionLines
            == std::vector<std::string>{"x-example.people mood curious", "x-acme.widgets flag 1"});
        CHECK(kernel->world().node(NodeId{1})->props.at("title") == Value::ofText("Sam again"));
        // The kernel keeps working on top of lines it does not understand.
        CHECK(submitOk(*kernel, proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("Sam once more")}})).seq == 3);
    }

    const std::string text = readFile(path);
    CHECK(text.find("set n1 title text \"Sam again\"\nx-example.people mood curious\nx-acme.widgets flag 1\n@end sha256:")
        != std::string::npos);
    std::unique_ptr<Kernel> again = openOk(path, OpenPolicy::ReadOnly);
    CHECK(again->status().kind == JournalStatus::Kind::Ok);
    REQUIRE(again->journal().commitCount() == 3);
    CHECK(again->journal().commits()[1].extensionLines
        == std::vector<std::string>{"x-example.people mood curious", "x-acme.widgets flag 1"});
    std::remove(path.c_str());
}

TEST_CASE("kernel: an unsupported op verb stops the load with the verb and seq named") {
    const std::string path = scratchPath("frobnicate");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "frobnicate");
        submitOk(*kernel, firstNote());
        submitOk(*kernel, proposalOf({CreateNode{NodeId{}, kTracerType, {{"title", Value::ofText("second")}}}}, "second"));
        CHECK(kernel->world().nodeCount() == 2);
    }

    // A verb a newer Tapestry might write, planted in commit 2 and re-sealed
    // by hand so only the grammar, not the digest, is at fault.
    std::string bytes = readFile(path);
    const std::vector<tree::DecodedCommit> commits = decodeAll(bytes);
    REQUIRE(commits.size() == 2);
    bytes = withRecordReplaced(bytes, commits[1], frame(2, bodyOf(bytes, commits[1]) + "frobnicate n1 7\n"));
    writeFile(path, bytes);

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
    const JournalStatus& status = kernel->status();
    CHECK(status.kind == JournalStatus::Kind::Corrupt);
    CHECK_MESSAGE(status.reason.find("frobnicate") != std::string::npos, status.reason);
    CHECK_MESSAGE(status.reason.find("commit 2") != std::string::npos, status.reason);
    CHECK(status.lastGoodSeq == 1);
    CHECK(status.offset == bytes.find("frobnicate n1 7\n"));
    // Only the verified prefix is loaded: commit 1's node, not commit 2's.
    CHECK(kernel->journal().commitCount() == 1);
    CHECK(kernel->world().nodeCount() == 1);
    checkTracerNode(kernel->world().node(NodeId{1}));
    CHECK(kernel->world().node(NodeId{2}) == nullptr);

    auto refused = kernel->submit(proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("no")}}));
    REQUIRE_FALSE(refused.ok());
    CHECK(refused.error().kind == Rejection::Kind::JournalNotClean);
    CHECK(readFile(path) == bytes);
    std::remove(path.c_str());
}

TEST_CASE("kernel: apply-level corruption rolls the journal back to the applied prefix") {
    const std::string path = scratchPath("apply-corrupt");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "apply-corrupt");
        submitOk(*kernel, firstNote());
        submitOk(*kernel,
            proposalOf({CreateNode{NodeId{}, kTracerType, {{"title", Value::ofText("second")}}}}, "second"));
    }

    const std::string original = readFile(path);
    const std::vector<tree::DecodedCommit> commits = decodeAll(original);
    REQUIRE(commits.size() == 2);
    CommitRecord first = commits[0].record;
    std::get<CreateNode>(first.ops[0]).id = NodeId{5};
    const tree::Encoded encodedFirst = tree::encodeCommit(first);
    CommitRecord second = commits[1].record;
    second.parent = encodedFirst.digest;
    const tree::Encoded encodedSecond = tree::encodeCommit(second);
    const std::string corrupted = original.substr(0, commits[0].begin) + encodedFirst.bytes + encodedSecond.bytes;
    writeFile(path, corrupted);

    const std::string copy = scratchPath("apply-corrupt-copy");
    {
        std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
        const JournalStatus& status = kernel->status();
        REQUIRE(status.kind == JournalStatus::Kind::Corrupt);
        CHECK(status.lastGoodSeq == 0);
        CHECK(kernel->journal().commitCount() == status.lastGoodSeq);
        CHECK(kernel->journal().lastSeq() == status.lastGoodSeq);
        CHECK(kernel->journal().verifiedBytes() == status.offset);
        CHECK(kernel->world().nodeCount() == 0);
        CHECK_MESSAGE(!kernel->saveAs(copy).has_value(), "save-as should copy the applied prefix");
    }
    {
        std::unique_ptr<Kernel> saved = openOk(copy, OpenPolicy::ReadOnly);
        CHECK(saved->status().kind == JournalStatus::Kind::Ok);
        CHECK(saved->journal().commitCount() == 0);
        CHECK(saved->world().nodeCount() == 0);
    }
    std::remove(path.c_str());
    std::remove(copy.c_str());
}

TEST_CASE("kernel: tick lines follow advance") {
    const std::string path = scratchPath("ticks");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "ticks");
        submitOk(*kernel, firstNote());
        CHECK(kernel->world().tick() == 0);
        submitOk(*kernel, proposalOf({Advance{3}}, "three ticks"));
        CHECK(kernel->world().tick() == 3);
        submitOk(*kernel, proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("later")}}, "at tick 3"));
    }

    std::string bytes = readFile(path);
    const std::vector<tree::DecodedCommit> commits = decodeAll(bytes);
    REQUIRE(commits.size() == 3);
    CHECK(commits[0].record.tick == 0);
    CHECK(commits[1].record.tick == 0); // the commit carrying the advance applies before it
    CHECK(commits[2].record.tick == 3);
    CHECK(bodyOf(bytes, commits[1]).find("tick 0\n") != std::string::npos);
    CHECK(bodyOf(bytes, commits[1]).find("advance 3\n") != std::string::npos);
    CHECK(bodyOf(bytes, commits[2]).find("tick 3\n") != std::string::npos);
    {
        std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
        CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
        CHECK(kernel->world().tick() == 3);
        CHECK(kernel->journal().commits()[2].tick == 3);
    }

    // A tick line that disagrees with the replayed world is corruption of
    // the history, even with a valid digest.
    std::string body = bodyOf(bytes, commits[2]);
    const std::size_t tickLine = body.find("tick 3\n");
    REQUIRE(tickLine != std::string::npos);
    body.replace(tickLine, 7, "tick 2\n");
    writeFile(path, withRecordReplaced(bytes, commits[2], frame(3, body)));

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
    CHECK(kernel->status().kind == JournalStatus::Kind::Corrupt);
    CHECK_MESSAGE(kernel->status().reason.find("TickMismatch") != std::string::npos, kernel->status().reason);
    CHECK(kernel->status().lastGoodSeq == 2);
    CHECK(kernel->journal().commitCount() == 2);
    CHECK(kernel->world().tick() == 3);
    CHECK(kernel->world().node(NodeId{1})->props.at("title") == Value::ofText("Sam"));
    std::remove(path.c_str());
}

TEST_CASE("kernel: text is bytes — non-ASCII round-trips and the byte count is UTF-8 length") {
    const std::string path = scratchPath("utf8");
    const std::string title = "café ☕"; // 6 code points, 9 bytes
    REQUIRE(title.size() == 9);
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "utf8");
        submitOk(*kernel,
            proposalOf({CreateNode{NodeId{}, kTracerType, {{"title", Value::ofText(title)}}}}, "a hot drink"));
    }

    const std::string bytes = readFile(path);
    CHECK(bytes.find("set n1 title text \"" + title + "\"\n") != std::string::npos);
    CHECK(bytes.find("\\u") == std::string::npos);

    // The counted body is exactly these bytes, and the count is their
    // UTF-8 length — not a character count, not a normalized form.
    auto header = tree::decodeHeader(bytes);
    REQUIRE_MESSAGE(header.ok(), detailOf(header));
    const std::string body = "parent sha256:" + header.value().digest.hex + "\nbranch main\nrecorded " + kClockStamp
        + "\ntick 0\nactor human kaelen\nmessage \"a hot drink\"\ncreate-node n1 " + kTracerType
        + "\nset n1 title text \"" + title + "\"\n";
    const std::string head = "@commit 1 " + std::to_string(body.size()) + "\n";
    const std::size_t begin = header.value().end;
    CHECK(bytes.compare(begin, head.size(), head) == 0);
    CHECK(bytes.compare(begin + head.size(), body.size(), body) == 0);
    CHECK(bytes.size() == begin + head.size() + body.size() + kEndLineBytes);

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    REQUIRE(kernel->world().node(NodeId{1}) != nullptr);
    CHECK(kernel->world().node(NodeId{1})->props.at("title") == Value::ofText(title));
    CHECK(kernel->world().node(NodeId{1})->props.at("title").text.size() == 9);
    std::remove(path.c_str());
}

// --- TREE-04: three kinds of time, three names, three places ------------
//
// `recorded` (commit header, wall clock, audit only), `tick` (commit header,
// the simulation step a commit applies at) and `event` (a time-typed node
// property a person or plugin sets) must be tellable apart by name and place
// alone, a correction must keep the earlier value in its earlier record, and
// the wall clock must never decide the order of history.

TEST_CASE("kernel: three kinds of time are distinguishable and a correction keeps both values") {
    const std::string path = scratchPath("three-times");
    {
        FixedClock* clock = nullptr;
        std::unique_ptr<Kernel> kernel = createWithClock(path, "times", clock);
        const CommitResult first = submitOk(*kernel,
            proposalOf({CreateNode{NodeId{}, kTracerType,
                           {{"title", Value::ofText("Sam")}, {"event", Value::ofTime("2026-09-07")}}}},
                "first note"));
        CHECK(first.seq == 1);

        // A minute later: the dinner was the day before. A correction is a
        // new commit under its own stamp, not an edit of the old record.
        clock->at = *RecordedAt::parse("2026-09-08T21:16:07Z");
        const CommitResult correction = submitOk(*kernel,
            proposalOf({SetProperty{NodeId{1}, "event", Value::ofTime("2026-09-06")}}, "corrected dinner date"));
        CHECK(correction.seq == 2);
        CHECK(kernel->world().node(NodeId{1})->props.at("event") == Value::ofTime("2026-09-06"));
    }

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    REQUIRE(kernel->journal().commitCount() == 2);
    const Node* node = kernel->world().node(NodeId{1});
    REQUIRE(node != nullptr);
    CHECK(node->props.at("event") == Value::ofTime("2026-09-06"));
    CHECK(kernel->journal().commits()[0].recorded.rfc3339Z() == "2026-09-08T21:15:07Z");
    CHECK(kernel->journal().commits()[1].recorded.rfc3339Z() == "2026-09-08T21:16:07Z");
    CHECK(kernel->journal().commits()[1].message == "corrected dinner date");
    CHECK(kernel->journal().commits()[0].tick == 0);
    CHECK(kernel->journal().commits()[1].tick == 0);

    // Both values are in the file: the correction erased nothing.
    const std::string text = readFile(path);
    for (const char* needle : {"set n1 event time 2026-09-07\n", "set n1 event time 2026-09-06\n",
             "recorded 2026-09-08T21:15:07Z\n", "recorded 2026-09-08T21:16:07Z\n",
             "message \"corrected dinner date\"\n"}) {
        CHECK_MESSAGE(text.find(needle) != std::string::npos, needle);
    }
    // The original sits under the earlier stamp, the correction under the
    // later one, in file order.
    const std::size_t firstStamp = text.find("recorded 2026-09-08T21:15:07Z\n");
    const std::size_t original = text.find("set n1 event time 2026-09-07\n");
    const std::size_t secondStamp = text.find("recorded 2026-09-08T21:16:07Z\n");
    const std::size_t corrected = text.find("set n1 event time 2026-09-06\n");
    CHECK(firstStamp < original);
    CHECK(original < secondStamp);
    CHECK(secondStamp < corrected);

    // Three names, three places. Header keys start their line, once per
    // commit; the event is the value of a `set … event time …` line and
    // never starts a line; the header names never appear inside a set line.
    CHECK(countLinesStartingWith(text, "recorded ") == 2);
    CHECK(countLinesStartingWith(text, "tick 0\n") == 2);
    CHECK(countLinesStartingWith(text, "tick ") == 2);
    CHECK(countLinesStartingWith(text, "set n1 event time ") == 2);
    CHECK(countLinesStartingWith(text, "event") == 0);
    CHECK(text.find(" recorded") == std::string::npos);
    CHECK(text.find(" tick") == std::string::npos);
    std::remove(path.c_str());
}

TEST_CASE("kernel: recorded is audit-only and never orders history") {
    const std::string path = scratchPath("clock-back");
    CommitResult first;
    CommitResult second;
    {
        FixedClock* clock = nullptr;
        std::unique_ptr<Kernel> kernel = createWithClock(path, "clock", clock);
        first = submitOk(*kernel, firstNote());
        CHECK(first.seq == 1);

        // The wall clock steps backwards (an NTP correction, a wrong zone, a
        // laptop waking up). History still moves forward by seq and parent.
        clock->at = *RecordedAt::parse("2026-09-08T20:00:00Z");
        second = submitOk(*kernel,
            proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("Sam, again")}}, "later by seq, earlier by clock"));
        CHECK(second.seq == 2);
    }

    const std::string text = readFile(path);
    const std::size_t firstStamp = text.find("recorded 2026-09-08T21:15:07Z\n");
    const std::size_t secondStamp = text.find("recorded 2026-09-08T20:00:00Z\n");
    REQUIRE(firstStamp != std::string::npos);
    REQUIRE(secondStamp != std::string::npos);
    CHECK(countLinesStartingWith(text, "recorded ") == 2);
    // The second record's stamp is the earlier one, and it is still second.
    CHECK(text.find("@commit 1 ") < firstStamp);
    CHECK(firstStamp < text.find("@commit 2 "));
    CHECK(text.find("@commit 2 ") < secondStamp);

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::ReadOnly);
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    REQUIRE(kernel->journal().commitCount() == 2);
    const std::vector<CommitRecord>& commits = kernel->journal().commits();
    CHECK(commits[0].seq == 1);
    CHECK(commits[1].seq == 2);
    CHECK(commits[0].recorded.unixSeconds > commits[1].recorded.unixSeconds);
    CHECK(commits[1].parent == first.digest);
    CHECK(kernel->journal().lastDigest() == second.digest);
    CHECK(kernel->world().node(NodeId{1})->props.at("title") == Value::ofText("Sam, again"));

    // The same chain, re-derived with the pure codec: commit 2's parent is
    // commit 1's digest whatever the clocks said.
    const std::vector<tree::DecodedCommit> decoded = decodeAll(text);
    REQUIRE(decoded.size() == 2);
    CHECK(decoded[0].digest == first.digest);
    CHECK(decoded[1].record.parent == decoded[0].digest);
    CHECK(decoded[1].digest == second.digest);
    std::remove(path.c_str());
}

TEST_CASE("kernel: tick changes only through advance and appears in the header") {
    const std::string path = scratchPath("tick-header");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "ticking");
        submitOk(*kernel, firstNote());
        submitOk(*kernel, proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("Sam")}}, "still tick 0"));
        CHECK(kernel->world().tick() == 0);
        submitOk(*kernel, proposalOf({Advance{3}}, "advance simulation"));
        CHECK(kernel->world().tick() == 3);
        submitOk(*kernel, proposalOf({SetProperty{NodeId{1}, "title", Value::ofText("Sam at 3")}}, "at tick 3"));
    }

    std::string bytes = readFile(path);
    std::vector<tree::DecodedCommit> commits = decodeAll(bytes);
    REQUIRE(commits.size() == 4);
    CHECK(commits[0].record.tick == 0);
    CHECK(commits[1].record.tick == 0);
    CHECK(commits[2].record.tick == 0); // the advance itself applies at the old tick
    CHECK(commits[3].record.tick == 3);
    CHECK(bodyOf(bytes, commits[2]).find("advance 3\n") != std::string::npos);
    CHECK(bodyOf(bytes, commits[3]).find("tick 3\n") != std::string::npos);
    CHECK(countLinesStartingWith(bytes, "tick 0\n") == 3);
    CHECK(countLinesStartingWith(bytes, "tick 3\n") == 1);
    CHECK(countLinesStartingWith(bytes, "advance ") == 1);
    // Nothing but advance moved the tick: two edits, no tick change.
    CHECK(countLinesStartingWith(bytes, "tick ") == 4);

    std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::Existing);
    CHECK(kernel->status().kind == JournalStatus::Kind::Ok);
    CHECK(kernel->world().tick() == 3);
    CHECK(kernel->journal().commits()[3].tick == 3);

    // One commit that both advances and edits applies at the header tick —
    // the tick before its own advance — and leaves the world two ticks on.
    const CommitResult mixed = submitOk(*kernel,
        proposalOf({Advance{2}, SetProperty{NodeId{1}, "title", Value::ofText("Sam at 5")}}, "advance and edit"));
    CHECK(mixed.seq == 5);
    CHECK(kernel->world().tick() == 5);
    CHECK(kernel->journal().commits()[4].tick == 3);
    bytes = readFile(path);
    commits = decodeAll(bytes);
    REQUIRE(commits.size() == 5);
    CHECK(commits[4].record.tick == 3);
    CHECK(bodyOf(bytes, commits[4]).find("tick 3\n") != std::string::npos);
    CHECK(bodyOf(bytes, commits[4]).find("advance 2\n") != std::string::npos);

    std::unique_ptr<Kernel> again = openOk(path, OpenPolicy::ReadOnly);
    CHECK(again->status().kind == JournalStatus::Kind::Ok);
    CHECK(again->world().tick() == 5);
    CHECK(again->journal().commits()[4].tick == 3);
    CHECK(again->world().node(NodeId{1})->props.at("title") == Value::ofText("Sam at 5"));
    std::remove(path.c_str());
}

} // TEST_SUITE("kernel")
