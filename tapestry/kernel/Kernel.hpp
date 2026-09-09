#pragma once

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Ops.hpp"
#include "kernel/Result.hpp"
#include "kernel/Time.hpp"
#include "kernel/World.hpp"
#include "kernel/journal/Journal.hpp"
#include "kernel/journal/Sink.hpp"

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace tapestry::kernel {

// What a caller asks the kernel to commit: who, why, and the ops. Ids in
// creation ops are 0; the kernel assigns them and returns them.
struct Proposal {
    Actor actor;
    std::string message;
    std::vector<Op> ops;
};

// What a successful submit returns: the commit's seq and digest, and the ids
// the creation ops received, in op order.
struct CommitResult {
    CommitSeq seq;
    Digest digest;
    std::vector<NodeId> nodeIds;
    std::vector<EdgeId> edgeIds;
};

// The single-writer transaction kernel: one open world, one journal, one way
// to change anything. Phase 2 plugin proposals go through the same submit().
class Kernel {
public:
    // A new world in a new file: writes the @tree header durably. The world
    // name is one token. A null clock means SystemClock.
    static Expected<std::unique_ptr<Kernel>, OpenFailure> create(const std::filesystem::path& path,
        std::string worldName, std::unique_ptr<Clock> clock = nullptr);
    static Expected<std::unique_ptr<Kernel>, OpenFailure> createWithSink(std::unique_ptr<Sink> sink,
        std::string worldName, std::unique_ptr<Clock> clock = nullptr);

    // An existing file: scans and verifies the journal, then rebuilds the
    // world by replaying every verified commit with its committed ids. On
    // failure no file is created or modified.
    static Expected<std::unique_ptr<Kernel>, OpenFailure> open(const std::filesystem::path& path,
        OpenPolicy policy, std::unique_ptr<Clock> clock = nullptr);
    static Expected<std::unique_ptr<Kernel>, OpenFailure> openBytes(std::string bytes,
        std::unique_ptr<Sink> sink, std::unique_ptr<Clock> clock = nullptr);

    // The only mutation path, in this fixed order: refuse unless the journal
    // is Ok; validate the actor; prepare and apply every op on a scratch copy
    // of the world (assigning ids); build the record (seq = lastSeq + 1,
    // parent = lastDigest, branch main, recorded = clock now, tick = the
    // world's tick); encode; Journal::append (write, then sync); and only
    // then replace the world with the scratch copy. A Rejection or an I/O
    // error at any point leaves both the file and world() exactly as before.
    Expected<CommitResult, Rejection> submit(const Proposal& proposal);

    const World& world() const { return m_world; }
    const JournalStatus& status() const { return m_journal->status(); }
    const Journal& journal() const { return *m_journal; }

    // Plan 04 adds:
    //   RepairResult repair();
    //   std::optional<IoError> saveAs(const std::filesystem::path& path);

private:
    Kernel(std::unique_ptr<Journal> journal, std::unique_ptr<Clock> clock);

    // Replays the journal's verified commits into the world.
    static Expected<std::unique_ptr<Kernel>, OpenFailure> fromJournal(std::unique_ptr<Journal> journal,
        std::unique_ptr<Clock> clock);

    std::unique_ptr<Journal> m_journal;
    std::unique_ptr<Clock> m_clock;
    World m_world;
};

} // namespace tapestry::kernel
