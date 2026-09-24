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
//   8: constraints. After the integrator, MS_CONSTRAINT_ITERATIONS passes
//      over every rule with a bound scalar `constraint` (id order, its
//      scope's visits in step order) move `self.pos` by the XPBD
//      projection along the symbolic gradient; then `velocity = pos -
//      prev` for every note the integrator moves; then set rules as in 6.
//   9: View notes (NoteKind::View). Rule targets are Note-kind notes only
//      (a View with `pos` is never pushed), and the bound-field pass skips
//      Views as it skips Rules: a View's `project` is evaluated only on
//      demand by ms_project, outside step() and the hash.
inline constexpr std::uint32_t MS_STEP_VERSION = 9u;

// The constraint solver's fixed pass count (ddsim's
// DD_CONSTRAINT_ITERATIONS, never a convergence check) and the guard
// below which a projection's denominator is treated as zero and the
// visit skipped (ddsim's DD_CONSTRAINT_EPS, 2^-16): both are behaviour
// pinned by MS_STEP_VERSION, not state.
inline constexpr std::uint32_t MS_CONSTRAINT_ITERATIONS = 4u;
inline constexpr std::int64_t MS_CONSTRAINT_EPS_RAW = std::int64_t{1} << 16;

} // namespace mathspace
