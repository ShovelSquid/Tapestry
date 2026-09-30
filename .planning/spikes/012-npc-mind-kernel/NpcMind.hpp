#pragma once

// An NPC's mind as a Tapestry world.
//
// One .tree file per NPC. Everything the NPC knows, believes and has said is a
// node in that world; why it believes something is an edge. The kernel does
// not know any of these types — they are plugin types in the same sense as
// `tapestry.notes/note@1`, so the file opens in Tapestry like any other world
// and can be inspected and hand-edited there.
//
// Who wrote each change is the commit's actor:
//   human <designer>          authored by hand (seed facts, voice samples)
//   plugin perihelion.world   observed from the game (a witnessed event)
//   plugin perihelion.mind    the mental-simulation model's updates
//   plugin perihelion.speaker a line the speaking model produced
// so "why does Rook distrust the player" is answerable by reading the file.

#include "kernel/Kernel.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace perihelion::npc {

namespace k = tapestry::kernel;

// Node types. Versioned the way Tapestry plugin types are, so a later schema
// can coexist with files written by this one.
inline constexpr std::string_view kSelf = "perihelion.npc/self@1";           // name, role, voice
inline constexpr std::string_view kPerson = "perihelion.npc/person@1";       // name, entity (Unity id)
inline constexpr std::string_view kFact = "perihelion.npc/fact@1";           // text, confidence, source
inline constexpr std::string_view kOpinion = "perihelion.npc/opinion@1";     // text, stance -1..1
inline constexpr std::string_view kSample = "perihelion.npc/sample@1";       // line, mood — voice examples
inline constexpr std::string_view kUtterance = "perihelion.npc/utterance@1"; // line, game_time — recorded outcomes

// Edge labels.
inline constexpr std::string_view kAbout = "about";     // fact|opinion|utterance -> person
inline constexpr std::string_view kBecause = "because"; // opinion -> fact
inline constexpr std::string_view kSaidTo = "said-to";  // utterance -> person

// Everything the speaking model needs for one line, and nothing else. This is
// the packet Unity asks for; its size is bounded by the limits below, not by
// how much the NPC has accumulated.
struct ContextPacket {
    struct Item {
        std::string text;
        double weight = 0.0; // confidence for facts, stance for opinions
        std::vector<std::string> because;
    };

    std::string npcName;
    std::string role;
    std::string voice;
    std::string listenerName;
    bool listenerKnown = false;
    std::vector<Item> opinionsOfListener;
    std::vector<Item> factsAboutListener;
    std::vector<Item> topicFacts;
    std::vector<std::string> voiceSamples;
    std::vector<std::string> recentLinesToListener;
};

struct ContextLimits {
    std::size_t facts = 6;
    std::size_t samples = 4;
    std::size_t recentLines = 3;
};

// Finds the person node whose `entity` or `name` matches `who`.
std::optional<k::NodeId> findPerson(const k::World& world, std::string_view who);

// Walks the graph outward from the listener and the topic. Deterministic: the
// same world, listener and topic always produce the same packet.
ContextPacket assembleContext(const k::World& world, std::string_view listener, std::string_view topic,
    ContextLimits limits = {});

// The packet as JSON — the shape the Unity client deserializes.
std::string toJson(const ContextPacket& packet);

// A line the speaker produced, recorded so replay reuses it instead of asking
// the model again.
// Creation ops carry the world's next ids explicitly (the kernel accepts a
// non-zero id only when it is exactly the next one), so the utterance node
// and its edge land in one commit.
k::Proposal recordUtterance(const k::World& world, k::NodeId listener, std::string line, std::int64_t gameTime);

// Rook, a hangar mechanic, with enough history to show every node and edge
// kind. Used by `npc_mind seed` and by the smoke test. Returns the first
// refusal as text, or nullopt when every commit landed.
std::optional<std::string> seedRook(k::Kernel& kernel);

} // namespace perihelion::npc
