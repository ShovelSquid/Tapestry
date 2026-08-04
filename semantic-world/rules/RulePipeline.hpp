#pragma once

#include "core/Types.hpp"
#include "rules/SimulationRule.hpp"

#include <memory>
#include <vector>

namespace sw {

// Phase 3: rules execute in configured order, every tick, on every machine.
// The pipeline order and each rule version are part of the state hash, so
// reordering rules is a deliberate, versioned change of physics.
class RulePipeline {
public:
    void append(std::unique_ptr<SimulationRule> rule);

    void apply(World& world, Tick tick);

    std::size_t size() const;
    const SimulationRule& at(std::size_t index) const;

private:
    std::vector<std::unique_ptr<SimulationRule>> m_rules;
};

} // namespace sw
