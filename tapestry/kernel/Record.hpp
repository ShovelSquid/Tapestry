#pragma once

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Time.hpp"

#include <string>
#include <vector>

namespace tapestry::kernel {

// The first record of every .tree file: `@tree 1 <bytes>` … `@end`. It names
// the world and stamps its creation; its digest is the parent of commit 1, so
// the chain has an anchor before any change exists.
struct HeaderRecord {
    int version = 1;
    std::string world;
    RecordedAt created;
    // `x-…` lines a plugin or a later Tapestry wrote into the header. Kept
    // verbatim and in order; the kernel never interprets them.
    std::vector<std::string> extensionLines;
};

// One committed change: `@commit <seq> <bytes>` … `@end sha256:<hex>`. The
// header lines are fixed and in this order in the file — parent, branch,
// recorded, tick, actor, then an optional message — followed by the op lines
// and finally any extension lines. Ordering of history comes from seq and
// parent alone; recorded is audit information.
struct CommitRecord {
    CommitSeq seq = 0;
    Digest parent;
    std::string branch = "main";
    RecordedAt recorded;
    Tick tick = 0;
    Actor actor;
    std::string message;
    std::vector<Op> ops;
    // `x-…` lines, verbatim, emitted after the ops.
    std::vector<std::string> extensionLines;
};

} // namespace tapestry::kernel
