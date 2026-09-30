// story_compare — 013a (a world per NPC) against 013b (one shared story world).
//
//   story_compare verify <dir>         same packets? byte-identical slices? what does a correction cost?
//   story_compare bench <dir> <lines>  cost at <lines> extra lines per NPC
//   story_compare seed <dir>           write only the shared hangar story (013b) to <dir>/story.tree
//   story_compare packet <story.tree> <speaker> <listener> [topic]
//                                      print 013b's packet (spike 014 checks its JS port against this)

#include "PerNpc.hpp"
#include "Story.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>

namespace npc = perihelion::npc;
using namespace story;

namespace {

const char* kNpcs[] = {"rook", "kade", "ines", "oda"};

std::string slurp(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

std::unique_ptr<k::Kernel> open(const std::string& path, k::OpenPolicy policy = k::OpenPolicy::ReadOnly) {
    auto opened = k::Kernel::open(path, policy);
    if (!opened) throw std::runtime_error("open " + path + ": " + opened.error().detail);
    return std::move(opened).value();
}

// Every (speaker, listener, topic) packet three ways: straight from the NPC's
// own file (013a), from the shared world through the speaker's beliefs
// (013b), and from a slice exported out of the shared world.
int comparePackets(const Scenario& s, const std::string& perDir, const std::string& storyPath, const std::string& sliceDir) {
    auto story = open(storyPath);
    int checked = 0, mismatched = 0;
    for (const char* key : kNpcs) {
        auto own = open(perDir + "/" + key + ".tree");
        auto slice = open(sliceDir + "/" + key + ".tree");
        const std::string speaker = s.character(key).name;
        std::vector<std::string> listeners = {"stranger"};
        for (const auto& c : s.characters) listeners.push_back(c.entity);
        for (const auto& listener : listeners) {
            for (const char* topic : {"", "parts", "cells", "ridge"}) {
                const std::string a = npc::toJson(npc::assembleContext(own->world(), listener, topic));
                const std::string b = npc::toJson(shared::assembleFor(story->world(), speaker, listener, topic));
                const std::string c = npc::toJson(npc::assembleContext(slice->world(), listener, topic));
                ++checked;
                if (a != b || a != c) {
                    if (++mismatched <= 2) {
                        std::printf("MISMATCH %s -> %s [%s]\n--- 013a\n%s--- 013b\n%s--- slice\n%s", key,
                            listener.c_str(), topic, a.c_str(), b.c_str(), c.c_str());
                    }
                }
            }
        }
    }
    std::printf("packets: %d checked, %d mismatched\n", checked, mismatched);
    return mismatched;
}

int verify(const std::string& dir) {
    const Scenario s = hangar();
    const std::string perDir = dir + "/013a", storyDir = dir + "/013b", sliceDir = dir + "/013b/slices";
    for (const auto& d : {perDir, storyDir, sliceDir}) std::filesystem::create_directories(d);

    std::vector<std::string> perPaths;
    for (const char* key : kNpcs) perPaths.push_back(pernpc::build(s, key, perDir));
    const std::string storyPath = shared::build(s, storyDir);
    {
        auto story = open(storyPath);
        for (const char* key : kNpcs) shared::exportSlice(story->world(), s.character(key).name, sliceDir);
    }

    int bad = comparePackets(s, perDir, storyPath, sliceDir);
    int identical = 0;
    for (const char* key : kNpcs) {
        identical += slurp(perDir + "/" + key + ".tree") == slurp(sliceDir + "/" + key + ".tree");
    }
    std::printf("slice files byte-identical to hand-built 013a files: %d of 4\n", identical);

    std::size_t perBytes = 0;
    for (const auto& p : perPaths) perBytes += std::filesystem::file_size(p);
    std::printf("bytes: 013a %zu across 4 files, 013b %zu in one file\n", perBytes,
        static_cast<std::size_t>(std::filesystem::file_size(storyPath)));

    std::printf("\nfalse beliefs (013b only; 013a has no canon to check against):\n");
    for (const auto& f : shared::falseBeliefs(open(storyPath)->world())) {
        std::printf("  %s believes \"%s\" (%.1f, %s)\n", f.holder.c_str(), f.fact.c_str(), f.confidence, f.source.c_str());
    }

    // A designer corrects the ridge fact.
    const std::string oldText = s.fact("ridge").text;
    const std::string newText = "Vesper held the ridge for forty minutes until Kade was pulled out";
    const int files = pernpc::correctFact(perPaths, oldText, newText);
    {
        auto story = open(storyPath, k::OpenPolicy::Existing);
        k::NodeId ridge{};
        for (const k::NodeId id : story->world().nodeIds()) {
            const k::Node* n = story->world().node(id);
            if (n->type == shared::kFact && n->props.at("text").text == oldText) ridge = id;
        }
        if (!story->submit({{"human", "designer"}, "correct a shared fact", {k::SetProperty{ridge, "text", k::Value::ofText(newText)}}})) {
            throw std::runtime_error("013b correction refused");
        }
        for (const char* key : kNpcs) shared::exportSlice(story->world(), s.character(key).name, sliceDir);
    }
    std::printf("\ncorrecting the ridge fact: 013a needed %d commits in %d files, found by matching old text; 013b needed 1 commit\n",
        files, files);
    std::printf("after the correction, ");
    bad += comparePackets(s, perDir, storyPath, sliceDir);
    return bad == 0 && identical == 4 ? 0 : 1;
}

template <typename F>
double medianMs(F&& f, int runs = 5) {
    std::vector<double> ms;
    for (int i = 0; i < runs; ++i) {
        const auto t0 = std::chrono::steady_clock::now();
        f();
        ms.push_back(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count());
    }
    std::sort(ms.begin(), ms.end());
    return ms[ms.size() / 2];
}

int bench(const std::string& dir, std::uint64_t extra) {
    const Scenario s = hangar(extra);
    const std::string perDir = dir + "/013a", storyDir = dir + "/013b";
    std::filesystem::create_directories(perDir);
    std::filesystem::create_directories(storyDir);

    std::vector<std::string> perPaths;
    const double buildA = medianMs([&] {
        perPaths.clear();
        for (const char* key : kNpcs) perPaths.push_back(pernpc::build(s, key, perDir));
    }, 1);
    std::string storyPath;
    const double buildB = medianMs([&] { storyPath = shared::build(s, storyDir); }, 1);

    std::size_t perBytes = 0;
    for (const auto& p : perPaths) perBytes += std::filesystem::file_size(p);
    const double reopenA = medianMs([&] { for (const auto& p : perPaths) open(p); }, 3);
    const double reopenRook = medianMs([&] { open(perPaths[0]); }, 3);
    const double reopenB = medianMs([&] { open(storyPath); }, 3);

    auto rook = open(perPaths[0]);
    auto story = open(storyPath);
    const double ctxA = medianMs([&] { npc::assembleContext(rook->world(), "player", "parts"); });
    const double ctxB = medianMs([&] { shared::assembleFor(story->world(), "Rook", "player", "parts"); });

    std::printf("{\"extra_lines_per_npc\": %llu, \"total_lines\": %zu, "
                "\"a_build_ms\": %.0f, \"b_build_ms\": %.0f, \"a_mb\": %.2f, \"b_mb\": %.2f, "
                "\"a_reopen_all_ms\": %.1f, \"a_reopen_one_npc_ms\": %.1f, \"b_reopen_ms\": %.1f, "
                "\"a_context_ms\": %.2f, \"b_context_ms\": %.2f}\n",
        static_cast<unsigned long long>(extra), s.lines.size(), buildA, buildB, double(perBytes) / 1e6,
        double(std::filesystem::file_size(storyPath)) / 1e6, reopenA, reopenRook, reopenB, ctxA, ctxB);
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    try {
        if (argc == 3 && std::string(argv[1]) == "verify") return verify(argv[2]);
        if (argc == 3 && std::string(argv[1]) == "seed") {
            std::filesystem::create_directories(argv[2]);
            std::printf("%s\n", shared::build(hangar(), argv[2]).c_str());
            return 0;
        }
        if ((argc == 5 || argc == 6) && std::string(argv[1]) == "packet") {
            auto story = open(argv[2]);
            std::fputs(npc::toJson(shared::assembleFor(story->world(), argv[3], argv[4], argc == 6 ? argv[5] : "")).c_str(), stdout);
            return 0;
        }
        if (argc == 4 && std::string(argv[1]) == "bench") return bench(argv[2], std::strtoull(argv[3], nullptr, 10));
    } catch (const std::exception& e) {
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }
    std::fputs("usage: story_compare verify <dir> | bench <dir> <lines> | seed <dir> | packet <story.tree> <speaker> <listener> [topic]\n", stderr);
    return 2;
}
