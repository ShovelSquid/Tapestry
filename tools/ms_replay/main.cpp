// ms_replay — headless replay of a mathspace golden fixture.
//
// The mathspace twin of tools/ddsim_replay/main.cpp: same CLI, same exit
// codes, same fixture grammar (tests/mathspace/fixture.hpp), but it drives
// mathspace::World directly (apply / step / hash / serialize / restore).
// The C ABI (mathspace_c.h) is exercised by tests/mathspace/c_abi_test.cpp
// instead; the goldens do not need it.
//
//   ms_replay <fixture.actions>                        print "<tick> <sha256>" per checkpoint, exit 0
//   ms_replay <fixture.actions> --compare <golden>     exit 0 if equal, else
//                                                       "MISMATCH tick <t>: got <hex> expected <hex>", exit 1
//   ms_replay <fixture.actions> --write-golden <out>   write the lines to <out>, exit 0
//   ms_replay <fixture.actions> --roundtrip            at every checkpoint also serialize, restore into
//                                                       a fresh World(seed) and require the same hash,
//                                                       tick and bytes; exit 1 on divergence
//
// Flags combine. Exit 2 on bad arguments or an unreadable / unparseable
// fixture; exit 1 when the replay rejects an action or a check fails.
#include "fixture.hpp"
#include "mathspace/world.hpp"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

using mathspace::Error;
using mathspace::World;

int usage() {
    std::fprintf(stderr,
                 "usage: ms_replay <fixture.actions> [--compare <golden.sha256>] "
                 "[--write-golden <out.sha256>] [--roundtrip]\n");
    return 2;
}

std::string hashOf(const World& w) {
    std::uint8_t digest[32];
    mathspace::hash(w, digest);
    return mathspace_test::hex(digest);
}

// Serialize `w`, restore into a fresh World with the same seed, and require
// the same hash, the same tick and the same bytes back.
bool roundtripAt(std::uint64_t tick, const World& w, const std::string& expectHash) {
    const unsigned long long t = static_cast<unsigned long long>(tick);
    const std::vector<std::uint8_t> bytes = mathspace::serialize(w);
    if (bytes.empty()) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: serialize produced no bytes\n", t);
        return false;
    }
    World other(w.seed);
    const Error rc = mathspace::restore(other, bytes);
    if (rc != Error::Ok) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: restore returned %s\n", t, mathspace::error_name(rc));
        return false;
    }
    bool ok = true;
    const std::string got = hashOf(other);
    if (got != expectHash) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: restored hash %s expected %s\n", t, got.c_str(),
                    expectHash.c_str());
        ok = false;
    }
    if (other.tick != tick) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: restored tick %llu\n", t,
                    static_cast<unsigned long long>(other.tick));
        ok = false;
    }
    if (mathspace::serialize(other) != bytes) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: re-serialized bytes differ\n", t);
        ok = false;
    }
    if (other != w) {
        std::printf("ROUNDTRIP MISMATCH tick %llu: restored world differs\n", t);
        ok = false;
    }
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

    const std::string text = mathspace_test::readFile(actionsPath);
    if (text.empty()) {
        std::fprintf(stderr, "ms_replay: cannot read %s\n", actionsPath.c_str());
        return 2;
    }
    mathspace_test::Fixture fixture;
    if (!mathspace_test::parseActions(text, fixture)) {
        std::fprintf(stderr, "ms_replay: cannot parse %s\n", actionsPath.c_str());
        return 2;
    }
    std::vector<mathspace_test::GoldenLine> expected;
    if (!comparePath.empty()) {
        const std::string goldenText = mathspace_test::readFile(comparePath);
        if (goldenText.empty() || !mathspace_test::parseSha256(goldenText, expected)) {
            std::fprintf(stderr, "ms_replay: cannot read or parse %s\n", comparePath.c_str());
            return 2;
        }
    }

    World world(fixture.seed);
    std::vector<mathspace_test::GoldenLine> got;
    bool roundtripOk = true;
    Error rejected = Error::Ok;
    const bool replayed = mathspace_test::replayFixture(
        fixture, world,
        [&](std::uint64_t tick, const World& w) {
            mathspace_test::GoldenLine line;
            line.tick = tick;
            line.hex = hashOf(w);
            got.push_back(line);
            if (roundtrip && !roundtripAt(tick, w, line.hex)) {
                roundtripOk = false;
            }
        },
        &rejected);
    if (!replayed) {
        std::fprintf(stderr, "ms_replay: an action was rejected (%s) during replay of %s\n",
                     mathspace::error_name(rejected), actionsPath.c_str());
        return 1;
    }

    std::string lines;
    for (const mathspace_test::GoldenLine& g : got) {
        lines += std::to_string(g.tick) + " " + g.hex + "\n";
    }

    int status = roundtripOk ? 0 : 1;
    if (!comparePath.empty()) {
        const std::size_t n = got.size() < expected.size() ? got.size() : expected.size();
        for (std::size_t i = 0; i < n; ++i) {
            if (got[i].tick != expected[i].tick || got[i].hex != expected[i].hex) {
                std::printf("MISMATCH tick %llu: got %s expected %s\n",
                            static_cast<unsigned long long>(expected[i].tick), got[i].hex.c_str(),
                            expected[i].hex.c_str());
                status = 1;
                break;
            }
        }
        if (status == 0 && got.size() != expected.size()) {
            std::printf("MISMATCH: %zu checkpoints replayed, %zu in %s\n", got.size(), expected.size(),
                        comparePath.c_str());
            status = 1;
        }
    }
    if (!writePath.empty()) {
        if (!mathspace_test::writeFile(writePath, lines)) {
            std::fprintf(stderr, "ms_replay: cannot write %s\n", writePath.c_str());
            return 1;
        }
    }
    if (comparePath.empty() && writePath.empty()) {
        std::fputs(lines.c_str(), stdout);
    }
    return status;
}
