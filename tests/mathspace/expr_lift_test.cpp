// expr_lift_test.cpp — bytecode back to an Ast: every shape the compiler
// emits round-trips (parse, compile, lift, compile again gives the same
// ops and the same s-expression), and malformed op lists are refused.
#include <doctest.h>

#include <string>

#include "mathspace/expr/lift.hpp"
#include "mathspace/expr/parser.hpp"

using namespace mathspace::expr;

namespace {

// pos and vel are dim 2, every other self/other field dim 1, node n7 has
// `q` dim 3 (the same table as expr_bytecode_test.cpp).
struct Dims : DimResolver {
    std::uint8_t dim(RefKind ref, std::uint64_t id, std::string_view name) const override {
        if (ref == RefKind::Space) return name == "dim" || name == "pos" ? 1 : 0;
        if (ref == RefKind::World) return name == "tick" ? 1 : 0;
        if (ref == RefKind::Node) return id == 7 && name == "q" ? 3 : 0;
        if (name == "pos" || name == "vel") return 2;
        return 1;
    }
};

// Compiles `src`, encodes and decodes it (as the world stores it), lifts,
// and checks the lifted tree against the parsed one both as text and as
// the ops it compiles to.
void roundtrip(const char* src) {
    const ParseResult p = parse(src);
    REQUIRE_MESSAGE(p.ok(), std::string(src) << ": " << parse_error_name(p.error));
    const CompileResult c = compile(p.ast, Dims{});
    REQUIRE_MESSAGE(c.ok(), std::string(src) << ": " << compile_error_name(c.error));
    const std::vector<std::uint8_t> bytes = encode(c.program);
    Program stored;
    std::uint32_t where = 0;
    REQUIRE(decode(bytes.data(), bytes.size(), stored, where) == CompileError::Ok);
    const LiftResult l = lift(stored);
    REQUIRE_MESSAGE(l.ok(), std::string(src) << ": " << lift_error_name(l.error) << "@" << l.where);
    CHECK_MESSAGE(to_sexpr(l.ast) == to_sexpr(p.ast), std::string(src));
    const CompileResult again = compile(l.ast, Dims{});
    REQUIRE_MESSAGE(again.ok(), std::string(src) << ": " << compile_error_name(again.error));
    CHECK_MESSAGE(again.program == c.program, std::string(src));
    CHECK(to_listing(again.program) == to_listing(c.program));
}

Op op(OpCode code, std::uint8_t dim = 1, std::int64_t value = 0) {
    Op o;
    o.code = code;
    o.dim = dim;
    o.value = value;
    return o;
}

std::string lift_err(std::vector<Op> ops) {
    Program p;
    p.ops = std::move(ops);
    const LiftResult r = lift(p);
    if (r.ok()) return "OK " + to_sexpr(r.ast);
    return std::string(lift_error_name(r.error)) + "@" + std::to_string(r.where);
}

} // namespace

TEST_CASE("every op shape lifts back to the tree it came from") {
    const char* sources[] = {
        "1",
        "-1.5",
        "self.mass",
        "self.pos",
        "other.pos - self.pos",
        "[1, 2]",
        "[self.mass, 2, 3]",
        "self.pos.x",
        "self.pos.y * self.mass",
        "2 * self.pos",
        "self.pos * 2",
        "self.pos / 2",
        "self.mass / 3",
        "1 < 2", "1 <= 2", "1 > 2", "1 >= 2", "1 == 2", "1 != 2",
        "if self.mass > 0 then self.pos else [0, 0]",
        "if 1 then if 2 then 3 else 4 else 5",
        "if 1 then 2 else if 3 then 4 else 5",
        "(if 1 then 2 else 3) + (if 4 then 5 else 6)",
        "if (if 1 then 2 else 3) then 4 else 5",
        "min(1, 2)", "max(self.mass, 0)", "abs(-1)", "clamp(self.t, 0, 1)",
        "sqrt(self.mass)", "sin(1)", "cos(1)", "atan2(1, 2)", "exp(1)", "log(2)", "pow(2, 3)",
        "dot(self.pos, other.pos)",
        "norm(other.pos - self.pos) - self.rest",
        "curve(node(n7).q, self.t)",
        "space.dim + world.tick",
        "node(n7).q.z",
        "norm([self.pos.x, 0]) * (if self.mass == 0 then 1 else self.mass)",
    };
    for (const char* src : sources) {
        roundtrip(src);
    }
}

TEST_CASE("malformed op lists are refused, not walked off the end") {
    CHECK(lift_err({}) == "EmptyProgram@0");
    CHECK(lift_err({op(OpCode::Add, 1)}) == "BadStack@0");
    CHECK(lift_err({op(OpCode::PushNum), op(OpCode::PushNum)}) == "BadStack@2");
    CHECK(lift_err({op(OpCode::PushNum), op(OpCode::Jump, 1, 2), op(OpCode::PushNum)}) == "BadJump@1");
    // JumpIfZero with no Jump: the frame is never closed.
    CHECK(lift_err({op(OpCode::PushNum), op(OpCode::JumpIfZero, 1, 3), op(OpCode::PushNum)}) == "BadJump@3");
    CHECK(lift_err({op(OpCode::PushNum, 1, 1LL << 32)}) == "OK 1");
}
