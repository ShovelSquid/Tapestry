// expr_diff_test.cpp — symbolic derivatives checked two ways: the shape
// of small results as s-expressions, and every rule against a central
// finite difference of the original expression in the VM.
#include <doctest.h>

#include <string>

#include "mathspace/expr/diff.hpp"
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
constexpr std::int64_t HALF = I(1) / 2;

// Space n1 (dim 2), note n2 with pos [1.5, -0.5], velocity [1, 0.5],
// mass 2, t 0.25; note n3 with pos [0, 1] and k 3.
struct Fixture {
    World w{1};
    Fixture() {
        REQUIRE(w.create_space(NoteId{1}, 2) == Error::Ok);
        REQUIRE(w.create_note(NoteId{2}, SpaceId{1}, NoteKind::Note) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("pos", {I(1) + HALF, -HALF})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("velocity", {I(1), HALF})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("mass", {I(2)})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{2}, mk("t", {HALF / 2})) == Error::Ok);
        REQUIRE(w.create_note(NoteId{3}, SpaceId{1}, NoteKind::Note) == Error::Ok);
        REQUIRE(w.set_field(NoteId{3}, mk("pos", {0, I(1)})) == Error::Ok);
        REQUIRE(w.set_field(NoteId{3}, mk("k", {I(3)})) == Error::Ok);
        w.tick = 5;
    }
    const Note& self() const { return *w.find(NoteId{2}); }
    WorldDims dims() const { return WorldDims{w, self()}; }

    DiffResult diff(const char* src, const char* field, std::uint8_t lane) const {
        const ParseResult p = parse(src);
        REQUIRE_MESSAGE(p.ok(), std::string(src) << ": " << parse_error_name(p.error));
        return differentiate(p.ast, field, lane, dims());
    }

    std::string dsexpr(const char* src, const char* field, std::uint8_t lane) const {
        const DiffResult r = diff(src, field, lane);
        REQUIRE_MESSAGE(r.ok(), std::string(src) << ": " << diff_error_name(r.error));
        return to_sexpr(r.ast);
    }

    // Evaluate `ast` on a copy of the world with self.field.lane shifted by `delta` raw.
    Lanes eval_at(const Ast& ast, const char* field, std::uint8_t lane, std::int64_t delta) const {
        World w2 = w;
        Note* n = w2.find(NoteId{2});
        Field* fld = find_field(*n, field);
        REQUIRE(fld != nullptr);
        fld->value[lane] = fx64::from_raw(fld->value[lane].raw + delta);
        const CompileResult c = compile(ast, WorldDims{w2, *n});
        REQUIRE_MESSAGE(c.ok(), to_sexpr(ast) << ": " << compile_error_name(c.error));
        Lanes out{};
        const VmError e = eval(c.program, w2, *n, nullptr, out);
        REQUIRE_MESSAGE(e == VmError::Ok, to_sexpr(ast) << ": " << vm_error_name(e));
        return out;
    }
};

// h = 2^-10; (f(x + h) - f(x - h)) / 2h is raw difference times 2^9.
constexpr std::int64_t H = std::int64_t{1} << 22;
constexpr std::int64_t TOL = std::int64_t{1} << 19; // ~1.2e-4

void check_fd(const Fixture& fx, const char* src, const char* field, std::uint8_t lane) {
    const ParseResult p = parse(src);
    REQUIRE_MESSAGE(p.ok(), std::string(src));
    const DiffResult r = differentiate(p.ast, field, lane, fx.dims());
    REQUIRE_MESSAGE(r.ok(), std::string(src) << " d/d" << field << "." << int(lane) << ": " << diff_error_name(r.error));
    REQUIRE(r.ast.nodes.size() <= MAX_NODES);
    const CompileResult cf = compile(p.ast, fx.dims());
    const CompileResult cd = compile(r.ast, fx.dims());
    REQUIRE_MESSAGE(cd.ok(), to_sexpr(r.ast) << ": " << compile_error_name(cd.error));
    CHECK_MESSAGE(cd.program.dim == cf.program.dim, std::string(src) << ": derivative dim " << int(cd.program.dim) << " vs " << int(cf.program.dim));
    const Lanes plus = fx.eval_at(p.ast, field, lane, H);
    const Lanes minus = fx.eval_at(p.ast, field, lane, -H);
    const Lanes d = fx.eval_at(r.ast, field, lane, 0);
    for (std::uint8_t i = 0; i < cf.program.dim; ++i) {
        const std::int64_t fd = (plus[i].raw - minus[i].raw) * (std::int64_t{1} << 9);
        const std::int64_t err = fd > d[i].raw ? fd - d[i].raw : d[i].raw - fd;
        CHECK_MESSAGE(err <= TOL, std::string(src) << " d/d" << field << "." << int(lane) << " lane " << int(i) << ": fd "
                                      << to_decimal(fd) << " vs " << to_decimal(d[i].raw) << "  [" << to_sexpr(r.ast) << "]");
    }
}

} // namespace

