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
//   3: the bootstrap rule is gone. Unary force rules (Rule notes with a
//      bound `force`) accumulate per target note in rule id order, then
//      `velocity += force / mass; pos += velocity` (mass defaults to 1),
//      then the bound fields of non-Rule notes as in 2.
//   4: a rule's bound scalar `select` gates each target: nonzero selects,
//      an evaluation error skips the target, absent selects all.
//   5: the integrator skips a note whose scalar `pinned` is nonzero
//      (RULE-08): neither its velocity nor its pos changes.
//   6: after the integrator, a rule's bound `set.<f>` fields (name order,
//      rules in id order) assign `f` on each selected, unpinned target
//      that already holds `f` at the program's dim.
//   7: pair and global scope. A pair rule visits every ordered pair of
//      distinct targets with `other` bound (select included), writing
//      `self`; a global rule visits the rule note once. Unary unchanged.
inline constexpr std::uint32_t MS_STEP_VERSION = 7u;

} // namespace mathspace
