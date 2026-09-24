// expr/parser.cpp — recursive descent over a small hand lexer.
//
// Every parse function returns the index of the node it produced; when
// `err` is set the index is meaningless and every caller returns at once
// (`failed()` checks). Nodes are appended after their children, so the
// Ast comes out in post-order without a separate pass.
#include "mathspace/expr/parser.hpp"

namespace mathspace::expr {

const char* parse_error_name(ParseError e) {
    switch (e) {
    case ParseError::Ok: return "Ok";
    case ParseError::UnexpectedChar: return "UnexpectedChar";
    case ParseError::UnexpectedEnd: return "UnexpectedEnd";
    case ParseError::UnexpectedToken: return "UnexpectedToken";
    case ParseError::TrailingInput: return "TrailingInput";
    case ParseError::InexactNumber: return "InexactNumber";
    case ParseError::NumberTooLarge: return "NumberTooLarge";
    case ParseError::UnknownFunction: return "UnknownFunction";
    case ParseError::BadArity: return "BadArity";
    case ParseError::BadComponent: return "BadComponent";
    case ParseError::BadNodeId: return "BadNodeId";
    case ParseError::BadName: return "BadName";
    case ParseError::VectorTooLong: return "VectorTooLong";
    case ParseError::TooDeep: return "TooDeep";
    case ParseError::TooManyNodes: return "TooManyNodes";
    }
    return "?";
}

namespace {

constexpr bool is_digit(char c) { return c >= '0' && c <= '9'; }
constexpr bool is_alpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
constexpr bool is_alnum(char c) { return is_alpha(c) || is_digit(c); }
constexpr bool is_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

constexpr std::uint64_t INT_LIMIT = std::uint64_t{1} << 31; // integer part must be below this
constexpr std::size_t MAX_FRACTION_DIGITS = 32;

} // namespace

// Integer part: decimal accumulate with an overflow guard. Fraction: the
// digit string is doubled 32 times; each doubling's carry out of the top
// digit is the next binary digit of the fraction, most significant first.
// Whatever is left after 32 doublings is the remainder; non-zero means the
// decimal is not k / 2^32.
ParseError parse_literal(std::string_view text, std::int64_t& raw) {
    raw = 0;
    std::size_t i = 0;
    if (i >= text.size() || !is_digit(text[i])) {
        return ParseError::UnexpectedToken;
    }
    std::uint64_t whole = 0;
    for (; i < text.size() && is_digit(text[i]); ++i) {
        whole = whole * 10 + static_cast<std::uint64_t>(text[i] - '0');
        if (whole >= INT_LIMIT) {
            return ParseError::NumberTooLarge;
        }
    }
    std::uint64_t frac = 0;
    if (i < text.size() && text[i] == '.') {
        ++i;
        if (i >= text.size() || !is_digit(text[i])) {
            return ParseError::UnexpectedToken;
        }
        std::uint8_t digits[MAX_FRACTION_DIGITS];
        std::size_t n = 0;
        for (; i < text.size() && is_digit(text[i]); ++i) {
            if (n >= MAX_FRACTION_DIGITS) {
                return ParseError::NumberTooLarge;
            }
            digits[n++] = static_cast<std::uint8_t>(text[i] - '0');
        }
        for (unsigned bit = 0; bit < 32; ++bit) {
            unsigned carry = 0;
            for (std::size_t k = n; k-- > 0;) {
                const unsigned d = digits[k] * 2u + carry;
                digits[k] = static_cast<std::uint8_t>(d % 10);
                carry = d / 10;
            }
            frac = (frac << 1) | carry;
        }
        for (std::size_t k = 0; k < n; ++k) {
            if (digits[k] != 0) {
                return ParseError::InexactNumber;
            }
        }
    }
    if (i != text.size()) {
        return ParseError::UnexpectedToken;
    }
    raw = static_cast<std::int64_t>((whole << 32) | frac);
    return ParseError::Ok;
}

namespace {

enum class Tok : std::uint8_t { End, Number, Ident, Punct };

struct Token {
    Tok type = Tok::End;
    std::string_view text;
    std::uint32_t offset = 0;
};

struct Parser {
    std::string_view src;
    std::uint32_t pos = 0;
    Token tok;
    Ast ast;
    ParseError err = ParseError::Ok;
    std::uint32_t err_off = 0;
    std::uint32_t depth = 0;

    bool failed() const { return err != ParseError::Ok; }

    void fail(ParseError e, std::uint32_t at) {
        if (!failed()) {
            err = e;
            err_off = at;
        }
    }

