// npc_mind — the headless half of the Perihelion ↔ Tapestry spike.
//
//   npc_mind seed <file.tree>                        write Rook's mind to a new world
//   npc_mind context <file.tree> <listener> [topic]  print the packet the speaker model gets
//   npc_mind say <file.tree> <listener> <game_time> <line…>
//                                                    record a spoken line as a commit
//   npc_mind bench <file.tree> <lines>               a long game: append, reopen, assemble
//
// Unity would reach the same three operations over a localhost sidecar; this
// CLI is how they are exercised without Unity or a model in the loop.

#include "NpcMind.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <optional>
#include <vector>
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
               "  npc_mind say <file.tree> <listener> <game_time> <line...>\n"
               "  npc_mind bench <file.tree> <lines>\n",
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

double msSince(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
}

// A long game for one NPC: Rook's seed, then `lines` spoken lines to the
// player, and a mind-sim opinion update after every tenth. Prints one JSON
// line: append cost, file size, reopen time and context-assembly time.
int bench(const char* path, std::uint64_t lines) {
    std::filesystem::remove(path);
    auto clock = std::make_unique<k::FixedClock>();
    clock->at = k::RecordedAt::parse("2026-09-30T06:00:00Z").value();
    auto created = k::Kernel::create(path, "rook", std::move(clock));
    if (!created || npc::seedRook(*created.value())) {
        std::fprintf(stderr, "seed failed\n");
        return 1;
    }
    auto& kernel = *created.value();
    const k::NodeId player = *npc::findPerson(kernel.world(), "player");
    std::optional<k::NodeId> opinion;
    for (const k::NodeId id : kernel.world().nodeIds()) {
        if (kernel.world().node(id)->type == npc::kOpinion) {
            opinion = id;
            break;
        }
    }

    std::vector<double> submitMs;
    submitMs.reserve(lines);
    const auto appendStart = std::chrono::steady_clock::now();
    for (std::uint64_t i = 0; i < lines; ++i) {
        const auto t0 = std::chrono::steady_clock::now();
        auto said = kernel.submit(npc::recordUtterance(kernel.world(), player,
            "Line " + std::to_string(i) + ": the actuators are still cooked and I still have no parts.",
            static_cast<std::int64_t>(600 + i * 60)));
        submitMs.push_back(msSince(t0));
        if (!said) {
            std::fprintf(stderr, "submit %llu refused\n", static_cast<unsigned long long>(i));
            return 1;
        }
        if (i % 10 == 9) {
            k::Proposal drift{{"plugin", "perihelion.mind"}, "stance drifts",
                {k::SetProperty{*opinion, "stance", k::Value::ofReal(-0.5 - 0.25 * double(i % 20) / 20.0)}}};
            if (!kernel.submit(drift)) {
                return 1;
            }
        }
    }
    const double appendMs = msSince(appendStart);
    const auto commits = kernel.lastSeq();
    created.value().reset();

    const auto openStart = std::chrono::steady_clock::now();
    auto reopened = openWorld(path, k::OpenPolicy::ReadOnly);
    const double openMs = msSince(openStart);
    if (!reopened) {
        return 1;
    }

    std::vector<double> contextMs;
    std::size_t packetLines = 0;
    for (int run = 0; run < 5; ++run) {
        const auto t0 = std::chrono::steady_clock::now();
        const auto packet = npc::assembleContext(reopened->world(), "player", "parts");
        contextMs.push_back(msSince(t0));
        packetLines = packet.recentLinesToListener.size();
    }
    std::sort(submitMs.begin(), submitMs.end());
    std::sort(contextMs.begin(), contextMs.end());
    const auto pct = [&](double p) { return submitMs.empty() ? 0.0 : submitMs[std::size_t(p * double(submitMs.size() - 1))]; };

    std::printf("{\"lines\": %llu, \"commits\": %llu, \"nodes\": %zu, \"edges\": %zu, \"file_mb\": %.2f, "
                "\"append_ms\": %.1f, \"submit_p50_ms\": %.3f, \"submit_p99_ms\": %.3f, "
                "\"reopen_ms\": %.1f, \"context_ms\": %.2f, \"packet_lines\": %zu}\n",
        static_cast<unsigned long long>(lines), static_cast<unsigned long long>(commits),
        reopened->world().nodeCount(), reopened->world().edgeCount(),
        double(std::filesystem::file_size(path)) / 1e6, appendMs, pct(0.5), pct(0.99), openMs, contextMs[2],
        packetLines);
    return 0;
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
        // A torn or edited file opens with only its verified prefix, so the
        // NPC would silently forget everything after the damage (spike 012).
        // Refuse rather than speak from a partial mind.
        if (kernel->status().kind != k::JournalStatus::Kind::Ok) {
            std::fprintf(stderr, "mind is damaged after commit %llu: %s\n",
                static_cast<unsigned long long>(kernel->status().lastGoodSeq), kernel->status().reason.c_str());
            return 3;
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

    if (command == "bench" && argc == 4) {
        return bench(path, std::strtoull(argv[3], nullptr, 10));
    }

    return usage();
}
