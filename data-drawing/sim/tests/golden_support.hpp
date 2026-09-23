// golden_support.hpp — test-side helpers: file IO, the action encoder that
// mirrors the sim's ByteReader, the golden fixture text formats and the
// replay rule.
//
// Fixture text (tests/golden/<name>.actions):
//   "# ..." comment | "seed <u64>" | "action <tick> <hex bytes>" | "checkpoint <tick>"
// Replay: for t = 0..max, apply every action stamped t (in file order); if t
// is a checkpoint, record the hash (after those applies, before the step);
// then step.
// <name>.sha256: one line per checkpoint "<tick> <64 lowercase hex>", ascending.
//
// Tests and tools are outside the forbidden-token gate, but nothing here
// needs a floating-point value either: brush parameters are raw Q32.32.
#pragma once

#include "ddsim/ddsim_c.h"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <sstream>
#include <string>
#include <vector>

namespace ddsim_test {

// Whole file as raw bytes, binary mode, C stdio (kernel_tests/support.hpp).
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

inline bool writeFile(const std::string& path, const std::string& bytes) {
    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (f == nullptr) {
        return false;
    }
    const std::size_t wrote = std::fwrite(bytes.data(), 1, bytes.size(), f);
    std::fclose(f);
    return wrote == bytes.size();
}

inline bool fileExists(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        return false;
    }
    std::fclose(f);
    return true;
}

// ---------------------------------------------------------------------------
// Encoder mirroring ddsim::ByteReader.
// ---------------------------------------------------------------------------
struct ByteWriter {
    std::vector<std::uint8_t> bytes;

    void u8(std::uint8_t v) { bytes.push_back(v); }
    void u16(std::uint16_t v) {
        bytes.push_back(static_cast<std::uint8_t>(v & 0xffu));
        bytes.push_back(static_cast<std::uint8_t>((v >> 8) & 0xffu));
    }
    void u32(std::uint32_t v) {
        for (unsigned i = 0; i < 4; ++i) {
            bytes.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
        }
    }
    void u64(std::uint64_t v) {
        for (unsigned i = 0; i < 8; ++i) {
            bytes.push_back(static_cast<std::uint8_t>((v >> (8 * i)) & 0xffu));
        }
    }
    void i64(std::int64_t v) { u64(static_cast<std::uint64_t>(v)); }
    void raw(const std::string& s) { bytes.insert(bytes.end(), s.begin(), s.end()); }
};

struct BrushSpec {
    std::uint32_t id = 1;
    std::string description;
    std::int64_t mass_raw = 0;
    std::int64_t radius_raw = 0;
    std::int64_t spacing_raw = 0;
    std::uint16_t curve[ddsim::DD_CURVE_KNOTS] = {};
};

// The "ink" brush every golden and the dev page share: mass 1.0, radius
// 0.75, spacing 0.5 as Q32.32 raw, identity curve.
inline BrushSpec inkBrush() {
    BrushSpec b;
    b.id = 1;
    b.description = "ink";
    b.mass_raw = ddsim::fx64::ONE;                  // 1.0
    b.radius_raw = (ddsim::fx64::ONE / 4) * 3;      // 0.75
    b.spacing_raw = ddsim::fx64::ONE / 2;           // 0.5
    for (std::uint32_t i = 0; i < 16; ++i) {
        b.curve[i] = static_cast<std::uint16_t>(i * 4096u);
    }
    b.curve[16] = 65535u;
    return b;
}

inline std::vector<std::uint8_t> encodeDefineBrush(const BrushSpec& b) {
    ByteWriter payload;
    payload.u32(b.id);
    payload.u32(static_cast<std::uint32_t>(b.description.size()));
    payload.raw(b.description);
    payload.i64(b.mass_raw);
    payload.i64(b.radius_raw);
    payload.i64(b.spacing_raw);
    for (std::uint32_t i = 0; i < ddsim::DD_CURVE_KNOTS; ++i) {
        payload.u16(b.curve[i]);
    }
    ByteWriter w;
    w.u8(1);   // kind DefineBrush
    w.u8(1);   // version
    w.u16(0);  // reserved
    w.u32(static_cast<std::uint32_t>(payload.bytes.size()));
    w.bytes.insert(w.bytes.end(), payload.bytes.begin(), payload.bytes.end());
    return w.bytes;
}

// An action with an arbitrary kind and empty payload (well-formed header).
inline std::vector<std::uint8_t> encodeEmptyAction(std::uint8_t kind) {
    ByteWriter w;
    w.u8(kind);
    w.u8(1);
    w.u16(0);
    w.u32(0);
    return w.bytes;
}

// ---------------------------------------------------------------------------
// Hex.
// ---------------------------------------------------------------------------
inline std::string hex(const std::uint8_t* bytes, std::size_t n) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(n * 2);
    for (std::size_t i = 0; i < n; ++i) {
        out.push_back(digits[bytes[i] >> 4]);
        out.push_back(digits[bytes[i] & 0x0f]);
    }
    return out;
}

inline std::string hex(const std::uint8_t (&digest)[32]) { return hex(digest, 32); }

inline std::string hex(const std::vector<std::uint8_t>& bytes) { return hex(bytes.data(), bytes.size()); }

inline int hexNibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

