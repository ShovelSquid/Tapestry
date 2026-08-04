#pragma once

#include "rules/SimulationRule.hpp"

namespace sw {

// Phase 3: lateral flow when downward movement is blocked, limited by the
// material's flowRate.
class WaterRule final : public SimulationRule {
public:
    std::string_view name() const override;
    std::uint32_t version() const override;
    void apply(World& world, Tick tick) override;
};

} // namespace sw
