#pragma once

#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
#include "kernel/Record.hpp"
#include "kernel/Result.hpp"
#include "kernel/journal/Sink.hpp"
#include "kernel/tree/Codec.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace tapestry::kernel {

// Existing: open for appending — takes the single-writer lock. ReadOnly: scan
// only, no lock, no sink; append() is refused.
enum class OpenPolicy { Existing, ReadOnly };

// What open() found. Ok: every record verified. TornTail: the last record
// could not be completed before the end of the file — an unacknowledged
// write; the complete prefix is loaded and appends are refused until an
// explicit repair (Plan 04). Corrupt: a record whose bytes are all present
// does not verify (digest, chain, seq, tick or grammar); the prefix before it
// is loaded read-only and nothing is ever repaired silently.
struct JournalStatus {
    enum class Kind { Ok, TornTail, Corrupt } kind = Kind::Ok;
    std::size_t offset = 0;      // start of the bad region
    std::size_t bytes = 0;       // TornTail: bytes from offset to the end of the file
    CommitSeq lastGoodSeq = 0;   // the last commit that verified (0: none)
    std::string reason;
};

// Why a journal could not be opened at all. Missing and NotATree never create
// or modify a file.
struct OpenFailure {
    enum class Kind { Missing, AlreadyExists, Locked, NotATree, Io } kind;
    std::string detail;
};

// The durable, append-only .tree file. open() reads and verifies every record
// before anything may be appended; append() writes one encoded record, syncs
// it, and only then records it — the caller applies to memory after append()
// returns, never before, so a crash can lose only what was never acknowledged.
class Journal {
public:
    // Writes the @tree header record durably into a new file.
    static Expected<std::unique_ptr<Journal>, OpenFailure> create(const std::filesystem::path& path,
        const HeaderRecord& header);
    static Expected<std::unique_ptr<Journal>, OpenFailure> createWithSink(std::unique_ptr<Sink> sink,
        const HeaderRecord& header);

    // Reads the whole file, scans and classifies it, then (Existing) opens a
    // PosixSink for appending. A missing path is Missing; an empty file or one
    // not beginning with `@tree 1 ` is NotATree; a second writer is Locked.
    static Expected<std::unique_ptr<Journal>, OpenFailure> open(const std::filesystem::path& path,
        OpenPolicy policy);

    // Scans the given bytes as if they were the file; the sink may be a test
    // double or nullptr for read-only.
    static Expected<std::unique_ptr<Journal>, OpenFailure> openBytes(std::string bytes,
        std::unique_ptr<Sink> sink);

    const HeaderRecord& header() const { return m_header; }
    const std::vector<CommitRecord>& commits() const { return m_commits; }
    std::size_t commitCount() const { return m_commits.size(); }
    const JournalStatus& status() const { return m_status; }
    const Digest& lastDigest() const { return m_lastDigest; }
    CommitSeq lastSeq() const { return m_lastSeq; }
    std::uint64_t verifiedBytes() const { return m_verifiedBytes; }

    // writeAll → sync → record. Refused (nothing written) unless status() is
    // Ok, a sink exists, and the record chains from lastDigest() with
    // seq == lastSeq() + 1.
    std::optional<IoError> append(const tree::Encoded& encoded, const CommitRecord& record);

    // A verified record whose ops the world refused to apply (the kernel
    // replaying it found an id or target that does not fit): the journal is
    // Corrupt from that commit on, and appends are refused.
    void markCorrupt(CommitSeq seq, std::string reason);

    // Plan 04 adds:
    //   RepairResult repair(RecordedAt now);
    //   std::optional<IoError> saveAs(const std::filesystem::path& path);

private:
    Journal() = default;

    static Expected<std::unique_ptr<Journal>, OpenFailure> scan(std::string bytes);

    HeaderRecord m_header;
    std::vector<CommitRecord> m_commits;
    std::vector<std::size_t> m_commitBegins;
    JournalStatus m_status;
    Digest m_lastDigest;
    CommitSeq m_lastSeq = 0;
    std::uint64_t m_verifiedBytes = 0;
    std::unique_ptr<Sink> m_sink;
};

} // namespace tapestry::kernel
