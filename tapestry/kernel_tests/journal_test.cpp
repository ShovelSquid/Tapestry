// The durability story (TREE-03), proven by failure injection rather than by
// trust. A RecordingSink stands in for the disk and can fail a sync or stop
// accepting bytes mid-record; exhaustive sweeps cut a real journal at every
// prefix length and flip every byte, and the kernel under test is the
// production kernel. The promises:
//
//   every commit is written then synced before submit returns;
//   a failed sync or a write that stops mid-record rejects the commit,
//     leaves the world untouched, and leaves the journal refusing appends
//     on top of bytes it could not confirm;
//   open() accepts a prefix exactly at record boundaries, classifies every
//     other cut TornTail with the exact verified prefix loaded, and never
//     accepts a single flipped byte;
//   a torn or corrupt journal refuses appends, a second writer is locked
//     out, a fresh world is only its header, and opening never changes the
//     file.

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
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::Advance;
using tapestry::kernel::Clock;
using tapestry::kernel::CommitRecord;
using tapestry::kernel::CommitResult;
using tapestry::kernel::CreateEdge;
using tapestry::kernel::CreateNode;
using tapestry::kernel::DeleteNode;
using tapestry::kernel::Digest;
using tapestry::kernel::EdgeId;
using tapestry::kernel::Expected;
using tapestry::kernel::FixedClock;
using tapestry::kernel::IoError;
using tapestry::kernel::JournalStatus;
using tapestry::kernel::Kernel;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::OpenFailure;
using tapestry::kernel::OpenPolicy;
using tapestry::kernel::Proposal;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::Rejection;
using tapestry::kernel::SetProperty;
using tapestry::kernel::Sink;
using tapestry::kernel::UnsetProperty;
using tapestry::kernel::Value;
namespace tree = tapestry::kernel::tree;
using tapestry::kernel::test::fileExists;
using tapestry::kernel::test::fileSize;
using tapestry::kernel::test::readFile;
using tapestry::kernel::test::scratchPath;
using tapestry::kernel::test::writeFile;

using Kind = JournalStatus::Kind;

const char* const kStamp = "2026-09-08T21:15:07Z";
const char* const kNoteType = "tapestry.notes/note@1";
const char* const kNoteBody = "Met Sam at dinner.\nLoves architecture and weird bird memes.";
constexpr std::string_view kEndPrefix = "@end sha256:";

// Stands in for the disk. Records the order of write and sync calls and
// keeps every byte written. Two injections model the two ways an append can
// fail short of the medium: failNextSync fails the next sync() once (the
// bytes went out, durability was never confirmed), and failWriteAfter caps
// the total bytes the sink will ever accept — a writeAll that crosses the
// cap keeps the bytes up to it and reports an error, the way a full disk or
// a process killed mid-write leaves a partial record behind. The sink never
// rolls anything back: a real disk cannot.
struct RecordingSink final : Sink {
    std::vector<std::string> calls;
    std::string data;
    bool failNextSync = false;
    std::size_t failWriteAfter = SIZE_MAX;

    std::optional<IoError> writeAll(std::string_view bytes) override {
        calls.emplace_back("w");
        const std::size_t room = failWriteAfter > data.size() ? failWriteAfter - data.size() : 0;
        const std::size_t accepted = std::min(bytes.size(), room);
        data.append(bytes.data(), accepted);
        if (accepted < bytes.size()) {
            return IoError{ENOSPC, "injected write failure"};
        }
        return std::nullopt;
    }
    std::optional<IoError> sync() override {
        calls.emplace_back("s");
        if (failNextSync) {
            failNextSync = false;
            return IoError{EIO, "injected sync failure"};
        }
        return std::nullopt;
    }
    std::uint64_t size() const override { return data.size(); }
};

template <class T, class E>
std::string detailOf(const Expected<T, E>& result) {
    return result.ok() ? std::string("ok") : result.error().detail;
}

std::unique_ptr<Clock> fixedClock(const char* stamp = kStamp) {
    auto clock = std::make_unique<FixedClock>();
    clock->at = *RecordedAt::parse(stamp);
    return clock;
}

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
    auto created = Kernel::create(path, world, fixedClock());
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    return std::move(created.value());
}

