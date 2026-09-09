// The durable append-only file. open() classifies before anything may be
// appended; append() acknowledges only after sync(); the valid prefix is
// always loaded and nothing is ever repaired silently.

#include "kernel/journal/Journal.hpp"

#include "kernel/Ops.hpp"
#include "kernel/Value.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>
#include <utility>

namespace tapestry::kernel {
namespace {

using OpenKind = OpenFailure::Kind;

std::string errnoText(int value) { return value == 0 ? std::string() : std::string(std::strerror(value)); }

// Whole file as bytes, binary C stdio so the scan sees exactly what is on
// disk. A missing path is Missing and creates nothing.
Expected<std::string, OpenFailure> readWholeFile(const std::filesystem::path& path) {
    std::FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        const int error = errno;
        if (error == ENOENT) {
            return OpenFailure{OpenKind::Missing, path.string()};
        }
        return OpenFailure{OpenKind::Io, "open for reading: " + errnoText(error)};
    }
    std::string bytes;
    char buffer[65536];
    for (;;) {
        const std::size_t got = std::fread(buffer, 1, sizeof buffer, file);
        if (got == 0) {
            break;
        }
        bytes.append(buffer, got);
    }
    const bool failed = std::ferror(file) != 0;
    std::fclose(file);
    if (failed) {
        return OpenFailure{OpenKind::Io, "read: " + path.string()};
    }
    return bytes;
}

OpenFailure fromIo(const IoError& error) {
    if (error.errnoValue == EWOULDBLOCK && error.what == "locked") {
        return OpenFailure{OpenKind::Locked, "another process holds the journal lock"};
    }
    if (error.errnoValue == EEXIST) {
        return OpenFailure{OpenKind::AlreadyExists, error.what};
    }
    if (error.errnoValue == ENOENT) {
        return OpenFailure{OpenKind::Missing, error.what};
    }
    return OpenFailure{OpenKind::Io, error.what + ": " + errnoText(error.errnoValue)};
}

const char* reasonName(tree::DecodeFailure::Reason reason) {
    using Reason = tree::DecodeFailure::Reason;
    switch (reason) {
    case Reason::Truncated:      return "truncated";
    case Reason::BadEnvelope:    return "bad envelope";
    case Reason::DigestMismatch: return "digest mismatch";
    case Reason::ChainBreak:     return "chain break";
    case Reason::SeqGap:         return "seq gap";
    case Reason::TickMismatch:   return "tick mismatch";
    case Reason::UnsupportedOp:  return "unsupported op";
    case Reason::BadLine:        return "bad line";
    case Reason::BadValue:       return "bad value";
    case Reason::InvalidUtf8:    return "invalid utf-8";
    case Reason::LimitExceeded:  return "limit exceeded";
    case Reason::NotATree:       break;
    }
    return "not a tree";
}

std::string describe(const tree::DecodeFailure& failure) {
    return std::string(reasonName(failure.reason)) + " at offset " + std::to_string(failure.offset) + ": "
        + failure.detail;
}

// A header the encoder can write and the decoder will read back.
std::optional<OpenFailure> checkHeader(const HeaderRecord& header) {
    if (header.version != 1) {
        return OpenFailure{OpenKind::Io, "unsupported .tree version"};
    }
    if (!isToken(header.world) || !isValidText(header.world)) {
        return OpenFailure{OpenKind::Io, "world name is not one token"};
    }
    for (const std::string& line : header.extensionLines) {
        if (line.size() < 2 || line.substr(0, 2) != "x-" || !isValidText(line) || line.find('\n') != std::string::npos) {
            return OpenFailure{OpenKind::Io, "extension line must start with x- and be one line of text"};
        }
    }
    return std::nullopt;
}

} // namespace

Expected<std::unique_ptr<Journal>, OpenFailure> Journal::create(const std::filesystem::path& path,
    const HeaderRecord& header) {
    if (auto failure = checkHeader(header)) {
        return *failure;
    }
    auto sink = openPosixSink(path, SinkMode::CreateNew);
    if (!sink) {
        return fromIo(sink.error());
    }
    return createWithSink(std::move(sink.value()), header);
}

Expected<std::unique_ptr<Journal>, OpenFailure> Journal::createWithSink(std::unique_ptr<Sink> sink,
    const HeaderRecord& header) {
    if (!sink) {
        return OpenFailure{OpenKind::Io, "no sink"};
    }
    if (auto failure = checkHeader(header)) {
        return *failure;
    }
    const tree::Encoded encoded = tree::encodeHeader(header);
    if (auto failure = sink->writeAll(encoded.bytes)) {
        return fromIo(*failure);
    }
    if (auto failure = sink->sync()) {
        return fromIo(*failure);
    }
    std::unique_ptr<Journal> journal(new Journal());
    journal->m_header = header;
    journal->m_lastDigest = encoded.digest;
    journal->m_verifiedBytes = encoded.bytes.size();
    journal->m_sink = std::move(sink);
    return journal;
}

