#include "NpcMind.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <utility>

namespace perihelion::npc {

namespace {

const k::Value* prop(const k::Node& node, const char* key) {
    const auto it = node.props.find(key);
    return it == node.props.end() ? nullptr : &it->second;
}

std::string text(const k::Node& node, const char* key) {
    const k::Value* value = prop(node, key);
    return value && value->type == k::ValueType::Text ? value->text : std::string{};
}

double real(const k::Node& node, const char* key, double fallback) {
    const k::Value* value = prop(node, key);
    return value && value->type == k::ValueType::Real ? value->real : fallback;
}

std::int64_t integer(const k::Node& node, const char* key) {
    const k::Value* value = prop(node, key);
    return value && value->type == k::ValueType::Int ? value->integer : 0;
}

std::string lower(std::string_view in) {
    std::string out(in);
    for (char& c : out) {
        if (c >= 'A' && c <= 'Z') {
            c = static_cast<char>(c - 'A' + 'a');
        }
    }
    return out;
}

// Every edge leaving `from` with `label`, as target node ids, in edge-id order.
std::vector<k::NodeId> outgoing(const k::World& world, k::NodeId from, std::string_view label) {
    std::vector<k::NodeId> out;
    for (const k::EdgeId id : world.edgeIds()) {
        const k::Edge* edge = world.edge(id);
        if (edge->from == from && edge->label == label) {
            out.push_back(edge->to);
        }
    }
    return out;
}

bool pointsAt(const k::World& world, k::NodeId from, std::string_view label, k::NodeId to) {
    for (const k::NodeId target : outgoing(world, from, label)) {
        if (target == to) {
            return true;
        }
    }
    return false;
}

std::string jsonString(std::string_view in) {
    std::string out = "\"";
    for (const char c : in) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\t': out += "\\t"; break;
        case '\r': out += "\\r"; break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof buf, "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
                out += buf;
            } else {
                out += c;
            }
        }
    }
    return out + "\"";
}

// Builds one commit's ops against a known starting id, so nodes created in
// this commit can be referenced by edges in the same commit.
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

    void edge(k::NodeId from, k::NodeId to, std::string_view label) {
        const k::EdgeId id{m_nextEdge++};
        m_proposal.ops.push_back(k::CreateEdge{id, from, to, std::string(label), {}});
    }

    void set(k::NodeId target, std::string key, k::Value value) {
        m_proposal.ops.push_back(k::SetProperty{target, std::move(key), std::move(value)});
    }

    void advance(k::Tick ticks) { m_proposal.ops.push_back(k::Advance{ticks}); }

    const k::Proposal& proposal() const { return m_proposal; }

private:
    std::uint64_t m_nextNode;
    std::uint64_t m_nextEdge;
    k::Proposal m_proposal;
};

k::Value t(std::string s) { return k::Value::ofText(std::move(s)); }
k::Value r(double d) { return k::Value::ofReal(d); }

} // namespace

std::optional<k::NodeId> findPerson(const k::World& world, std::string_view who) {
    const std::string needle = lower(who);
    for (const k::NodeId id : world.nodeIds()) {
        const k::Node* node = world.node(id);
        if (node->type != kPerson) {
            continue;
        }
        if (lower(text(*node, "entity")) == needle || lower(text(*node, "name")) == needle) {
            return id;
        }
    }
    return std::nullopt;
}

