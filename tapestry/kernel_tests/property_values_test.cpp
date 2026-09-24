// Reading every past value of one property key, in commit order (D-06).
//
// A thread's `thread.log` blocks read back the same way buildHistoryIndex
// reads authorship: a scan over Journal::commits(), nothing stored twice.

#include "kernel/Ids.hpp"
#include "kernel/Kernel.hpp"
#include "kernel/Ops.hpp"
#include "kernel/PropertyValues.hpp"
#include "kernel/Value.hpp"
#include "kernel_tests/support.hpp"

#include <doctest.h>

#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace {

using tapestry::kernel::Actor;
using tapestry::kernel::CreateNode;
using tapestry::kernel::getPropertyValues;
using tapestry::kernel::Kernel;
using tapestry::kernel::NodeId;
using tapestry::kernel::Op;
using tapestry::kernel::Proposal;
using tapestry::kernel::SetProperty;
using tapestry::kernel::Value;
using tapestry::kernel::test::scratchPath;

const char* const kThreadType = "tapestry.threads/thread@1";

Actor human(const char* id) { return Actor{"human", id}; }

void submitOk(Kernel& kernel, const Actor& actor, const char* message, std::vector<Op> ops) {
    Proposal proposal;
    proposal.actor = actor;
    proposal.message = message;
    proposal.ops = std::move(ops);
    auto result = kernel.submit(proposal);
    REQUIRE_MESSAGE(result.ok(), (result.ok() ? std::string("ok") : result.error().detail));
}

CreateNode thread() {
    CreateNode create;
    create.type = kThreadType;
    return create;
}

} // namespace

TEST_CASE("property values: an empty journal has no values for any key") {
    auto created = Kernel::create(scratchPath("property-values-empty"), "pv");
    REQUIRE_MESSAGE(created.ok(), (created.ok() ? std::string("ok") : created.error().detail));
    auto kernel = std::move(created.value());

    const auto values = getPropertyValues(kernel->journal(), NodeId{1}, "thread.log");
    CHECK(values.empty());
}

TEST_CASE("property values: several sets of one key come back in commit order") {
    auto created = Kernel::create(scratchPath("property-values-order"), "pv");
    REQUIRE_MESSAGE(created.ok(), (created.ok() ? std::string("ok") : created.error().detail));
    auto kernel = std::move(created.value());

    submitOk(*kernel, human("user.kaelen"), "Create thread", {thread()});
    submitOk(*kernel, human("user.kaelen"), "Batch 1",
        {SetProperty{NodeId{1}, "thread.log",
            Value::ofText("thread 1 v0\nat 2026-09-15T21:04:10.250Z\n+0.000 ins 1 \"H\"")}});
    submitOk(*kernel, human("user.kaelen"), "Batch 2",
        {SetProperty{NodeId{1}, "thread.log",
            Value::ofText("thread 1 v1\nat 2026-09-15T21:04:11.000Z\n+0.000 ins 2 \"i\"")}});

    const auto values = getPropertyValues(kernel->journal(), NodeId{1}, "thread.log");
    REQUIRE(values.size() == 2);
    CHECK(values[0].seq == 2);
    CHECK(values[0].actor == human("user.kaelen"));
    CHECK(values[0].value.text.find("v0") != std::string::npos);
    CHECK(values[1].seq == 3);
    CHECK(values[1].value.text.find("v1") != std::string::npos);
}

TEST_CASE("property values: fromSeq cuts everything at or before it") {
    auto created = Kernel::create(scratchPath("property-values-fromseq"), "pv");
    REQUIRE_MESSAGE(created.ok(), (created.ok() ? std::string("ok") : created.error().detail));
    auto kernel = std::move(created.value());

    submitOk(*kernel, human("user.kaelen"), "Create thread", {thread()});
    submitOk(*kernel, human("user.kaelen"), "Batch 1",
        {SetProperty{NodeId{1}, "thread.log", Value::ofText("first")}});
    submitOk(*kernel, human("user.kaelen"), "Batch 2",
        {SetProperty{NodeId{1}, "thread.log", Value::ofText("second")}});

    const auto all = getPropertyValues(kernel->journal(), NodeId{1}, "thread.log");
    REQUIRE(all.size() == 2);

    const auto afterFirst = getPropertyValues(kernel->journal(), NodeId{1}, "thread.log", all[0].seq);
    REQUIRE(afterFirst.size() == 1);
    CHECK(afterFirst[0].value.text == "second");
}

TEST_CASE("property values: a different key or node is never returned") {
    auto created = Kernel::create(scratchPath("property-values-scoped"), "pv");
    REQUIRE_MESSAGE(created.ok(), (created.ok() ? std::string("ok") : created.error().detail));
    auto kernel = std::move(created.value());

    submitOk(*kernel, human("user.kaelen"), "Create two threads", {thread(), thread()});
    submitOk(*kernel, human("user.kaelen"), "Set on n1",
        {SetProperty{NodeId{1}, "thread.log", Value::ofText("n1 log")}});
    submitOk(*kernel, human("user.kaelen"), "Set on n2",
        {SetProperty{NodeId{2}, "thread.log", Value::ofText("n2 log")}});
    submitOk(*kernel, human("user.kaelen"), "Set unrelated key on n1",
        {SetProperty{NodeId{1}, "body", Value::ofText("hello")}});

    const auto n1Log = getPropertyValues(kernel->journal(), NodeId{1}, "thread.log");
    REQUIRE(n1Log.size() == 1);
    CHECK(n1Log[0].value.text == "n1 log");
}
