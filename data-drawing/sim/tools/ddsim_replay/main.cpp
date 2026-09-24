// ddsim_replay — headless replay of a golden fixture through the flat C ABI.
//
// This is the tool a person runs to verify "same file, same seed, same
// hash": it replays <fixture.actions> with the same rule as the tests and
// the Wasm checker, and prints one "<tick> <sha256>" line per checkpoint.
// It drives the sim ONLY through ddsim_c.h (dd_create / dd_apply / dd_step /
// dd_hash / dd_serialize / dd_restore), so it exercises exactly the ABI the
// Wasm build exports.
//
//   ddsim_replay <fixture.actions>                        print the lines, exit 0
//   ddsim_replay <fixture.actions> --compare <golden>     exit 0 if equal, else
//                                                          "MISMATCH tick <t>: got <hex> expected <hex>", exit 1
//   ddsim_replay <fixture.actions> --write-golden <out>   write the lines to <out>, exit 0
//   ddsim_replay <fixture.actions> --roundtrip            at every checkpoint also serialize, restore into
//                                                          a fresh dd_create(seed) and require the same hash
//                                                          and the same bytes; exit 1 on divergence
//
// Flags combine. Exit 2 on bad arguments or an unreadable / unparseable
// fixture; exit 1 when the replay rejects an action or a check fails.
#include "ddsim/ddsim_c.h"
#include "golden_support.hpp"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

int usage() {
    std::fprintf(stderr,
                 "usage: ddsim_replay <fixture.actions> [--compare <golden.sha256>] "
                 "[--write-golden <out.sha256>] [--roundtrip]\n");
    return 2;
}

std::string hashOf(const dd_sim* sim) {
    std::uint8_t digest[32];
    dd_hash(sim, digest);
    return ddsim_test::hex(digest);
}

// Serialize `sim`, restore into a fresh sim with the same seed, and require
// the same hash, the same tick and the same bytes back.
bool roundtripAt(std::uint64_t tick, std::uint64_t seed, const dd_sim* sim, const std::string& expectHash) {
    const std::uint32_t len = dd_serialize(sim, nullptr, 0);
    if (len == 0) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: dd_serialize reported no bytes\n", static_cast<unsigned long long>(tick));
        return false;
    }
    std::vector<std::uint8_t> bytes(len);
    if (dd_serialize(sim, bytes.data(), len) != len) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: dd_serialize wrote a different length\n", static_cast<unsigned long long>(tick));
        return false;
    }
    dd_sim* other = dd_create(seed);
    if (other == nullptr) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: dd_create failed\n", static_cast<unsigned long long>(tick));
        return false;
    }
    bool ok = true;
    const int rc = dd_restore(other, bytes.data(), len);
    if (rc != DD_OK) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: dd_restore returned %d\n", static_cast<unsigned long long>(tick), rc);
        ok = false;
    } else {
        const std::string got = hashOf(other);
        if (got != expectHash) {
            std::printf("ROUNDTRIP MISMATCH tick %llu: restored hash %s expected %s\n",
                        static_cast<unsigned long long>(tick), got.c_str(), expectHash.c_str());
            ok = false;
        }
        if (dd_tick(other) != tick) {
            std::printf("ROUNDTRIP MISMATCH tick %llu: restored tick %llu\n", static_cast<unsigned long long>(tick),
                        static_cast<unsigned long long>(dd_tick(other)));
            ok = false;
        }
        std::vector<std::uint8_t> again(len);
        if (dd_serialize(other, nullptr, 0) != len || dd_serialize(other, again.data(), len) != len || again != bytes) {
            std::printf("ROUNDTRIP MISMATCH tick %llu: re-serialized bytes differ\n", static_cast<unsigned long long>(tick));
            ok = false;
        }
    }
    dd_destroy(other);
    return ok;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        return usage();
    }
    const std::string actionsPath = argv[1];
    std::string comparePath;
    std::string writePath;
    bool roundtrip = false;
    for (int i = 2; i < argc; ++i) {
        const char* arg = argv[i];
        if (std::strcmp(arg, "--compare") == 0 && i + 1 < argc && comparePath.empty()) {
            comparePath = argv[++i];
        } else if (std::strcmp(arg, "--write-golden") == 0 && i + 1 < argc && writePath.empty()) {
            writePath = argv[++i];
        } else if (std::strcmp(arg, "--roundtrip") == 0) {
            roundtrip = true;
        } else {
            return usage();
        }
    }

    const std::string text = ddsim_test::readFile(actionsPath);
    if (text.empty()) {
        std::fprintf(stderr, "ddsim_replay: cannot read %s\n", actionsPath.c_str());
        return 2;
    }
    ddsim_test::Fixture fixture;
    if (!ddsim_test::parseActions(text, fixture)) {
        std::fprintf(stderr, "ddsim_replay: cannot parse %s\n", actionsPath.c_str());
        return 2;
    }
    std::vector<ddsim_test::GoldenLine> expected;
    if (!comparePath.empty()) {
        const std::string goldenText = ddsim_test::readFile(comparePath);
        if (goldenText.empty() || !ddsim_test::parseSha256(goldenText, expected)) {
            std::fprintf(stderr, "ddsim_replay: cannot read or parse %s\n", comparePath.c_str());
            return 2;
        }
    }

    dd_sim* sim = dd_create(fixture.seed);
    if (sim == nullptr) {
        std::fprintf(stderr, "ddsim_replay: dd_create failed\n");
        return 1;
    }
    std::vector<ddsim_test::GoldenLine> got;
    bool roundtripOk = true;
    std::uint64_t lastTick = 0;
    const bool replayed = ddsim_test::replayFixtureAbi(fixture, sim, [&](std::uint64_t tick, const dd_sim* s) {
        ddsim_test::GoldenLine line;
        line.tick = tick;
        line.hex = hashOf(s);
        got.push_back(line);
        if (roundtrip && !roundtripAt(tick, fixture.seed, s, line.hex)) {
            roundtripOk = false;
        }
        lastTick = tick;
    });
    (void)lastTick;
    dd_destroy(sim);
    if (!replayed) {
        std::fprintf(stderr, "ddsim_replay: an action was rejected during replay of %s\n", actionsPath.c_str());
        return 1;
    }

    std::string lines;
    for (const ddsim_test::GoldenLine& g : got) {
        lines += std::to_string(g.tick) + " " + g.hex + "\n";
    }

    int status = roundtripOk ? 0 : 1;
    if (!comparePath.empty()) {
        const std::size_t n = got.size() < expected.size() ? got.size() : expected.size();
        for (std::size_t i = 0; i < n; ++i) {
            if (got[i].tick != expected[i].tick || got[i].hex != expected[i].hex) {
                std::printf("MISMATCH tick %llu: got %s expected %s\n", static_cast<unsigned long long>(expected[i].tick),
                            got[i].hex.c_str(), expected[i].hex.c_str());
                status = 1;
                break;
            }
        }
        if (status == 0 && got.size() != expected.size()) {
            std::printf("MISMATCH: %zu checkpoints replayed, %zu in %s\n", got.size(), expected.size(), comparePath.c_str());
            status = 1;
        }
    }
    if (!writePath.empty()) {
        if (!ddsim_test::writeFile(writePath, lines)) {
            std::fprintf(stderr, "ddsim_replay: cannot write %s\n", writePath.c_str());
            return 1;
        }
    }
    if (comparePath.empty() && writePath.empty()) {
        std::fputs(lines.c_str(), stdout);
    }
    return status;
}
