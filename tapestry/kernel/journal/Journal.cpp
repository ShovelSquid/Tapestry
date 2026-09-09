// The durable append-only file. open() classifies before anything may be
// appended; append() acknowledges only after sync(); the valid prefix is
// always loaded and nothing is ever repaired silently.

#include "kernel/journal/Journal.hpp"

#include "kernel/Ops.hpp"
#include "kernel/Value.hpp"

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <variant>

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
    auto journal = createWithSink(std::move(sink.value()), header);
    if (!journal) {
        OpenFailure failure = journal.error();
        std::error_code cleanup;
        std::filesystem::remove(path, cleanup);
        if (cleanup) {
            failure.detail += "; could not remove failed creation: " + cleanup.message();
        }
        return failure;
    }
    journal.value()->m_path = path;
    return std::move(journal.value());
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
    auto check = tree::decodeHeader(encoded.bytes);
    if (!check) {
        return OpenFailure{OpenKind::Io, "header would not decode: " + check.error().detail};
    }
    if (auto failure = sink->writeAll(encoded.bytes)) {
        return fromIo(*failure);
    }
    if (auto failure = sink->sync()) {
        return fromIo(*failure);
    }
    std::unique_ptr<Journal> journal(new Journal());
    journal->m_header = header;
    journal->m_headerDigest = encoded.digest;
    journal->m_headerEnd = encoded.bytes.size();
    journal->m_lastDigest = encoded.digest;
    journal->m_verifiedBytes = encoded.bytes.size();
    journal->m_bytes = encoded.bytes;
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
    journal->m_headerDigest = header.value().digest;
    journal->m_headerEnd = header.value().end;
    journal->m_lastDigest = header.value().digest;
    journal->m_verifiedBytes = header.value().end;

    std::size_t position = header.value().end;
    // The tick a commit must carry is the tick the replayed world is at:
    // zero, raised by every advance op in the verified commits before it.
    Tick expectedTick = 0;
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
        bool tickOverflow = false;
        for (const Op& op : decoded.record.ops) {
            if (const auto* advance = std::get_if<Advance>(&op)) {
                if (advance->ticks > std::numeric_limits<Tick>::max() - expectedTick) {
                    JournalStatus status;
                    status.kind = JournalStatus::Kind::Corrupt;
                    status.offset = decoded.begin;
                    status.lastGoodSeq = journal->m_lastSeq;
                    status.reason = "commit " + std::to_string(decoded.record.seq)
                        + ": advance would overflow the tick counter";
                    journal->m_status = std::move(status);
                    tickOverflow = true;
                    break;
                }
                expectedTick += advance->ticks;
            }
        }
        if (tickOverflow) {
            break;
        }
        journal->m_commits.push_back(std::move(decoded.record));
        journal->m_commitBegins.push_back(decoded.begin);
        journal->m_commitEnds.push_back(decoded.end);
        journal->m_commitDigests.push_back(decoded.digest);
        journal->m_lastDigest = decoded.digest;
        journal->m_lastSeq += 1;
        journal->m_verifiedBytes = decoded.end;
        position = decoded.end;
    }
    if (journal->m_status.kind == JournalStatus::Kind::Ok) {
        journal->m_status.lastGoodSeq = journal->m_lastSeq;
    }
    journal->m_bytes = std::move(bytes);
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
    journal.value()->m_path = path;
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
        markUnacknowledged(encoded.bytes, *failure);
        return failure;
    }
    if (auto failure = m_sink->sync()) {
        markUnacknowledged(encoded.bytes, *failure);
        return failure;
    }
    // Only now: the bytes are on the medium.
    m_commits.push_back(record);
    m_commitBegins.push_back(static_cast<std::size_t>(m_verifiedBytes));
    m_commitEnds.push_back(static_cast<std::size_t>(m_verifiedBytes + encoded.bytes.size()));
    m_commitDigests.push_back(encoded.digest);
    m_lastDigest = encoded.digest;
    m_lastSeq = record.seq;
    m_verifiedBytes += encoded.bytes.size();
    m_bytes += encoded.bytes;
    m_status.lastGoodSeq = record.seq;
    return std::nullopt;
}

// An append the sink did not confirm. Whatever reached the sink past the
// verified prefix (the sink's own size says how much — a real crash before
// the flush may have kept any prefix of it, Assumption A3) is an
// unacknowledged tail: kept in m_bytes so an explicit repair can preserve it,
// and reported as TornTail so nothing is ever appended behind it. Writing on
// would put a second `@commit <seq>` after the first and corrupt the file.
void Journal::markUnacknowledged(std::string_view attempted, const IoError& error) {
    const std::uint64_t size = m_sink->size();
    std::size_t landed = 0;
    if (size > m_verifiedBytes) {
        landed = static_cast<std::size_t>(std::min<std::uint64_t>(size - m_verifiedBytes, attempted.size()));
    }
    m_bytes.resize(static_cast<std::size_t>(m_verifiedBytes));
    m_bytes.append(attempted.data(), landed);
    JournalStatus status;
    status.kind = JournalStatus::Kind::TornTail;
    status.offset = static_cast<std::size_t>(m_verifiedBytes);
    status.bytes = landed;
    status.lastGoodSeq = m_lastSeq;
    status.reason = "append not acknowledged (" + error.what + "): " + std::to_string(landed)
        + " unconfirmed bytes after the verified prefix";
    m_status = status;
}

