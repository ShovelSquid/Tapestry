// mathspace/expr/ast.hpp — the expression tree as a flat vector.
//
// An Ast is a std::vector of Nodes in post-order: every child sits at a
// lower index than its parent, and the root is the last node. Children are
// not stored in the node but as a contiguous run of indices in Ast::args
// (`first`, `count`), the same way for every kind, so a walker is one
// index loop from 0 to size(): by the time it reaches a node, every child
// has been visited. Nothing here needs recursion or a pointer, which is
// what the plan asks for (mathspace_plan.md, phase 2) and what keeps the
// bytecode compiler, the differentiator, and the hash walk bounded.
//
// The tree carries no types: `[1, 2] + 3` parses fine and is rejected by
// the checker in bytecode.hpp. The parser only guarantees shape: builtin
// arity, vector length within MAX_DIM, component lanes within MAX_DIM,
// well-formed references.
//
// Number literals are already on the Q32.32 grid (Node::value is the raw);
// the parser rejects decimals that are not exactly k / 2^32, so no rounding
// ever happens after this point, which is also why no floating type is
// needed anywhere near the expression code.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "ddsim/fx64.hpp"
#include "mathspace/note.hpp"

namespace mathspace::expr {

enum class Kind : std::uint8_t {
    Number,    // value = raw fx64; no children
    Vector,    // children = the components, 1..MAX_DIM
    Neg,       // one child
    Add, Sub, Mul, Div,             // two children
    Lt, Le, Gt, Ge, Eq, Ne,         // two children; yields 1 or 0
    If,        // three children: condition, then, else
    Call,      // fn = builtin; children = arguments, count = builtin_arity(fn)
    Component, // one child; lane = 0..MAX_DIM-1
    Ref,       // no children; ref = which note, value = node id for Node, name = field
};

enum class Builtin : std::uint8_t {
    Min, Max, Abs, Clamp, Sqrt, Sin, Cos, Atan2, Exp, Log, Pow, Dot, Norm, Curve,
    COUNT
};

enum class RefKind : std::uint8_t {
    Self,   // the note the expression is bound on
    Other,  // the other note of a pair rule
    Node,   // an explicit note, `node(n12).f`; value holds the id
    Space,  // the note's space: `space.dim`, `space.pos`
    World,  // `world.tick`
};

struct Node {
    Kind kind = Kind::Number;
    Builtin fn = Builtin::Min;   // Call only
    RefKind ref = RefKind::Self; // Ref only
    std::uint8_t lane = 0;       // Component only
    std::uint32_t first = 0;     // index into Ast::args of the first child
    std::uint32_t count = 0;     // number of children
    std::int64_t value = 0;      // Number: raw fx64. Ref/Node: the note id.
    std::string name;            // Ref: field name (empty for other kinds)
};

struct Ast {
    std::vector<Node> nodes; // post-order, root last
    std::vector<std::uint32_t> args;

    bool empty() const { return nodes.empty(); }
    std::uint32_t root() const { return static_cast<std::uint32_t>(nodes.size() - 1); }
    std::uint32_t child(const Node& n, std::uint32_t i) const { return args[n.first + i]; }
};

// Hard bounds so every pass over an expression has a fixed cost ceiling.
inline constexpr std::uint32_t MAX_NODES = 4096;
inline constexpr std::uint32_t MAX_DEPTH = 64;

std::string_view builtin_name(Builtin b);
std::uint32_t builtin_arity(Builtin b);
// Builtin::COUNT when the name is not a builtin.
Builtin builtin_from_name(std::string_view name);

std::string_view ref_name(RefKind r);
std::string_view kind_name(Kind k);

// Exact decimal text of a raw Q32.32 value: "-1.5", "0.00000000023283064365386962890625".
// Trailing zeros are dropped and integers print with no point. This is the
// inverse of the parser's literal rule, so parse(to_decimal(v)) == v.
std::string to_decimal(std::int64_t raw);

// S-expression rendering for tests and diagnostics, one index loop over the
// nodes: `(+ (ref self pos) [1 2])`, `(if (< a b) a b)`, `(. (ref self pos) 0)`.
std::string to_sexpr(const Ast& ast);

} // namespace mathspace::expr
