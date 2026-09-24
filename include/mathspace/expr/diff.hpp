// mathspace/expr/diff.hpp — symbolic derivative of an Ast.
//
// differentiate(f, field, lane) is d f / d (self.field.lane): the
// derivative of the expression with respect to one scalar lane of one of
// the note's own fields, as a new Ast that compiles and runs like any
// other (phase 4's constraint solver needs the gradient of a constraint
// expression with respect to each position lane, and asks for it here
// once at bind time rather than differencing numerically every tick).
//
// Shapes are preserved: the derivative of a value of dim d is a value of
// dim d, so every rule below keeps the operand shapes the compiler
// accepts (bytecode.hpp): `d(a * b) = da * b + a * db` broadcasts exactly
// as `a * b` did. The Ast carries no dims, so the DimResolver that the
// compiler would use is asked for reference dims; that is what makes a
// zero derivative the right shape (`[0, 0]` for a vector field, `0` for
// a scalar) and gives `self.field` its unit vector.
//
// Rules (x is the variable, everything else is constant in x):
//   number, other/node/space/world refs, comparisons   zero of the shape
//   self.field                       unit vector at `lane` (1 when dim 1)
//   - a, a + b, a - b, [..], a.k, if c then a else b   linear in the
//                                    derivatives; the condition is copied
//   a * b, a / b                     product and quotient rules
//   sqrt sin cos exp log pow atan2   the chain rule with the usual forms;
//                                    pow(a, b) with b constant in x is
//                                    b * pow(a, b - 1) * da
//   abs min max clamp                the derivative of the branch taken:
//                                    `if a < 0 then -da else da` and so on
//   dot(a, b)                        dot(da, b) + dot(a, db)
//   norm(a)                          dot(a, da) / norm(a)
//   curve                            Unsupported (a table has no useful
//                                    symbolic slope; the solver avoids it)
//
// Subtrees whose derivative is identically zero (no `self.field` inside)
// are never expanded, so `x * y * z` differentiated by x is `y * z` plus
// nothing, not a tree of zero products. The result is a tree, not a DAG:
// a subtree the rule needs twice is copied twice, which is what keeps
// MAX_NODES an honest bound on what the compiler and VM will see.
//
// `node(nN).f` is treated as a constant even when nN is the note the
// expression is bound to; write `self.f` for the variable.
#pragma once

#include <cstdint>
#include <string_view>

#include "mathspace/expr/ast.hpp"
#include "mathspace/expr/bytecode.hpp"

namespace mathspace::expr {

enum class DiffError : std::uint8_t {
    Ok = 0,
    EmptyAst,      // nothing to differentiate
    UnknownRef,    // the resolver gave dim 0 for the variable field or for a reference in f
    BadLane,       // lane at or beyond the variable field's dim
    Unsupported,   // `curve` with the variable inside it
    TooManyNodes,  // the derivative would exceed MAX_NODES
};

const char* diff_error_name(DiffError e);

struct DiffResult {
    Ast ast;
    DiffError error = DiffError::Ok;
    std::uint32_t where = 0; // Ast node index in f where the error was found

    bool ok() const { return error == DiffError::Ok; }
};

DiffResult differentiate(const Ast& f, std::string_view field, std::uint8_t lane, const DimResolver& dims);

} // namespace mathspace::expr
