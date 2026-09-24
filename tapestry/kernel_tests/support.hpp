#pragma once

#include <cstdio>
#include <cstdlib>
#include <string>
#include <string_view>

#include <unistd.h>

namespace tapestry::kernel::test {

// A scratch .tree path that will not collide between runs or between test
// binaries running in parallel: the pid is part of the name. Any stale file
// from an earlier crashed run is removed so a test never reads its own past.
inline std::string scratchPath(const char* name) {
    const char* base = std::getenv("TMPDIR");
    std::string path = (base != nullptr) ? base : "/tmp";
    if (!path.empty() && path.back() != '/') {
        path += '/';
    }
    path += "tapestry-kernel-test-";
    path += name;
    path += '-';
    path += std::to_string(static_cast<long>(::getpid()));
    path += ".tree";
    std::remove(path.c_str());
    return path;
}

// Whole file as raw bytes. Binary mode and C stdio on purpose: the truncation
// and corruption sweeps depend on seeing exactly what is on disk, byte for
// byte, with no newline translation and no locale involvement.
inline std::string readFile(const std::string& path) {
    std::string bytes;
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        return bytes;
    }
    char buffer[4096];
    for (;;) {
        const std::size_t got = std::fread(buffer, 1, sizeof buffer, f);
        if (got == 0) {
            break;
        }
        bytes.append(buffer, got);
    }
    std::fclose(f);
    return bytes;
}

// Writes exactly these bytes, replacing any existing file. Tests use this to
// plant torn, corrupt, or foreign files for the kernel to classify.
inline void writeFile(const std::string& path, std::string_view bytes) {
    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (f == nullptr) {
        return;
    }
    if (!bytes.empty()) {
        std::fwrite(bytes.data(), 1, bytes.size(), f);
    }
    std::fclose(f);
}

// Size in bytes, or -1 if the file cannot be opened.
inline long fileSize(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        return -1;
    }
    std::fseek(f, 0, SEEK_END);
    const long size = std::ftell(f);
    std::fclose(f);
    return size;
}

inline bool fileExists(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        return false;
    }
    std::fclose(f);
    return true;
}

} // namespace tapestry::kernel::test
