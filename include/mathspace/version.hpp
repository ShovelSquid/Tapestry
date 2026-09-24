// mathspace/version.hpp — library version string (version.cpp) and the
// pins for behaviour that is compiled into the engine rather than stored.
#pragma once

#include <cstdint>

namespace mathspace {

const char* version();

// What step() does (step.cpp) is behaviour the bytes of a world do not
// describe, so its version is written into the hash walk (hash.cpp) and
// any change to step() must bump it.
//   1: the phase 1 bootstrap rule, `pos += velocity` for every note that
//      has both fields at the same dim.
//   2: then every bound field is evaluated (expr/vm.hpp), notes in id
//      order, fields in name order, against the live world.
// Plan phase 3 replaces the bootstrap rule with a Rule note.
inline constexpr std::uint32_t MS_STEP_VERSION = 2u;

} // namespace mathspace
