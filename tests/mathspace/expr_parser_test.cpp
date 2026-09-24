// expr_parser_test.cpp — text to Ast: grammar, precedence, exact literals,
// post-order layout, and every error code with its byte offset.
#include <doctest.h>

#include <string>

#include "mathspace/expr/parser.hpp"

using namespace mathspace::expr;

namespace {

std::string sx(const char* src) {
    const ParseResult r = parse(src);
    if (!r.ok()) {
        return std::string("ERR ") + parse_error_name(r.error) + "@" + std::to_string(r.offset);
    }
    return to_sexpr(r.ast);
}

std::string err(const char* src) {
    const ParseResult r = parse(src);
    if (r.ok()) {
        return "OK";
    }
    return std::string(parse_error_name(r.error)) + "@" + std::to_string(r.offset);
}

} // namespace

TEST_CASE("literals are exact Q32.32") {
    std::int64_t raw = 0;
    CHECK(parse_literal("0", raw) == ParseError::Ok);
    CHECK(raw == 0);
    CHECK(parse_literal("1", raw) == ParseError::Ok);
    CHECK(raw == (std::int64_t{1} << 32));
    CHECK(parse_literal("1.5", raw) == ParseError::Ok);
    CHECK(raw == (std::int64_t{3} << 31));
    CHECK(parse_literal("0.25", raw) == ParseError::Ok);
    CHECK(raw == (std::int64_t{1} << 30));
    CHECK(parse_literal("2147483647.5", raw) == ParseError::Ok);
    CHECK(raw == ((std::int64_t{2147483647} << 32) | (std::int64_t{1} << 31)));
    // 2^-32 has exactly 32 decimal digits.
    CHECK(parse_literal("0.00000000023283064365386962890625", raw) == ParseError::Ok);
    CHECK(raw == 1);
    // Trailing zeros are fine, a 33rd digit is not.
    CHECK(parse_literal("1.50", raw) == ParseError::Ok);
    CHECK(raw == (std::int64_t{3} << 31));
    CHECK(parse_literal("0.000000000232830643653869628906250", raw) == ParseError::NumberTooLarge);

    CHECK(parse_literal("0.1", raw) == ParseError::InexactNumber);
    CHECK(parse_literal("0.3", raw) == ParseError::InexactNumber);
    CHECK(parse_literal("0.00000000023283064365386962890624", raw) == ParseError::InexactNumber);
    CHECK(parse_literal("2147483648", raw) == ParseError::NumberTooLarge);
    CHECK(parse_literal("99999999999999999999", raw) == ParseError::NumberTooLarge);
    CHECK(parse_literal("", raw) == ParseError::UnexpectedToken);
    CHECK(parse_literal("1.", raw) == ParseError::UnexpectedToken);
    CHECK(parse_literal(".5", raw) == ParseError::UnexpectedToken);
    CHECK(parse_literal("-1", raw) == ParseError::UnexpectedToken);
}

TEST_CASE("to_decimal is the inverse of parse_literal") {
    const char* texts[] = {"0", "1", "1.5", "0.25", "2147483647.5", "0.00000000023283064365386962890625",
                           "3.14159265346825122833251953125", "1024.0009765625"};
    for (const char* t : texts) {
        std::int64_t raw = 0;
        REQUIRE(parse_literal(t, raw) == ParseError::Ok);
        CHECK(to_decimal(raw) == t);
    }
    CHECK(to_decimal(-(std::int64_t{3} << 31)) == "-1.5");
    CHECK(to_decimal(INT64_MIN) == "-2147483648");
    CHECK(to_decimal(INT64_MAX) == "2147483647.99999999976716935634613037109375");
}

TEST_CASE("precedence and associativity") {
    CHECK(sx("1 + 2 * 3") == "(+ 1 (* 2 3))");
    CHECK(sx("(1 + 2) * 3") == "(* (+ 1 2) 3)");
    CHECK(sx("1 - 2 - 3") == "(- (- 1 2) 3)");
    CHECK(sx("8 / 2 / 2") == "(/ (/ 8 2) 2)");
    CHECK(sx("-1 * 2") == "(* (neg 1) 2)");
    CHECK(sx("--1") == "(neg (neg 1))");
    CHECK(sx("-self.mass.x") == "(neg (. (ref self mass) 0))");
    CHECK(sx("1 < 2 + 3") == "(< 1 (+ 2 3))");
    CHECK(sx("a.x") == "ERR UnknownFunction@0");
    CHECK(sx("1 <= 2") == "(<= 1 2)");
    CHECK(sx("1 >= 2") == "(>= 1 2)");
    CHECK(sx("1 > 2") == "(> 1 2)");
    CHECK(sx("1 == 2") == "(== 1 2)");
    CHECK(sx("1 != 2") == "(!= 1 2)");
    CHECK(sx("1 < 2 < 3") == "ERR UnexpectedToken@6");
    CHECK(sx("(1 < 2) < 3") == "(< (< 1 2) 3)");
}

