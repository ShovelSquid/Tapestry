// npc_mind — the headless half of the Perihelion ↔ Tapestry spike.
//
//   npc_mind seed <file.tree>                        write Rook's mind to a new world
//   npc_mind context <file.tree> <listener> [topic]  print the packet the speaker model gets
//   npc_mind say <file.tree> <listener> <game_time> <line…>
//                                                    record a spoken line as a commit
//
// Unity would reach the same three operations over a localhost sidecar; this
// CLI is how they are exercised without Unity or a model in the loop.

#include "NpcMind.hpp"

#include <charconv>
#include <cstdio>
#include <memory>
#include <string>

namespace k = tapestry::kernel;
namespace npc = perihelion::npc;

namespace {

int usage() {
    std::fputs("usage:\n"
               "  npc_mind seed <file.tree>\n"
               "  npc_mind context <file.tree> <listener> [topic]\n"
               "  npc_mind say <file.tree> <listener> <game_time> <line...>\n",
        stderr);
    return 2;
}

std::unique_ptr<k::Kernel> openWorld(const char* path, k::OpenPolicy policy) {
    auto opened = k::Kernel::open(path, policy);
    if (!opened) {
        std::fprintf(stderr, "cannot open %s: %s\n", path, opened.error().detail.c_str());
        return nullptr;
    }
    return std::move(opened).value();
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        return usage();
    }
    const std::string command = argv[1];
    const char* path = argv[2];

    if (command == "seed") {
        // A fixed clock keeps the example file byte-stable across runs.
        auto clock = std::make_unique<k::FixedClock>();
        clock->at = k::RecordedAt::parse("2026-09-30T06:00:00Z").value();
        auto created = k::Kernel::create(path, "rook", std::move(clock));
        if (!created) {
            std::fprintf(stderr, "cannot create %s: %s\n", path, created.error().detail.c_str());
            return 1;
        }
        if (auto err = npc::seedRook(*created.value())) {
            std::fprintf(stderr, "seed refused: %s\n", err->c_str());
            return 1;
        }
        std::printf("wrote %s (%llu commits)\n", path,
            static_cast<unsigned long long>(created.value()->lastSeq()));
        return 0;
    }

    if (command == "context" && (argc == 4 || argc == 5)) {
        auto kernel = openWorld(path, k::OpenPolicy::ReadOnly);
        if (!kernel) {
            return 1;
        }
        const auto packet = npc::assembleContext(kernel->world(), argv[3], argc == 5 ? argv[4] : "");
        std::fputs(npc::toJson(packet).c_str(), stdout);
        return 0;
    }

    if (command == "say" && argc >= 6) {
        auto kernel = openWorld(path, k::OpenPolicy::Existing);
        if (!kernel) {
            return 1;
        }
        const auto listener = npc::findPerson(kernel->world(), argv[3]);
        if (!listener) {
            std::fprintf(stderr, "no person '%s' in this mind\n", argv[3]);
            return 1;
        }
        std::int64_t gameTime = 0;
        const std::string_view timeArg = argv[4];
        if (std::from_chars(timeArg.data(), timeArg.data() + timeArg.size(), gameTime).ec != std::errc{}) {
            std::fprintf(stderr, "game_time must be an integer\n");
            return 1;
        }
        std::string line = argv[5];
        for (int i = 6; i < argc; ++i) {
            line += ' ';
            line += argv[i];
        }
        auto result = kernel->submit(npc::recordUtterance(kernel->world(), *listener, line, gameTime));
        if (!result) {
            std::fprintf(stderr, "refused: %s\n", result.error().detail.c_str());
            return 1;
        }
        std::printf("recorded as commit %llu\n", static_cast<unsigned long long>(result.value().seq));
        return 0;
    }

    return usage();
}
