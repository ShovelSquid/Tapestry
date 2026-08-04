#pragma once

#include "core/Types.hpp"

#include <string>

namespace sw {

struct MaterialDefinition {
    MaterialId id {};
    std::string name;

    std::int32_t density {};
    std::int32_t friction {};
    std::int32_t cohesion {};
    std::int32_t flowRate {};
    std::int32_t thermalConductivity {};

    bool affectedByGravity {};
    bool canFlow {};
    bool immovable {};
};

} // namespace sw