std::unique_ptr<Kernel> openOk(const std::string& path, OpenPolicy policy) {
    auto opened = Kernel::open(path, policy, fixedClock());
    REQUIRE_MESSAGE(opened.ok(), detailOf(opened));
    return std::move(opened.value());
}

// The sweep fixtures, in commit order: every op verb, block and inline
// text, every value type, an edge with a property, an advance and a
// cascading delete — so a cut or a flip can land in any line form the
// encoder writes. The node and tick counts each commit leaves behind are
// what a sweep checks the loaded world against.
std::vector<Proposal> fixtureProposals() {
    std::vector<Proposal> out;
    out.push_back(proposalOf({CreateNode{NodeId{}, kNoteType,
                                 {{"title", Value::ofText("Sam")}, {"body", Value::ofText(kNoteBody)},
                                     {"anger", Value::ofInt(3)}, {"position.x", Value::ofReal(12.5)}}}},
        "first note"));
    out.push_back(proposalOf({CreateNode{NodeId{}, "example.people/person@1", {{"name", Value::ofText("Alex")}}},
                                 CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "knows", {{"weight", Value::ofReal(0.5)}}}},
        "Alex"));
    out.push_back(proposalOf({SetProperty{NodeId{1}, "pinned", Value::ofBool(true)},
                                 SetProperty{NodeId{1}, "event", Value::ofTime("2026-09-07")},
                                 UnsetProperty{NodeId{1}, "anger"}},
        "pin and date"));
    out.push_back(proposalOf({Advance{3}}, "three ticks"));
    out.push_back(proposalOf({SetProperty{NodeId{2}, "friend", Value::ofRef(NodeId{1})}, DeleteNode{NodeId{2}}},
        "Alex leaves"));
    return out;
}
constexpr std::size_t kNodesAfter[] = {0, 1, 2, 2, 2, 1};
constexpr std::uint64_t kTickAfter[] = {0, 0, 0, 0, 3, 3};

// A journal at `path` holding the first `commits` fixture proposals, and
// its bytes. The kernel is destroyed before returning so the path is free
// to be opened again.
std::string buildJournal(const std::string& path, std::size_t commits) {
    const std::vector<Proposal> proposals = fixtureProposals();
    REQUIRE(commits <= proposals.size());
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "sweep");
        for (std::size_t i = 0; i < commits; ++i) {
            submitOk(*kernel, proposals[i]);
        }
        CHECK(kernel->world().nodeCount() == kNodesAfter[commits]);
        CHECK(kernel->world().tick() == kTickAfter[commits]);
    }
    return readFile(path);
}

// Record boundaries found from the text alone: the offset just after the
// LF of every line that begins with `@end sha256:`. The header's boundary
// comes first, then one per commit; the last equals the file size.
std::vector<std::size_t> recordBoundaries(const std::string& bytes) {
    std::vector<std::size_t> out;
    std::size_t pos = 0;
    while (pos < bytes.size()) {
        const std::size_t lf = bytes.find('\n', pos);
        if (lf == std::string::npos) {
            break;
        }
        if (bytes.compare(pos, kEndPrefix.size(), kEndPrefix) == 0) {
            out.push_back(lf + 1);
        }
        pos = lf + 1;
    }
    return out;
}

// The index of the record holding byte `offset`: 0 for the header, k for
// commit k.
std::size_t recordHolding(const std::vector<std::size_t>& boundaries, std::size_t offset) {
    return static_cast<std::size_t>(std::upper_bound(boundaries.begin(), boundaries.end(), offset) - boundaries.begin());
}

std::size_t countOf(const std::string& text, std::string_view needle) {
    std::size_t count = 0;
    for (std::size_t pos = text.find(needle); pos != std::string::npos; pos = text.find(needle, pos + needle.size())) {
        ++count;
    }
    return count;
}

// Header plus the first fixture commit through a RecordingSink; the caller
// keeps the raw pointer to inject failures into the next append.
std::unique_ptr<Kernel> kernelWithOneCommit(RecordingSink*& sink) {
    auto owned = std::make_unique<RecordingSink>();
    sink = owned.get();
    auto created = Kernel::createWithSink(std::move(owned), "recorded", fixedClock());
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    std::unique_ptr<Kernel> kernel = std::move(created.value());
    submitOk(*kernel, fixtureProposals()[0]);
    return kernel;
}

} // namespace

