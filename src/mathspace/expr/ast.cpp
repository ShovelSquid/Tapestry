// expr/ast.cpp — names, exact decimal text, and the S-expression printer.
#include "mathspace/expr/ast.hpp"

namespace mathspace::expr {

namespace {

struct BuiltinInfo {
    std::string_view name;
    std::uint32_t arity;
};

// Indexed by Builtin; the order here is the enum's order.
constexpr BuiltinInfo BUILTINS[] = {
    {"min", 2}, {"max", 2}, {"abs", 1}, {"clamp", 3}, {"sqrt", 1},
    {"sin", 1}, {"cos", 1}, {"atan2", 2}, {"exp", 1}, {"log", 1},
    {"pow", 2}, {"dot", 2}, {"norm", 1}, {"curve", 2},
};
static_assert(sizeof(BUILTINS) / sizeof(BUILTINS[0]) == static_cast<std::size_t>(Builtin::COUNT));

} // namespace

std::string_view builtin_name(Builtin b) { return BUILTINS[static_cast<std::size_t>(b)].name; }
std::uint32_t builtin_arity(Builtin b) { return BUILTINS[static_cast<std::size_t>(b)].arity; }

Builtin builtin_from_name(std::string_view name) {
    for (std::size_t i = 0; i < static_cast<std::size_t>(Builtin::COUNT); ++i) {
        if (BUILTINS[i].name == name) {
            return static_cast<Builtin>(i);
        }
    }
    return Builtin::COUNT;
}

std::string_view ref_name(RefKind r) {
    switch (r) {
    case RefKind::Self: return "self";
    case RefKind::Other: return "other";
    case RefKind::Node: return "node";
    case RefKind::Space: return "space";
    case RefKind::World: return "world";
    }
    return "?";
}

std::string_view kind_name(Kind k) {
    switch (k) {
    case Kind::Number: return "num";
    case Kind::Vector: return "vec";
    case Kind::Neg: return "neg";
    case Kind::Add: return "+";
    case Kind::Sub: return "-";
    case Kind::Mul: return "*";
    case Kind::Div: return "/";
    case Kind::Lt: return "<";
    case Kind::Le: return "<=";
    case Kind::Gt: return ">";
    case Kind::Ge: return ">=";
    case Kind::Eq: return "==";
    case Kind::Ne: return "!=";
    case Kind::If: return "if";
    case Kind::Call: return "call";
    case Kind::Component: return ".";
    case Kind::Ref: return "ref";
    }
    return "?";
}

// Integer part by division, fraction by multiplying the low 32 bits by ten
// at most 32 times (2^-32 needs exactly 32 decimal digits). The magnitude
// is taken in unsigned arithmetic so INT64_MIN does not overflow.
std::string to_decimal(std::int64_t raw) {
    std::string out;
    std::uint64_t mag = raw < 0 ? std::uint64_t{0} - static_cast<std::uint64_t>(raw) : static_cast<std::uint64_t>(raw);
    if (raw < 0) {
        out.push_back('-');
    }
    out += std::to_string(mag >> 32);
    std::uint64_t frac = mag & 0xFFFFFFFFu;
    if (frac != 0) {
        out.push_back('.');
        for (unsigned i = 0; i < 32; ++i) {
            frac *= 10;
            out.push_back(static_cast<char>('0' + (frac >> 32)));
            frac &= 0xFFFFFFFFu;
        }
        while (out.back() == '0') {
            out.pop_back();
        }
    }
    return out;
}

// Post-order means each node's text can be assembled from texts already
// built for lower indices: one pass, no recursion.
std::string to_sexpr(const Ast& ast) {
    if (ast.nodes.empty()) {
        return "";
    }
    std::vector<std::string> text(ast.nodes.size());
    for (std::size_t i = 0; i < ast.nodes.size(); ++i) {
        const Node& n = ast.nodes[i];
        std::string& s = text[i];
        switch (n.kind) {
        case Kind::Number:
            s = to_decimal(n.value);
            break;
        case Kind::Vector:
            s = "[";
            for (std::uint32_t k = 0; k < n.count; ++k) {
                if (k) s += " ";
                s += text[ast.child(n, k)];
            }
            s += "]";
            break;
        case Kind::Ref:
            s = "(ref ";
            s += ref_name(n.ref);
            if (n.ref == RefKind::Node) {
                s += " n" + std::to_string(static_cast<std::uint64_t>(n.value));
            }
            s += " " + n.name + ")";
            break;
        case Kind::Component:
            s = "(. " + text[ast.child(n, 0)] + " " + std::to_string(n.lane) + ")";
            break;
        case Kind::Call:
            s = "(" + std::string(builtin_name(n.fn));
            for (std::uint32_t k = 0; k < n.count; ++k) {
                s += " " + text[ast.child(n, k)];
            }
            s += ")";
            break;
        default:
            s = "(" + std::string(kind_name(n.kind));
            for (std::uint32_t k = 0; k < n.count; ++k) {
                s += " " + text[ast.child(n, k)];
            }
            s += ")";
            break;
        }
    }
    return text.back();
}

} // namespace mathspace::expr