    // ---- lexer -------------------------------------------------------

    void next() {
        while (pos < src.size() && is_space(src[pos])) {
            ++pos;
        }
        tok.offset = pos;
        if (pos >= src.size()) {
            tok.type = Tok::End;
            tok.text = {};
            return;
        }
        const char c = src[pos];
        const std::uint32_t start = pos;
        if (is_digit(c)) {
            while (pos < src.size() && is_digit(src[pos])) ++pos;
            if (pos + 1 < src.size() && src[pos] == '.' && is_digit(src[pos + 1])) {
                ++pos;
                while (pos < src.size() && is_digit(src[pos])) ++pos;
            }
            tok.type = Tok::Number;
        } else if (is_alpha(c)) {
            while (pos < src.size() && is_alnum(src[pos])) ++pos;
            tok.type = Tok::Ident;
        } else {
            switch (c) {
            case '+': case '-': case '*': case '/':
            case '(': case ')': case '[': case ']': case ',': case '.':
                ++pos;
                break;
            case '<': case '>': case '=': case '!':
                ++pos;
                if (pos < src.size() && src[pos] == '=') {
                    ++pos;
                } else if (c == '=' || c == '!') {
                    fail(ParseError::UnexpectedChar, start);
                }
                break;
            default:
                fail(ParseError::UnexpectedChar, start);
                ++pos;
                break;
            }
            tok.type = Tok::Punct;
        }
        tok.text = src.substr(start, pos - start);
    }

    bool at_punct(std::string_view p) const { return tok.type == Tok::Punct && tok.text == p; }
    bool at_ident(std::string_view w) const { return tok.type == Tok::Ident && tok.text == w; }

    void expect_punct(std::string_view p) {
        if (failed()) return;
        if (!at_punct(p)) {
            fail(tok.type == Tok::End ? ParseError::UnexpectedEnd : ParseError::UnexpectedToken, tok.offset);
            return;
        }
        next();
    }

    void expect_ident(std::string_view w) {
        if (failed()) return;
        if (!at_ident(w)) {
            fail(tok.type == Tok::End ? ParseError::UnexpectedEnd : ParseError::UnexpectedToken, tok.offset);
            return;
        }
        next();
    }

    // ---- tree building ----------------------------------------------

    std::uint32_t emit(Node n) {
        if (ast.nodes.size() >= MAX_NODES) {
            fail(ParseError::TooManyNodes, tok.offset);
            return 0;
        }
        ast.nodes.push_back(std::move(n));
        return static_cast<std::uint32_t>(ast.nodes.size() - 1);
    }

    std::uint32_t emit_unary(Kind k, std::uint32_t a) {
        Node n;
        n.kind = k;
        n.first = static_cast<std::uint32_t>(ast.args.size());
        n.count = 1;
        ast.args.push_back(a);
        return emit(std::move(n));
    }

    std::uint32_t emit_binary(Kind k, std::uint32_t a, std::uint32_t b) {
        Node n;
        n.kind = k;
        n.first = static_cast<std::uint32_t>(ast.args.size());
        n.count = 2;
        ast.args.push_back(a);
        ast.args.push_back(b);
        return emit(std::move(n));
    }

    // Children of a variadic node are collected in `list` then appended
    // as one run, so that runs in Ast::args never interleave.
    std::uint32_t emit_list(Node n, const std::vector<std::uint32_t>& list) {
        n.first = static_cast<std::uint32_t>(ast.args.size());
        n.count = static_cast<std::uint32_t>(list.size());
        for (const std::uint32_t c : list) {
            ast.args.push_back(c);
        }
        return emit(std::move(n));
    }

    // ---- grammar ----------------------------------------------------

    std::uint32_t parse_expr() {
        if (failed()) return 0;
        if (++depth > MAX_DEPTH) {
            fail(ParseError::TooDeep, tok.offset);
            return 0;
        }
        std::uint32_t result = 0;
        if (at_ident("if")) {
            next();
            const std::uint32_t c = parse_expr();
            expect_ident("then");
            const std::uint32_t a = parse_expr();
            expect_ident("else");
            const std::uint32_t b = parse_expr();
            if (!failed()) {
                Node n;
                n.kind = Kind::If;
                result = emit_list(std::move(n), {c, a, b});
            }
        } else {
            result = parse_cmp();
        }
        --depth;
        return result;
    }

