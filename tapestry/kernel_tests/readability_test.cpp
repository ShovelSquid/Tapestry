// The readability promise made concrete (TREE-01, TREE-04). The kernel
// writes a small world under a fixed clock; the bytes are frozen in
// docs/tree/example.tree; this suite proves the kernel still writes exactly
// those bytes, that they read as plain text with the content, relationships,
// changes, authorship and ancestry visible by eye, and that the frozen file
// reopens to the world that produced it.
//
// Regenerating the fixture is always deliberate: run the test binary once
// with TAPESTRY_REGEN_FIXTURE set, read the diff, and commit it with a
// message that says why the bytes changed. The default run only compares.

#include "kernel/Ids.hpp"
#include "kernel/Kernel.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Record.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"
#include "kernel/journal/Journal.hpp"
#include "kernel_tests/support.hpp"

#include <doctest.h>

#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::Advance;
using tapestry::kernel::CommitRecord;
using tapestry::kernel::CommitResult;
using tapestry::kernel::CreateEdge;
using tapestry::kernel::CreateNode;
using tapestry::kernel::Edge;
using tapestry::kernel::EdgeId;
using tapestry::kernel::Expected;
using tapestry::kernel::FixedClock;
using tapestry::kernel::JournalStatus;
using tapestry::kernel::Kernel;
using tapestry::kernel::Node;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::OpenPolicy;
using tapestry::kernel::Proposal;
using tapestry::kernel::RecordedAt;
using tapestry::kernel::SetProperty;
using tapestry::kernel::Value;
using tapestry::kernel::test::readFile;
using tapestry::kernel::test::scratchPath;
using tapestry::kernel::test::writeFile;

// TAPESTRY_FIXTURE_DIR is a compile definition from CMakeLists.txt pointing
// at <source>/docs/tree, so the fixture lives next to FORMAT.md in git.
const char* const kFixturePath = TAPESTRY_FIXTURE_DIR "/example.tree";
const char* const kWorldCreated = "2026-09-08T21:15:07Z";
const char* const kNoteBody = "Met Sam at dinner.\nLoves architecture and weird bird memes.";

template <class T, class E>
std::string detailOf(const Expected<T, E>& result) {
    return result.ok() ? std::string("ok") : result.error().detail;
}

Proposal proposalOf(Actor actor, const char* message, std::vector<Op> ops) {
    Proposal proposal;
    proposal.actor = std::move(actor);
    proposal.message = message;
    proposal.ops = std::move(ops);
    return proposal;
}

// One commit of the golden sequence: the clock moves 60 s first, so every
// `recorded` stamp in the fixture differs from the one before it.
CommitResult commitAfterAMinute(Kernel& kernel, FixedClock& clock, const Proposal& proposal) {
    clock.at.unixSeconds += 60;
    auto result = kernel.submit(proposal);
    REQUIRE_MESSAGE(result.ok(), detailOf(result));
    return result.value();
}

// The golden world, exactly as the plan's <golden_world> block lists it: a
// note about Sam, the person Sam of a type the kernel has never seen, the
// edge between them made by a plugin, a corrected dinner date, an advance
// by the system, and an edit at the new tick with no message.
void buildGoldenWorld(Kernel& kernel, FixedClock& clock) {
    const Actor kaelen{"human", "kaelen"};
    const Actor people{"plugin", "example.people"};
    const Actor system{"system", "tapestry"};

    CreateNode note;
    note.type = "tapestry.notes/note@1";
    note.props["title"] = Value::ofText("Sam");
    note.props["body"] = Value::ofText(kNoteBody);
    note.props["event"] = Value::ofTime("2026-09-07");
    const CommitResult first = commitAfterAMinute(kernel, clock, proposalOf(kaelen, "first note", {note}));
    REQUIRE(first.nodeIds == std::vector<NodeId>{NodeId{1}});

    CreateNode person;
    person.type = "example.people/person@2";
    person.props["name"] = Value::ofText("Sam");
    person.props["anger"] = Value::ofInt(3);
    person.props["position.x"] = Value::ofReal(12.5);
    person.props["position.y"] = Value::ofReal(-3);
    const CommitResult second = commitAfterAMinute(kernel, clock, proposalOf(kaelen, "who Sam is", {person}));
    REQUIRE(second.nodeIds == std::vector<NodeId>{NodeId{2}});

    CreateEdge mentions;
    mentions.from = NodeId{1};
    mentions.to = NodeId{2};
    mentions.label = "mentions";
    mentions.props["note"] = Value::ofText("first meeting");
    const CommitResult third =
        commitAfterAMinute(kernel, clock, proposalOf(people, "link note to person", {mentions}));
    REQUIRE(third.edgeIds == std::vector<EdgeId>{EdgeId{1}});

    commitAfterAMinute(kernel, clock,
        proposalOf(kaelen, "corrected dinner date", {SetProperty{NodeId{1}, "event", Value::ofTime("2026-09-06")}}));
    commitAfterAMinute(kernel, clock, proposalOf(system, "advance simulation", {Advance{3}}));
    REQUIRE(kernel.world().tick() == 3);
    const CommitResult sixth =
        commitAfterAMinute(kernel, clock, proposalOf(kaelen, "", {SetProperty{NodeId{2}, "anger", Value::ofInt(4)}}));
    REQUIRE(sixth.seq == 6);
}

