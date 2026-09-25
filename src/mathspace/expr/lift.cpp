// mathspace/expr/lift.cpp — see lift.hpp.
#include "mathspace/expr/lift.hpp"

#include <vector>

namespace mathspace::expr {

const char* lift_error_name(LiftError e) {
    switch (e) {
    case LiftError::Ok: return "Ok";
    case LiftError::EmptyProgram: return "EmptyProgram";
    case LiftError::BadStack: return "BadStack";
    case LiftError::BadJump: return "BadJump";
    case LiftError::TooManyNodes: return "TooManyNodes";
    default: return "?";
    }
}

namespace {

// An `if` under construction: its condition and then-branch roots, and
// the op index at which its else-branch ends (0 until the Jump is seen).
struct IfFrame {
    std::uint32_t cond = 0;
    std::uint32_t then = 0;
    std::uint32_t end = 0;
    bool has_then = false;
};

struct Builder {
    Ast& ast;
    std::vector<std::uint32_t> stack; // subtree roots, node indices
    LiftError err = LiftError::Ok;

    // Appends `node` with `count` children popped from the stack (in
    // order) and pushes it; false on underflow or overflow.
    bool push(Node node, std::uint32_t count) {
        if (stack.size() < count) {
            err = LiftError::BadStack;
            return false;
        }
        if (ast.nodes.size() >= MAX_NODES) {
            err = LiftError::TooManyNodes;
            return false;
        }
        node.first = static_cast<std::uint32_t>(ast.args.size());
        node.count = count;
        for (std::size_t i = stack.size() - count; i < stack.size(); ++i) {
            ast.args.push_back(stack[i]);
        }
        stack.resize(stack.size() - count);
        ast.nodes.push_back(std::move(node));
        stack.push_back(static_cast<std::uint32_t>(ast.nodes.size() - 1));
        return true;
    }

    bool simple(Kind kind, std::uint32_t count) {
        Node n;
        n.kind = kind;
        return push(std::move(n), count);
    }
};

} // namespace

LiftResult lift(const Program& program) {
    LiftResult r;
    if (program.ops.empty()) {
        r.error = LiftError::EmptyProgram;
        return r;
    }
    Builder b{r.ast, {}, LiftError::Ok};
    std::vector<IfFrame> frames;

    auto fail = [&](LiftError e, std::uint32_t at) {
        r.error = e;
        r.where = at;
        r.ast = Ast{};
    };

    // Closes every frame whose else-branch ends at op index `at`.
    auto close = [&](std::uint32_t at) {
        while (!frames.empty() && frames.back().has_then && frames.back().end == at) {
            const IfFrame f = frames.back();
            frames.pop_back();
            if (b.stack.empty()) {
                b.err = LiftError::BadStack;
                return false;
            }
            const std::uint32_t else_root = b.stack.back();
            b.stack.pop_back();
            b.stack.push_back(f.cond);
            b.stack.push_back(f.then);
            b.stack.push_back(else_root);
            if (!b.simple(Kind::If, 3)) {
                return false;
            }
        }
        return true;
    };

    const std::uint32_t count = static_cast<std::uint32_t>(program.ops.size());
    for (std::uint32_t pc = 0; pc < count; ++pc) {
        if (!close(pc)) {
            fail(b.err, pc);
            return r;
        }
        const Op& op = program.ops[pc];
        bool ok = true;
        switch (op.code) {
        case OpCode::PushNum: {
            Node n;
            n.kind = Kind::Number;
            n.value = op.value;
            ok = b.push(std::move(n), 0);
            break;
        }
        case OpCode::LoadRef: {
            Node n;
            n.kind = Kind::Ref;
            n.ref = op.ref;
            n.value = op.value;
            n.name = op.name;
            ok = b.push(std::move(n), 0);
            break;
        }
        case OpCode::MakeVec: ok = b.simple(Kind::Vector, op.dim); break;
        case OpCode::Neg: ok = b.simple(Kind::Neg, 1); break;
        case OpCode::Add: ok = b.simple(Kind::Add, 2); break;
        case OpCode::Sub: ok = b.simple(Kind::Sub, 2); break;
        case OpCode::Mul: case OpCode::MulSV: case OpCode::MulVS: ok = b.simple(Kind::Mul, 2); break;
        case OpCode::Div: case OpCode::DivVS: ok = b.simple(Kind::Div, 2); break;
        case OpCode::Lt: ok = b.simple(Kind::Lt, 2); break;
        case OpCode::Le: ok = b.simple(Kind::Le, 2); break;
        case OpCode::Gt: ok = b.simple(Kind::Gt, 2); break;
        case OpCode::Ge: ok = b.simple(Kind::Ge, 2); break;
        case OpCode::Eq: ok = b.simple(Kind::Eq, 2); break;
        case OpCode::Ne: ok = b.simple(Kind::Ne, 2); break;
        case OpCode::Lane: {
            Node n;
            n.kind = Kind::Component;
            n.lane = op.lane;
            ok = b.push(std::move(n), 1);
            break;
        }
        case OpCode::Call: {
            Node n;
            n.kind = Kind::Call;
            n.fn = op.fn;
            ok = b.push(std::move(n), builtin_arity(op.fn));
            break;
        }
        case OpCode::JumpIfZero: {
            if (b.stack.empty()) {
                b.err = LiftError::BadStack;
                ok = false;
                break;
            }
            IfFrame f;
            f.cond = b.stack.back();
            b.stack.pop_back();
            frames.push_back(f);
            break;
        }
        case OpCode::Jump: {
            if (frames.empty() || frames.back().has_then) {
                b.err = LiftError::BadJump;
                ok = false;
                break;
            }
            if (b.stack.empty()) {
                b.err = LiftError::BadStack;
                ok = false;
                break;
            }
            IfFrame& f = frames.back();
            f.then = b.stack.back();
            b.stack.pop_back();
            f.has_then = true;
            f.end = static_cast<std::uint32_t>(op.value);
            break;
        }
        default:
            b.err = LiftError::BadStack;
            ok = false;
            break;
        }
        if (!ok) {
            fail(b.err, pc);
            return r;
        }
    }
    if (!close(count)) {
        fail(b.err, count);
        return r;
    }
    if (!frames.empty()) {
        fail(LiftError::BadJump, count);
        return r;
    }
    if (b.stack.size() != 1) {
        fail(LiftError::BadStack, count);
        return r;
    }
    return r;
}

} // namespace mathspace::expr