inline bool parseHex(const std::string& text, std::vector<std::uint8_t>& out) {
    if (text.size() % 2 != 0) {
        return false;
    }
    out.clear();
    out.reserve(text.size() / 2);
    for (std::size_t i = 0; i < text.size(); i += 2) {
        const int hi = hexNibble(text[i]);
        const int lo = hexNibble(text[i + 1]);
        if (hi < 0 || lo < 0) {
            return false;
        }
        out.push_back(static_cast<std::uint8_t>((hi << 4) | lo));
    }
    return true;
}

// ---------------------------------------------------------------------------
// Fixture text.
// ---------------------------------------------------------------------------
struct FixtureAction {
    std::uint64_t tick = 0;
    std::vector<std::uint8_t> bytes;
};

struct Fixture {
    std::uint64_t seed = 0;
    std::vector<FixtureAction> actions;
    std::vector<std::uint64_t> checkpoints;
};

struct GoldenLine {
    std::uint64_t tick = 0;
    std::string hex;
};

inline bool parseU64(const std::string& s, std::uint64_t& out) {
    if (s.empty()) {
        return false;
    }
    std::uint64_t v = 0;
    for (const char c : s) {
        if (c < '0' || c > '9') {
            return false;
        }
        v = v * 10 + static_cast<std::uint64_t>(c - '0');
    }
    out = v;
    return true;
}

// Strict: any line that is not a comment, blank, or one of the three
// directives makes the whole parse fail.
inline bool parseActions(const std::string& text, Fixture& out) {
    Fixture f;
    bool sawSeed = false;
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.empty() || line[0] == '#') {
            continue;
        }
        std::istringstream ls(line);
        std::string word;
        ls >> word;
        if (word == "seed") {
            std::string v;
            if (!(ls >> v) || !parseU64(v, f.seed)) return false;
            sawSeed = true;
        } else if (word == "action") {
            std::string t, h;
            FixtureAction a;
            if (!(ls >> t >> h) || !parseU64(t, a.tick) || !parseHex(h, a.bytes)) return false;
            f.actions.push_back(std::move(a));
        } else if (word == "checkpoint") {
            std::string t;
            std::uint64_t tick = 0;
            if (!(ls >> t) || !parseU64(t, tick)) return false;
            if (!f.checkpoints.empty() && tick <= f.checkpoints.back()) return false;
            f.checkpoints.push_back(tick);
        } else {
            return false;
        }
        std::string extra;
        if (ls >> extra) return false;
    }
    if (!sawSeed) {
        return false;
    }
    out = std::move(f);
    return true;
}

inline bool parseSha256(const std::string& text, std::vector<GoldenLine>& out) {
    std::vector<GoldenLine> lines;
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.empty()) {
            continue;
        }
        std::istringstream ls(line);
        std::string t, h, extra;
        GoldenLine g;
        if (!(ls >> t >> h) || (ls >> extra) || !parseU64(t, g.tick) || h.size() != 64) return false;
        for (const char c : h) {
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        if (!lines.empty() && g.tick <= lines.back().tick) return false;
        g.hex = h;
        lines.push_back(std::move(g));
    }
    out = std::move(lines);
    return true;
}

// The replay rule, written once over an abstract driver so the doctest suite
// (ddsim::Sim) and ddsim_replay (the flat C ABI) cannot drift apart:
// `apply(bytes, len)` returns a DD_* code, `step()` advances one tick,
// `onCheckpoint(tick)` runs after that tick's applies and before its step.
// Returns false if any apply is rejected.
template <typename Apply, typename Step, typename OnCheckpoint>
bool replayFixtureWith(const Fixture& f, Apply&& apply, Step&& step, OnCheckpoint&& onCheckpoint) {
    std::uint64_t max = 0;
    for (const auto& a : f.actions) {
        if (a.tick > max) max = a.tick;
    }
    for (const auto c : f.checkpoints) {
        if (c > max) max = c;
    }
    std::size_t nextCheckpoint = 0;
    for (std::uint64_t t = 0; t <= max; ++t) {
        for (const auto& a : f.actions) {
            if (a.tick == t) {
                if (apply(a.bytes.data(), static_cast<std::uint32_t>(a.bytes.size())) != DD_OK) {
                    return false;
                }
            }
        }
        if (nextCheckpoint < f.checkpoints.size() && f.checkpoints[nextCheckpoint] == t) {
            onCheckpoint(t);
            ++nextCheckpoint;
        }
        step();
    }
    return true;
}

// The same rule over the C++ class: `onCheckpoint(tick, sim)`.
template <typename Callback>
bool replayFixture(const Fixture& f, ddsim::Sim& sim, Callback&& onCheckpoint) {
    return replayFixtureWith(
        f, [&](const std::uint8_t* bytes, std::uint32_t len) { return sim.apply(bytes, len); },
        [&]() { sim.step(); }, [&](std::uint64_t tick) { onCheckpoint(tick, sim); });
}

// The same rule over the flat C ABI: `onCheckpoint(tick, dd_sim*)`.
template <typename Callback>
bool replayFixtureAbi(const Fixture& f, dd_sim* sim, Callback&& onCheckpoint) {
    return replayFixtureWith(
        f, [&](const std::uint8_t* bytes, std::uint32_t len) { return dd_apply(sim, bytes, len); },
        [&]() { dd_step(sim); }, [&](std::uint64_t tick) { onCheckpoint(tick, sim); });
}

inline std::string goldenPath(const std::string& name, const std::string& ext) {
    return std::string(DDSIM_GOLDEN_DIR) + "/" + name + "." + ext;
}

} // namespace ddsim_test
