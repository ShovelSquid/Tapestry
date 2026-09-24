// expr_bytecode_test.cpp — Ast to checked op list: shapes, jumps, the
// verifier on hand-built programs, encode/decode round trips.
#include <doctest.h>

#include <string>

#include "mathspace/expr/bytecode.hpp"
#include "mathspace/expr/parser.hpp"

using namespace mathspace::expr;

namespace {

// pos and vel are dim 2, mass and every other self field dim 1, `other`
// mirrors self, node n7 has `q` dim 3, space.dim and world.tick are 1.
struct Dims : DimResolver {
    std::uint8_t dim(RefKind ref, std::uint64_t id, std::string_view name) const override {
        if (ref == RefKind::Space) return name == "dim" || name == "pos" ? 1 : 0;
        if (ref == RefKind::World) return name == "tick" ? 1 : 0;
        if (ref == RefKind::Node) return id == 7 && name == "q" ? 3 : 0;
        if (name == "pos" || name == "vel") return 2;
        if (name == "missing") return 0;
        return 1;
    }
};

CompileResult comp(const char* src) {
    const ParseResult p = parse(src);
    REQUIRE_MESSAGE(p.ok(), std::string(src) << ": " << parse_error_name(p.error));
    return compile(p.ast, Dims{});
}

std::string listing(const char* src) {
    const CompileResult r = comp(src);
    if (!r.ok()) {
        return std::string("ERR ") + compile_error_name(r.error) + "@" + std::to_string(r.where);
    }
    return to_listing(r.program);
}

std::string err(const char* src) {
    const CompileResult r = comp(src);
    if (r.ok()) return "OK dim " + std::to_string(r.program.dim);
    return std::string(compile_error_name(r.error)) + "@" + std::to_string(r.where);
}

Op op(OpCode code, std::uint8_t dim = 1, std::int64_t value = 0) {
    Op o;
    o.code = code;
    o.dim = dim;
    o.value = value;
    return o;
}

} // namespace

TEST_CASE("scalars and vectors compile to the expected ops") {
    CHECK(listing("1 + 2") == "PushNum 1\nPushNum 2\nAdd 1\n");
    CHECK(listing("[1, 2] + self.pos") == "PushNum 1\nPushNum 2\nMakeVec 2\nLoadRef self pos dim 2\nAdd 2\n");
    CHECK(listing("-self.pos") == "LoadRef self pos dim 2\nNeg 2\n");
    CHECK(listing("2 * self.pos") == "PushNum 2\nLoadRef self pos dim 2\nMulSV 2\n");
    CHECK(listing("self.pos * 2") == "LoadRef self pos dim 2\nPushNum 2\nMulVS 2\n");
    CHECK(listing("self.pos / 2") == "LoadRef self pos dim 2\nPushNum 2\nDivVS 2\n");
    CHECK(listing("self.mass / 2") == "LoadRef self mass dim 1\nPushNum 2\nDiv\n");
    CHECK(listing("self.pos.y") == "LoadRef self pos dim 2\nLane 2 1\n");
    CHECK(listing("[1, 2].x") == "PushNum 1\nPushNum 2\nMakeVec 2\nLane 2 0\n");
    CHECK(listing("node(n7).q.2") == "LoadRef node n7 q dim 3\nLane 3 2\n");
    CHECK(listing("dot(self.pos, other.vel)") == "LoadRef self pos dim 2\nLoadRef other vel dim 2\nCall dot 2\n");
    CHECK(listing("norm(node(n7).q)") == "LoadRef node n7 q dim 3\nCall norm 3\n");
    CHECK(listing("curve([0, 1, 0], world.tick)") == "PushNum 0\nPushNum 1\nPushNum 0\nMakeVec 3\nLoadRef world tick dim 1\nCall curve 3\n");
    CHECK(listing("clamp(self.mass, 0, 1)") == "LoadRef self mass dim 1\nPushNum 0\nPushNum 1\nCall clamp 1\n");
    CHECK(listing("1 < 2") == "PushNum 1\nPushNum 2\nLt\n");
    CHECK(listing("space.dim") == "LoadRef space dim dim 1\n");
    CHECK(err("[1, 2, 3]") == "OK dim 3");
    CHECK(err("[self.mass]") == "OK dim 1");
}