TEST_SUITE("journal") {

TEST_CASE("journal: every commit is written then synced before submit returns") {
    auto owned = std::make_unique<RecordingSink>();
    RecordingSink* sink = owned.get();
    auto created = Kernel::createWithSink(std::move(owned), "recorded", fixedClock());
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    std::unique_ptr<Kernel> kernel = std::move(created.value());
    CHECK(sink->calls == std::vector<std::string>{"w", "s"});

    const std::vector<Proposal> proposals = fixtureProposals();
    const CommitResult first = submitOk(*kernel, proposals[0]);
    CHECK(sink->calls == std::vector<std::string>{"w", "s", "w", "s"});
    const CommitResult second = submitOk(*kernel, proposals[1]);
    CHECK(sink->calls == std::vector<std::string>{"w", "s", "w", "s", "w", "s"});
    CHECK(kernel->journal().verifiedBytes() == sink->data.size());

    // What went through the sink decodes as the header and exactly two
    // commits, sealed with the digests submit handed back.
    auto header = tree::decodeHeader(sink->data);
    REQUIRE_MESSAGE(header.ok(), detailOf(header));
    CHECK(header.value().record.world == "recorded");
    auto one = tree::decodeCommit(sink->data, header.value().end, header.value().digest, 1, 0);
    REQUIRE_MESSAGE(one.ok(), detailOf(one));
    CHECK(one.value().digest == first.digest);
    auto two = tree::decodeCommit(sink->data, one.value().end, one.value().digest, 2, 0);
    REQUIRE_MESSAGE(two.ok(), detailOf(two));
    CHECK(two.value().digest == second.digest);
    CHECK(two.value().end == sink->data.size());
    CHECK(recordBoundaries(sink->data).size() == 3);
}

TEST_CASE("journal: a failed sync rejects the commit and leaves the world untouched") {
    RecordingSink* sink = nullptr;
    std::unique_ptr<Kernel> kernel = kernelWithOneCommit(sink);
    const std::size_t verified = sink->data.size();
    const Digest lastDigest = kernel->journal().lastDigest();
    REQUIRE(kernel->world().nodeCount() == 1);

    sink->failNextSync = true;
    auto result = kernel->submit(fixtureProposals()[1]);
    REQUIRE_FALSE(result.ok());
    CHECK(result.error().kind == Rejection::Kind::Io);
    CHECK(sink->calls == std::vector<std::string>{"w", "s", "w", "s", "w", "s"});

    // Nothing moved: not the world, not the verified journal.
    CHECK(kernel->world().nodeCount() == 1);
    CHECK(kernel->world().edgeCount() == 0);
    CHECK(kernel->world().nextNodeId() == NodeId{2});
    CHECK(kernel->journal().commitCount() == 1);
    CHECK(kernel->journal().lastSeq() == 1);
    CHECK(kernel->journal().lastDigest() == lastDigest);
    CHECK(kernel->journal().verifiedBytes() == verified);

    // The bytes went out but were never acknowledged. The journal knows it
    // has a tail it could not confirm — the same torn tail a crash after
    // the write would leave — and says so.
    REQUIRE(sink->data.size() > verified);
    const std::size_t tail = sink->data.size() - verified;
    CHECK(kernel->status().kind == Kind::TornTail);
    CHECK(kernel->status().offset == verified);
    CHECK(kernel->status().bytes == tail);
    CHECK(kernel->status().lastGoodSeq == 1);

    // It will not write on top of bytes it cannot vouch for: that would put
    // a second `@commit 2` behind the first and corrupt the file.
    const std::string bytesAfter = sink->data;
    auto refused = kernel->submit(fixtureProposals()[2]);
    REQUIRE_FALSE(refused.ok());
    CHECK(refused.error().kind == Rejection::Kind::JournalNotClean);
    CHECK(sink->calls.size() == 6);
    CHECK(sink->data == bytesAfter);
    CHECK(kernel->world().nodeCount() == 1);

    // What a crash before the flush leaves on the medium is any prefix of
    // the unconfirmed record (Assumption A3): every such prefix reopens
    // with exactly the previous commit and a TornTail at the same offset.
    for (const std::size_t cut : {verified + 1, verified + tail / 2, sink->data.size() - 1}) {
        auto reopened = Kernel::openBytes(sink->data.substr(0, cut), nullptr);
        REQUIRE_MESSAGE(reopened.ok(), "cut at " << cut << ": " << detailOf(reopened));
        CHECK_MESSAGE(reopened.value()->status().kind == Kind::TornTail, "cut at " << cut);
        CHECK(reopened.value()->status().offset == verified);
        CHECK(reopened.value()->status().bytes == cut - verified);
        CHECK(reopened.value()->status().lastGoodSeq == 1);
        CHECK(reopened.value()->journal().commitCount() == 1);
        CHECK(reopened.value()->world().nodeCount() == 1);
    }
    // And if every byte did reach the medium, the record is complete and
    // verifies: history never loses a complete record. The rejection said
    // "not confirmed", never "did not happen" — which is why the journal
    // above refuses to append until the caller repairs or reopens.
    auto complete = Kernel::openBytes(sink->data, nullptr);
    REQUIRE_MESSAGE(complete.ok(), detailOf(complete));
    CHECK(complete.value()->status().kind == Kind::Ok);
    CHECK(complete.value()->journal().commitCount() == 2);
}

TEST_CASE("journal: a write that stops mid-record is a torn tail, never a partial commit") {
    RecordingSink* sink = nullptr;
    std::unique_ptr<Kernel> kernel = kernelWithOneCommit(sink);
    const std::size_t verified = sink->data.size();
    REQUIRE(kernel->journal().verifiedBytes() == verified);

    sink->failWriteAfter = verified + 20;
    auto result = kernel->submit(fixtureProposals()[1]);
    REQUIRE_FALSE(result.ok());
    CHECK(result.error().kind == Rejection::Kind::Io);
    // The write failed, so no sync was attempted; the 20 bytes stay put.
    CHECK(sink->calls == std::vector<std::string>{"w", "s", "w", "s", "w"});
    CHECK(sink->data.size() == verified + 20);
    CHECK(sink->data.compare(verified, 10, "@commit 2 ") == 0);

    CHECK(kernel->world().nodeCount() == 1);
    CHECK(kernel->journal().commitCount() == 1);
    CHECK(kernel->journal().verifiedBytes() == verified);
    CHECK(kernel->status().kind == Kind::TornTail);
    CHECK(kernel->status().offset == verified);
    CHECK(kernel->status().bytes == 20);
    CHECK(kernel->status().lastGoodSeq == 1);

    auto refused = kernel->submit(fixtureProposals()[2]);
    REQUIRE_FALSE(refused.ok());
    CHECK(refused.error().kind == Rejection::Kind::JournalNotClean);
    CHECK(sink->data.size() == verified + 20);

    // Reopened from the bytes: one commit, and a torn tail of 20 bytes
    // starting exactly where the verified prefix ends.
    auto reopened = Kernel::openBytes(sink->data, nullptr);
    REQUIRE_MESSAGE(reopened.ok(), detailOf(reopened));
    CHECK(reopened.value()->status().kind == Kind::TornTail);
    CHECK(reopened.value()->status().offset == verified);
    CHECK(reopened.value()->status().bytes == 20);
    CHECK(reopened.value()->status().lastGoodSeq == 1);
    CHECK(reopened.value()->journal().commitCount() == 1);
    CHECK(reopened.value()->journal().verifiedBytes() == verified);
    CHECK(reopened.value()->world().nodeCount() == 1);
    CHECK(reopened.value()->world().node(NodeId{1}) != nullptr);
    CHECK(reopened.value()->world().node(NodeId{2}) == nullptr);
}

TEST_CASE("journal: exhaustive prefix truncation never accepts a partial record") {
    const std::string source = scratchPath("truncation-source");
    const std::string full = buildJournal(source, 5);
    std::remove(source.c_str());
    const std::vector<std::size_t> boundaries = recordBoundaries(full);
    REQUIRE(boundaries.size() == 6);
    REQUIRE(boundaries.back() == full.size());
    const std::size_t headerEnd = boundaries[0];

    const std::string path = scratchPath("truncation");
    std::size_t okCuts = 0;
    std::size_t tornCuts = 0;
    std::size_t headerCuts = 0;
    for (std::size_t len = 0; len <= full.size(); ++len) {
        writeFile(path, full.substr(0, len));
        REQUIRE(static_cast<std::size_t>(fileSize(path)) == len);
        auto opened = Kernel::open(path, OpenPolicy::ReadOnly);

        if (len < headerEnd) {
            // No complete header: not a usable .tree file, and nothing to
            // load. (A zero-length file is the same answer.)
            REQUIRE_MESSAGE(!opened.ok(), "cut at " << len << " opened a file without a complete header");
            CHECK_MESSAGE(opened.error().kind == OpenFailure::Kind::NotATree,
                "cut at " << len << ": " << opened.error().detail);
            ++headerCuts;
            continue;
        }
        REQUIRE_MESSAGE(opened.ok(), "cut at " << len << ": " << detailOf(opened));
        const Kernel& kernel = *opened.value();
        const JournalStatus& status = kernel.status();

        const std::size_t record = recordHolding(boundaries, len); // 0: header, k: commit k
        const std::size_t lastBoundary = boundaries[record - 1];
        const std::size_t commitsBefore = record - 1;
        if (lastBoundary == len) {
            CHECK_MESSAGE(status.kind == Kind::Ok, "cut at " << len << " (boundary): " << status.reason);
            ++okCuts;
        } else {
            CHECK_MESSAGE(status.kind == Kind::TornTail, "cut at " << len << ": " << status.reason);
            CHECK_MESSAGE(status.offset == lastBoundary, "cut at " << len << ": offset " << status.offset);
            CHECK_MESSAGE(status.bytes == len - lastBoundary, "cut at " << len << ": bytes " << status.bytes);
            ++tornCuts;
        }
        // Exactly the commits that end at or before the cut: never more,
        // never fewer — in the journal and in the replayed world.
        CHECK_MESSAGE(kernel.journal().commitCount() == commitsBefore, "cut at " << len);
        CHECK_MESSAGE(status.lastGoodSeq == commitsBefore, "cut at " << len);
        CHECK_MESSAGE(kernel.journal().verifiedBytes() == lastBoundary, "cut at " << len);
        CHECK_MESSAGE(kernel.world().nodeCount() == kNodesAfter[commitsBefore], "cut at " << len);
        CHECK_MESSAGE(kernel.world().tick() == kTickAfter[commitsBefore], "cut at " << len);
    }
    CHECK(headerCuts == headerEnd);
    CHECK(okCuts == boundaries.size());
    CHECK(tornCuts == full.size() + 1 - headerEnd - boundaries.size());
    MESSAGE("truncation sweep: " << full.size() << " bytes, " << full.size() + 1 << " prefixes, " << okCuts
                                 << " boundaries, " << tornCuts << " torn, " << headerCuts << " without a header");
    std::remove(path.c_str());
}

TEST_CASE("journal: single-byte corruption is never accepted") {
    const std::string source = scratchPath("corruption-source");
    const std::string full = buildJournal(source, 3);
    std::remove(source.c_str());
    const std::vector<std::size_t> boundaries = recordBoundaries(full);
    REQUIRE(boundaries.size() == 4);
    const std::size_t headerEnd = boundaries[0];

    const std::string path = scratchPath("corruption");
    std::size_t refusedOpens = 0;
    std::size_t corrupt = 0;
    std::size_t torn = 0;
    for (std::size_t i = 0; i < full.size(); ++i) {
        std::string bad = full;
        bad[i] = static_cast<char>(static_cast<unsigned char>(bad[i]) ^ 0x01u);
        writeFile(path, bad);
        auto opened = Kernel::open(path, OpenPolicy::ReadOnly);
        const std::size_t record = recordHolding(boundaries, i); // 0: header, k: commit k

        if (!opened.ok()) {
            // Only a damaged header makes the file unusable as a whole.
            CHECK_MESSAGE(record == 0, "flip at " << i << " in commit " << record << ": " << opened.error().detail);
            CHECK_MESSAGE(opened.error().kind == OpenFailure::Kind::NotATree, "flip at " << i);
            ++refusedOpens;
            continue;
        }
        CHECK_MESSAGE(i >= headerEnd, "flip at " << i << " inside the header was accepted");
        const Kernel& kernel = *opened.value();
        const JournalStatus& status = kernel.status();
        CHECK_MESSAGE(status.kind != Kind::Ok, "flip at " << i << " in commit " << record << " was accepted");
        CHECK_MESSAGE(kernel.journal().commitCount() < 3, "flip at " << i);
        // The damaged record and everything after it stay unloaded.
        CHECK_MESSAGE(kernel.journal().commitCount() <= record - 1, "flip at " << i << " in commit " << record);
        CHECK_MESSAGE(status.lastGoodSeq <= record - 1, "flip at " << i);
        const bool offsetInsideRecord = status.offset >= boundaries[record - 1] && status.offset < boundaries[record];
        CHECK_MESSAGE(offsetInsideRecord, "flip at " << i << " in commit " << record << " reported offset " << status.offset);
        CHECK_MESSAGE(kernel.world().nodeCount() == kNodesAfter[kernel.journal().commitCount()], "flip at " << i);
        if (record < 3) {
            // Bytes that are all present and do not verify are corruption,
            // never a torn tail.
            CHECK_MESSAGE(status.kind == Kind::Corrupt, "flip at " << i << " in commit " << record << ": " << status.reason);
        }
        if (status.kind == Kind::Corrupt) {
            ++corrupt;
        } else {
            ++torn;
        }
    }
    CHECK(refusedOpens == headerEnd);
    CHECK(refusedOpens + corrupt + torn == full.size());
    MESSAGE("corruption sweep: " << full.size() << " bytes flipped, " << refusedOpens << " not a tree, " << corrupt
                                 << " corrupt, " << torn << " torn");
    std::remove(path.c_str());
}

TEST_CASE("journal: appends are refused while torn or corrupt") {
    const std::string path = scratchPath("refused");
    const std::string full = buildJournal(path, 2);
    const std::vector<std::size_t> boundaries = recordBoundaries(full);
    REQUIRE(boundaries.size() == 3);

    // Torn: the second commit cut short.
    const std::string torn = full.substr(0, boundaries[1] + 40);
    writeFile(path, torn);
    {
        std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::Existing);
        CHECK(kernel->status().kind == Kind::TornTail);
        CHECK(kernel->status().offset == boundaries[1]);
        CHECK(kernel->status().bytes == 40);
        CHECK(kernel->journal().commitCount() == 1);
        auto refused = kernel->submit(fixtureProposals()[2]);
        REQUIRE_FALSE(refused.ok());
        CHECK(refused.error().kind == Rejection::Kind::JournalNotClean);
        CHECK(kernel->world().nodeCount() == 1);
    }
    CHECK(readFile(path) == torn);

    // Corrupt: one byte of the first commit's body flipped.
    std::string corrupt = full;
    corrupt[boundaries[0] + 60] = static_cast<char>(static_cast<unsigned char>(corrupt[boundaries[0] + 60]) ^ 0x01u);
    writeFile(path, corrupt);
    {
        std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::Existing);
        CHECK(kernel->status().kind == Kind::Corrupt);
        CHECK(kernel->status().offset == boundaries[0]);
        CHECK(kernel->journal().commitCount() == 0);
        auto refused = kernel->submit(fixtureProposals()[0]);
        REQUIRE_FALSE(refused.ok());
        CHECK(refused.error().kind == Rejection::Kind::JournalNotClean);
        CHECK(kernel->world().nodeCount() == 0);
    }
    CHECK(readFile(path) == corrupt);
    std::remove(path.c_str());
}

