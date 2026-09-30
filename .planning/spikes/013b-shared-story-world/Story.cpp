#include "Story.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <optional>

namespace story::shared {

namespace npc = perihelion::npc;

namespace {

k::Value t(const std::string& v) { return k::Value::ofText(v); }

std::string text(const std::map<std::string, k::Value>& props, const char* key) {
    const auto it = props.find(key);
    return it == props.end() ? std::string{} : it->second.text;
}

double real(const std::map<std::string, k::Value>& props, const char* key, double fallback) {
    const auto it = props.find(key);
    return it == props.end() || it->second.type != k::ValueType::Real ? fallback : it->second.real;
}

std::string lower(std::string_view in) {
    std::string out(in);
    for (char& c : out) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return out;
}

// Edges by (endpoint, label) in both directions, built in one pass (spike 012).
class Index {
public:
    explicit Index(const k::World& world) : m_world(world) {
        for (const k::EdgeId id : world.edgeIds()) {
            const k::Edge* e = world.edge(id);
            m_out[{e->from.value, e->label}].push_back(e);
            m_in[{e->to.value, e->label}].push_back(e);
        }
    }
    const std::vector<const k::Edge*>& out(k::NodeId from, std::string_view label) const {
        return find(m_out, from, label);
    }
    const std::vector<const k::Edge*>& in(k::NodeId to, std::string_view label) const {
        return find(m_in, to, label);
    }
    const k::Edge* between(k::NodeId from, std::string_view label, k::NodeId to) const {
        for (const k::Edge* e : out(from, label)) {
            if (e->to == to) return e;
        }
        return nullptr;
    }

private:
    using Map = std::map<std::pair<std::uint64_t, std::string>, std::vector<const k::Edge*>>;
    static const std::vector<const k::Edge*>& find(const Map& map, k::NodeId id, std::string_view label) {
        static const std::vector<const k::Edge*> none;
        const auto it = map.find({id.value, std::string(label)});
        return it == map.end() ? none : it->second;
    }
    const k::World& m_world;
    Map m_out, m_in;
};

std::optional<k::NodeId> findCharacter(const k::World& world, std::string_view who, std::optional<k::NodeId> except = {}) {
    const std::string needle = lower(who);
    for (const k::NodeId id : world.nodeIds()) {
        const k::Node* n = world.node(id);
        if (n->type != kCharacter || (except && id == *except)) continue;
        if (lower(text(n->props, "entity")) == needle || lower(text(n->props, "name")) == needle) return id;
    }
    return std::nullopt;
}

} // namespace

std::string build(const Scenario& s, const std::string& dir) {
    const std::string path = dir + "/story.tree";
    auto kernel = createWorld(path, "story");

    Batch cast(kernel->world(), "human", "designer", "the cast");
    std::map<std::string, k::NodeId> who;
    for (const auto& c : s.characters) {
        who[c.key] = cast.node(kCharacter, {{"name", t(c.name)}, {"entity", t(c.entity)}, {"role", t(c.role)},
                                               {"voice", t(c.voice)}, {"npc", k::Value::ofBool(c.npc)}});
    }
    for (const auto& c : s.characters) {
        for (const auto& line : c.samples) {
            cast.edge(cast.node(kSample, {{"line", t(line)}}), who.at(c.key), "sample-of");
        }
    }
    submitOrThrow(*kernel, cast);

    Batch canon(kernel->world(), "human", "designer", "what happened, and what is only said to have happened");
    std::map<std::string, k::NodeId> fact;
    for (const auto& f : s.facts) {
        fact[f.key] = canon.node(kFact, {{"text", t(f.text)}, {"canon", k::Value::ofBool(f.canon)}});
        for (const auto& about : f.about) canon.edge(fact[f.key], who.at(about), "about");
    }
    submitOrThrow(*kernel, canon);

    Batch know(kernel->world(), "human", "designer", "who knows what");
    for (const auto& b : s.beliefs) {
        know.edge(who.at(b.holder), fact.at(b.fact), "believes",
            {{"confidence", k::Value::ofReal(b.confidence)}, {"source", t(b.source)}});
    }
    submitOrThrow(*kernel, know);

    Batch feel(kernel->world(), "plugin", "perihelion.mind", "opinions");
    for (const auto& o : s.opinions) {
        const k::NodeId id = feel.node(kOpinion, {{"text", t(o.text)}, {"stance", k::Value::ofReal(o.stance)}});
        feel.edge(who.at(o.holder), id, "holds");
        feel.edge(id, who.at(o.about), "about");
        for (const auto& reason : o.because) feel.edge(id, fact.at(reason), "because");
    }
    submitOrThrow(*kernel, feel);

    for (const auto& line : s.lines) {
        Batch said(kernel->world(), "plugin", "perihelion.speaker", "said to " + s.character(line.listener).name);
        const k::NodeId id = said.node(kUtterance, {{"line", t(line.text)}, {"game_time", k::Value::ofInt(line.gameTime)}});
        said.edge(who.at(line.speaker), id, "spoke");
        said.edge(id, who.at(line.listener), "said-to");
        submitOrThrow(*kernel, said);
    }
    return path;
}

npc::ContextPacket assembleFor(const k::World& world, std::string_view speaker, std::string_view listener,
    std::string_view topic, npc::ContextLimits limits) {
    npc::ContextPacket packet;
    const Index index(world);
    const std::optional<k::NodeId> me = findCharacter(world, speaker);
    if (!me) return packet;
    const k::Node& self = *world.node(*me);
    packet.npcName = text(self.props, "name");
    packet.role = text(self.props, "role");
    packet.voice = text(self.props, "voice");

    const std::optional<k::NodeId> who = findCharacter(world, listener, me);
    packet.listenerKnown = who.has_value();
    packet.listenerName = who ? text(world.node(*who)->props, "name") : std::string(listener);
    const std::string needle = lower(topic);

    // Walk outward from the speaker; never scan the world. Scanning every node
    // and searching the speaker's edges for each was quadratic: 2.7 s at 50k
    // lines across four NPCs (spike 013b). Targets are visited in node-id
    // order so ties break exactly as spike 012's assembler breaks them.
    const auto byNode = [](std::vector<const k::Edge*> edges, bool target) {
        std::sort(edges.begin(), edges.end(), [target](const k::Edge* a, const k::Edge* b) {
            return (target ? a->to : a->from) < (target ? b->to : b->from);
        });
        return edges;
    };

    if (who) {
        for (const k::Edge* held : byNode(index.out(*me, "holds"), true)) {
            if (!index.between(held->to, "about", *who)) continue;
            const k::Node& node = *world.node(held->to);
            npc::ContextPacket::Item item{text(node.props, "text"), real(node.props, "stance", 0.0), {}};
            for (const k::Edge* reason : index.out(held->to, "because")) {
                item.because.push_back(text(world.node(reason->to)->props, "text"));
            }
            packet.opinionsOfListener.push_back(std::move(item));
        }
    }

    std::vector<npc::ContextPacket::Item> topicFacts;
    for (const k::Edge* belief : byNode(index.out(*me, "believes"), true)) {
        const k::Node& node = *world.node(belief->to);
        npc::ContextPacket::Item item{text(node.props, "text"), real(belief->props, "confidence", 1.0), {}};
        if (who && index.between(belief->to, "about", *who)) {
            packet.factsAboutListener.push_back(std::move(item));
        } else if (!needle.empty() && lower(item.text).find(needle) != std::string::npos) {
            topicFacts.push_back(std::move(item));
        }
    }

    for (const k::Edge* sample : byNode(index.in(*me, "sample-of"), false)) {
        packet.voiceSamples.push_back(text(world.node(sample->from)->props, "line"));
    }

    std::vector<std::pair<std::int64_t, std::string>> lines;
    if (who) {
        for (const k::Edge* spoke : byNode(index.out(*me, "spoke"), true)) {
            if (!index.between(spoke->to, "said-to", *who)) continue;
            const k::Node& node = *world.node(spoke->to);
            const auto it = node.props.find("game_time");
            lines.emplace_back(it == node.props.end() ? 0 : it->second.integer, text(node.props, "line"));
        }
    }

    // Same ordering and limits as spike 012's assembler.
    std::stable_sort(packet.opinionsOfListener.begin(), packet.opinionsOfListener.end(),
        [](const auto& a, const auto& b) { return std::fabs(a.weight) > std::fabs(b.weight); });
    const auto surest = [](const auto& a, const auto& b) { return a.weight > b.weight; };
    std::stable_sort(packet.factsAboutListener.begin(), packet.factsAboutListener.end(), surest);
    std::stable_sort(topicFacts.begin(), topicFacts.end(), surest);
    if (packet.factsAboutListener.size() > limits.facts) packet.factsAboutListener.resize(limits.facts);
    topicFacts.resize(std::min(topicFacts.size(), limits.facts));
    packet.topicFacts = std::move(topicFacts);
    if (packet.voiceSamples.size() > limits.samples) packet.voiceSamples.resize(limits.samples);
    std::stable_sort(lines.begin(), lines.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    const std::size_t skip = lines.size() > limits.recentLines ? lines.size() - limits.recentLines : 0;
    for (std::size_t i = skip; i < lines.size(); ++i) packet.recentLinesToListener.push_back(lines[i].second);
    return packet;
}

std::string exportSlice(const k::World& world, std::string_view speaker, const std::string& dir) {
    const Index index(world);
    const k::NodeId me = findCharacter(world, speaker).value();
    const std::map<std::string, k::Value>& self = world.node(me)->props;
    const std::string name = text(self, "name");
    const std::string path = dir + "/" + lower(name) + ".tree";
    auto kernel = createWorld(path, lower(name));

    // Mirrors 013a's builder commit for commit, so a slice can be compared
    // with a hand-built per-NPC file byte for byte.
    Batch who(kernel->world(), "human", "designer", "who " + name + " is");
    who.node(npc::kSelf, {{"name", t(name)}, {"role", t(text(self, "role"))}, {"voice", t(text(self, "voice"))}});
    std::map<std::uint64_t, k::NodeId> person; // story id -> slice id
    for (const k::NodeId id : world.nodeIds()) {
        const k::Node* n = world.node(id);
        if (n->type == kCharacter && id != me) {
            person[id.value] = who.node(npc::kPerson, {{"name", t(text(n->props, "name"))}, {"entity", t(text(n->props, "entity"))}});
        }
    }
    for (const k::Edge* e : index.in(me, "sample-of")) {
        who.node(npc::kSample, {{"line", t(text(world.node(e->from)->props, "line"))}});
    }
    submitOrThrow(*kernel, who);

    Batch know(kernel->world(), "human", "designer", "what " + name + " knows");
    std::map<std::uint64_t, k::NodeId> fact;
    for (const k::NodeId id : world.nodeIds()) {
        const k::Node* n = world.node(id);
        const k::Edge* belief = n->type == kFact ? index.between(me, "believes", id) : nullptr;
        if (!belief) continue;
        const k::NodeId f = know.node(npc::kFact, {{"text", t(text(n->props, "text"))},
                                                      {"confidence", k::Value::ofReal(real(belief->props, "confidence", 1.0))},
                                                      {"source", t(text(belief->props, "source"))}});
        fact[id.value] = f;
        for (const k::Edge* about : index.out(id, "about")) {
            if (about->to != me) know.edge(f, person.at(about->to.value), npc::kAbout);
        }
    }
    submitOrThrow(*kernel, know);

    Batch feel(kernel->world(), "plugin", "perihelion.mind", name + "'s opinions");
    for (const k::Edge* held : index.out(me, "holds")) {
        const k::Node* o = world.node(held->to);
        const k::NodeId id = feel.node(npc::kOpinion, {{"text", t(text(o->props, "text"))},
                                                          {"stance", k::Value::ofReal(real(o->props, "stance", 0.0))}});
        for (const k::Edge* about : index.out(held->to, "about")) feel.edge(id, person.at(about->to.value), npc::kAbout);
        for (const k::Edge* reason : index.out(held->to, "because")) {
            const auto it = fact.find(reason->to.value);
            if (it == fact.end()) {
                throw std::runtime_error(name + " holds an opinion for a reason they don't believe");
            }
            feel.edge(id, it->second, npc::kBecause);
        }
    }
    submitOrThrow(*kernel, feel);

    for (const k::Edge* spoke : index.out(me, "spoke")) {
        const k::Node* u = world.node(spoke->to);
        const k::Edge* to = index.out(spoke->to, "said-to").front();
        auto said = kernel->submit(npc::recordUtterance(kernel->world(), person.at(to->to.value), text(u->props, "line"),
            u->props.at("game_time").integer));
        if (!said) throw std::runtime_error("slice line: " + said.error().detail);
    }
    return path;
}

std::vector<FalseBelief> falseBeliefs(const k::World& world) {
    std::vector<FalseBelief> out;
    for (const k::EdgeId id : world.edgeIds()) {
        const k::Edge* e = world.edge(id);
        if (e->label != "believes") continue;
        const k::Node* f = world.node(e->to);
        const auto canon = f->props.find("canon");
        if (canon != f->props.end() && !canon->second.boolean) {
            out.push_back({text(world.node(e->from)->props, "name"), text(f->props, "text"), text(e->props, "source"),
                real(e->props, "confidence", 1.0)});
        }
    }
    return out;
}

} // namespace story::shared