ContextPacket assembleContext(const k::World& world, std::string_view listener, std::string_view topic,
    ContextLimits limits) {
    ContextPacket packet;
    const std::optional<k::NodeId> who = findPerson(world, listener);
    packet.listenerKnown = who.has_value();
    packet.listenerName = who ? text(*world.node(*who), "name") : std::string(listener);
    const std::string topicNeedle = lower(topic);

    std::vector<ContextPacket::Item> topicFacts;
    std::vector<std::pair<std::int64_t, std::string>> lines;

    for (const k::NodeId id : world.nodeIds()) {
        const k::Node& node = *world.node(id);
        if (node.type == kSelf) {
            packet.npcName = text(node, "name");
            packet.role = text(node, "role");
            packet.voice = text(node, "voice");
        } else if (node.type == kOpinion && who && pointsAt(world, id, kAbout, *who)) {
            ContextPacket::Item item{text(node, "text"), real(node, "stance", 0.0), {}};
            for (const k::NodeId reason : outgoing(world, id, kBecause)) {
                item.because.push_back(text(*world.node(reason), "text"));
            }
            packet.opinionsOfListener.push_back(std::move(item));
        } else if (node.type == kFact) {
            ContextPacket::Item item{text(node, "text"), real(node, "confidence", 1.0), {}};
            if (who && pointsAt(world, id, kAbout, *who)) {
                packet.factsAboutListener.push_back(std::move(item));
            } else if (!topicNeedle.empty() && lower(item.text).find(topicNeedle) != std::string::npos) {
                topicFacts.push_back(std::move(item));
            }
        } else if (node.type == kSample) {
            packet.voiceSamples.push_back(text(node, "line"));
        } else if (node.type == kUtterance && who && pointsAt(world, id, kSaidTo, *who)) {
            lines.emplace_back(integer(node, "game_time"), text(node, "line"));
        }
    }

    // Strongest feelings and surest facts first; ties keep node order, so the
    // packet is stable across runs.
    std::stable_sort(packet.opinionsOfListener.begin(), packet.opinionsOfListener.end(),
        [](const auto& a, const auto& b) { return std::fabs(a.weight) > std::fabs(b.weight); });
    const auto surest = [](const auto& a, const auto& b) { return a.weight > b.weight; };
    std::stable_sort(packet.factsAboutListener.begin(), packet.factsAboutListener.end(), surest);
    std::stable_sort(topicFacts.begin(), topicFacts.end(), surest);

    if (packet.factsAboutListener.size() > limits.facts) {
        packet.factsAboutListener.resize(limits.facts);
    }
    topicFacts.resize(std::min(topicFacts.size(), limits.facts));
    packet.topicFacts = std::move(topicFacts);
    if (packet.voiceSamples.size() > limits.samples) {
        packet.voiceSamples.resize(limits.samples);
    }

    std::stable_sort(lines.begin(), lines.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    const std::size_t skip = lines.size() > limits.recentLines ? lines.size() - limits.recentLines : 0;
    for (std::size_t i = skip; i < lines.size(); ++i) {
        packet.recentLinesToListener.push_back(lines[i].second);
    }
    return packet;
}

std::string toJson(const ContextPacket& packet) {
    const auto items = [](const std::vector<ContextPacket::Item>& list, const char* weightKey) {
        std::string out = "[";
        for (std::size_t i = 0; i < list.size(); ++i) {
            out += i ? ",\n    " : "\n    ";
            out += "{\"text\": " + jsonString(list[i].text) + ", \"" + weightKey
                + "\": " + k::formatReal(list[i].weight);
            if (!list[i].because.empty()) {
                out += ", \"because\": [";
                for (std::size_t j = 0; j < list[i].because.size(); ++j) {
                    out += (j ? ", " : "") + jsonString(list[i].because[j]);
                }
                out += "]";
            }
            out += "}";
        }
        return out + (list.empty() ? "]" : "\n  ]");
    };
    const auto strings = [](const std::vector<std::string>& list) {
        std::string out = "[";
        for (std::size_t i = 0; i < list.size(); ++i) {
            out += (i ? ",\n    " : "\n    ") + jsonString(list[i]);
        }
        return out + (list.empty() ? "]" : "\n  ]");
    };

    std::string out = "{\n";
    out += "  \"npc\": " + jsonString(packet.npcName) + ",\n";
    out += "  \"role\": " + jsonString(packet.role) + ",\n";
    out += "  \"voice\": " + jsonString(packet.voice) + ",\n";
    out += "  \"listener\": " + jsonString(packet.listenerName) + ",\n";
    out += std::string("  \"listener_known\": ") + (packet.listenerKnown ? "true" : "false") + ",\n";
    out += "  \"opinions_of_listener\": " + items(packet.opinionsOfListener, "stance") + ",\n";
    out += "  \"facts_about_listener\": " + items(packet.factsAboutListener, "confidence") + ",\n";
    out += "  \"topic_facts\": " + items(packet.topicFacts, "confidence") + ",\n";
    out += "  \"voice_samples\": " + strings(packet.voiceSamples) + ",\n";
    out += "  \"recent_lines_to_listener\": " + strings(packet.recentLinesToListener) + "\n";
    return out + "}\n";
}

k::Proposal recordUtterance(const k::World& world, k::NodeId listener, std::string line, std::int64_t gameTime) {
    Batch batch(world, "plugin", "perihelion.speaker", "said to " + text(*world.node(listener), "name"));
    const k::NodeId said = batch.node(kUtterance,
        {{"line", t(std::move(line))}, {"game_time", k::Value::ofInt(gameTime)}});
    batch.edge(said, listener, kSaidTo);
    return batch.proposal();
}

std::optional<std::string> seedRook(k::Kernel& kernel) {
    const auto submit = [&](const Batch& batch) -> std::optional<std::string> {
        auto result = kernel.submit(batch.proposal());
        if (!result) {
            return batch.proposal().message + ": " + result.error().detail;
        }
        return std::nullopt;
    };

    // Who Rook is and how Rook talks: a designer's hand-authored ground truth.
    Batch self(kernel.world(), "human", "designer", "who Rook is");
    self.node(kSelf,
        {{"name", t("Rook")},
            {"role", t("hangar mechanic, second shift")},
            {"voice", t("Terse, dry, talks to machines more kindly than to people. "
                        "Never says more than three sentences. Swears by part numbers.")}});
    const k::NodeId player = self.node(kPerson, {{"name", t("Vesper")}, {"entity", t("player")}});
    const k::NodeId kade = self.node(kPerson, {{"name", t("Kade")}, {"entity", t("pilot.kade")}});
    self.node(kSample, {{"line", t("Left actuator's cooked. Again. You want it fixed or you want it fast?")},
                           {"mood", t("irritated")}});
    self.node(kSample, {{"line", t("She'll fly. Don't ask her to do anything clever.")}, {"mood", t("neutral")}});
    self.node(kSample, {{"line", t("...Good landing. Don't tell anyone I said that.")}, {"mood", t("warm")}});
    if (auto err = submit(self)) {
        return err;
    }

    // What Rook knows — some witnessed, some heard.
    Batch know(kernel.world(), "human", "designer", "what Rook knows at start");
    const k::NodeId returnedWrecked = know.node(kFact,
        {{"text", t("Vesper brought the Hauler back with both knee joints sheared")},
            {"confidence", r(1.0)},
            {"source", t("witnessed")}});
    know.edge(returnedWrecked, player, kAbout);
    const k::NodeId savedKade = know.node(kFact,
        {{"text", t("Vesper pulled Kade out of the ridge ambush")},
            {"confidence", r(0.6)},
            {"source", t("told by Kade")}});
    know.edge(savedKade, player, kAbout);
    know.edge(savedKade, kade, kAbout);
    know.node(kFact, {{"text", t("Cell stocks are down to four days since the northern depot fell")},
                         {"confidence", r(0.9)},
                         {"source", t("witnessed")}});
    know.node(kFact, {{"text", t("Actuator parts come from the salvage yard; the yard stopped trading with us")},
                         {"confidence", r(0.7)},
                         {"source", t("rumor")}});
    if (auto err = submit(know)) {
        return err;
    }

    // Opinions, each tied to the facts that produced it.
    Batch feel(kernel.world(), "plugin", "perihelion.mind", "Rook forms opinions of Vesper");
    const k::NodeId careless = feel.node(kOpinion,
        {{"text", t("Vesper is hard on machines")}, {"stance", r(-0.6)}});
    feel.edge(careless, player, kAbout);
    feel.edge(careless, returnedWrecked, kBecause);
    const k::NodeId brave = feel.node(kOpinion,
        {{"text", t("Vesper looks after the pilots, at least")}, {"stance", r(0.3)}});
    feel.edge(brave, player, kAbout);
    feel.edge(brave, savedKade, kBecause);
    if (auto err = submit(feel)) {
        return err;
    }

    // Time passes in the sim, then Rook speaks once. The line is the
    // speaker's recorded outcome: replay reads it back, never regenerates it.
    Batch later(kernel.world(), "system", "perihelion.clock", "shift change");
    later.advance(600);
    if (auto err = submit(later)) {
        return err;
    }
    auto said = kernel.submit(recordUtterance(kernel.world(), player,
        "Knees again. I'm not a miracle worker, I'm a mechanic with no parts.", 600));
    if (!said) {
        return "first line: " + said.error().detail;
    }

    // The mental sim reacts to the salvage rumor: frustration hardens.
    Batch harden(kernel.world(), "plugin", "perihelion.mind", "parts shortage sharpens Rook's view");
    harden.set(careless, "stance", r(-0.75));
    if (auto err = submit(harden)) {
        return err;
    }
    return std::nullopt;
}

} // namespace perihelion::npc
