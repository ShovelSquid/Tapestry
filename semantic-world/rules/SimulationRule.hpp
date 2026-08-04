#pragma once

#include "core/Types.hpp"

#include <string_view>

namespace sw {

class World;

class SimulationRule {
public:
    virtual ~SimulationRule() = default;

    virtual std::string_view name() const = 0;
    virtual std::uint32_t version() const = 0;

    virtual void apply(World& world, Tick tick) = 0;
};

} // namespace sw
