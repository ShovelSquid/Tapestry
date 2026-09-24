// mathspace/expr/vm.hpp — evaluate a Program against a World and a note.
//
// The machine is a fixed array of fx64 lanes and two counters. A value
// of dim d is d consecutive lanes; every op knows its dim from the
// compiler (bytecode.hpp), so the loop is a switch with no dynamic
// typing. Jumps are forward, so the loop bound is the op count: a
// program of n ops runs at most n ops, whatever the data. Stack bounds
// are checked on every push and pop against MAX_STACK_LANES, so an
// unverified program cannot read outside the array; it fails with
// BadProgram instead.
//
// Semantics, all on the Q32.32 grid with fx64's floor rounding:
//   + - * /        lane-wise, scalar broadcast per the compiler's shapes
//   domain errors  `/ 0`, `sqrt(x < 0)`, `log(x <= 0)`, `pow(x <= 0, y)`
//                  yield 0 in every build (fx64's Release contract); the
//                  VM checks first so the Debug asserts never fire on
//                  user data. `norm` of a wrapped dot product is sqrt(0).
//   comparisons    push fx64 one or zero
//   min max abs clamp sqrt   fx64.hpp;  sin cos atan2 exp log pow  fxmath.hpp
//   dot(a, b)      sum of lane products;  norm(v) = sqrt(dot(v, v))
//   curve(k, t)    k has d knots at t = i / (d - 1); t is clamped to
//                  [0, 1] and the result is linear between the two
//                  nearest knots. d == 1 returns the knot.
//   self.f other.f node(nN).f   the field's lanes; the field must exist
//                  and have the dim the compiler recorded (DimChanged
//                  otherwise, so a reshaped field is an error rather
//                  than a silent misread)
//   space.dim      the note's space dim as an integer on the grid;
//                  space.f  a field of the Space note
//   world.tick     the tick as an integer on the grid (mod 2^31 so it
//                  stays on the grid; ticks never get that far)
//
// eval writes the result's `program.dim` lanes into `out` and zeroes the
// rest, so the caller can hand it straight to Field::value. A failure
// leaves `out` all zero.
#pragma once

#include <array>
#include <cstdint>

#include "mathspace/expr/bytecode.hpp"
#include "mathspace/world.hpp"

namespace mathspace::expr {

enum class VmError : std::uint8_t {
    Ok = 0,
    NoOther,      // `other.f` with no other note supplied
    NoSuchNote,   // `node(nN)` not in the world
    NoSpace,      // `space.*` on a note without a Space (a Space note itself)
    NoSuchField,  // the note has no field of that name
    UnknownRef,   // `space.<x>` that is neither dim nor a field, `world.<x>` not tick
    DimChanged,   // the field exists at a different dim than the op recorded
    BadProgram,   // stack over/underflow or an op the verifier would reject
};

const char* vm_error_name(VmError e);

using Lanes = std::array<fx64, MAX_DIM>;

VmError eval(const Program& program, const World& world, const Note& self, const Note* other, Lanes& out);

// The DimResolver the compiler needs for the same references, read from
// a World: `self` is the note the expression is bound to, `other` may be
// null (then `other.f` fails to compile with UnknownRef).
struct WorldDims : DimResolver {
    const World& world;
    const Note& self;
    const Note* other = nullptr;

    WorldDims(const World& w, const Note& s, const Note* o = nullptr) : world(w), self(s), other(o) {}

    std::uint8_t dim(RefKind ref, std::uint64_t id, std::string_view name) const override;
};

// The DimResolver for a program bound on a Rule note (step.cpp) or a
// View note (ms_project), whose `self` (and `other`) is a target note of
// the rule's space that does not exist at compile time. `pos` is the
// space dim; any other field takes the dim of the first Note-kind note in
// the space, in id order, that has it (rules and views excluded); `space.*` is the rule's
// space. A wrong guess for a note that holds the field at another dim
// is a per-note DimChanged at evaluation, not a misread.
struct RuleDims : DimResolver {
    const World& world;
    const Note& rule;

    RuleDims(const World& w, const Note& r) : world(w), rule(r) {}

    std::uint8_t dim(RefKind ref, std::uint64_t id, std::string_view name) const override;
};

} // namespace mathspace::expr
