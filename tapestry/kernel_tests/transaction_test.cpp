// What a commit is allowed to leave behind, and how reopening grows.
//
// Kernel::submit, Kernel::fromJournal and Kernel::replayUpTo buy all-or-nothing
// atomicity by working on a scratch World and swapping it in only once the
// commit is certain. These three cases pin the two things that scratch is for,
// so the shape of the scratch can change underneath them without the contract
// moving:
//
//   A. a rejection — or an I/O failure after every op was accepted — leaves the
//      world exactly as it was, down to the edges a delete-node cascade removed
//      and the tombstones a create-then-delete would have left;
//   B. replay is a pure function of the journal bytes: every prefix of the
//      journal rebuilds the same world a bare prepare/apply loop would, and
//      buildHistoryIndex derives the same authorship from the same commits;
//   C. opening a world costs time proportional to the ops in its journal, not
//      to commits squared.
//
// Case C is the one that fails while the scratch is a copy of the whole world.

#include "kernel/History.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Kernel.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Record.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"
#include "kernel/World.hpp"
#include "kernel/journal/Journal.hpp"
#include "kernel/journal/Sink.hpp"

#include <doctest.h>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <memory>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::Advance;
using tapestry::kernel::buildHistoryIndex;
using tapestry::kernel::Clock;
using tapestry::kernel::CommitRecord;
using tapestry::kernel::CommitResult;
using tapestry::kernel::CommitSeq;
using tapestry::kernel::CreateEdge;
using tapestry::kernel::CreateNode;
using tapestry::kernel::DeleteEdge;
using tapestry::kernel::DeleteNode;
using tapestry::kernel::Edge;
using tapestry::kernel::EdgeHistory;
using tapestry::kernel::EdgeId;
using tapestry::kernel::Expected;
using tapestry::kernel::FixedClock;
using tapestry::kernel::format;
using tapestry::kernel::formatInline;
using tapestry::kernel::HistoryIndex;
using tapestry::kernel::IoError;
using tapestry::kernel::Kernel;
using tapestry::kernel::Node;
using tapestry::kernel::NodeHistory;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::Proposal;
using tapestry::kernel::Rejection;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::SetProperty;
using tapestry::kernel::Sink;
using tapestry::kernel::UnsetProperty;
using tapestry::kernel::Value;
using tapestry::kernel::World;

const char* const kNoteType = "tapestry.notes/note@1";
const char* const kStamp = "2026-09-15T08:30:00Z";

// Keeps every byte written and can be told to fail its sync, which is the only
// way to reach submit()'s I/O path without a real broken disk.
struct RecordingSink final : Sink {
    std::string data;
    bool failSync = false;