TEST_CASE("journal: a second opener is locked out") {
    const std::string path = scratchPath("locked");
    const std::string bytes = buildJournal(path, 1);
    const long size = fileSize(path);

    auto first = Kernel::open(path, OpenPolicy::Existing, fixedClock());
    REQUIRE_MESSAGE(first.ok(), detailOf(first));

    auto second = Kernel::open(path, OpenPolicy::Existing, fixedClock());
    REQUIRE_FALSE(second.ok());
    CHECK(second.error().kind == OpenFailure::Kind::Locked);
    CHECK(fileSize(path) == size);
    CHECK(readFile(path) == bytes);

    // A read-only open takes no lock and needs none: it never writes.
    auto reader = Kernel::open(path, OpenPolicy::ReadOnly, fixedClock());
    REQUIRE_MESSAGE(reader.ok(), detailOf(reader));
    CHECK(reader.value()->journal().commitCount() == 1);

    // The holder can still write; the file grows only through it.
    submitOk(*first.value(), fixtureProposals()[1]);
    CHECK(fileSize(path) > size);

    // Releasing the first opener frees the journal for the next.
    first.value().reset();
    auto third = Kernel::open(path, OpenPolicy::Existing, fixedClock());
    REQUIRE_MESSAGE(third.ok(), detailOf(third));
    CHECK(third.value()->status().kind == Kind::Ok);
    CHECK(third.value()->journal().commitCount() == 2);
    std::remove(path.c_str());
}