TEST_CASE("if compiles to forward jumps") {
    CHECK(listing("if 1 < 2 then 3 else 4") ==
          "PushNum 1\nPushNum 2\nLt\nJumpIfZero 6\nPushNum 3\nJump 7\nPushNum 4\n");
    CHECK(listing("if self.mass then self.pos else [0, 0]") ==
          "LoadRef self mass dim 1\nJumpIfZero 4\nLoadRef self pos dim 2\nJump 7\nPushNum 0\nPushNum 0\nMakeVec 2\n");
    CHECK(listing("1 + (if 1 then 2 else 3)") ==
          "PushNum 1\nPushNum 1\nJumpIfZero 5\nPushNum 2\nJump 6\nPushNum 3\nAdd 1\n");
    CHECK(listing("if 1 then if 2 then 3 else 4 else 5") ==
          "PushNum 1\nJumpIfZero 8\nPushNum 2\nJumpIfZero 6\nPushNum 3\nJump 7\nPushNum 4\nJump 9\nPushNum 5\n");
    const CompileResult r = comp("if 1 then if 2 then 3 else 4 else 5");
    REQUIRE(r.ok());
    CHECK(r.program.dim == 1);
    CHECK(r.program.max_stack == 1);
    CHECK(comp("1 + (if 1 then 2 else 3)").program.max_stack == 2);
}

TEST_CASE("shape errors point at the ast node") {
    CHECK(err("self.pos + 1") == "DimMismatch@2");
    CHECK(err("self.pos - node(n7).q") == "DimMismatch@2");
    CHECK(err("self.pos * other.pos") == "DimMismatch@2");
    CHECK(err("1 / self.pos") == "NotScalar@2");
    CHECK(err("self.pos / other.pos") == "NotScalar@2");
    CHECK(err("self.pos < 1") == "NotScalar@2");
    CHECK(err("if self.pos then 1 else 2") == "NotScalar@3");
    CHECK(err("if 1 then self.pos else 2") == "DimMismatch@3");
    CHECK(err("[1, self.pos]") == "NestedVector@2");
    CHECK(err("[[1]]") == "OK dim 1"); // a one-vector is a scalar
    CHECK(err("self.pos.z") == "BadLane@1");
    CHECK(err("self.mass.x") == "OK dim 1");
    CHECK(err("self.mass.y") == "BadLane@1");
    CHECK(err("self.missing") == "UnknownRef@0");
    CHECK(err("other.missing") == "UnknownRef@0");
    CHECK(err("node(n8).q") == "UnknownRef@0");
    CHECK(err("space.tick") == "UnknownRef@0");
    CHECK(err("world.dim") == "UnknownRef@0");
    CHECK(err("sin(self.pos)") == "NotScalar@1");
    CHECK(err("min(self.pos, 1)") == "NotScalar@2");
    CHECK(err("dot(self.pos, node(n7).q)") == "DimMismatch@2");
    CHECK(err("curve(self.pos, self.vel)") == "NotScalar@2");
    CHECK(err("norm(1)") == "OK dim 1");
    CHECK(err("abs(-[1, 2].x)") == "OK dim 1");
    CHECK(compile(Ast{}, Dims{}).error == CompileError::EmptyAst);
}

