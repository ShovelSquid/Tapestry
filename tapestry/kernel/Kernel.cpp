// The single-writer transaction kernel. submit() is the only way anything
// changes, and its order is fixed: validate on a scratch copy, encode, write
// and sync through the journal, and only then swap the scratch copy in.

#include "kernel/Kernel.hpp"

#include "kernel/Value.hpp"
#include "kernel/tree/Codec.hpp"

#include <utility>
#include <variant>

namespace tapestry::kernel {
namespace {

std::unique_ptr<Clock> clockOrSystem(std::unique_ptr<Clock> clock) {
    if (clock) {
        return clock;
    }
    return std::make_unique<SystemClock>();
}

std::optional<OpenFailure> checkWorldName(const std::string& name) {
    if (!isToken(name) || !isValidText(name)) {
        return OpenFailure{OpenFailure::Kind::Io, "world name is not one token: " + name};
    }
    return std::nullopt;
}

} // namespace

Kernel::Kernel(std::unique_ptr<Journal> journal, std::unique_ptr<Clock> clock)
    : m_journal(std::move(journal)), m_clock(std::move(clock)) {}

Expected<std::unique_ptr<Kernel>, OpenFailure> Kernel::create(const std::filesystem::path& path,
    std::string worldName, std::unique_ptr<Clock> clock) {
    if (auto failure = checkWorldName(worldName)) {
        return *failure;
    }
    auto ticking = clockOrSystem(std::move(clock));
    HeaderRecord header;
    header.world = std::move(worldName);
    header.created = ticking->now();
    auto journal = Journal::create(path, header);
    if (!journal) {
        return journal.error();
    }
    return fromJournal(std::move(journal.value()), std::move(ticking));
}

Expected<std::unique_ptr<Kernel>, OpenFailure> Kernel::createWithSink(std::unique_ptr<Sink> sink,
    std::string worldName, std::unique_ptr<Clock> clock) {
    if (auto failure = checkWorldName(worldName)) {
        return *failure;
    }
    auto ticking = clockOrSystem(std::move(clock));
    HeaderRecord header;
    header.world = std::move(worldName);
    header.created = ticking->now();
    auto journal = Journal::createWithSink(std::move(sink), header);
    if (!journal) {
        return journal.error();
    }
    return fromJournal(std::move(journal.value()), std::move(ticking));
}

Expected<std::unique_ptr<Kernel>, OpenFailure> Kernel::open(const std::filesystem::path& path, OpenPolicy policy,
    std::unique_ptr<Clock> clock) {
    auto journal = Journal::open(path, policy);
    if (!journal) {
        return journal.error();
    }
    return fromJournal(std::move(journal.value()), clockOrSystem(std::move(clock)));
}

Expected<std::unique_ptr<Kernel>, OpenFailure> Kernel::openBytes(std::string bytes, std::unique_ptr<Sink> sink,
    std::unique_ptr<Clock> clock) {
    auto journal = Journal::openBytes(std::move(bytes), std::move(sink));
    if (!journal) {
        return journal.error();
    }
    return fromJournal(std::move(journal.value()), clockOrSystem(std::move(clock)));
}

Expected<std::unique_ptr<Kernel>, OpenFailure> Kernel::fromJournal(std::unique_ptr<Journal> journal,
    std::unique_ptr<Clock> clock) {
    std::unique_ptr<Kernel> kernel(new Kernel(std::move(journal), std::move(clock)));
    // Replay every verified commit with its committed ids, one commit at a
    // time on a scratch copy so a commit that will not apply leaves the world
    // at the previous commit rather than half-way through. A verified record
    // the world refuses is corruption of the history, not a crash.
    for (const CommitRecord& commit : kernel->m_journal->commits()) {
        World scratch = kernel->m_world;
        for (const Op& original : commit.ops) {
            Op op = original;
            if (auto rejection = scratch.prepare(op)) {
                kernel->m_journal->markCorrupt(commit.seq, "apply: " + rejection->detail);
                return kernel;
            }
            scratch.apply(op);
        }
        kernel->m_world = std::move(scratch);
    }
    return kernel;
}

Expected<CommitResult, Rejection> Kernel::submit(const Proposal& proposal) {
    using Kind = Rejection::Kind;
    if (m_journal->status().kind != JournalStatus::Kind::Ok) {
        return Rejection{Kind::JournalNotClean, m_journal->status().reason};
    }
    if (!isValidActorKind(proposal.actor.kind) || !isToken(proposal.actor.id) || !isValidText(proposal.actor.id)) {
        return Rejection{Kind::BadActor, proposal.actor.kind + " " + proposal.actor.id};
    }
    if (!isValidText(proposal.message)) {
        return Rejection{Kind::BadValue, "message is not valid UTF-8"};
    }

    // 1. Validate every op on a scratch copy; ids are assigned here.
    World scratch = m_world;
    CommitRecord record;
    CommitResult result;
    for (const Op& original : proposal.ops) {
        Op op = original;
        if (auto rejection = scratch.prepare(op)) {
            return *rejection;
        }
        if (const auto* create = std::get_if<CreateNode>(&op)) {
            result.nodeIds.push_back(create->id);
        } else if (const auto* edge = std::get_if<CreateEdge>(&op)) {
            result.edgeIds.push_back(edge->id);
        }
        scratch.apply(op);
        record.ops.push_back(std::move(op));
    }

    // 2. Build and encode the record.
    record.seq = m_journal->lastSeq() + 1;
    record.parent = m_journal->lastDigest();
    record.branch = "main";
    record.recorded = m_clock->now();
    record.tick = m_world.tick();
    record.actor = proposal.actor;
    record.message = proposal.message;
    const tree::Encoded encoded = tree::encodeCommit(record);

    // 3. Durable write, then sync. A failure here changes nothing.
    if (auto failure = m_journal->append(encoded, record)) {
        return Rejection{Kind::Io, failure->what};
    }

    // 4. Only now does the world move.
    m_world = std::move(scratch);
    result.seq = record.seq;
    result.digest = encoded.digest;
    return result;
}

} // namespace tapestry::kernel
