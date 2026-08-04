#pragma once

#include "rules/SimulationRule.hpp"

namespace sw {

// Phase 3: granular settling — fall straight down, otherwise slide diagonally.
// Diagonal choice must come from seeded, address-based randomness, never from
// iteration accidents.
class SandRule final : public SimulationRule {
public:
    std::string_view name() const override;
    std::uint32_t version() const override;
    void apply(World& world, Tick tick) override;
};

} // namespace sw