TEST_CASE("derivative shapes as s-expressions") {
    Fixture fx;
    CHECK(fx.dsexpr("1", "mass", 0) == "0");
    CHECK(fx.dsexpr("self.mass", "mass", 0) == "1");
    CHECK(fx.dsexpr("self.pos", "pos", 0) == "[1 0]");
    CHECK(fx.dsexpr("self.pos", "pos", 1) == "[0 1]");
    CHECK(fx.dsexpr("self.pos", "mass", 0) == "[0 0]");
    CHECK(fx.dsexpr("self.velocity + self.pos", "pos", 1) == "[0 1]");
    CHECK(fx.dsexpr("self.pos - self.velocity", "velocity", 0) == "(neg [1 0])");
    CHECK(fx.dsexpr("node(n3).k * self.mass", "mass", 0) == "(* (ref node n3 k) 1)");
    CHECK(fx.dsexpr("self.mass * self.mass", "mass", 0) == "(+ (* 1 (ref self mass)) (* (ref self mass) 1))");
    CHECK(fx.dsexpr("self.mass / 2", "mass", 0) == "(/ 1 2)");
    CHECK(fx.dsexpr("2 / self.mass", "mass", 0) == "(/ (neg (* 2 1)) (* (ref self mass) (ref self mass)))");
    CHECK(fx.dsexpr("self.pos.x", "pos", 0) == "(. [1 0] 0)");
    CHECK(fx.dsexpr("[self.mass, 1]", "mass", 0) == "[1 0]");
    CHECK(fx.dsexpr("if self.mass < 1 then self.mass else 3", "mass", 0) == "(if (< (ref self mass) 1) 1 0)");
    CHECK(fx.dsexpr("self.mass < 1", "mass", 0) == "0");
    CHECK(fx.dsexpr("sin(self.mass)", "mass", 0) == "(* (cos (ref self mass)) 1)");
    CHECK(fx.dsexpr("norm(self.pos)", "pos", 0) == "(/ (dot (ref self pos) [1 0]) (norm (ref self pos)))");
    CHECK(fx.dsexpr("world.tick + space.dim", "mass", 0) == "0");
    CHECK(fx.dsexpr("curve([1, 2], self.t) * 0 + self.mass", "mass", 0) == "1"); // curve of a constant is fine
}

TEST_CASE("every rule agrees with a finite difference") {
    Fixture fx;
    const char* scalar[] = {
        "self.mass", "-self.mass", "self.mass + 1", "3 - self.mass", "self.mass * self.mass",
        "self.mass * node(n3).k", "self.mass / 3", "3 / self.mass", "self.mass / (self.mass + 1)",
        "self.mass * self.mass * self.mass - 2 * self.mass", "(self.mass + 1) * (self.mass - 1)",
        "sqrt(self.mass)", "sqrt(self.mass * 3 + 1)", "sin(self.mass)", "cos(self.mass)",
        "sin(self.mass * self.mass)", "exp(self.mass / 4)", "log(self.mass)", "log(self.mass * self.mass + 1)",
        "pow(self.mass, 3)", "pow(self.mass, node(n3).k)", "pow(2, self.mass)", "pow(self.mass, self.mass)",
        "pow(self.mass + 1, self.mass / 2)", "atan2(self.mass, 3)", "atan2(1, self.mass)",
        "atan2(self.mass, self.mass * self.mass)", "abs(self.mass - 3)", "abs(self.mass - 1)",
        "min(self.mass, 3)", "min(3, self.mass)", "max(self.mass, 3)", "max(3, self.mass)",
        "min(self.mass * 2, self.mass * self.mass - 1)", "clamp(self.mass, 0, 1)", "clamp(self.mass, 0, 3)",
        "clamp(self.mass, self.mass + 1, 5)", "clamp(1, 0, self.mass)",
        "if self.mass < 1 then self.mass * 2 else self.mass * self.mass",
        "if self.mass > 1 then sin(self.mass) else 0",
        "self.pos.x * self.mass", "dot(self.pos, self.velocity) * self.mass",
    };
    for (const char* src : scalar) check_fd(fx, src, "mass", 0);

    const char* vector[] = {
        "self.pos", "-self.pos", "self.pos + self.velocity", "self.pos - node(n3).pos", "self.pos * 2",
        "2 * self.pos", "self.pos * self.mass", "self.pos / 4", "self.pos / self.mass",
        "self.pos * self.pos.x", "[self.pos.y, self.pos.x]", "[self.pos.x * self.pos.y, 1]",
        "self.pos.x", "self.pos.y", "dot(self.pos, self.pos)", "dot(self.pos, self.velocity)",
        "norm(self.pos)", "norm(self.pos - node(n3).pos)",
        "(self.pos - node(n3).pos) / norm(self.pos - node(n3).pos)",
        "sqrt(dot(self.pos, self.pos))", "atan2(self.pos.y, self.pos.x)",
        "if self.pos.x < 1 then self.pos else self.velocity",
        "self.pos.x * self.pos.x + self.pos.y * self.pos.y",
        "exp(-dot(self.pos, self.pos) / 4)",
    };
    for (const char* src : vector) {
        check_fd(fx, src, "pos", 0);
        check_fd(fx, src, "pos", 1);
        check_fd(fx, src, "mass", 0); // constant in mass: the shaped zero must still compile and agree
    }
}

