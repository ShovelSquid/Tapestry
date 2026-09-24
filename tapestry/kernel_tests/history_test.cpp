// Authorship derived from the journal, not stored beside it.
//
// The scenario below is the one the app shows in a note's provenance footer:
// a person creates a note, an agent edits it, the agent grows a second note
// connected to the first, and the Obsidian bridge deletes the original. Every
// question the UI asks — who made this, who touched it last, who deleted it,
// what did it look like before the last change — is answered from the actor
// lines of those four commits and nothing else.

#include "kernel/History.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Kernel.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Value.hpp"
#include "kernel/journal/Journal.hpp"
#include "kernel_tests/support.hpp"

#include <doctest.h>

#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::buildHistoryIndex;
using tapestry::kernel::CommitSeq;
using tapestry::kernel::CreateEdge;
using tapestry::kernel::CreateNode;
using tapestry::kernel::DeleteNode;
using tapestry::kernel::EdgeHistory;
using tapestry::kernel::EdgeId;
using tapestry::kernel::HistoryIndex;
using tapestry::kernel::Kernel;
using tapestry::kernel::NodeHistory;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::Proposal;
using tapestry::kernel::SetProperty;
using tapestry::kernel::Value;
using tapestry::kernel::test::scratchPath;

const char* const kNoteType = "tapestry.notes/note@1";

Actor human(const char* id) { return Actor{"human", id}; }
Actor plugin(const char* id) { return Actor{"plugin", id}; }

void submitOk(Kernel& kernel, const Actor& actor, const char* message, std::vector<Op> ops) {
    Proposal proposal;
    proposal.actor = actor;
    proposal.message = message;
    proposal.ops = std::move(ops);
    auto result = kernel.submit(proposal);
    REQUIRE_MESSAGE(result.ok(), (result.ok() ? std::string("ok") : result.error().detail));
}

CreateNode note(const char* title) {
    CreateNode create;
    create.type = kNoteType;
    create.props["title"] = Value::ofText(title);
    return create;
}

// The four commits every case below reads. Kept in one place so each case
// asserts a different question about the same history rather than a different
// history.
std::unique_ptr<Kernel> scenario(const char* name) {
    auto created = Kernel::create(scratchPath(name), "history");
    REQUIRE_MESSAGE(created.ok(), (created.ok() ? std::string("ok") : created.error().detail));
    auto kernel = std::move(created.value());

    // 1: the person makes the note.
    submitOk(*kernel, human("user.kaelen"), "Create note", {note("Rody")});
    // 2: an agent edits it.
    submitOk(*kernel, plugin("agent.claude"), "Update note text",
        {SetProperty{NodeId{1}, "body", Value::ofText("Best friends with Max.")}});
    // 3: the same agent grows a second note from it, connected in one commit.
    submitOk(*kernel, plugin("agent.claude"), "Grow note",
        {note("Max"), CreateEdge{EdgeId{}, NodeId{2}, NodeId{1}, "link", {}}});
    // 4: the bridge observes the file disappear.
    submitOk(*kernel, plugin("obsidian.bridge"), "observed deletion of Rody.md",
        {DeleteNode{NodeId{1}}});

    return kernel;
}

const NodeHistory* findNode(const HistoryIndex& index, NodeId id) {
    for (const NodeHistory& entry : index.nodes) {
        if (entry.id == id) {
            return &entry;
        }
    }
    return nullptr;
}

const EdgeHistory* findEdge(const HistoryIndex& index, EdgeId id) {
    for (const EdgeHistory& entry : index.edges) {
        if (entry.id == id) {
            return &entry;
        }
    }
    return nullptr;
}

} // namespace

TEST_CASE("history: authorship comes from the commit that created the node") {
    auto kernel = scenario("history-authorship");
    const auto index = buildHistoryIndex(kernel->journal().commits(), kernel->lastSeq());

    const NodeHistory* n1 = findNode(index, NodeId{1});
    REQUIRE(n1 != nullptr);
    CHECK(n1->createdSeq == 1);
    CHECK(n1->createdBy == human("user.kaelen"));
    // The agent edited it, so it is the agent who touched it last — but the
    // person is still the one who made it.
    CHECK(n1->changedSeq == 2);
    CHECK(n1->changedBy == plugin("agent.claude"));

    const NodeHistory* n2 = findNode(index, NodeId{2});
    REQUIRE(n2 != nullptr);
    CHECK(n2->createdBy == plugin("agent.claude"));
    // Nobody has edited n2, so its creator is also its last changer.
    CHECK(n2->changedBy == plugin("agent.claude"));

    const EdgeHistory* e1 = findEdge(index, EdgeId{1});
    REQUIRE(e1 != nullptr);
    CHECK(e1->from == NodeId{2});
    CHECK(e1->to == NodeId{1});
    CHECK(e1->createdBy == plugin("agent.claude"));
}

TEST_CASE("history: an index built to an earlier seq never shows a later changer") {
    auto kernel = scenario("history-rewound");

    // The world as of commit 1: the agent's edit has not happened yet, so
    // attributing it to the agent would be showing the reader something the
    // history they are looking at does not contain.
    const auto atOne = buildHistoryIndex(kernel->journal().commits(), CommitSeq{1});
    const NodeHistory* n1 = findNode(atOne, NodeId{1});
    REQUIRE(n1 != nullptr);
    CHECK(n1->changedSeq == 1);
    CHECK(n1->changedBy == human("user.kaelen"));
    CHECK_FALSE(n1->deletedSeq.has_value());

    // n2 and e1 do not exist yet either.
    CHECK(findNode(atOne, NodeId{2}) == nullptr);
    CHECK(atOne.edges.empty());
}

TEST_CASE("history: deleting a node marks it and every edge touching it") {
    auto kernel = scenario("history-delete");
    const auto index = buildHistoryIndex(kernel->journal().commits(), kernel->lastSeq());

    const NodeHistory* n1 = findNode(index, NodeId{1});
    REQUIRE(n1 != nullptr);
    REQUIRE(n1->deletedSeq.has_value());
    CHECK(*n1->deletedSeq == 4);
    REQUIRE(n1->deletedBy.has_value());
    CHECK(*n1->deletedBy == plugin("obsidian.bridge"));

    // The kernel cascades the edge delete but records only the delete-node
    // line, so the index has to reproduce the cascade to stay truthful.
    const EdgeHistory* e1 = findEdge(index, EdgeId{1});
    REQUIRE(e1 != nullptr);
    REQUIRE(e1->deletedSeq.has_value());
    CHECK(*e1->deletedSeq == 4);
    REQUIRE(e1->deletedBy.has_value());
    CHECK(*e1->deletedBy == plugin("obsidian.bridge"));

    // The surviving endpoint is untouched.
    const NodeHistory* n2 = findNode(index, NodeId{2});
    REQUIRE(n2 != nullptr);
    CHECK_FALSE(n2->deletedSeq.has_value());
}

TEST_CASE("history: header digest is the parent of commit 1") {
    auto kernel = scenario("history-digest");
    const auto& commits = kernel->journal().commits();
    REQUIRE_FALSE(commits.empty());

    // This is what makes the header digest usable as a tree's identity: it is
    // already the anchor of the commit chain, so it needs no new field.
    CHECK(kernel->journal().headerDigest().hex == commits[0].parent.hex);
    CHECK(kernel->journal().headerDigest().hex.size() == 64);
}