TEST_CASE("verify accepts what compile emits and rejects malformed programs") {
    Program p;
    std::uint32_t where = 0;
    p.ops = {op(OpCode::PushNum), op(OpCode::PushNum), op(OpCode::Add)};
    p.dim = 1;
    CHECK(verify(p, where) == CompileError::Ok);
    CHECK(p.max_stack == 2);

    p.dim = 2; // result dim does not match
    CHECK(verify(p, where) == CompileError::BadStack);
    CHECK(where == 3);

    p.dim = 1;
    p.ops[2].dim = 2; // Add 2 over two scalars
    CHECK(verify(p, where) == CompileError::BadStack);
    CHECK(where == 2);

    p.ops = {op(OpCode::PushNum), op(OpCode::PushNum)}; // two values left
    CHECK(verify(p, where) == CompileError::BadStack);
    p.ops = {op(OpCode::Add)}; // underflow
    CHECK(verify(p, where) == CompileError::BadStack);
    CHECK(where == 0);
    p.ops = {};
    CHECK(verify(p, where) == CompileError::BadStack);

    // Jumps: backwards, past the end, to a label with a different shape.
    p.ops = {op(OpCode::PushNum), op(OpCode::JumpIfZero, 1, 0), op(OpCode::PushNum)};
    CHECK(verify(p, where) == CompileError::BadJump);
    CHECK(where == 1);
    p.ops[1].value = 4;
    CHECK(verify(p, where) == CompileError::BadJump);
    p.ops[1].value = 3; // jump to end with an empty stack, fallthrough leaves one: mismatch
    CHECK(verify(p, where) == CompileError::BadStack);
    CHECK(where == 3);
    // Dead code after an unconditional jump with no label.
    p.ops = {op(OpCode::PushNum), op(OpCode::Jump, 1, 3), op(OpCode::PushNum), op(OpCode::Neg)};
    CHECK(verify(p, where) == CompileError::BadJump);
    CHECK(where == 2);
    // Both arms of a well-formed if.
    p.ops = {op(OpCode::PushNum), op(OpCode::JumpIfZero, 1, 4), op(OpCode::PushNum), op(OpCode::Jump, 1, 5),
             op(OpCode::PushNum)};
    p.dim = 1;
    CHECK(verify(p, where) == CompileError::Ok);
    p.ops[4] = op(OpCode::LoadRef, 2);
    p.ops[4].name = "pos";
    CHECK(verify(p, where) == CompileError::BadStack); // arms disagree
    CHECK(where == 5);

    // Bad enum values and dims.
    p.ops = {op(OpCode::PushNum, 0)};
    CHECK(verify(p, where) == CompileError::BadStack);
    p.ops = {op(OpCode::PushNum, 9)};
    CHECK(verify(p, where) == CompileError::BadStack);
    p.ops = {op(OpCode::LoadRef, 1)};
    CHECK(verify(p, where) == CompileError::BadStack); // empty name
    p.ops[0].name = "m";
    CHECK(verify(p, where) == CompileError::Ok);
    p.ops = {op(OpCode::PushNum), op(OpCode::Call)};
    p.ops[1].fn = Builtin::COUNT;
    CHECK(verify(p, where) == CompileError::BadStack);
    p.ops[1].fn = Builtin::Sqrt;
    CHECK(verify(p, where) == CompileError::Ok);
    p.ops = {op(OpCode::PushNum), op(OpCode::PushNum), op(OpCode::MakeVec, 2), op(OpCode::Lane, 2, 0)};
    p.ops[3].lane = 2;
    CHECK(verify(p, where) == CompileError::BadStack);
    p.ops[3].lane = 1;
    CHECK(verify(p, where) == CompileError::Ok);
    CHECK(p.max_stack == 2);
    p.ops = {op(OpCode::PushNum), op(OpCode::PushNum), op(OpCode::Lane, 2, 0)}; // no MakeVec
    CHECK(verify(p, where) == CompileError::BadStack);
    CHECK(where == 2);
}

TEST_CASE("stack too deep is an error, not a crash") {
    // [8 lanes] pushed via 8 LoadRefs of dim 8 then reduced: 128 lanes is
    // fine; 129 values of dim 8 exceeds MAX_STACK_LANES.
    Program p;
    std::uint32_t where = 0;
    const std::uint32_t n = MAX_STACK_LANES / 8 + 1;
    for (std::uint32_t i = 0; i < n; ++i) {
        Op o = op(OpCode::LoadRef, 8);
        o.name = "v";
        p.ops.push_back(o);
    }
    for (std::uint32_t i = 1; i < n; ++i) p.ops.push_back(op(OpCode::Add, 8));
    p.dim = 8;
    CHECK(verify(p, where) == CompileError::StackTooDeep);
    CHECK(where == n - 1);
    p.ops.erase(p.ops.begin());
    p.ops.pop_back();
    CHECK(verify(p, where) == CompileError::Ok);
    CHECK(p.max_stack == MAX_STACK_LANES);
}

