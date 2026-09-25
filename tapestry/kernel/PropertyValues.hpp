#pragma once

#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Time.hpp"
#include "kernel/Value.hpp"
#include "kernel/journal/Journal.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace tapestry::kernel {

// One value a property was ever set to, and the commit that set it. A plain
// copy (not a reference into the journal), so the caller can hold it after
// the journal has moved on.
struct PropertyValueEntry {
    CommitSeq seq = 0;
    RecordedAt recorded;
    Actor actor;
    Value value;
};

// Every value `key` was ever set to on `node`, in commit order, from commits
// with seq > fromSeq (0: from the beginning of the journal).
//
// A read-only scan over journal.commits() -- this adds no verb and no value
// type, the same way buildHistoryIndex (History.hpp) answers "who created
// this" from the same commits. Threads (D-06) use it to read every
// `thread.log` block a node was ever given, in the order they were
// committed, because the value's own history is the sequence of `set` lines
// (FORMAT.md: "the history of the value is the sequence of set lines") and
// nothing here stores that sequence a second time.
std::vector<PropertyValueEntry> getPropertyValues(
    const Journal& journal, NodeId node, std::string_view key, CommitSeq fromSeq = 0);

} // namespace tapestry::kernel