void Journal::markCorrupt(CommitSeq seq, std::string reason) {
    const std::size_t keep = (seq >= 1 && seq <= m_commits.size()) ? static_cast<std::size_t>(seq - 1) : 0;
    JournalStatus status;
    status.kind = JournalStatus::Kind::Corrupt;
    status.lastGoodSeq = static_cast<CommitSeq>(keep);
    status.offset = keep < m_commitBegins.size() ? m_commitBegins[keep] : m_headerEnd;
    status.bytes = 0;
    status.reason = "commit " + std::to_string(seq) + ": " + std::move(reason);

    m_commits.resize(keep);
    m_commitBegins.resize(keep);
    m_commitEnds.resize(keep);
    m_commitDigests.resize(keep);
    m_lastSeq = static_cast<CommitSeq>(keep);
    m_lastDigest = keep == 0 ? m_headerDigest : m_commitDigests[keep - 1];
    m_verifiedBytes = keep == 0 ? m_headerEnd : m_commitEnds[keep - 1];
    m_status = status;
}

RepairResult Journal::repair(RecordedAt now) {
    RepairResult result;
    if (m_status.kind == JournalStatus::Kind::Ok) {
        result.detail = "journal is Ok: nothing to repair";
        return result;
    }
    if (m_status.kind == JournalStatus::Kind::Corrupt) {
        // Bytes that are all present and do not verify are not a torn tail;
        // cutting them would discard history a person has not looked at.
        result.detail = "journal is Corrupt, not torn: " + m_status.reason;
        return result;
    }
    if (!m_sink) {
        result.detail = "journal is read-only: open it for writing to repair";
        return result;
    }
    if (m_path.empty()) {
        result.detail = "journal has no file: nowhere to put a sidecar";
        return result;
    }

    // The sidecar name comes from the journal path and the clock only.
    std::string stamp = now.rfc3339Z();
    std::replace(stamp.begin(), stamp.end(), ':', '-');
    result.sidecar = m_path;
    result.sidecar += ".torn-" + stamp;

    const std::size_t verified = static_cast<std::size_t>(m_verifiedBytes);
    const std::string_view tail = std::string_view(m_bytes).substr(std::min(verified, m_bytes.size()));

    // 1. Preserve the tail verbatim, durably, in a file that did not exist.
    auto sidecar = openPosixSink(result.sidecar, SinkMode::CreateNew);
    if (!sidecar) {
        result.detail = "create sidecar " + result.sidecar.string() + ": " + sidecar.error().what + ": "
            + errnoText(sidecar.error().errnoValue);
        return result;
    }
    if (auto failure = sidecar.value()->writeAll(tail)) {
        result.detail = "write sidecar " + result.sidecar.string() + ": " + failure->what + ": "
            + errnoText(failure->errnoValue);
        sidecar.value().reset();
        std::error_code cleanup;
        std::filesystem::remove(result.sidecar, cleanup);
        if (cleanup) {
            result.detail += "; could not remove failed sidecar: " + cleanup.message();
        }
        return result;
    }
    if (auto failure = sidecar.value()->sync()) {
        result.detail = "sync sidecar " + result.sidecar.string() + ": " + failure->what + ": "
            + errnoText(failure->errnoValue);
        sidecar.value().reset();
        std::error_code cleanup;
        std::filesystem::remove(result.sidecar, cleanup);
        if (cleanup) {
            result.detail += "; could not remove failed sidecar: " + cleanup.message();
        }
        return result;
    }
    sidecar.value().reset();

    // 2. Only now cut the journal back to what verified, and flush that.
    if (auto failure = m_sink->truncate(m_verifiedBytes)) {
        result.detail = "truncate journal to " + std::to_string(verified) + " bytes (tail preserved in "
            + result.sidecar.string() + "): " + failure->what + ": " + errnoText(failure->errnoValue);
        return result;
    }

    // 3. The journal is exactly its verified prefix again.
    m_bytes.resize(verified);
    m_status = JournalStatus{};
    m_status.lastGoodSeq = m_lastSeq;
    result.repaired = true;
    result.bytesMoved = tail.size();
    result.detail = "moved " + std::to_string(tail.size()) + " unverified bytes to " + result.sidecar.string()
        + " and truncated the journal to " + std::to_string(verified) + " bytes";
    return result;
}

std::optional<IoError> Journal::saveAs(const std::filesystem::path& path) const {
    auto sink = openPosixSink(path, SinkMode::CreateNew); // EEXIST for an existing file
    if (!sink) {
        return sink.error();
    }
    const std::string_view prefix = std::string_view(m_bytes).substr(0, static_cast<std::size_t>(m_verifiedBytes));
    if (auto failure = sink.value()->writeAll(prefix)) {
        sink.value().reset();
        std::error_code cleanup;
        std::filesystem::remove(path, cleanup);
        if (cleanup) {
            failure->what += "; could not remove failed copy: " + cleanup.message();
        }
        return failure;
    }
    if (auto failure = sink.value()->sync()) {
        sink.value().reset();
        std::error_code cleanup;
        std::filesystem::remove(path, cleanup);
        if (cleanup) {
            failure->what += "; could not remove failed copy: " + cleanup.message();
        }
        return failure;
    }
    return std::nullopt;
}

} // namespace tapestry::kernel
