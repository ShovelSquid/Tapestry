#pragma once

#include "core/Types.hpp"
#include "materials/MaterialDefinition.hpp"

#include <vector>

namespace sw {

// Phase 2: stable material ids, versioned definitions, replay records which
// library version produced a run.
class MaterialLibrary {
public:
    MaterialId add(const MaterialDefinition& definition);
    const MaterialDefinition& get(MaterialId id) const;

    // Bumped whenever any definition changes, so a replay can refuse to run
    // against a library it was not recorded with.
    std::uint32_t version() const;

private:
    std::vector<MaterialDefinition> m_definitions;
    std::uint32_t m_version {1};
};

} // namespace sw
