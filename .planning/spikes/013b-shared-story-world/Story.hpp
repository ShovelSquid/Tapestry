#pragma once

// 013b: one shared story world. Characters, facts and events exist once.
// Who knows what is a `believes` edge from a character to a fact, with the
// confidence and source on the edge. Canon (`canon` on the fact) is kept
// apart from belief, so a character can be confidently wrong.
//
//   character --believes{confidence,source}--> fact --about--> character
//   character --holds--> opinion --about--> character
//                        opinion --because--> fact
//   sample --sample-of--> character
//   character --spoke--> utterance --said-to--> character

#include "NpcMind.hpp"
#include "Scenario.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace story::shared {

inline constexpr std::string_view kCharacter = "perihelion.story/character@1";
inline constexpr std::string_view kFact = "perihelion.story/fact@1";
inline constexpr std::string_view kOpinion = "perihelion.story/opinion@1";
inline constexpr std::string_view kSample = "perihelion.story/sample@1";
inline constexpr std::string_view kUtterance = "perihelion.story/utterance@1";

// Writes `<dir>/story.tree` and returns its path.
std::string build(const Scenario& scenario, const std::string& dir);

// The packet `speaker` gets when talking to `listener`, answered from the
// shared world through the speaker's beliefs only.
perihelion::npc::ContextPacket assembleFor(const k::World& world, std::string_view speaker,
    std::string_view listener, std::string_view topic, perihelion::npc::ContextLimits limits = {});

// Exports what `speaker` holds as a standalone world in spike 012's schema,
// which is what a game would ship per NPC. Returns the path.
std::string exportSlice(const k::World& world, std::string_view speaker, const std::string& dir);

// Beliefs whose fact is not canon: who is wrong, about what, and why.
struct FalseBelief {
    std::string holder, fact, source;
    double confidence = 0.0;
};
std::vector<FalseBelief> falseBeliefs(const k::World& world);

} // namespace story::shared