    std::optional<IoError> writeAll(std::string_view bytes) override {
        data.append(bytes.data(), bytes.size());
        return std::nullopt;
    }
    std::optional<IoError> sync() override {
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

std::unique_ptr<Clock> fixedClock() {
    auto clock = std::make_unique<FixedClock>();
    clock->at = *RecordedAt::parse(kStamp);
    return clock;
}

template <class T, class E>
std::string detailOf(const Expected<T, E>& result) {
    return result.ok() ? std::string("ok") : result.error().detail;
}

Proposal proposalOf(const Actor& actor, const char* message, std::vector<Op> ops) {
    Proposal proposal;
    proposal.actor = actor;
    proposal.message = message;
    proposal.ops = std::move(ops);
    return proposal;
}

Proposal byKaelen(std::vector<Op> ops, const char* message = "") {
    return proposalOf(Actor{"human", "kaelen"}, message, std::move(ops));
}

CommitResult submitOk(Kernel& kernel, const Proposal& proposal) {
    auto result = kernel.submit(proposal);
    REQUIRE_MESSAGE(result.ok(), detailOf(result));
    return result.value();
}

CreateNode note(const char* title) {
    CreateNode create;
    create.type = kNoteType;
    create.props["title"] = Value::ofText(title);
    return create;
}

// The complete observable state of a world as one comparable, printable value:
// every live node with its type and properties, every live edge with its
// endpoints, label and properties, both id counters, the tick, and every
// tombstone below each counter. If two worlds render the same text there is no
// question a caller could ask that would tell them apart.
//
// Every private member of World must be represented here. A new field that is
// not is a field rollback can silently fail to restore.
std::string snapshotOf(const World& world) {
    std::string out;
    out += "next " + format(world.nextNodeId()) + ' ' + format(world.nextEdgeId());
    out += " tick " + std::to_string(world.tick()) + '\n';
    for (const NodeId id : world.nodeIds()) {
        const Node* found = world.node(id);
        REQUIRE(found != nullptr);
        out += "node " + format(id) + ' ' + found->type + '\n';
        for (const auto& [key, value] : found->props) {
            out += "  " + key + " = " + formatInline(value) + '\n';
        }
    }
    for (const EdgeId id : world.edgeIds()) {
        const Edge* found = world.edge(id);
        REQUIRE(found != nullptr);
        out += "edge " + format(id) + ' ' + format(found->from) + " -> " + format(found->to) + ' ' + found->label + '\n';
        for (const auto& [key, value] : found->props) {
            out += "  " + key + " = " + formatInline(value) + '\n';
        }
    }
    for (std::uint64_t k = 1; k < world.nextNodeId().value; ++k) {
        if (world.wasDeleted(NodeId{k})) {
            out += "deleted " + format(NodeId{k}) + '\n';
        }
    }
    for (std::uint64_t k = 1; k < world.nextEdgeId().value; ++k) {
        if (world.wasDeleted(EdgeId{k})) {
            out += "deleted " + format(EdgeId{k}) + '\n';
        }
    }
    return out;
}

// Live nodes n1..n4, live edges e1 (n1->n2, with a property), e2 (n3->n1, with
// a property), a tombstoned edge e3 and a tombstoned node n5, and a tick of 7.
// Six commits, so the next valid commit is seq 7 with ids n6 and e4.
std::unique_ptr<Kernel> seededKernel(RecordingSink** out) {
    auto sink = std::make_unique<RecordingSink>();
    *out = sink.get();
    auto created = Kernel::createWithSink(std::move(sink), "transaction", fixedClock());
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    auto kernel = std::move(created.value());

    submitOk(*kernel, byKaelen({note("one"), note("two"), note("three"), note("four")}, "four notes"));
    submitOk(*kernel, byKaelen({
        CreateEdge{EdgeId{}, NodeId{1}, NodeId{2}, "link", {{"weight", Value::ofInt(4)}}},
        CreateEdge{EdgeId{}, NodeId{3}, NodeId{1}, "grew-from", {{"note", Value::ofText("from three")}}},
        CreateEdge{EdgeId{}, NodeId{2}, NodeId{3}, "link", {}},
    }, "three edges"));
    submitOk(*kernel, byKaelen({Advance{7}}, "seven ticks"));
    submitOk(*kernel, byKaelen({DeleteEdge{EdgeId{3}}}, "drop the third edge"));
    submitOk(*kernel, byKaelen({note("five")}, "a fifth note"));
    submitOk(*kernel, byKaelen({DeleteNode{NodeId{5}}}, "drop the fifth note"));
    return kernel;
}

} // namespace

TEST_SUITE("transaction") {

TEST_CASE("transaction: a rejection mid-commit leaves the world exactly as it was") {
    RecordingSink* sink = nullptr;
    std::unique_ptr<Kernel> kernel = seededKernel(&sink);
    REQUIRE(kernel->lastSeq() == 6);
    REQUIRE(kernel->world().nodeCount() == 4);
    REQUIRE(kernel->world().edgeCount() == 2);
    REQUIRE(kernel->world().tick() == 7);
    REQUIRE(kernel->world().wasDeleted(NodeId{5}));
    REQUIRE(kernel->world().wasDeleted(EdgeId{3}));

    const std::string before = snapshotOf(kernel->world());
    const std::string bytesBefore = sink->data;

    const auto expectRejected = [&](const Proposal& proposal, Rejection::Kind kind) {
        auto result = kernel->submit(proposal);
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().kind == kind);
        CHECK(snapshotOf(kernel->world()) == before);
        CHECK(kernel->lastSeq() == 6);
    };

    // A1. The cascade: deleting n1 takes e1 and e2 with it, and then the commit
    // is refused. Both edges must come back with their endpoints, labels and
    // properties — the delete-node line is the only record that they went.
    expectRejected(byKaelen({
        DeleteNode{NodeId{1}},
        SetProperty{NodeId{99}, "title", Value::ofText("nobody")},
    }, "cascade then miss"), Rejection::Kind::UnknownTarget);
    CHECK(sink->data == bytesBefore);

    // A2. Counters and the tick do not leak out of a rejected commit.
    expectRejected(byKaelen({
        note("six"),
        CreateEdge{EdgeId{}, NodeId{6}, NodeId{2}, "link", {}},
        Advance{5},
        SetProperty{NodeId{2}, "9lives", Value::ofInt(9)},
    }, "create, connect, advance, then a bad key"), Rejection::Kind::BadKey);

    // A3. A node created and deleted inside one rejected commit leaves no
    // tombstone: rollback has to erase the id, not restore it as deleted.
    expectRejected(byKaelen({
        note("six"),
        DeleteNode{NodeId{6}},
        SetProperty{NodeId{99}, "title", Value::ofText("nobody")},
    }, "create, delete, then a miss"), Rejection::Kind::UnknownTarget);
    CHECK_FALSE(kernel->world().wasDeleted(NodeId{6}));

    // The world is still usable, and the ids and seq are the ones the rejected
    // commits never consumed.
    const CommitResult committed = submitOk(*kernel, byKaelen({
        note("six"),
        CreateEdge{EdgeId{}, NodeId{6}, NodeId{2}, "link", {}},
    }, "the commit that sticks"));
    CHECK(committed.seq == 7);
    REQUIRE(committed.nodeIds.size() == 1);
    CHECK(committed.nodeIds[0] == NodeId{6});
    REQUIRE(committed.edgeIds.size() == 1);
    CHECK(committed.edgeIds[0] == EdgeId{4});
    CHECK(kernel->world().nodeCount() == 5);
    CHECK(kernel->world().edgeCount() == 3);

    // A4. Nothing is rejected by prepare here: every op applies and the world
    // is put back only because the durable write failed. Run last, because a
    // failed sync tears the journal and refuses every later submit.
    const std::string beforeIo = snapshotOf(kernel->world());
    sink->failSync = true;
    auto failed = kernel->submit(byKaelen({DeleteNode{NodeId{1}}}, "cascade into a broken disk"));
    REQUIRE_FALSE(failed.ok());
    CHECK(failed.error().kind == Rejection::Kind::Io);
    CHECK(snapshotOf(kernel->world()) == beforeIo);
    CHECK(kernel->world().edgeCount() == 3);
    CHECK(kernel->world().node(NodeId{1}) != nullptr);
}

TEST_CASE("transaction: replay and derived authorship are unchanged") {
    // Five commits, four actors, all seven op kinds, and a delete-node whose
    // cascade is written nowhere in the file.
    const auto build = []() {
        auto sink = std::make_unique<RecordingSink>();
        RecordingSink* raw = sink.get();
        auto created = Kernel::createWithSink(std::move(sink), "replay", fixedClock());
        REQUIRE_MESSAGE(created.ok(), detailOf(created));
        auto kernel = std::move(created.value());

        submitOk(*kernel, proposalOf(Actor{"human", "kaelen"}, "two notes",
            {note("Rody"), note("Max")}));
        submitOk(*kernel, proposalOf(Actor{"plugin", "agent.claude"}, "edit and grow", {
            SetProperty{NodeId{1}, "body", Value::ofText("Best friends with Max.")},
            CreateEdge{EdgeId{}, NodeId{2}, NodeId{1}, "grew-from", {{"why", Value::ofText("grew")}}},
            Advance{3},
        }));
        submitOk(*kernel, proposalOf(Actor{"human", "kaelen"}, "retract the body", {
            UnsetProperty{NodeId{1}, "body"},
            SetProperty{EdgeId{1}, "weight", Value::ofInt(2)},
        }));
        submitOk(*kernel, proposalOf(Actor{"system", "tapestry"}, "a link that did not last", {
            note("Scratch"),
            CreateEdge{EdgeId{}, NodeId{3}, NodeId{1}, "link", {}},
            DeleteEdge{EdgeId{2}},
        }));
        submitOk(*kernel, proposalOf(Actor{"plugin", "obsidian.bridge"}, "observed deletion of Rody.md",
            {DeleteNode{NodeId{1}}}));

        std::string bytes = raw->data;
        return std::make_pair(std::move(kernel), std::move(bytes));
    };

    auto [live, bytes] = build();
    REQUIRE(live->lastSeq() == 5);

    // B1. The bytes rebuild the world the live kernel holds.
    auto reopened = Kernel::openBytes(bytes, nullptr);
    REQUIRE_MESSAGE(reopened.ok(), detailOf(reopened));
    std::unique_ptr<Kernel> replayed = std::move(reopened.value());
    CHECK(snapshotOf(replayed->world()) == snapshotOf(live->world()));

    // B2. Every prefix matches a bare prepare/apply loop over the decoded
    // commits. The bare loop is the oracle: it uses no kernel scratch at all.
    const std::vector<CommitRecord>& commits = replayed->journal().commits();
    for (CommitSeq k = 0; k <= replayed->lastSeq(); ++k) {
        World bare;
        for (const CommitRecord& commit : commits) {
            if (commit.seq > k) {
                break;
            }
            for (const Op& original : commit.ops) {
                Op op = original;
                auto rejection = bare.prepare(op);
                REQUIRE_MESSAGE(!rejection.has_value(), (rejection ? rejection->detail : std::string("ok")));
                bare.apply(op);
            }
        }
        replayed->replayUpTo(k);
        CHECK_MESSAGE(snapshotOf(replayed->world()) == snapshotOf(bare), "replayUpTo(" << k << ")");
    }
    replayed->replayUpTo(replayed->lastSeq());

    // B3. Authorship derived from those same commits, by name and seq.
    const HistoryIndex index = buildHistoryIndex(live->journal().commits(), live->lastSeq());
    const auto findNode = [&](NodeId id) -> const NodeHistory* {
        for (const NodeHistory& entry : index.nodes) {
            if (entry.id == id) {
                return &entry;
            }
        }
        return nullptr;
    };
    const auto findEdge = [&](EdgeId id) -> const EdgeHistory* {
        for (const EdgeHistory& entry : index.edges) {
            if (entry.id == id) {
                return &entry;
            }
        }
        return nullptr;
    };

    const NodeHistory* n1 = findNode(NodeId{1});
    REQUIRE(n1 != nullptr);
    CHECK(n1->createdSeq == 1);
    CHECK(n1->createdBy == Actor{"human", "kaelen"});
    CHECK(n1->changedSeq == 3);
    CHECK(n1->changedBy == Actor{"human", "kaelen"});
    REQUIRE(n1->deletedSeq.has_value());
    CHECK(*n1->deletedSeq == 5);
    REQUIRE(n1->deletedBy.has_value());
    CHECK(*n1->deletedBy == Actor{"plugin", "obsidian.bridge"});

    const NodeHistory* n2 = findNode(NodeId{2});
    REQUIRE(n2 != nullptr);
    CHECK(n2->createdSeq == 1);
    CHECK(n2->createdBy == Actor{"human", "kaelen"});
    CHECK(n2->changedSeq == 1);
    CHECK_FALSE(n2->deletedSeq.has_value());

    const NodeHistory* n3 = findNode(NodeId{3});
    REQUIRE(n3 != nullptr);
    CHECK(n3->createdSeq == 4);
    CHECK(n3->createdBy == Actor{"system", "tapestry"});
    CHECK_FALSE(n3->deletedSeq.has_value());

    // e1 is the cascade: no delete-edge line names it, and it is still the
    // bridge that removed it, in commit 5.
    const EdgeHistory* e1 = findEdge(EdgeId{1});
    REQUIRE(e1 != nullptr);
    CHECK(e1->from == NodeId{2});
    CHECK(e1->to == NodeId{1});
    CHECK(e1->createdSeq == 2);
    CHECK(e1->createdBy == Actor{"plugin", "agent.claude"});
    REQUIRE(e1->deletedSeq.has_value());
    CHECK(*e1->deletedSeq == 5);
    REQUIRE(e1->deletedBy.has_value());
    CHECK(*e1->deletedBy == Actor{"plugin", "obsidian.bridge"});

    const EdgeHistory* e2 = findEdge(EdgeId{2});
    REQUIRE(e2 != nullptr);
    CHECK(e2->createdSeq == 4);
    CHECK(e2->createdBy == Actor{"system", "tapestry"});
    REQUIRE(e2->deletedSeq.has_value());
    CHECK(*e2->deletedSeq == 4);
    REQUIRE(e2->deletedBy.has_value());
    CHECK(*e2->deletedBy == Actor{"system", "tapestry"});

    // B4. The same proposals under the same clock produce the same file.
    auto [again, bytesAgain] = build();
    CHECK(bytesAgain == bytes);
    CHECK(snapshotOf(again->world()) == snapshotOf(live->world()));
}

TEST_CASE("transaction: reopening a long journal does not grow quadratically") {
    // One node, then one commit per new property key: the shape spike 006
    // measured, where the world grows with every commit.
    const auto journalOf = [](std::size_t commits) {
        auto sink = std::make_unique<RecordingSink>();
        RecordingSink* raw = sink.get();
        auto created = Kernel::createWithSink(std::move(sink), "bench", fixedClock());
        REQUIRE_MESSAGE(created.ok(), detailOf(created));
        auto kernel = std::move(created.value());
        submitOk(*kernel, byKaelen({note("bench")}, "the one node"));
        for (std::size_t i = 0; i < commits; ++i) {
            auto result = kernel->submit(byKaelen(
                {SetProperty{NodeId{1}, "k" + std::to_string(i), Value::ofInt(static_cast<std::int64_t>(i))}},
                "one property"));
            REQUIRE_MESSAGE(result.ok(), detailOf(result));
        }
        return raw->data;
    };

    const auto reopenMillis = [](const std::string& bytes) {
        const auto start = std::chrono::steady_clock::now();
        auto opened = Kernel::openBytes(bytes, nullptr);
        const auto stop = std::chrono::steady_clock::now();
        REQUIRE_MESSAGE(opened.ok(), detailOf(opened));
        return std::chrono::duration<double, std::milli>(stop - start).count();
    };

    // One warm-up run, discarded, then the best of three: the best run is the
    // one least disturbed by everything else on the machine.
    const auto bestReopenMillis = [&](const std::string& bytes) {
        reopenMillis(bytes);
        double best = reopenMillis(bytes);
        best = std::min(best, reopenMillis(bytes));
        best = std::min(best, reopenMillis(bytes));
        return best;
    };

    const auto show = [](double value) {
        std::ostringstream out;
        out.setf(std::ios::fixed);
        out.precision(2);
        out << value;
        return out.str();
    };

    std::size_t base = 1000;
    if (const char* fromEnv = std::getenv("TAPESTRY_REPLAY_BENCH_COMMITS")) {
        const long parsed = std::strtol(fromEnv, nullptr, 10);
        if (parsed > 0) {
            base = static_cast<std::size_t>(parsed);
        }
    }

    std::size_t small = base;
    std::size_t large = base * 4;
    double smallMillis = bestReopenMillis(journalOf(small));
    double largeMillis = bestReopenMillis(journalOf(large));
    MESSAGE("reopen " << small << " commits: " << show(smallMillis) << " ms");
    MESSAGE("reopen " << large << " commits: " << show(largeMillis) << " ms");

    // Under a millisecond the clock is measuring itself, not the kernel.
    if (smallMillis < 1.0) {
        MESSAGE("reopen at " << small << " commits is under 1 ms — too small to compare; re-running at 4x and 16x");
        small = base * 4;
        large = base * 16;
        smallMillis = largeMillis;
        largeMillis = bestReopenMillis(journalOf(large));
        MESSAGE("reopen " << small << " commits: " << show(smallMillis) << " ms");
        MESSAGE("reopen " << large << " commits: " << show(largeMillis) << " ms");
    }

    const double ratio = largeMillis / smallMillis;
    MESSAGE("4x the commits cost " << show(ratio) << "x the time (linear ~4, quadratic ~16)");
    CHECK_MESSAGE(ratio < 8.0, "reopen grows faster than linearly: ratio " << show(ratio));
}

} // TEST_SUITE("transaction")
