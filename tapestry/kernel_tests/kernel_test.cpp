// The tracer: one node, created through Kernel::submit, appended durably to
// a .tree file, reopened by a fresh kernel and read back with the same id.
// Alongside it, the three properties that make the path trustworthy:
// a rejection changes nothing, every commit is written then synced before
// submit returns, and open() never creates or touches a file it refuses.

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Kernel.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"
#include "kernel/journal/Journal.hpp"
#include "kernel/journal/Sink.hpp"
#include "kernel/tree/Codec.hpp"
#include "kernel_tests/support.hpp"

#include <doctest.h>

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::Clock;
using tapestry::kernel::CommitResult;
using tapestry::kernel::CreateNode;
using tapestry::kernel::Expected;
using tapestry::kernel::FixedClock;
using tapestry::kernel::IoError;
using tapestry::kernel::JournalStatus;
using tapestry::kernel::Kernel;
using tapestry::kernel::Node;
using tapestry::kernel::NodeId;
using tapestry::kernel::OpenFailure;
using tapestry::kernel::OpenPolicy;
using tapestry::kernel::Proposal;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::Rejection;
using tapestry::kernel::SetProperty;
using tapestry::kernel::sha256;
using tapestry::kernel::Sink;
using tapestry::kernel::Value;
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

} // TEST_SUITE("kernel")
