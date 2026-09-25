// mathspace/expr/bytecode.hpp — a checked, flat op list from an Ast.
//
// The VM (vm.hpp) is a stack of fx64 lanes. A value of dim d occupies d
// consecutive lanes, so a vector literal costs nothing: its components
// are pushed in order and simply are the vector (MakeVec only tells the
// verifier that d scalars became one value). Every op therefore
// carries the dim it works on, fixed at compile time by the shape check
// here, and the VM never has to discover a dim at run time. `if` is the
// one piece of control flow: a forward JumpIfZero over the then-branch
// and a forward Jump over the else-branch, so a program of n ops
// executes at most n ops and both branches keep their Debug asserts
// honest (only the taken branch runs).
//
// Shapes. The check assigns each Ast node a dim:
//   literal 1; `[a, b]` its count, each component dim 1 (NestedVector
//   otherwise); `+ -` need equal dims; `*` allows scalar*scalar,
//   scalar*vector and vector*scalar; `/` allows scalar/scalar and
//   vector/scalar; comparisons, `if` conditions and every scalar builtin
//   (`min max abs clamp sqrt sin cos atan2 exp log pow`) take dim 1;
//   `if` branches need equal dims; `.lane` needs lane < dim and yields 1;
//   `dot` takes two equal dims and yields 1; `norm` takes any dim and
//   yields 1; `curve(knots, t)` takes knots of any dim and a scalar t and
//   yields 1 (a piecewise-linear table, see vm.hpp).
//
// A reference's dim is not in the text: it is the dim of a field on a
// note. The compiler asks a DimResolver, which the caller builds from
// whatever it knows (the World for `self` and `node(nN)`, a rule's scope
// for `other`). The dim is recorded in the LoadRef op, so the VM can
// refuse to run when the field has since changed shape instead of
// silently reading the wrong lanes. `space.dim` and `world.tick` resolve
// to dim 1 through the same call.
//
// Bytes. `encode` is the canonical form that action 37 carries and the
// hash walk writes for a bound field; `decode` rejects anything that
// `verify` would not accept, so bytecode arriving through an action is
// as safe as bytecode the compiler produced. `verify` replays the stack
// discipline with dims, including at jump targets, in one linear pass.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "mathspace/expr/ast.hpp"

namespace mathspace::expr {

enum class OpCode : std::uint8_t {
    PushNum = 0, // imm = raw fx64; pushes 1
    LoadRef,     // ref, dim, imm = node id (Node), name; pushes dim
    MakeVec,     // dim: pops dim scalars, pushes one value of dim (no lane moves)
    Neg,         // dim: pops dim, pushes dim
    Add, Sub,    // dim: pops dim, dim; pushes dim
    Mul, Div,    // scalar: pops 1, 1; pushes 1
    MulSV,       // dim: pops 1 (below) and dim (top); pushes dim
    MulVS,       // dim: pops dim (below) and 1 (top); pushes dim
    DivVS,       // dim: pops dim (below) and 1 (top); pushes dim
    Lt, Le, Gt, Ge, Eq, Ne, // pops 1, 1; pushes 1 (one or zero)
    Lane,        // dim, lane: pops dim; pushes 1
    Call,        // fn, dim (the vector arg's dim for dot/norm/curve, else 1)
    JumpIfZero,  // imm = target op index (> this op); pops 1
    Jump,        // imm = target op index (> this op)
    COUNT
};

struct Op {
    OpCode code = OpCode::PushNum;
    std::uint8_t dim = 1;
    std::uint8_t lane = 0;         // Lane only
    Builtin fn = Builtin::Min;     // Call only
    RefKind ref = RefKind::Self;   // LoadRef only
    std::int64_t value = 0;        // PushNum: raw; LoadRef: node id; jumps: target
    std::string name;              // LoadRef: field name

    friend bool operator==(const Op& a, const Op& b) {
        return a.code == b.code && a.dim == b.dim && a.lane == b.lane && a.fn == b.fn && a.ref == b.ref &&
               a.value == b.value && a.name == b.name;
    }
    friend bool operator!=(const Op& a, const Op& b) { return !(a == b); }
};

struct Program {
    std::vector<Op> ops;
    std::uint8_t dim = 0;          // dim of the result the last op leaves
    std::uint32_t max_stack = 0;   // lanes; filled by compile and verify

    friend bool operator==(const Program& a, const Program& b) { return a.ops == b.ops && a.dim == b.dim; }
    friend bool operator!=(const Program& a, const Program& b) { return !(a == b); }
};

inline constexpr std::uint8_t BYTECODE_VERSION = 1;
inline constexpr std::uint32_t MAX_OPS = 2 * MAX_NODES;     // every If adds two jumps at most
inline constexpr std::uint32_t MAX_STACK_LANES = 1024;

enum class CompileError : std::uint8_t {
    Ok = 0,
    DimMismatch,   // operands of different dims where equal dims are needed
    NotScalar,     // a scalar position holds a vector
    NestedVector,  // a vector literal component is itself a vector
    BadLane,       // `.lane` at or beyond the value's dim
    UnknownRef,    // the resolver gave dim 0 (no such field, or `other` outside a pair)
    EmptyAst,      // nothing to compile
    TooManyOps,    // more than MAX_OPS
    StackTooDeep,  // more than MAX_STACK_LANES lanes live at once
    BadBytes,      // decode: truncated, bad version, bad enum value
    BadJump,       // verify: a jump that is not strictly forward and in range
    BadStack,      // verify: an op finds fewer lanes, or the wrong dims, on the stack
};

const char* compile_error_name(CompileError e);

struct DimResolver {
    virtual ~DimResolver() = default;
    // The dim of `name` on the note `ref` denotes (id for RefKind::Node),
    // or 0 when unknown.
    virtual std::uint8_t dim(RefKind ref, std::uint64_t id, std::string_view name) const = 0;
};

struct CompileResult {
    Program program;
    CompileError error = CompileError::Ok;
    std::uint32_t where = 0; // Ast node index (compile) or op index (verify)

    bool ok() const { return error == CompileError::Ok; }
};

// Shape-checks and emits. Non-recursive: an explicit frame stack over the
// post-order tree, bounded by the node count.
CompileResult compile(const Ast& ast, const DimResolver& dims);

// Replays the stack discipline. On success fills program.max_stack and
// checks program.dim against what the last op leaves. `where` is the op
// index of the failure.
CompileError verify(Program& program, std::uint32_t& where);

//   u8 BYTECODE_VERSION | u8 dim | u32 op_count | ops
//   op: u8 code, then per code:
//     PushNum: i64        LoadRef: u8 ref, u8 dim, u64 id, u8 len, name
//     MakeVec Neg Add Sub MulSV MulVS DivVS: u8 dim   Lane: u8 dim, u8 lane
//     Call: u8 fn, u8 dim       JumpIfZero Jump: u32 target
//     Mul Div and comparisons: nothing
std::vector<std::uint8_t> encode(const Program& program);
// Decodes and verifies; on failure `program` is left empty.
CompileError decode(const std::uint8_t* data, std::size_t size, Program& program, std::uint32_t& where);

// One op per line, for tests: `LoadRef self pos dim 2`, `Add 2`, `Jump 7`.
std::string to_listing(const Program& program);

} // namespace mathspace::expr
