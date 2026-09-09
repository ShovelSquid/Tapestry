#pragma once

#include "kernel/Result.hpp"

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace tapestry::kernel {

// An operating-system error, carried rather than thrown: the errno value and
// a short note on which call failed.
struct IoError {
    int errnoValue = 0;
    std::string what;
};

// The durability seam: one open journal file, append position only. The
// journal never sees a file descriptor — it hands whole records to a Sink and
// waits for sync() before acknowledging anything — so a test double can
// record the write/sync order, truncate a write or fail a sync, and the
// journal code under test is the production code.
class Sink {
public:
    virtual ~Sink() = default;

    // Appends every byte or reports the first error. Loops until all bytes
    // are written; a short write is never reported as success.
    virtual std::optional<IoError> writeAll(std::string_view bytes) = 0;

    // Makes everything written so far durable on the medium. PosixSink uses
    // fcntl(F_FULLFSYNC), falling back to fsync only where the file system
    // reports it unsupported (EINVAL / ENOTSUP).
    virtual std::optional<IoError> sync() = 0;

    // Current size of the file in bytes.
    virtual std::uint64_t size() const = 0;

    // Cuts the file to newSize bytes and makes the new length durable
    // (PosixSink: ftruncate, then the same full flush sync() performs). The
    // journal calls this from an explicit repair only, after the bytes being
    // cut have been preserved verbatim elsewhere — never from open().
    virtual std::optional<IoError> truncate(std::uint64_t newSize) = 0;
};

// CreateNew refuses an existing path and syncs the parent directory once the
// file exists; AppendExisting refuses a missing path.
enum class SinkMode { CreateNew, AppendExisting };

// The real thing. open(O_WRONLY|O_APPEND|O_CLOEXEC|O_NOFOLLOW [+O_CREAT|O_EXCL
// for CreateNew], 0644), then flock(LOCK_EX|LOCK_NB) for the life of the
// sink, so a second process opening the same journal is told
// IoError{EWOULDBLOCK, "locked"} instead of interleaving records. The
// destructor closes the descriptor, releasing the lock.
Expected<std::unique_ptr<Sink>, IoError> openPosixSink(const std::filesystem::path& path, SinkMode mode);

} // namespace tapestry::kernel
