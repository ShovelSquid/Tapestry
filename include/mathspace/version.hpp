// mathspace/version.hpp — library version string (version.cpp) and the
// pins for behaviour that is compiled into the engine rather than stored.
#pragma once

#include <cstdint>

namespace mathspace {

const char* version();

// The phase 1 bootstrap rule (step.cpp): `pos += velocity` each tick for
// every note that has both fields at the same dim. It is behaviour the
// bytes of a world do not describe, so its version is written into the
// hash walk (hash.cpp) and a change to what step() does must bump it.
// Plan phase 3 replaces the rule with a Rule note and deletes this.
inline constexpr std::uint32_t MS_RULE_INTEGRATE_VERSION = 1u;

} // namespace mathspace