TEST_CASE("journal: a fresh world is only the header and empty or missing files are diagnosed") {
    const std::string path = scratchPath("fresh");
    {
        std::unique_ptr<Kernel> kernel = createOk(path, "fresh");
        CHECK(kernel->status().kind == Kind::Ok);
        CHECK(kernel->journal().commitCount() == 0);
    }
    const std::string text = readFile(path);
    CHECK(text.compare(0, 8, "@tree 1 ") == 0);
    CHECK(countOf(text, kEndPrefix) == 1);
    CHECK(countOf(text, "@commit") == 0);
    CHECK(text.find("world fresh\n") != std::string::npos);
    CHECK(text.find(std::string("created ") + kStamp + "\n") != std::string::npos);
    CHECK(text.back() == '\n');
    {
        std::unique_ptr<Kernel> kernel = openOk(path, OpenPolicy::Existing);
        CHECK(kernel->status().kind == Kind::Ok);
        CHECK(kernel->journal().commitCount() == 0);
        CHECK(kernel->journal().verifiedBytes() == text.size());
        CHECK(kernel->world().nodeCount() == 0);
        CHECK(kernel->world().nextNodeId() == NodeId{1});
    }
    CHECK(readFile(path) == text);
    std::remove(path.c_str());

    const std::string empty = scratchPath("empty");
    writeFile(empty, "");
    for (const OpenPolicy policy : {OpenPolicy::Existing, OpenPolicy::ReadOnly}) {
        auto result = Kernel::open(empty, policy);
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().kind == OpenFailure::Kind::NotATree);
        CHECK(fileSize(empty) == 0);
    }
    std::remove(empty.c_str());

    const std::string missing = scratchPath("missing");
    for (const OpenPolicy policy : {OpenPolicy::Existing, OpenPolicy::ReadOnly}) {
        auto result = Kernel::open(missing, policy);
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().kind == OpenFailure::Kind::Missing);
        CHECK_FALSE(fileExists(missing));
    }
}