Expected<std::unique_ptr<Journal>, OpenFailure> Journal::scan(std::string bytes) {
    std::unique_ptr<Journal> journal(new Journal());
    auto header = tree::decodeHeader(bytes);
    if (!header) {
        // Without a complete, verified header record there is no world to
        // load: report it as not a usable .tree file, with the reason.
        return OpenFailure{OpenKind::NotATree, describe(header.error())};
    }
    journal->m_header = std::move(header.value().record);
    journal->m_lastDigest = header.value().digest;
    journal->m_verifiedBytes = header.value().end;

    std::size_t position = header.value().end;
    const Tick expectedTick = 0; // Plan 03: follows advance ops
    while (position < bytes.size()) {
        auto commit = tree::decodeCommit(bytes, position, journal->m_lastDigest, journal->m_lastSeq + 1, expectedTick);
        if (!commit) {
            // The first failure decides the class. At end of input: the
            // record was never completed — an unacknowledged write, safe to
            // repair. Anywhere else: bytes that are all present do not
            // verify — corruption, never repaired silently.
            const tree::DecodeFailure& failure = commit.error();
            JournalStatus status;
            status.lastGoodSeq = journal->m_lastSeq;
            if (failure.atEof) {
                status.kind = JournalStatus::Kind::TornTail;
                status.offset = position;
                status.bytes = bytes.size() - position;
            } else {
                status.kind = JournalStatus::Kind::Corrupt;
                status.offset = failure.offset;
                status.bytes = 0;
            }
            status.reason = describe(failure);
            journal->m_status = status;
            break;
        }
        tree::DecodedCommit& decoded = commit.value();
        journal->m_commits.push_back(std::move(decoded.record));
        journal->m_commitBegins.push_back(decoded.begin);
        journal->m_lastDigest = decoded.digest;
        journal->m_lastSeq += 1;
        journal->m_verifiedBytes = decoded.end;
        position = decoded.end;
    }
    return journal;
}

Expected<std::unique_ptr<Journal>, OpenFailure> Journal::open(const std::filesystem::path& path,
    OpenPolicy policy) {
    auto bytes = readWholeFile(path);
    if (!bytes) {
        return bytes.error();
    }
    const std::size_t size = bytes.value().size();
    auto journal = scan(std::move(bytes.value()));
    if (!journal) {
        return journal.error();
    }
    if (policy == OpenPolicy::Existing) {
        auto sink = openPosixSink(path, SinkMode::AppendExisting);
        if (!sink) {
            return fromIo(sink.error());
        }
        if (sink.value()->size() != size) {
            return OpenFailure{OpenKind::Io, "journal changed while it was being opened"};
        }
        journal.value()->m_sink = std::move(sink.value());
    }
    return std::move(journal.value());
}

Expected<std::unique_ptr<Journal>, OpenFailure> Journal::openBytes(std::string bytes, std::unique_ptr<Sink> sink) {
    auto journal = scan(std::move(bytes));
    if (!journal) {
        return journal.error();
    }
    journal.value()->m_sink = std::move(sink);
    return std::move(journal.value());
}

std::optional<IoError> Journal::append(const tree::Encoded& encoded, const CommitRecord& record) {
    if (!m_sink) {
        return IoError{0, "journal is read-only"};
    }
    if (m_status.kind != JournalStatus::Kind::Ok) {
        return IoError{0, "journal is not clean: " + m_status.reason};
    }
    if (record.seq != m_lastSeq + 1 || record.parent != m_lastDigest) {
        return IoError{0, "record does not chain from the last verified record"};
    }
    if (auto failure = m_sink->writeAll(encoded.bytes)) {
        return failure;
    }
    if (auto failure = m_sink->sync()) {
        return failure;
    }
    // Only now: the bytes are on the medium.
    m_commits.push_back(record);
    m_commitBegins.push_back(static_cast<std::size_t>(m_verifiedBytes));
    m_lastDigest = encoded.digest;
    m_lastSeq = record.seq;
    m_verifiedBytes += encoded.bytes.size();
    return std::nullopt;
}

void Journal::markCorrupt(CommitSeq seq, std::string reason) {
    JournalStatus status;
    status.kind = JournalStatus::Kind::Corrupt;
    status.lastGoodSeq = seq > 0 ? seq - 1 : 0;
    status.offset = (seq >= 1 && seq <= m_commitBegins.size()) ? m_commitBegins[static_cast<std::size_t>(seq - 1)] : 0;
    status.bytes = 0;
    status.reason = "commit " + std::to_string(seq) + ": " + std::move(reason);
    m_status = status;
}

} // namespace tapestry::kernel
