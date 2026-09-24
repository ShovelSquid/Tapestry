// expr_vm_test.cpp — text through parser, compiler and VM against a
// small World; every op, every reference kind, every error.
#include <doctest.h>

#include <string>

#include "mathspace/fxmath.hpp"
#include "mathspace/expr/parser.hpp"
#include "mathspace/expr/vm.hpp"

using namespace mathspace;
using namespace mathspace::expr;

namespace {

Field mk(const char* name, std::initializer_list<std::int64_t> raws) {
    Field f;
    f.name = name;
    f.dim = static_cast<std::uint8_t>(raws.size());
    std::size_t i = 0;
    for (const std::int64_t r : raws) f.value[i++] = fx64::from_raw(r);
    return f;
}

constexpr std::int64_t I(std::int64_t v) { return v << 32; }

// Space n1 (dim 2, with a `g` field), note n2 in it with pos [3, 4],
// velocity [1, 0], mass 2; note n3 with q [1, 2, 3] (dim 3, so a
// dim-mismatched field for a 2-space is fine: q is not pos). Space n9 is
// empty. World tick 5.
struct Fixture {
    World w{1};
    Fixture() {
        REQUIRE(w.create_space(NoteId{1}, 2) == Error::Ok);
        REQUIRE(w.set_field(NoteId{1}, mk("g", {I(-10)})) == Error::Ok);
        REQUIRE(w.create_note(NoteId{2}, SpaceId{1}, NoteKind::Note) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("pos", {I(3), I(4)})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("velocity", {I(1), 0})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("mass", {I(2)})) == Error::Ok);
        REQUIRE(w.create_note(NoteId{3}, SpaceId{1}, NoteKind::Note) == Error::Ok);
        REQUIRE(w.set_field(NoteId{3}, mk("q", {I(1), I(2), I(3)})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{3}, mk("pos", {I(0), I(0)})) == Error::Ok);
        w.tick = 5;
    }
    const Note& self() const { return *w.find(NoteId{2}); }
    const Note& n3() const { return *w.find(NoteId{3}); }
    const Note& space() const { return *w.find(NoteId{1}); }

    // "ERR <stage> <name>" or the decimal lanes joined by spaces.
    std::string run(const char* src, const Note* other = nullptr, const Note* as = nullptr) const {
        const Note& s = as ? *as : self();
        const ParseResult p = parse(src);
        if (!p.ok()) return std::string("ERR parse ") + parse_error_name(p.error);
        const CompileResult c = compile(p.ast, WorldDims{w, s, other});
        if (!c.ok()) return std::string("ERR compile ") + compile_error_name(c.error);
        Lanes out{};
        const VmError e = eval(c.program, w, s, other, out);
        if (e != VmError::Ok) {
            for (const fx64 v : out) CHECK(v.raw == 0);
            return std::string("ERR vm ") + vm_error_name(e);
        }
        std::string r;
        for (std::uint8_t i = 0; i < c.program.dim; ++i) {
            if (i) r += " ";
            r += to_decimal(out[i].raw);
        }
        for (std::uint8_t i = c.program.dim; i < MAX_DIM; ++i) CHECK(out[i].raw == 0);
        return r;
    }
};

} // namespace

TEST_CASE("arithmetic on scalars and vectors") {
    Fixture f;
    CHECK(f.run("1 + 2") == "3");
    CHECK(f.run("1.5 - 2") == "-0.5");
    CHECK(f.run("3 * 0.5") == "1.5");
    CHECK(f.run("1 / 4") == "0.25");
    CHECK(f.run("1 / 0") == "0");
    CHECK(f.run("-2") == "-2");
    CHECK(f.run("--2") == "2");
    CHECK(f.run("[1, 2] + [3, 4]") == "4 6");
    CHECK(f.run("[1, 2] - [3, 4]") == "-2 -2");
    CHECK(f.run("-[1, 2]") == "-1 -2");
    CHECK(f.run("2 * [1, 2]") == "2 4");
    CHECK(f.run("[1, 2] * 2") == "2 4");
    CHECK(f.run("[1, 2] / 2") == "0.5 1");
    CHECK(f.run("[1, 2, 3, 4, 5, 6, 7, 8] * 2") == "2 4 6 8 10 12 14 16");
    CHECK(f.run("[1, 2].x") == "1");
    CHECK(f.run("[1, 2].y") == "2");
    CHECK(f.run("([1, 2] + [3, 4]).y * 10") == "60");
    CHECK(f.run("1 + 2 * 3 - 4 / 2") == "5");
    // Floor rounding of fx64 shows through.
    CHECK(f.run("1 / 3 * 3") == "0.99999999976716935634613037109375");
}