// The golden world written to a scratch file by the real kernel under the
// fixed clock, and the bytes it left on disk.
std::string generateGoldenBytes(const std::string& scratch) {
    auto owned = std::make_unique<FixedClock>();
    FixedClock* clock = owned.get();
    clock->at = *RecordedAt::parse(kWorldCreated);
    auto created = Kernel::create(scratch, "example", std::move(owned));
    REQUIRE_MESSAGE(created.ok(), detailOf(created));
    buildGoldenWorld(*created.value(), *clock);
    return readFile(scratch);
}

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

} // namespace

TEST_SUITE("readability") {

TEST_CASE("readability: the golden world matches docs/tree/example.tree byte for byte") {
    const std::string scratch = scratchPath("golden");
    const std::string generated = generateGoldenBytes(scratch);
    REQUIRE_FALSE(generated.empty());

    // Regeneration only on request (T-1-17): the default run compares and
    // fails on drift, so a format change is always a visible fixture diff.
    if (std::getenv("TAPESTRY_REGEN_FIXTURE") != nullptr) {
        std::filesystem::create_directories(std::filesystem::path(kFixturePath).parent_path());
        writeFile(kFixturePath, generated);
        const std::string rewrote = std::string("TAPESTRY_REGEN_FIXTURE is set: rewrote ") + kFixturePath + " ("
            + std::to_string(generated.size()) + " bytes)";
        MESSAGE(rewrote);
    }

    const std::string frozen = readFile(kFixturePath);
    const std::string missing =
        std::string("fixture missing or empty: ") + kFixturePath + " (run once with TAPESTRY_REGEN_FIXTURE=1)";
    REQUIRE_MESSAGE(!frozen.empty(), missing);
    CHECK(generated.size() == frozen.size());
    CHECK(generated == frozen);
    std::remove(scratch.c_str());
}

TEST_CASE("readability: the fixture reads as text") {
    const std::string text = readFile(kFixturePath);
    REQUIRE_FALSE(text.empty());

    // Every fact a reader should find by eye, as the literal line it is on.
    for (const char* needle : {"@tree 1 ", "world example", "created 2026-09-08T21:15:07Z", "@commit 1 ", "@commit 6 ",
             "parent sha256:", "branch main", "recorded 2026-09-08T21:16:07Z", "tick 0", "tick 3",
             "actor human kaelen", "actor plugin example.people", "actor system tapestry",
             "message \"corrected dinner date\"", "create-node n1 tapestry.notes/note@1",
             "create-node n2 example.people/person@2", "set n1 body text <<TEXT",
             "Loves architecture and weird bird memes.", "set n1 event time 2026-09-07", "set n1 event time 2026-09-06",
             "set n2 anger int 3", "set n2 position.x real 12.5", "create-edge e1 n1 n2 mentions",
             "set e1 note text \"first meeting\"", "advance 3", "@end sha256:"}) {
        CHECK_MESSAGE(text.find(needle) != std::string::npos, needle);
    }
    // The two-line body is raw lines between <<TEXT and TEXT, not one
    // escaped line.
    CHECK(text.find("set n1 body text <<TEXT\nMet Sam at dinner.\nLoves architecture and weird bird memes.\nTEXT\n")
        != std::string::npos);
    CHECK(text.find("\\n") == std::string::npos); // backslash + n appears nowhere

    // Plain LF-terminated text: one trailing line feed, no CR, no NUL, no tab.
    REQUIRE(text.size() >= 2);
    CHECK(text.back() == '\n');
    CHECK(text[text.size() - 2] != '\n');
    CHECK(text.find('\r') == std::string::npos);
    CHECK(text.find('\0') == std::string::npos);
    CHECK(text.find('\t') == std::string::npos);

    // One header record and six commits, each sealed by its own @end line.
    CHECK(countLinesStartingWith(text, "@end sha256:") == 7);
    CHECK(countLinesStartingWith(text, "@tree 1 ") == 1);
    CHECK(countLinesStartingWith(text, "@commit ") == 6);
    CHECK(countLinesStartingWith(text, "recorded ") == 6);
    CHECK(countLinesStartingWith(text, "tick ") == 6);
    CHECK(countLinesStartingWith(text, "actor ") == 6);
    CHECK(countLinesStartingWith(text, "message ") == 5); // the sixth commit has none
}

TEST_CASE("readability: the fixture reopens Ok and equals the generated world") {
    auto opened = Kernel::open(kFixturePath, OpenPolicy::ReadOnly);
    REQUIRE_MESSAGE(opened.ok(), detailOf(opened));
    const Kernel& kernel = *opened.value();
    CHECK(kernel.status().kind == JournalStatus::Kind::Ok);
    CHECK(kernel.journal().header().world == "example");
    CHECK(kernel.journal().header().created.rfc3339Z() == kWorldCreated);
    REQUIRE(kernel.journal().commitCount() == 6);
    CHECK(kernel.world().tick() == 3);
    CHECK(kernel.world().nodeCount() == 2);
    CHECK(kernel.world().edgeCount() == 1);

    const Node* note = kernel.world().node(NodeId{1});
    REQUIRE(note != nullptr);
    CHECK(note->type == "tapestry.notes/note@1");
    CHECK(note->props.at("title") == Value::ofText("Sam"));
    CHECK(note->props.at("body") == Value::ofText(kNoteBody));
    CHECK(note->props.at("event") == Value::ofTime("2026-09-06"));

    const Node* person = kernel.world().node(NodeId{2});
    REQUIRE(person != nullptr);
    CHECK(person->type == "example.people/person@2");
    CHECK(person->props.at("name") == Value::ofText("Sam"));
    CHECK(person->props.at("anger") == Value::ofInt(4));
    CHECK(person->props.at("position.x") == Value::ofReal(12.5));
    CHECK(person->props.at("position.y") == Value::ofReal(-3));

    const Edge* edge = kernel.world().edge(EdgeId{1});
    REQUIRE(edge != nullptr);
    CHECK(edge->from == NodeId{1});
    CHECK(edge->to == NodeId{2});
    CHECK(edge->label == "mentions");
    CHECK(edge->props.at("note") == Value::ofText("first meeting"));

    // Authorship and the three kinds of time, per record.
    const std::vector<CommitRecord>& commits = kernel.journal().commits();
    CHECK(commits[0].actor == Actor{"human", "kaelen"});
    CHECK(commits[2].actor == Actor{"plugin", "example.people"});
    CHECK(commits[4].actor == Actor{"system", "tapestry"});
    CHECK(commits[0].recorded.rfc3339Z() == "2026-09-08T21:16:07Z");
    CHECK(commits[5].recorded.rfc3339Z() == "2026-09-08T21:21:07Z");
    CHECK(commits[3].message == "corrected dinner date");
    CHECK(commits[5].message.empty());
    for (std::size_t i = 0; i < 5; ++i) {
        CHECK(commits[i].tick == 0);
    }
    CHECK(commits[5].tick == 3);

    // The same bytes, generated again right now, describe the same world.
    const std::string scratch = scratchPath("golden-again");
    CHECK(generateGoldenBytes(scratch) == readFile(kFixturePath));
    std::remove(scratch.c_str());
}

} // TEST_SUITE("readability")