    std::uint32_t parse_cmp() {
        std::uint32_t a = parse_add();
        if (failed()) return 0;
        Kind k;
        if (at_punct("<")) k = Kind::Lt;
        else if (at_punct("<=")) k = Kind::Le;
        else if (at_punct(">")) k = Kind::Gt;
        else if (at_punct(">=")) k = Kind::Ge;
        else if (at_punct("==")) k = Kind::Eq;
        else if (at_punct("!=")) k = Kind::Ne;
        else return a;
        next();
        const std::uint32_t b = parse_add();
        if (failed()) return 0;
        a = emit_binary(k, a, b);
        // Non-associative: a second comparison operator is an error here.
        if (at_punct("<") || at_punct("<=") || at_punct(">") || at_punct(">=") || at_punct("==") || at_punct("!=")) {
            fail(ParseError::UnexpectedToken, tok.offset);
            return 0;
        }
        return a;
    }

    std::uint32_t parse_add() {
        std::uint32_t a = parse_mul();
        while (!failed() && (at_punct("+") || at_punct("-"))) {
            const Kind k = at_punct("+") ? Kind::Add : Kind::Sub;
            next();
            const std::uint32_t b = parse_mul();
            if (failed()) return 0;
            a = emit_binary(k, a, b);
        }
        return a;
    }

    std::uint32_t parse_mul() {
        std::uint32_t a = parse_unary();
        while (!failed() && (at_punct("*") || at_punct("/"))) {
            const Kind k = at_punct("*") ? Kind::Mul : Kind::Div;
            next();
            const std::uint32_t b = parse_unary();
            if (failed()) return 0;
            a = emit_binary(k, a, b);
        }
        return a;
    }

    std::uint32_t parse_unary() {
        if (failed()) return 0;
        if (at_punct("-")) {
            // A chain of minus signs nests, so it counts against the depth
            // bound like any other nesting.
            if (++depth > MAX_DEPTH) {
                fail(ParseError::TooDeep, tok.offset);
                return 0;
            }
            next();
            const std::uint32_t a = parse_unary();
            --depth;
            if (failed()) return 0;
            return emit_unary(Kind::Neg, a);
        }
        return parse_postfix();
    }

    std::uint32_t parse_postfix() {
        std::uint32_t a = parse_primary();
        while (!failed() && at_punct(".")) {
            next();
            std::uint8_t lane = 0;
            if (!parse_lane(lane)) {
                return 0;
            }
            Node n;
            n.kind = Kind::Component;
            n.lane = lane;
            n.first = static_cast<std::uint32_t>(ast.args.size());
            n.count = 1;
            ast.args.push_back(a);
            a = emit(std::move(n));
        }
        return a;
    }

    // `x y z w` or a single digit below MAX_DIM.
    bool parse_lane(std::uint8_t& lane) {
        if (tok.type == Tok::Ident && tok.text.size() == 1) {
            switch (tok.text[0]) {
            case 'x': lane = 0; break;
            case 'y': lane = 1; break;
            case 'z': lane = 2; break;
            case 'w': lane = 3; break;
            default: fail(ParseError::BadComponent, tok.offset); return false;
            }
            next();
            return true;
        }
        if (tok.type == Tok::Number && tok.text.size() == 1 && tok.text[0] < '0' + MAX_DIM) {
            lane = static_cast<std::uint8_t>(tok.text[0] - '0');
            next();
            return true;
        }
        fail(tok.type == Tok::End ? ParseError::UnexpectedEnd : ParseError::BadComponent, tok.offset);
        return false;
    }

    std::uint32_t parse_primary() {
        if (failed()) return 0;
        switch (tok.type) {
        case Tok::End:
            fail(ParseError::UnexpectedEnd, tok.offset);
            return 0;
        case Tok::Number: {
            Node n;
            n.kind = Kind::Number;
            const ParseError e = parse_literal(tok.text, n.value);
            if (e != ParseError::Ok) {
                fail(e, tok.offset);
                return 0;
            }
            next();
            return emit(std::move(n));
        }
        case Tok::Punct:
            if (at_punct("(")) {
                next();
                const std::uint32_t a = parse_expr();
                expect_punct(")");
                return failed() ? 0 : a;
            }
            if (at_punct("[")) {
                return parse_vector();
            }
            fail(ParseError::UnexpectedToken, tok.offset);
            return 0;
        case Tok::Ident:
            return parse_ident();
        }
        return 0;
    }