TEST_CASE("comparisons and if") {
    Fixture f;
    CHECK(f.run("1 < 2") == "1");
    CHECK(f.run("2 < 2") == "0");
    CHECK(f.run("2 <= 2") == "1");
    CHECK(f.run("3 > 2") == "1");
    CHECK(f.run("2 >= 3") == "0");
    CHECK(f.run("2 == 2") == "1");
    CHECK(f.run("2 != 2") == "0");
    CHECK(f.run("if 1 < 2 then 10 else 20") == "10");
    CHECK(f.run("if 1 > 2 then 10 else 20") == "20");
    CHECK(f.run("if 0.5 then 10 else 20") == "10"); // any non-zero is true
    CHECK(f.run("if 0 then [1, 2] else [3, 4]") == "3 4");
    CHECK(f.run("if 1 then if 0 then 1 else 2 else 3") == "2");
    CHECK(f.run("1 + (if 1 then 2 else 3) * 10") == "21");
    // Only the taken branch runs: log(-1) would assert in Debug.
    CHECK(f.run("if 1 then 2 else log(-1)") == "2");
    CHECK(f.run("if 0 then log(-1) else 2") == "2");
    CHECK(f.run("if 1 then 2 else [1, 2] / 0 * 1 / 0") == "ERR compile DimMismatch");
}

TEST_CASE("builtins") {
    Fixture f;
    CHECK(f.run("min(1, 2)") == "1");
    CHECK(f.run("max(1, 2)") == "2");
    CHECK(f.run("abs(-1.5)") == "1.5");
    CHECK(f.run("clamp(5, 0, 1)") == "1");
    CHECK(f.run("clamp(-5, 0, 1)") == "0");
    CHECK(f.run("clamp(0.5, 0, 1)") == "0.5");
    CHECK(f.run("sqrt(16)") == "4");
    CHECK(f.run("sqrt(-1)") == "0");
    CHECK(f.run("log(0)") == "0");
    CHECK(f.run("log(-1)") == "0");
    CHECK(f.run("pow(0, 2)") == "0");
    CHECK(f.run("pow(-2, 2)") == "0");
    CHECK(f.run("[1, 2] / 0") == "0 0");
    CHECK(f.run("sin(0)") == "0");
    CHECK(f.run("cos(0)") == "1");
    CHECK(f.run("atan2(0, 1)") == "0");
    CHECK(f.run("exp(0)") == "1");
    CHECK(f.run("log(1)") == "0");
    CHECK(f.run("pow(2, 10)") == to_decimal(ddsim::fxmath::pow(fx64::from_int(2), fx64::from_int(10)).raw));
    CHECK(f.run("sin(1.5)") == to_decimal(ddsim::fxmath::sin(fx64::from_raw(I(3) >> 1)).raw));
    CHECK(f.run("dot([1, 2], [3, 4])") == "11");
    CHECK(f.run("dot([1, 2, 3], [1, 1, 1])") == "6");
    CHECK(f.run("norm([3, 4])") == "5");
    CHECK(f.run("norm(2)") == "2");
    CHECK(f.run("norm(-2)") == "2");
    // curve: knots at t = 0, 0.5, 1.
    CHECK(f.run("curve([0, 10, 0], 0)") == "0");
    CHECK(f.run("curve([0, 10, 0], 0.5)") == "10");
    CHECK(f.run("curve([0, 10, 0], 1)") == "0");
    CHECK(f.run("curve([0, 10, 0], 0.25)") == "5");
    CHECK(f.run("curve([0, 10, 0], 0.75)") == "5");
    CHECK(f.run("curve([0, 10, 0], -3)") == "0");
    CHECK(f.run("curve([0, 10, 0], 7)") == "0");
    CHECK(f.run("curve([0, 10], 0.125)") == "1.25");
    CHECK(f.run("curve(4, 0.5)") == "4");
    CHECK(f.run("curve([1, 2, 3, 4, 5, 6, 7, 8], 1)") == "8");
    CHECK(f.run("curve([1, 2, 3, 4, 5, 6, 7, 8], 0.5)") == "4.5");
}

