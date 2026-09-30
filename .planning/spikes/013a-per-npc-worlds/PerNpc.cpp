#include "PerNpc.hpp"

#include "NpcMind.hpp"

namespace story::pernpc {

namespace npc = perihelion::npc;

std::string build(const Scenario& s, const std::string& key, const std::string& dir) {
    const std::string path = dir + "/" + key + ".tree";
    auto kernel = createWorld(path, key);
    const Character& me = s.character(key);
    const auto t = [](const std::string& v) { return k::Value::ofText(v); };

    Batch who(kernel->world(), "human", "designer", "who " + me.name + " is");
    who.node(npc::kSelf, {{"name", t(me.name)}, {"role", t(me.role)}, {"voice", t(me.voice)}});
    std::map<std::string, k::NodeId> person;
    for (const auto& c : s.characters) {
        if (c.key != key) {
            person[c.key] = who.node(npc::kPerson, {{"name", t(c.name)}, {"entity", t(c.entity)}});
        }
    }
    for (const auto& line : me.samples) {
        who.node(npc::kSample, {{"line", t(line)}});
    }
    submitOrThrow(*kernel, who);

    Batch know(kernel->world(), "human", "designer", "what " + me.name + " knows");
    std::map<std::string, k::NodeId> fact;
    for (const auto& f : s.facts) {
        for (const auto& b : s.beliefs) {
            if (b.holder != key || b.fact != f.key) continue;
            const k::NodeId id = know.node(npc::kFact,
                {{"text", t(f.text)}, {"confidence", k::Value::ofReal(b.confidence)}, {"source", t(b.source)}});
            fact[f.key] = id;
            for (const auto& about : f.about) {
                if (about != key) know.edge(id, person.at(about), npc::kAbout);
            }
        }
    }
    submitOrThrow(*kernel, know);

    Batch feel(kernel->world(), "plugin", "perihelion.mind", me.name + "'s opinions");
    for (const auto& o : s.opinions) {
        if (o.holder != key) continue;
        const k::NodeId id = feel.node(npc::kOpinion, {{"text", t(o.text)}, {"stance", k::Value::ofReal(o.stance)}});
        feel.edge(id, person.at(o.about), npc::kAbout);
        for (const auto& reason : o.because) {
            feel.edge(id, fact.at(reason), npc::kBecause); // throws if the holder doesn't believe the reason
        }
    }
    submitOrThrow(*kernel, feel);

    for (const auto& line : s.lines) {
        if (line.speaker == key) {
            auto said = kernel->submit(npc::recordUtterance(kernel->world(), person.at(line.listener), line.text, line.gameTime));
            if (!said) throw std::runtime_error("line: " + said.error().detail);
        }
    }
    return path;
}

int correctFact(const std::vector<std::string>& paths, const std::string& oldText, const std::string& newText) {
    int touched = 0;
    for (const auto& path : paths) {
        auto opened = k::Kernel::open(path, k::OpenPolicy::Existing);
        if (!opened) throw std::runtime_error("open " + path);
        auto& kernel = *opened.value();
        k::Proposal fix{{"human", "designer"}, "correct a shared fact", {}};
        for (const k::NodeId id : kernel.world().nodeIds()) {
            const k::Node* node = kernel.world().node(id);
            const auto it = node->props.find("text");
            if (node->type == npc::kFact && it != node->props.end() && it->second.text == oldText) {
                fix.ops.push_back(k::SetProperty{id, "text", k::Value::ofText(newText)});
            }
        }
        if (!fix.ops.empty()) {
            if (!kernel.submit(fix)) throw std::runtime_error("correct " + path);
            ++touched;
        }
    }
    return touched;
}

} // namespace story::pernpc
