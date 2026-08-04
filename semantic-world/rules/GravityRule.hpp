#pragma once

#include "rules/SimulationRule.hpp"

namespace sw {

// Phase 3: applies the world (or region) gravity vector to every particle
// whose material is affected by gravity, in stable id order.
class GravityRule final : public SimulationRule {
public:
    std::string_view name() const override;
    std::uint32_t version() const override;
    void apply(World& world, Tick tick) override;
};

} // namespace sw