TEST_CASE("if then else") {
    CHECK(sx("if 1 < 2 then 3 else 4") == "(if (< 1 2) 3 4)");
    // The else branch runs to the end of the input.
    CHECK(sx("if 1 then 2 else 3 + 4") == "(if 1 2 (+ 3 4))");
    CHECK(sx("if 1 then if 2 then 3 else 4 else 5") == "(if 1 (if 2 3 4) 5)");
    CHECK(sx("(if 1 then 2 else 3) + 4") == "(+ (if 1 2 3) 4)");
    CHECK(sx("1 + if 2 then 3 else 4") == "ERR UnexpectedToken@4");
    CHECK(sx("if 1 then 2") == "ERR UnexpectedEnd@11");
    CHECK(sx("if 1 2 else 3") == "ERR UnexpectedToken@5");
    CHECK(sx("then") == "ERR UnexpectedToken@0");
}

TEST_CASE("vectors and components") {
    CHECK(sx("[1, 2]") == "[1 2]");
    CHECK(sx("[1]") == "[1]");
    CHECK(sx("[1,2,3,4,5,6,7,8]") == "[1 2 3 4 5 6 7 8]");
    CHECK(sx("[1,2,3,4,5,6,7,8,9]") == "ERR VectorTooLong@0");
    CHECK(sx("[1, [2, 3]]") == "[1 [2 3]]");
    CHECK(sx("[]") == "ERR UnexpectedToken@1");
    CHECK(sx("[1,") == "ERR UnexpectedEnd@3");
    CHECK(sx("[1 2]") == "ERR UnexpectedToken@3");
    CHECK(sx("self.pos.x") == "(. (ref self pos) 0)");
    CHECK(sx("self.pos.y") == "(. (ref self pos) 1)");
    CHECK(sx("self.pos.z") == "(. (ref self pos) 2)");
    CHECK(sx("self.pos.w") == "(. (ref self pos) 3)");
    CHECK(sx("self.pos.0") == "(. (ref self pos) 0)");
    CHECK(sx("self.pos.7") == "(. (ref self pos) 7)");
    CHECK(sx("self.pos.8") == "ERR BadComponent@9");
    CHECK(sx("self.pos.q") == "ERR BadComponent@9");
    CHECK(sx("self.pos.xy") == "ERR BadComponent@9");
    CHECK(sx("self.pos.") == "ERR UnexpectedEnd@9");
    CHECK(sx("[1, 2].y.x") == "(. (. [1 2] 1) 0)");
    CHECK(sx("[1, 2].x * 2") == "(* (. [1 2] 0) 2)");
}

TEST_CASE("references") {
    CHECK(sx("self.mass") == "(ref self mass)");
    CHECK(sx("other.velocity") == "(ref other velocity)");
    CHECK(sx("node(n12).pos") == "(ref node n12 pos)");
    CHECK(sx("space.dim") == "(ref space dim)");
    CHECK(sx("world.tick") == "(ref world tick)");
    CHECK(sx("self.a_b2") == "(ref self a_b2)");
    CHECK(sx("self") == "ERR UnexpectedEnd@4");
    CHECK(sx("self.") == "ERR UnexpectedEnd@5");
    CHECK(sx("self.1") == "ERR UnexpectedToken@5");
    CHECK(sx("node(12).pos") == "ERR BadNodeId@5");
    CHECK(sx("node(n0).pos") == "ERR BadNodeId@5");
    CHECK(sx("node(n).pos") == "ERR BadNodeId@5");
    CHECK(sx("node(n1x).pos") == "ERR BadNodeId@5");
    CHECK(sx("node(n99999999999999999999).pos") == "ERR BadNodeId@5");
    CHECK(sx("node(n12)") == "ERR UnexpectedEnd@9");
    CHECK(sx("node n12") == "ERR UnexpectedToken@5");
    CHECK(sx("node(n18446744073709551615).f") == "(ref node n18446744073709551615 f)");
    // A field name longer than the store allows.
    CHECK(sx("self.abcdefghijklmnopqrstuvwxyzabcdef") == "ERR BadName@5");
}

TEST_CASE("calls") {
    CHECK(sx("min(1, 2)") == "(min 1 2)");
    CHECK(sx("max(1, 2)") == "(max 1 2)");
    CHECK(sx("abs(-1)") == "(abs (neg 1))");
    CHECK(sx("clamp(1, 0, 2)") == "(clamp 1 0 2)");
    CHECK(sx("sqrt(4)") == "(sqrt 4)");
    CHECK(sx("sin(0)") == "(sin 0)");
    CHECK(sx("cos(0)") == "(cos 0)");
    CHECK(sx("atan2(1, 1)") == "(atan2 1 1)");
    CHECK(sx("exp(1)") == "(exp 1)");
    CHECK(sx("log(1)") == "(log 1)");
    CHECK(sx("pow(2, 3)") == "(pow 2 3)");
    CHECK(sx("dot([1, 0], [0, 1])") == "(dot [1 0] [0 1])");
    CHECK(sx("norm(self.pos - other.pos)") == "(norm (- (ref self pos) (ref other pos)))");
    CHECK(sx("curve(self.knots, world.tick)") == "(curve (ref self knots) (ref world tick))");
    CHECK(sx("min(1)") == "ERR BadArity@0");
    CHECK(sx("min(1, 2, 3)") == "ERR BadArity@0");
    CHECK(sx("abs()") == "ERR UnexpectedToken@4");
    CHECK(sx("tan(1)") == "ERR UnknownFunction@0");
    CHECK(sx("min 1 2") == "ERR UnexpectedToken@4");
    CHECK(sx("min(1, 2") == "ERR UnexpectedEnd@8");
    CHECK(sx("sqrt") == "ERR UnexpectedEnd@4");
}

