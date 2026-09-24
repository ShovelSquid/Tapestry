// mathspace/expr/lift.hpp — bytecode back to an Ast.
//
// lift(program) is the inverse of compile (bytecode.hpp): a Program whose
// ops came from an Ast is turned back into an Ast that compiles to the
// same ops. The engine stores only bytecode for a bound field (the
// plugin compiles the text and sends action 37), so anything that needs
// the tree of a program the world already holds, first of all the
// constraint solver's symbolic gradient (diff.hpp, step.cpp), lifts it
// here rather than keeping a second copy of every program in the walk.
//
// The walk is one pass over the ops with a stack of subtree roots, the
// stack machine run backwards: a push becomes a leaf, an n-ary op pops n
// roots and pushes their parent, so the nodes come out in post-order by
// construction. `if` is the one shape that is not a single op: compile
// emits `cond JumpIfZero then Jump else` with the JumpIfZero aimed at the
// else-branch and the Jump at the first op after it, so JumpIfZero opens
// a frame holding the condition, Jump closes the then-branch and records
// where the else-branch ends, and reaching that index (checked before
// every op and once at the end) closes the frame into an If node. Inner
// frames always close before outer ones because their ends come first
// or coincide, in which case the frame stack's order is the nesting.
//
// Mul, MulSV and MulVS all lift to Kind::Mul, Div and DivVS to Kind::Div:
// the Ast carries no dims, the compiler rediscovers the variant. A
// Program that decode accepted always lifts; the error codes cover bytes
// this function is handed without that guarantee.
#pragma once

#include <cstdint>

#include "mathspace/expr/ast.hpp"
#include "mathspace/expr/bytecode.hpp"

namespace mathspace::expr {

enum class LiftError : std::uint8_t {
    Ok = 0,
    EmptyProgram,  // no ops
    BadStack,      // an op finds too few values, or more than one is left at the end
    BadJump,       // a Jump without an open frame, or a frame left open at the end
    TooManyNodes,  // more than MAX_NODES
};

const char* lift_error_name(LiftError e);

struct LiftResult {
    Ast ast;
    LiftError error = LiftError::Ok;
    std::uint32_t where = 0; // op index of the failure

    bool ok() const { return error == LiftError::Ok; }
};

LiftResult lift(const Program& program);

} // namespace mathspace::expr