TEST_CASE("journal: open twice yields the same digests and never modifies the file") {
    const std::string path = scratchPath("twice");
    const std::string bytes = buildJournal(path, 3);
    const long size = fileSize(path);

    struct Seen {
        Digest lastDigest;
        std::vector<Digest> parents;
        std::vector<NodeId> nodeIds;
        std::vector<EdgeId> edgeIds;
        std::uint64_t tick = 0;
        std::string title;
    };
    const auto observe = [&](OpenPolicy policy) {
        std::unique_ptr<Kernel> kernel = openOk(path, policy);
        REQUIRE(kernel->status().kind == Kind::Ok);
        REQUIRE(kernel->journal().commitCount() == 3);
        Seen seen;
        seen.lastDigest = kernel->journal().lastDigest();
        for (const CommitRecord& commit : kernel->journal().commits()) {
            seen.parents.push_back(commit.parent);
        }
        seen.nodeIds = kernel->world().nodeIds();
        seen.edgeIds = kernel->world().edgeIds();
        seen.tick = kernel->world().tick();
        seen.title = kernel->world().node(NodeId{1})->props.at("title").text;
        return seen;
    };

    const Seen first = observe(OpenPolicy::Existing);
    CHECK(fileSize(path) == size);
    CHECK(readFile(path) == bytes);
    const Seen second = observe(OpenPolicy::Existing);
    const Seen third = observe(OpenPolicy::ReadOnly);
    CHECK(fileSize(path) == size);
    CHECK(readFile(path) == bytes);

    for (const Seen* other : {&second, &third}) {
        CHECK(other->lastDigest == first.lastDigest);
        CHECK(other->parents == first.parents);
        CHECK(other->nodeIds == first.nodeIds);
        CHECK(other->edgeIds == first.edgeIds);
        CHECK(other->tick == first.tick);
        CHECK(other->title == first.title);
    }
    CHECK(first.parents.size() == 3);
    CHECK(first.nodeIds == std::vector<NodeId>{NodeId{1}, NodeId{2}});
    CHECK(first.edgeIds == std::vector<EdgeId>{EdgeId{1}});
    CHECK(first.title == "Sam");
    std::remove(path.c_str());
}

} // TEST_SUITE("journal")
