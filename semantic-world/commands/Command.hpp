#pragma once

#include "core/Types.hpp"

#include <variant>

namespace sw {

using ParameterId = std::uint32_t;

// Every command carries the tick it belongs to and a stable sequence number.
// Commands are sorted by (tick, sequence) before application, so input order
// never depends on arrival timing.
struct CommandHeader {
    Tick tick {};
    Sequence sequence {};
};

struct PaintMaterialCommand {
    CommandHeader header {};
    Vec2i position {};
    MaterialId material {};
    std::int32_t radius {};
};

struct EraseMaterialCommand {
    CommandHeader header {};
    Vec2i position {};
    std::int32_t radius {};
};

struct SetGravityCommand {
    CommandHeader header {};
    Vec2i gravity {};
};

struct ChangeMaterialParameterCommand {
    CommandHeader header {};
    MaterialId material {};
    ParameterId parameter {};
    std::int32_t value {};
};

using Command = std::variant<
    PaintMaterialCommand,
    EraseMaterialCommand,
    SetGravityCommand,
    ChangeMaterialParameterCommand>;

} // namespace sw
