#pragma once

// One story, described once, so 013a (a world per NPC) and 013b (one shared
// story world) are built from exactly the same facts and compared packet for
// packet. Order matters: both builders create nodes in the order listed here,
// so ties in the assembler's stable sorts break the same way.

#include "kernel/Kernel.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace story {

namespace k = tapestry::kernel;

struct Character {
    std::string key, name, entity, role, voice;
    bool npc = false;
    std::vector<std::string> samples;
};

struct Fact {
    std::string key, text;
    bool canon = true; // false: a rumor or lie that someone may still believe
    std::vector<std::string> about;
};

struct Belief {
    std::string holder, fact;
    double confidence = 1.0;
    std::string source;
};

struct Opinion {
    std::string holder, about, text;
    double stance = 0.0;
    std::vector<std::string> because;
};

struct Line {
    std::string speaker, listener, text;
    std::int64_t gameTime = 0;
};

struct Scenario {
    std::vector<Character> characters;
    std::vector<Fact> facts;
    std::vector<Belief> beliefs;
    std::vector<Opinion> opinions;
    std::vector<Line> lines;

    const Character& character(std::string_view key) const {
        for (const auto& c : characters) {
            if (c.key == key) return c;
        }
        throw std::out_of_range(std::string(key));
    }
    const Fact& fact(std::string_view key) const {
        for (const auto& f : facts) {
            if (f.key == key) return f;
        }
        throw std::out_of_range(std::string(key));
    }
};

// The hangar: four NPCs and the player. Rook and Kade share the ridge
// ambush; Ines and Oda believe a rumor that canon says is false.
inline Scenario hangar(std::uint64_t extraLinesPerNpc = 0) {
    Scenario s;
    s.characters = {
        {"rook", "Rook", "npc.rook", "hangar mechanic, second shift",
            "Terse, dry, talks to machines more kindly than to people. Never says more than three sentences.", true,
            {"Left actuator's cooked. Again. You want it fixed or you want it fast?",
                "...Good landing. Don't tell anyone I said that."}},
        {"kade", "Kade", "pilot.kade", "pilot", "Quick and warm; deflects anything serious with a joke.", true,
            {"If I die out there, tell Rook it was the actuator.", "Buy you a drink? Buy me a drink."}},
        {"ines", "Ines", "npc.ines", "quartermaster", "Precise, suspicious, counts everything aloud.", true,
            {"Four cells. Four. Sign here.", "I don't do favors. I do inventory."}},
        {"oda", "Oda", "npc.oda", "base commander", "Formal and clipped; speaks in orders and dates.", true,
            {"Report at oh-six-hundred.", "Noted. Dismissed."}},
        {"vesper", "Vesper", "player", "", "", false, {}},
    };
    s.facts = {
        {"hauler", "Vesper brought the Hauler back with both knee joints sheared", true, {"vesper"}},
        {"ridge", "Vesper held the ridge until Kade was pulled out", true, {"vesper", "kade"}},
        {"early", "Vesper pulled out of the ridge before the extraction", false, {"vesper"}},
        {"cells", "Cell stocks are down to four days since the northern depot fell", true, {}},
        {"yard", "The salvage yard stopped trading with us, so there are no actuator parts", true, {}},
        {"rations", "Oda cut the mechanics' rations to keep the pilots fed", true, {"oda"}},
    };
    s.beliefs = {
        {"rook", "hauler", 1.0, "witnessed"},
        {"rook", "ridge", 0.6, "told by Kade"},
        {"rook", "cells", 0.9, "witnessed"},
        {"rook", "yard", 0.7, "rumor"},
        {"rook", "rations", 1.0, "witnessed"},
        {"kade", "hauler", 0.8, "told by Rook"},
        {"kade", "ridge", 1.0, "witnessed"},
        {"ines", "early", 0.5, "told by Oda"},
        {"ines", "cells", 1.0, "witnessed"},
        {"ines", "yard", 1.0, "witnessed"},
        {"ines", "rations", 1.0, "witnessed"},
        {"oda", "ridge", 0.5, "after-action report"},
        {"oda", "early", 0.4, "rumor"},
        {"oda", "cells", 1.0, "witnessed"},
    };
    s.opinions = {
        {"rook", "vesper", "Vesper is hard on machines", -0.6, {"hauler"}},
        {"rook", "vesper", "Vesper looks after the pilots, at least", 0.3, {"ridge"}},
        {"rook", "oda", "Oda feeds pilots before mechanics", -0.4, {"rations"}},
        {"kade", "vesper", "Vesper saved my life", 0.9, {"ridge"}},
        {"ines", "vesper", "Vesper runs when it gets hot", -0.5, {"early"}},
        {"oda", "vesper", "Vesper's record is mixed", -0.1, {"ridge", "early"}},
    };
    s.lines = {
        {"rook", "vesper", "Knees again. I'm not a miracle worker, I'm a mechanic with no parts.", 600},
        {"kade", "vesper", "Drinks are on me. Well. On you. But I'm buying.", 650},
        {"ines", "vesper", "Sign for the cells. All four days of them.", 700},
        {"rook", "oda", "Rations. For the people who keep your mechs standing.", 720},
    };
    for (std::uint64_t i = 0; i < extraLinesPerNpc; ++i) {
        for (const char* npc : {"rook", "kade", "ines", "oda"}) {
            s.lines.push_back({npc, "vesper",
                std::string(npc) + " line " + std::to_string(i) + ": nothing's changed and nobody's fixing it.",
                static_cast<std::int64_t>(1000 + i * 60)});
        }
    }
    return s;
}

// Builds one commit's ops against a known starting id, so nodes created in a
// commit can be referenced by edges in the same commit.
class Batch {
public:
    Batch(const k::World& world, std::string actorKind, std::string actorId, std::string message)
        : m_nextNode(world.nextNodeId().value), m_nextEdge(world.nextEdgeId().value) {
        m_proposal.actor = {std::move(actorKind), std::move(actorId)};
        m_proposal.message = std::move(message);
    }

    k::NodeId node(std::string_view type, std::map<std::string, k::Value> props) {
        const k::NodeId id{m_nextNode++};
        m_proposal.ops.push_back(k::CreateNode{id, std::string(type), std::move(props)});
        return id;
    }

    void edge(k::NodeId from, k::NodeId to, std::string_view label, std::map<std::string, k::Value> props = {}) {
        const k::EdgeId id{m_nextEdge++};
        m_proposal.ops.push_back(k::CreateEdge{id, from, to, std::string(label), std::move(props)});
    }

    bool empty() const { return m_proposal.ops.empty(); }
    const k::Proposal& proposal() const { return m_proposal; }

private:
    std::uint64_t m_nextNode;
    std::uint64_t m_nextEdge;
    k::Proposal m_proposal;
};

inline void submitOrThrow(k::Kernel& kernel, const Batch& batch) {
    if (batch.empty()) return;
    auto result = kernel.submit(batch.proposal());
    if (!result) {
        throw std::runtime_error(batch.proposal().message + ": " + result.error().detail);
    }
}

inline std::unique_ptr<k::Kernel> createWorld(const std::string& path, const std::string& name) {
    std::filesystem::remove(path);
    auto clock = std::make_unique<k::FixedClock>();
    clock->at = k::RecordedAt::parse("2026-09-30T06:00:00Z").value();
    auto created = k::Kernel::create(path, name, std::move(clock));
    if (!created) {
        throw std::runtime_error("cannot create " + path + ": " + created.error().detail);
    }
    return std::move(created).value();
}

} // namespace story