TEST_CASE("whitespace, trailing input, bad characters") {
    CHECK(sx(" \t\n1\r\n+ 2 ") == "(+ 1 2)");
    CHECK(sx("1 2") == "ERR TrailingInput@2");
    CHECK(sx("1)") == "ERR TrailingInput@1");
    CHECK(sx("") == "ERR UnexpectedEnd@0");
    CHECK(sx("   ") == "ERR UnexpectedEnd@3");
    CHECK(sx("1 + ") == "ERR UnexpectedEnd@4");
    CHECK(sx("1 ^ 2") == "ERR UnexpectedChar@2");
    CHECK(sx("1 = 2") == "ERR UnexpectedChar@2");
    CHECK(sx("!1") == "ERR UnexpectedChar@0");
    CHECK(sx("1 + 0.1") == "ERR InexactNumber@4");
    CHECK(sx("(1") == "ERR UnexpectedEnd@2");
    CHECK(sx("1 +* 2") == "ERR UnexpectedToken@3");
    CHECK(sx("1.x") == "(. 1 0)"); // shape only; the checker rejects it later
}

TEST_CASE("bounds: depth and node count") {
    std::string deep;
    for (int i = 0; i < 64; ++i) deep += "(";
    deep += "1";
    for (int i = 0; i < 64; ++i) deep += ")";
    // 64 parens plus the outer expr is 65 levels.
    CHECK(err(deep.c_str()) == "TooDeep@64");
    std::string ok_deep;
    for (int i = 0; i < 63; ++i) ok_deep += "(";
    ok_deep += "1";
    for (int i = 0; i < 63; ++i) ok_deep += ")";
    CHECK(err(ok_deep.c_str()) == "OK");

    std::string negs(64, '-');
    negs += "1";
    CHECK(err(negs.c_str()) == "TooDeep@63");

    // 2048 additions of a literal = 4097 nodes: one too many. Left
    // associative, so the depth stays flat.
    std::string wide = "1";
    for (int i = 0; i < 2048; ++i) wide += "+1";
    CHECK(err(wide.c_str()) == "TooManyNodes@4097");
    std::string wide_ok = "1";
    for (int i = 0; i < 2047; ++i) wide_ok += "+1";
    CHECK(err(wide_ok.c_str()) == "OK");
    CHECK(parse(wide_ok).ast.nodes.size() == MAX_NODES - 1);
}

TEST_CASE("the ast is post-order with children in contiguous runs") {
    const ParseResult r = parse("min(self.a, 2) * [3, 4].y");
    REQUIRE(r.ok());
    const Ast& a = r.ast;
    REQUIRE(a.nodes.size() == 8);
    CHECK(a.nodes[0].kind == Kind::Ref);
    CHECK(a.nodes[0].name == "a");
    CHECK(a.nodes[1].kind == Kind::Number);
    CHECK(a.nodes[2].kind == Kind::Call);
    CHECK(a.nodes[2].fn == Builtin::Min);
    CHECK(a.child(a.nodes[2], 0) == 0);
    CHECK(a.child(a.nodes[2], 1) == 1);
    CHECK(a.nodes[3].kind == Kind::Number);
    CHECK(a.nodes[4].kind == Kind::Number);
    CHECK(a.nodes[5].kind == Kind::Vector);
    CHECK(a.nodes[5].count == 2);
    CHECK(a.nodes[6].kind == Kind::Component);
    CHECK(a.nodes[6].lane == 1);
    CHECK(a.root() == 7);
    // Root is the multiply, which comes last.
    CHECK(a.nodes.back().kind == Kind::Mul);
    for (std::size_t i = 0; i < a.nodes.size(); ++i) {
        const Node& n = a.nodes[i];
        for (std::uint32_t k = 0; k < n.count; ++k) {
            CHECK(a.child(n, k) < i);
        }
    }
    CHECK(r.offset == 25);
    // Failure leaves no partial tree.
    const ParseResult bad = parse("min(self.a, 2) * [3, 4].y +");
    CHECK(bad.ast.nodes.empty());
    CHECK(bad.ast.args.empty());
}

TEST_CASE("builtin tables agree with the enum") {
    for (std::size_t i = 0; i < static_cast<std::size_t>(Builtin::COUNT); ++i) {
        const Builtin b = static_cast<Builtin>(i);
        CHECK(builtin_from_name(builtin_name(b)) == b);
        CHECK(builtin_arity(b) >= 1);
        CHECK(builtin_arity(b) <= 3);
    }
    CHECK(builtin_from_name("nope") == Builtin::COUNT);
    CHECK(builtin_from_name("") == Builtin::COUNT);
}
