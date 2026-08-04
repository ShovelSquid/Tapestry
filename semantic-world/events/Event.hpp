#pragma once

#include "core/Types.hpp"

#include <optional>
#include <string>

namespace sw {

enum class EventType : std::uint32_t {
    CreateWorld,
    PaintMaterial,
    EraseMaterial,
    SetGravity,
    ChangeMaterialParameter,
    CreateEntity,
    DestroyEntity,
    CreateRuleRegion,
    ReplaceRulePipeline,
    AddSemanticTag,
    DamageParticle,
    CreateScar,
};

struct Region2i {
    Vec2i min {};
    Vec2i max {};
};

// Every event records tick, sequence, type, schema version, source, payload,
// an optional causal parent and an optional affected region.
struct Event {
    Tick tick {};
    Sequence sequence {};
    EventType type {};
    SchemaVersion schemaVersion {1};

    std::string source; // author or system component

    std::string payload; // JSON for now, binary later

    std::optional<Sequence> causalParent;
    std::optional<Region2i> affectedRegion;
};

} // namespace sw