TEST_CASE("a long left-nested chain differentiates without a depth limit") {
    Fixture fx;
    // 600 terms nest 600 deep after the parser's loops; the derivative of a
    // sum chain is a chain of the same length.
    std::string chain = "self.mass";
    for (int i = 0; i < 600; ++i) chain += " + self.mass";
    const ParseResult p = parse(chain);
    REQUIRE(p.ok());
    const DiffResult r = differentiate(p.ast, "mass", 0, fx.dims());
    REQUIRE_MESSAGE(r.ok(), diff_error_name(r.error));
    const Lanes v = fx.eval_at(r.ast, "mass", 0, 0);
    CHECK(v[0].raw == I(601));
}

TEST_CASE("the derivative of a derivative works (the output is a well-formed tree)") {
    Fixture fx;
    const ParseResult p = parse("self.mass * self.mass * self.mass");
    REQUIRE(p.ok());
    const DiffResult d1 = differentiate(p.ast, "mass", 0, fx.dims());
    REQUIRE(d1.ok());
    const DiffResult d2 = differentiate(d1.ast, "mass", 0, fx.dims());
    REQUIRE(d2.ok());
    const Lanes v = fx.eval_at(d2.ast, "mass", 0, 0);
    CHECK(v[0].raw == I(12)); // 6 * mass at mass 2
}

TEST_CASE("errors") {
    Fixture fx;
    Ast empty;
    CHECK(differentiate(empty, "mass", 0, fx.dims()).error == DiffError::EmptyAst);
    CHECK(fx.diff("1", "nope", 0).error == DiffError::UnknownRef);
    CHECK(fx.diff("1", "pos", 2).error == DiffError::BadLane);
    CHECK(fx.diff("1", "mass", 1).error == DiffError::BadLane);
    {
        const DiffResult r = fx.diff("self.nope + self.mass", "mass", 0);
        CHECK(r.error == DiffError::UnknownRef);
        CHECK(r.where == 0);
    }
    {
        const DiffResult r = fx.diff("other.mass * self.mass", "mass", 0);
        CHECK(r.error == DiffError::UnknownRef); // no other note: the resolver gives 0
    }
    {
        const DiffResult r = fx.diff("curve([1, 2, 3], self.mass)", "mass", 0);
        CHECK(r.error == DiffError::Unsupported);
        CHECK(r.where == 5);
    }
    CHECK(fx.diff("curve([self.mass, 2], self.t)", "mass", 0).error == DiffError::Unsupported);
    // The product rule copies both sides; a long enough chain of products
    // overflows MAX_NODES while f itself is well under it.
    std::string chain = "self.mass";
    for (int i = 0; i < 150; ++i) chain += " * (self.mass + 1)";
    const ParseResult p = parse(chain);
    REQUIRE(p.ok());
    REQUIRE(p.ast.nodes.size() < MAX_NODES / 4);
    CHECK(differentiate(p.ast, "mass", 0, fx.dims()).error == DiffError::TooManyNodes);
}