TEST_CASE("encode and decode round trip, decode rejects bad bytes") {
    const char* sources[] = {
        "1 + 2",
        "if self.mass then self.pos else [0, 0]",
        "norm(node(n7).q - [1, 2, 3]) * curve([0, 1], world.tick)",
        "clamp(dot(self.pos, other.vel) / 2, -1.5, 1.5)",
        "self.pos.y",
    };
    for (const char* src : sources) {
        const CompileResult r = comp(src);
        REQUIRE_MESSAGE(r.ok(), std::string(src));
        const std::vector<std::uint8_t> bytes = encode(r.program);
        CHECK(bytes.size() >= 6);
        CHECK(bytes[0] == BYTECODE_VERSION);
        CHECK(bytes[1] == r.program.dim);
        Program back;
        std::uint32_t where = 0;
        CHECK_MESSAGE(decode(bytes.data(), bytes.size(), back, where) == CompileError::Ok, std::string(src) << " @" << where);
        CHECK(back == r.program);
        CHECK(back.max_stack == r.program.max_stack);
        CHECK(encode(back) == bytes);
        // Every truncation fails cleanly.
        for (std::size_t cut = 0; cut < bytes.size(); ++cut) {
            Program t;
            CHECK(decode(bytes.data(), cut, t, where) == CompileError::BadBytes);
            CHECK(t.ops.empty());
        }
        std::vector<std::uint8_t> longer = bytes;
        longer.push_back(0);
        Program t;
        CHECK(decode(longer.data(), longer.size(), t, where) == CompileError::BadBytes);
    }
    // Bad version, bad opcode, bad ref, bad builtin, zero ops.
    const std::vector<std::uint8_t> good = encode(comp("1").program);
    Program t;
    std::uint32_t where = 0;
    std::vector<std::uint8_t> b = good;
    b[0] = 2;
    CHECK(decode(b.data(), b.size(), t, where) == CompileError::BadBytes);
    b = good;
    b[6] = static_cast<std::uint8_t>(OpCode::COUNT);
    CHECK(decode(b.data(), b.size(), t, where) == CompileError::BadBytes);
    b = good;
    b[2] = 0;
    CHECK(decode(b.data(), b.size(), t, where) == CompileError::BadBytes);
    b = encode(comp("self.mass").program);
    b[7] = 9; // ref kind
    CHECK(decode(b.data(), b.size(), t, where) == CompileError::BadBytes);
    b = encode(comp("sqrt(1)").program);
    b[b.size() - 2] = static_cast<std::uint8_t>(Builtin::COUNT);
    CHECK(decode(b.data(), b.size(), t, where) == CompileError::BadBytes);
    // Well-formed bytes with a shape error reach the verifier.
    b = encode(comp("1 + 2").program);
    b[1] = 2;
    CHECK(decode(b.data(), b.size(), t, where) == CompileError::BadStack);
    CHECK(t.ops.empty());
}

TEST_CASE("wide and deep trees compile without recursion") {
    std::string wide = "1";
    for (int i = 0; i < 2047; ++i) wide += "+1";
    const CompileResult w = comp(wide.c_str());
    REQUIRE(w.ok());
    CHECK(w.program.ops.size() == 2048 + 2047);
    CHECK(w.program.max_stack == 2);

    std::string deep;
    for (int i = 0; i < 63; ++i) deep += "-";
    deep += "1";
    const CompileResult d = comp(deep.c_str());
    REQUIRE(d.ok());
    CHECK(d.program.ops.size() == 64);
    CHECK(d.program.max_stack == 1);

    std::string chain = "self.mass";
    for (int i = 0; i < 100; ++i) chain += ".x";
    // Each .x on a scalar is lane 0 of dim 1, so it stays legal; the
    // parser's depth bound does not count postfix chains, the compiler
    // must not care.
    const CompileResult c = comp(chain.c_str());
    REQUIRE(c.ok());
    CHECK(c.program.ops.size() == 101);
}