    std::uint32_t parse_vector() {
        const std::uint32_t open = tok.offset;
        next();
        std::vector<std::uint32_t> items;
        for (;;) {
            if (items.size() >= MAX_DIM) {
                fail(ParseError::VectorTooLong, open);
                return 0;
            }
            items.push_back(parse_expr());
            if (failed()) return 0;
            if (at_punct(",")) {
                next();
                continue;
            }
            expect_punct("]");
            if (failed()) return 0;
            Node n;
            n.kind = Kind::Vector;
            return emit_list(std::move(n), items);
        }
    }

    std::uint32_t parse_ident() {
        const Token head = tok;
        if (head.text == "self" || head.text == "other" || head.text == "space" || head.text == "world") {
            next();
            expect_punct(".");
            Node n;
            n.kind = Kind::Ref;
            n.ref = head.text == "self" ? RefKind::Self
                  : head.text == "other" ? RefKind::Other
                  : head.text == "space" ? RefKind::Space
                  : RefKind::World;
            if (!parse_field_name(n.name)) return 0;
            return emit(std::move(n));
        }
        if (head.text == "node") {
            next();
            expect_punct("(");
            if (failed()) return 0;
            Node n;
            n.kind = Kind::Ref;
            n.ref = RefKind::Node;
            if (!parse_node_id(n.value)) return 0;
            expect_punct(")");
            expect_punct(".");
            if (!parse_field_name(n.name)) return 0;
            return emit(std::move(n));
        }
        if (head.text == "if" || head.text == "then" || head.text == "else") {
            fail(ParseError::UnexpectedToken, head.offset);
            return 0;
        }
        const Builtin fn = builtin_from_name(head.text);
        if (fn == Builtin::COUNT) {
            fail(ParseError::UnknownFunction, head.offset);
            return 0;
        }
        next();
        expect_punct("(");
        std::vector<std::uint32_t> items;
        for (;;) {
            if (failed()) return 0;
            if (items.size() > builtin_arity(fn)) {
                fail(ParseError::BadArity, head.offset);
                return 0;
            }
            items.push_back(parse_expr());
            if (failed()) return 0;
            if (at_punct(",")) {
                next();
                continue;
            }
            break;
        }
        expect_punct(")");
        if (failed()) return 0;
        if (items.size() != builtin_arity(fn)) {
            fail(ParseError::BadArity, head.offset);
            return 0;
        }
        Node n;
        n.kind = Kind::Call;
        n.fn = fn;
        return emit_list(std::move(n), items);
    }

    // The token after a ref's dot: an identifier that the store would
    // accept as a field name.
    bool parse_field_name(std::string& out) {
        if (failed()) return false;
        if (tok.type != Tok::Ident) {
            fail(tok.type == Tok::End ? ParseError::UnexpectedEnd : ParseError::UnexpectedToken, tok.offset);
            return false;
        }
        if (!valid_field_name(tok.text)) {
            fail(ParseError::BadName, tok.offset);
            return false;
        }
        out = std::string(tok.text);
        next();
        return true;
    }

    // `n<digits>`, nonzero, fitting in 64 bits. Lexed as one identifier.
    bool parse_node_id(std::int64_t& out) {
        if (tok.type != Tok::Ident || tok.text.size() < 2 || tok.text[0] != 'n' || tok.text[1] == '0') {
            fail(tok.type == Tok::End ? ParseError::UnexpectedEnd : ParseError::BadNodeId, tok.offset);
            return false;
        }
        std::uint64_t id = 0;
        for (std::size_t i = 1; i < tok.text.size(); ++i) {
            const char c = tok.text[i];
            const std::uint64_t d = static_cast<std::uint64_t>(c - '0');
            if (!is_digit(c) || id > UINT64_MAX / 10 || (id == UINT64_MAX / 10 && d > UINT64_MAX % 10)) {
                fail(ParseError::BadNodeId, tok.offset);
                return false;
            }
            id = id * 10 + d;
        }
        out = static_cast<std::int64_t>(id);
        next();
        return true;
    }
};

} // namespace

ParseResult parse(std::string_view source) {
    Parser p;
    p.src = source;
    p.next();
    p.parse_expr();
    if (!p.failed() && p.tok.type != Tok::End) {
        p.fail(ParseError::TrailingInput, p.tok.offset);
    }
    ParseResult r;
    if (p.failed()) {
        r.error = p.err;
        r.offset = p.err_off;
        return r;
    }
    r.ast = std::move(p.ast);
    r.offset = static_cast<std::uint32_t>(source.size());
    return r;
}

} // namespace mathspace::expr
