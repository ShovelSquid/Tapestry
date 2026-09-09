// The real durability primitives, and nothing else in the kernel touches
// them: open with the flags the header documents, flock for the session,
// write until every byte is out, F_FULLFSYNC before anyone is told "done".

#include "kernel/journal/Sink.hpp"

#include <cerrno>
#include <cstddef>
#include <limits>
#include <string>
#include <utility>

#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

namespace tapestry::kernel {
namespace {

IoError errorNow(const char* what) { return IoError{errno, what}; }

class PosixSink final : public Sink {
public:
    explicit PosixSink(int fd) : m_fd(fd) {}
    ~PosixSink() override {
        if (m_fd >= 0) {
            ::close(m_fd); // releases the flock
        }
    }
    PosixSink(const PosixSink&) = delete;
    PosixSink& operator=(const PosixSink&) = delete;

    std::optional<IoError> writeAll(std::string_view bytes) override {
        const char* cursor = bytes.data();
        std::size_t left = bytes.size();
        while (left > 0) {
            const ssize_t written = ::write(m_fd, cursor, left);
            if (written < 0) {
                if (errno == EINTR) {
                    continue;
                }
                return errorNow("write");
            }
            if (written == 0) {
                return IoError{EIO, "write wrote nothing"};
            }
            cursor += written;
            left -= static_cast<std::size_t>(written);
        }
        return std::nullopt;
    }

    std::optional<IoError> sync() override {
#if defined(F_FULLFSYNC)
        // Apple's fsync only reaches the drive cache; F_FULLFSYNC asks the
        // drive to flush to permanent storage. Fall back to fsync only where
        // the file system says it does not support the request.
        if (::fcntl(m_fd, F_FULLFSYNC) == 0) {
            return std::nullopt;
        }
        if (errno != EINVAL && errno != ENOTSUP) {
            return errorNow("fcntl(F_FULLFSYNC)");
        }
#endif
        if (::fsync(m_fd) != 0) {
            return errorNow("fsync");
        }
        return std::nullopt;
    }

    std::uint64_t size() const override {
        struct stat info {};
        if (::fstat(m_fd, &info) != 0) {
            return 0;
        }
        return static_cast<std::uint64_t>(info.st_size);
    }

    std::optional<IoError> truncate(std::uint64_t newSize) override {
        if (newSize > static_cast<std::uint64_t>(std::numeric_limits<off_t>::max())) {
            return IoError{EINVAL, "truncate: size does not fit off_t"};
        }
        while (::ftruncate(m_fd, static_cast<off_t>(newSize)) != 0) {
            if (errno == EINTR) {
                continue;
            }
            return errorNow("ftruncate");
        }
        // The new length is metadata; it needs the same full flush as data.
        return sync();
    }

private:
    int m_fd;
};

// After creating a file, the directory entry must reach the medium too, or a
// crash can leave a durable file that no directory names (SQLite §9.5).
std::optional<IoError> syncDirectory(const std::filesystem::path& directory) {
    const std::string name = directory.empty() ? std::string(".") : directory.string();
    const int fd = ::open(name.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        return errorNow("open directory");
    }
    std::optional<IoError> failure;
    if (::fsync(fd) != 0) {
        failure = errorNow("fsync directory");
    }
    ::close(fd);
    return failure;
}

} // namespace

Expected<std::unique_ptr<Sink>, IoError> openPosixSink(const std::filesystem::path& path, SinkMode mode) {
    int flags = O_WRONLY | O_APPEND | O_CLOEXEC | O_NOFOLLOW;
    if (mode == SinkMode::CreateNew) {
        flags |= O_CREAT | O_EXCL;
    }
    const int fd = ::open(path.c_str(), flags, 0644);
    if (fd < 0) {
        return errorNow(mode == SinkMode::CreateNew ? "open(O_CREAT|O_EXCL)" : "open");
    }
    if (::flock(fd, LOCK_EX | LOCK_NB) != 0) {
        const int error = errno;
        ::close(fd);
        if (error == EWOULDBLOCK) {
            return IoError{EWOULDBLOCK, "locked"};
        }
        return IoError{error, "flock"};
    }
    auto sink = std::make_unique<PosixSink>(fd);
    if (mode == SinkMode::CreateNew) {
        if (auto failure = syncDirectory(path.parent_path())) {
            return *failure;
        }
    }
    return std::unique_ptr<Sink>(std::move(sink));
}

} // namespace tapestry::kernel
