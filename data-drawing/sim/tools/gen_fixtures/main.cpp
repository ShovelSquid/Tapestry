// gen_fixtures — writes the golden .actions fixtures. Test-side C++ encoder;
// the .sha256 files beside them are produced by ddsim_tests with
// DDSIM_WRITE_GOLDEN=1 from the native-release build and then committed.
//
// Usage: ddsim_gen_fixtures <output-dir>
#include "action_writer.hpp"
#include "golden_support.hpp"

#include <cstdint>
#include <cstdio>
#include <string>

namespace {

std::string header(const char* what) {
    return std::string("# ddsim golden fixture: ") + what +
           "\n# seed <u64> | action <tick> <hex> | checkpoint <tick>\n";
}

} // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: ddsim_gen_fixtures <output-dir>\n");
        return 2;
    }
    const std::string dir = argv[1];

    std::string noop = header("no actions; the tick and the seeded rng are the whole state");
    noop += "seed 42\n";
    noop += "checkpoint 0\ncheckpoint 1\ncheckpoint 60\ncheckpoint 600\n";
    if (!ddsim_test::writeFile(dir + "/noop.actions", noop)) {
        std::fprintf(stderr, "cannot write %s/noop.actions\n", dir.c_str());
        return 1;
    }

    std::string one = header("one DefineBrush (id 1, \"ink\", mass 1.0, radius 0.75, spacing 0.5, identity curve) at tick 0");
    one += "seed 42\n";
    one += "action 0 " + ddsim_test::hex(ddsim_test::encodeDefineBrush(ddsim_test::inkBrush())) + "\n";
    one += "checkpoint 0\ncheckpoint 1\ncheckpoint 60\ncheckpoint 600\n";
    if (!ddsim_test::writeFile(dir + "/one-brush.actions", one)) {
        std::fprintf(stderr, "cannot write %s/one-brush.actions\n", dir.c_str());
        return 1;
    }

    // many-brushes: 50 DefineBrush actions, one per tick 0..49 (ids 1..50),
    // descriptions cycling through five strings — two of them multibyte
    // UTF-8 on purpose, because desc_len counts bytes — masses cycling
    // 1, 4, 16, 64; radius 0.75, spacing 0.5, identity curve.
    std::string many = header("50 DefineBrush actions at ticks 0..49 (ids 1..50); descriptions cycle ink / green rust / loneliness / \xe9\x9d\x92\xe8\x8b\x94 / rust \xe2\x9c\x93 (UTF-8 bytes); masses cycle 1, 4, 16, 64; radius 0.75, spacing 0.5, identity curve");
    many += "seed 7\n";
    const char* descriptions[5] = {"ink", "green rust", "loneliness", "\xe9\x9d\x92\xe8\x8b\x94", "rust \xe2\x9c\x93"};
    const std::int64_t masses[4] = {ddsim::fx64::ONE, ddsim::fx64::ONE * 4, ddsim::fx64::ONE * 16, ddsim::fx64::ONE * 64};
    for (std::uint32_t i = 0; i < 50; ++i) {
        ddsim_test::BrushSpec b = ddsim_test::inkBrush();
        b.id = i + 1;
        b.description = descriptions[i % 5];
        b.mass_raw = masses[i % 4];
        many += "action " + std::to_string(i) + " " + ddsim_test::hex(ddsim_test::encodeDefineBrush(b)) + "\n";
    }
    many += "checkpoint 0\ncheckpoint 25\ncheckpoint 50\ncheckpoint 600\n";
    if (!ddsim_test::writeFile(dir + "/many-brushes.actions", many)) {
        std::fprintf(stderr, "cannot write %s/many-brushes.actions\n", dir.c_str());
        return 1;
    }

    std::printf("wrote %s/{noop,one-brush,many-brushes}.actions\n", dir.c_str());
    return 0;
}
