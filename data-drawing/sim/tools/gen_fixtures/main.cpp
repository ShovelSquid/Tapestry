// gen_fixtures — writes the golden .actions fixtures. Test-side C++ encoder;
// the .sha256 files beside them are produced by ddsim_tests with
// DDSIM_WRITE_GOLDEN=1 from the native-release build and then committed.
//
// Usage: ddsim_gen_fixtures <output-dir>
#include "golden_support.hpp"

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

    std::printf("wrote %s/noop.actions and %s/one-brush.actions\n", dir.c_str(), dir.c_str());
    return 0;
}