TEST_CASE("references") {
    Fixture f;
    CHECK(f.run("self.pos") == "3 4");
    CHECK(f.run("self.pos.y") == "4");
    CHECK(f.run("self.mass * 2") == "4");
    CHECK(f.run("self.pos + self.velocity") == "4 4");
    CHECK(f.run("node(n3).q") == "1 2 3");
    CHECK(f.run("node(n3).q.2 + node(n2).mass") == "5");
    CHECK(f.run("space.dim") == "2");
    CHECK(f.run("space.g") == "-10");
    CHECK(f.run("world.tick") == "5");
    CHECK(f.run("world.tick * self.mass") == "10");
    CHECK(f.run("other.q", &f.n3()) == "1 2 3");
    CHECK(f.run("norm(self.pos - other.pos)", &f.n3()) == "5");
    CHECK(f.run("other.q") == "ERR compile UnknownRef");
    CHECK(f.run("self.nope") == "ERR compile UnknownRef");
    CHECK(f.run("node(n4).q") == "ERR compile UnknownRef");
    CHECK(f.run("space.nope") == "ERR compile UnknownRef");
    CHECK(f.run("world.seed") == "ERR compile UnknownRef");
    // Evaluated as the Space note itself: no space above it.
    CHECK(f.run("space.dim", nullptr, &f.space()) == "ERR compile UnknownRef");
    CHECK(f.run("self.g", nullptr, &f.space()) == "-10");
}

TEST_CASE("run-time reference failures") {
    Fixture f;
    // Compile against the world as it is, then change it under the program.
    const ParseResult p = parse("self.pos + node(n3).pos + other.pos");
    REQUIRE(p.ok());
    const CompileResult c = compile(p.ast, WorldDims{f.w, f.self(), &f.n3()});
    REQUIRE(c.ok());
    Lanes out{};
    CHECK(eval(c.program, f.w, f.self(), &f.n3(), out) == VmError::Ok);
    CHECK(out[0].raw == I(3));
    CHECK(eval(c.program, f.w, f.self(), nullptr, out) == VmError::NoOther);
    CHECK(out[0].raw == 0);

    World w2 = f.w;
    REQUIRE(w2.delete_note(NoteId{3}) == Error::Ok);
    const Note& s2 = *w2.find(NoteId{2});
    CHECK(eval(c.program, w2, s2, &s2, out) == VmError::NoSuchNote);

    World w3 = f.w;
    REQUIRE(w3.delete_field(NoteId{2}, "pos") == Error::Ok);
    CHECK(eval(c.program, w3, *w3.find(NoteId{2}), w3.find(NoteId{3}), out) == VmError::NoSuchField);

    World w4 = f.w;
    REQUIRE(w4.set_field(NoteId{3}, mk("pos", {I(1)})) == Error::PosDimMismatch);
    REQUIRE(w4.set_field(NoteId{3}, mk("q", {I(1)})) == Error::Ok);
    const ParseResult pq = parse("node(n3).q");
    const CompileResult cq = compile(pq.ast, WorldDims{f.w, f.self()});
    REQUIRE(cq.ok());
    CHECK(eval(cq.program, w4, *w4.find(NoteId{2}), nullptr, out) == VmError::DimChanged);

    // Space refs on a Space note, and world.tick under a bogus name.
    Program sp = compile(parse("space.dim").ast, WorldDims{f.w, f.self()}).program;
    CHECK(eval(sp, f.w, f.space(), nullptr, out) == VmError::NoSpace);
    sp.ops[0].name = "seed";
    sp.ops[0].ref = RefKind::World;
    CHECK(eval(sp, f.w, f.self(), nullptr, out) == VmError::UnknownRef);
}

TEST_CASE("malformed programs fail instead of reading outside the stack") {
    Fixture f;
    Lanes out{};
    Program p;
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::BadProgram);
    Op add;
    add.code = OpCode::Add;
    p.ops = {add};
    p.dim = 1;
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::BadProgram); // underflow
    Op push;
    push.code = OpCode::PushNum;
    push.value = I(7);
    p.ops = {push, push};
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::BadProgram); // two values left
    p.ops = {push};
    p.dim = 2;
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::BadProgram); // dim disagrees
    p.dim = 1;
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::Ok);
    CHECK(out[0].raw == I(7));
    Op jump;
    jump.code = OpCode::Jump;
    jump.value = 0;
    p.ops = {push, jump};
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::BadProgram); // backward jump
    // Overflow: 1025 pushes.
    p.ops.assign(MAX_STACK_LANES + 1, push);
    CHECK(eval(p, f.w, f.self(), nullptr, out) == VmError::BadProgram);
}

TEST_CASE("bytes round trip through the VM") {
    Fixture f;
    const CompileResult c = compile(parse("norm(self.pos) + world.tick").ast, WorldDims{f.w, f.self()});
    REQUIRE(c.ok());
    const std::vector<std::uint8_t> bytes = encode(c.program);
    Program back;
    std::uint32_t where = 0;
    REQUIRE(decode(bytes.data(), bytes.size(), back, where) == CompileError::Ok);
    Lanes out{};
    CHECK(eval(back, f.w, f.self(), nullptr, out) == VmError::Ok);
    CHECK(out[0].raw == I(10));
}
