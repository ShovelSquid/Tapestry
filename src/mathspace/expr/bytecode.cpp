// expr/bytecode.cpp — shape check and emission, verify, encode/decode.
#include "mathspace/expr/bytecode.hpp"

#include "../wire.hpp"

namespace mathspace::expr {

const char* compile_error_name(CompileError e) {
    switch (e) {
    case CompileError::Ok: return "Ok";
    case CompileError::DimMismatch: return "DimMismatch";
    case CompileError::NotScalar: return "NotScalar";
    case CompileError::NestedVector: return "NestedVector";
    case CompileError::BadLane: return "BadLane";
    case CompileError::UnknownRef: return "UnknownRef";
    case CompileError::EmptyAst: return "EmptyAst";
    case CompileError::TooManyOps: return "TooManyOps";
    case CompileError::StackTooDeep: return "StackTooDeep";
    case CompileError::BadBytes: return "BadBytes";
    case CompileError::BadJump: return "BadJump";
    case CompileError::BadStack: return "BadStack";
    }
    return "?";
}

namespace {

constexpr bool is_scalar_builtin(Builtin b) {
    return b != Builtin::Dot && b != Builtin::Norm && b != Builtin::Curve;
}

struct Emitter {
    Program& prog;
    CompileError err = CompileError::Ok;

    bool emit(Op op) {
        if (prog.ops.size() >= MAX_OPS) {
            err = CompileError::TooManyOps;
            return false;
        }
        prog.ops.push_back(std::move(op));
        return true;
    }
    bool simple(OpCode code, std::uint8_t dim) {
        Op op;
        op.code = code;
        op.dim = dim;
        return emit(std::move(op));
    }
};

// One traversal frame: a node and how many of its children are done.
// `jz` and `jmp` remember the two jump ops of an If so they can be
// patched once the branch they skip has been emitted.
struct Frame {
    std::uint32_t node;
    std::uint32_t next = 0;
    std::uint32_t jz = 0;
    std::uint32_t jmp = 0;
};

} // namespace

CompileResult compile(const Ast& ast, const DimResolver& dims) {
    CompileResult r;
    if (ast.nodes.empty()) {
        r.error = CompileError::EmptyAst;
        return r;
    }
    Program& prog = r.program;
    Emitter em{prog};
    std::vector<std::uint8_t> dim(ast.nodes.size(), 0);
    std::vector<Frame> stack;
    stack.push_back(Frame{ast.root()});

    auto fail = [&](CompileError e, std::uint32_t node) {
        r.error = e;
        r.where = node;
    };

    // Each node is visited once per child plus once to finish, so the
    // loop runs at most nodes + args times; the bound is literal.
    const std::uint32_t max_visits = 2 * MAX_NODES + MAX_NODES * MAX_DIM;
    for (std::uint32_t visit = 0; visit < max_visits && !stack.empty() && r.ok(); ++visit) {
        Frame& f = stack.back();
        const Node& n = ast.nodes[f.node];
        if (f.next < n.count) {
            if (n.kind == Kind::If) {
                if (f.next == 1) {
                    // Condition is on the stack: skip the then-branch when zero.
                    f.jz = static_cast<std::uint32_t>(prog.ops.size());
                    Op op;
                    op.code = OpCode::JumpIfZero;
                    op.dim = 1;
                    if (!em.emit(std::move(op))) { fail(em.err, f.node); break; }
                } else if (f.next == 2) {
                    f.jmp = static_cast<std::uint32_t>(prog.ops.size());
                    Op op;
                    op.code = OpCode::Jump;
                    op.dim = 1;
                    if (!em.emit(std::move(op))) { fail(em.err, f.node); break; }
                    prog.ops[f.jz].value = static_cast<std::int64_t>(prog.ops.size());
                }
            }
            const std::uint32_t child = ast.child(n, f.next);
            ++f.next;
            stack.push_back(Frame{child});
            continue;
        }

        // Every child has a dim; type this node and emit its op.
        const std::uint32_t me = f.node;
        auto cd = [&](std::uint32_t i) { return dim[ast.child(n, i)]; };
        std::uint8_t d = 0;
        switch (n.kind) {
        case Kind::Number: {
            Op op;
            op.code = OpCode::PushNum;
            op.dim = 1;
            op.value = n.value;
            if (!em.emit(std::move(op))) { fail(em.err, me); break; }
            d = 1;
            break;
        }
        case Kind::Vector:
            for (std::uint32_t i = 0; i < n.count; ++i) {
                if (cd(i) != 1) { fail(CompileError::NestedVector, me); break; }
            }
            d = static_cast<std::uint8_t>(n.count);
            if (r.ok() && !em.simple(OpCode::MakeVec, d)) { fail(em.err, me); }
            break;
        case Kind::Neg:
            d = cd(0);
            if (!em.simple(OpCode::Neg, d)) { fail(em.err, me); }
            break;
        case Kind::Add:
        case Kind::Sub:
            if (cd(0) != cd(1)) { fail(CompileError::DimMismatch, me); break; }
            d = cd(0);
            if (!em.simple(n.kind == Kind::Add ? OpCode::Add : OpCode::Sub, d)) { fail(em.err, me); }
            break;
        case Kind::Mul:
            if (cd(0) == 1 && cd(1) == 1) {
                d = 1;
                if (!em.simple(OpCode::Mul, 1)) { fail(em.err, me); }
            } else if (cd(0) == 1) {
                d = cd(1);
                if (!em.simple(OpCode::MulSV, d)) { fail(em.err, me); }
            } else if (cd(1) == 1) {
                d = cd(0);
                if (!em.simple(OpCode::MulVS, d)) { fail(em.err, me); }
            } else {
                fail(CompileError::DimMismatch, me);
            }
            break;
        case Kind::Div:
            if (cd(1) != 1) { fail(CompileError::NotScalar, me); break; }
            d = cd(0);
            if (!em.simple(d == 1 ? OpCode::Div : OpCode::DivVS, d)) { fail(em.err, me); }
            break;
        case Kind::Lt: case Kind::Le: case Kind::Gt: case Kind::Ge: case Kind::Eq: case Kind::Ne: {
            if (cd(0) != 1 || cd(1) != 1) { fail(CompileError::NotScalar, me); break; }
            d = 1;
            const OpCode code = n.kind == Kind::Lt ? OpCode::Lt
                              : n.kind == Kind::Le ? OpCode::Le
                              : n.kind == Kind::Gt ? OpCode::Gt
                              : n.kind == Kind::Ge ? OpCode::Ge
                              : n.kind == Kind::Eq ? OpCode::Eq
                              : OpCode::Ne;
            if (!em.simple(code, 1)) { fail(em.err, me); }
            break;
        }
        case Kind::If:
            if (cd(0) != 1) { fail(CompileError::NotScalar, me); break; }
            if (cd(1) != cd(2)) { fail(CompileError::DimMismatch, me); break; }
            prog.ops[f.jmp].value = static_cast<std::int64_t>(prog.ops.size());
            d = cd(1);
            break;
        case Kind::Component: {
            if (n.lane >= cd(0)) { fail(CompileError::BadLane, me); break; }
            Op op;
            op.code = OpCode::Lane;
            op.dim = cd(0);
            op.lane = n.lane;
            if (!em.emit(std::move(op))) { fail(em.err, me); break; }
            d = 1;
            break;
        }
        case Kind::Call: {
            Op op;
            op.code = OpCode::Call;
            op.fn = n.fn;
            if (is_scalar_builtin(n.fn)) {
                for (std::uint32_t i = 0; i < n.count; ++i) {
                    if (cd(i) != 1) { fail(CompileError::NotScalar, me); break; }
                }
                op.dim = 1;
            } else if (n.fn == Builtin::Dot) {
                if (cd(0) != cd(1)) { fail(CompileError::DimMismatch, me); break; }
                op.dim = cd(0);
            } else if (n.fn == Builtin::Norm) {
                op.dim = cd(0);
            } else { // Curve
                if (cd(1) != 1) { fail(CompileError::NotScalar, me); break; }
                op.dim = cd(0);
            }
            if (!r.ok()) break;
            if (!em.emit(std::move(op))) { fail(em.err, me); break; }
            d = 1;
            break;
        }
        case Kind::Ref: {
            const std::uint8_t rd = dims.dim(n.ref, static_cast<std::uint64_t>(n.value), n.name);
            if (!valid_dim(rd)) { fail(CompileError::UnknownRef, me); break; }
            Op op;
            op.code = OpCode::LoadRef;
            op.ref = n.ref;
            op.dim = rd;
            op.value = n.value;
            op.name = n.name;
            if (!em.emit(std::move(op))) { fail(em.err, me); break; }
            d = rd;
            break;
        }
        }
        dim[me] = d;
        stack.pop_back();
    }
    if (!r.ok()) {
        r.program = Program{};
        return r;
    }
    prog.dim = dim[ast.root()];
    std::uint32_t where = 0;
    const CompileError v = verify(prog, where);
    if (v != CompileError::Ok) {
        // The compiler and verifier disagree, or the stack is too deep;
        // report the op, there is no better node to point at.
        r.program = Program{};
        r.error = v;
        r.where = where;
    }
    return r;
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

namespace {

using Shape = std::vector<std::uint8_t>;

struct Checker {
    const Program& prog;
    Shape cur;
    std::vector<Shape> at;      // expected shape at each op index (and at end)
    std::vector<bool> has;
    bool reachable = true;
    std::uint32_t lanes = 0;
    std::uint32_t max_lanes = 0;

    explicit Checker(const Program& p) : prog(p), at(p.ops.size() + 1), has(p.ops.size() + 1, false) {}

    bool pop(std::uint8_t d) {
        if (cur.empty() || cur.back() != d) {
            return false;
        }
        cur.pop_back();
        lanes -= d;
        return true;
    }
    bool push(std::uint8_t d) {
        cur.push_back(d);
        lanes += d;
        if (lanes > max_lanes) {
            max_lanes = lanes;
        }
        return lanes <= MAX_STACK_LANES;
    }
    static std::uint32_t sum(const Shape& s) {
        std::uint32_t n = 0;
        for (const std::uint8_t d : s) n += d;
        return n;
    }
    // Record `cur` as the shape at `target`, or check it against one
    // already recorded.
    bool label(std::uint32_t target) {
        if (has[target]) {
            return at[target] == cur;
        }
        at[target] = cur;
        has[target] = true;
        return true;
    }
    // Entering op `pc`: reconcile the incoming shape with any label.
    bool enter(std::uint32_t pc) {
        if (has[pc]) {
            if (reachable && at[pc] != cur) {
                return false;
            }
            cur = at[pc];
            lanes = sum(cur);
            reachable = true;
            return true;
        }
        return reachable;
    }
};

} // namespace

CompileError verify(Program& program, std::uint32_t& where) {
    const std::size_t n = program.ops.size();
    where = 0;
    if (n == 0 || n > MAX_OPS) {
        return n == 0 ? CompileError::BadStack : CompileError::TooManyOps;
    }
    Checker c(program);
    for (std::uint32_t pc = 0; pc < n; ++pc) {
        where = pc;
        const Op& op = program.ops[pc];
        if (!c.enter(pc)) {
            return c.has[pc] ? CompileError::BadStack : CompileError::BadJump;
        }
        if (!valid_dim(op.dim)) {
            return CompileError::BadStack;
        }
        bool ok = true;
        switch (op.code) {
        case OpCode::PushNum:
            ok = op.dim == 1 && c.push(1);
            break;
        case OpCode::LoadRef:
            ok = valid_field_name(op.name) && c.push(op.dim);
            break;
        case OpCode::MakeVec:
            for (std::uint8_t i = 0; ok && i < op.dim; ++i) {
                ok = c.pop(1);
            }
            ok = ok && c.push(op.dim);
            break;
        case OpCode::Neg:
            ok = c.pop(op.dim) && c.push(op.dim);
            break;
        case OpCode::Add:
        case OpCode::Sub:
            ok = c.pop(op.dim) && c.pop(op.dim) && c.push(op.dim);
            break;
        case OpCode::Mul:
        case OpCode::Div:
        case OpCode::Lt: case OpCode::Le: case OpCode::Gt: case OpCode::Ge: case OpCode::Eq: case OpCode::Ne:
            ok = op.dim == 1 && c.pop(1) && c.pop(1) && c.push(1);
            break;
        case OpCode::MulSV:
            ok = c.pop(op.dim) && c.pop(1) && c.push(op.dim);
            break;
        case OpCode::MulVS:
        case OpCode::DivVS:
            ok = c.pop(1) && c.pop(op.dim) && c.push(op.dim);
            break;
        case OpCode::Lane:
            ok = op.lane < op.dim && c.pop(op.dim) && c.push(1);
            break;
        case OpCode::Call:
            if (op.fn >= Builtin::COUNT) {
                ok = false;
            } else if (is_scalar_builtin(op.fn)) {
                ok = op.dim == 1;
                for (std::uint32_t i = 0; ok && i < builtin_arity(op.fn); ++i) {
                    ok = c.pop(1);
                }
            } else if (op.fn == Builtin::Dot) {
                ok = c.pop(op.dim) && c.pop(op.dim);
            } else if (op.fn == Builtin::Norm) {
                ok = c.pop(op.dim);
            } else { // Curve: knots below, t on top
                ok = c.pop(1) && c.pop(op.dim);
            }
            ok = ok && c.push(1);
            break;
        case OpCode::JumpIfZero:
        case OpCode::Jump: {
            const std::int64_t target = op.value;
            if (target <= pc || target > static_cast<std::int64_t>(n)) {
                return CompileError::BadJump;
            }
            if (op.code == OpCode::JumpIfZero) {
                if (!c.pop(1)) {
                    return CompileError::BadStack;
                }
            }
            if (!c.label(static_cast<std::uint32_t>(target))) {
                return CompileError::BadStack;
            }
            if (op.code == OpCode::Jump) {
                c.reachable = false;
            }
            break;
        }
        case OpCode::COUNT:
            ok = false;
            break;
        }
        if (!ok) {
            return c.lanes > MAX_STACK_LANES ? CompileError::StackTooDeep : CompileError::BadStack;
        }
    }
    where = static_cast<std::uint32_t>(n);
    // Falling off the end is the only way here; a label at n comes from a
    // jump that already met the range check, so a mismatch is a stack one.
    if (!c.enter(where)) {
        return CompileError::BadStack;
    }
    if (c.cur.size() != 1 || c.cur[0] != program.dim) {
        return CompileError::BadStack;
    }
    program.max_stack = c.max_lanes;
    return CompileError::Ok;
}

// ---------------------------------------------------------------------------
// bytes
// ---------------------------------------------------------------------------

std::vector<std::uint8_t> encode(const Program& program) {
    wire::Bytes out;
    wire::put_u8(out, BYTECODE_VERSION);
    wire::put_u8(out, program.dim);
    wire::put_u32(out, static_cast<std::uint32_t>(program.ops.size()));
    for (const Op& op : program.ops) {
        wire::put_u8(out, static_cast<std::uint8_t>(op.code));
        switch (op.code) {
        case OpCode::PushNum:
            wire::put_u64(out, static_cast<std::uint64_t>(op.value));
            break;
        case OpCode::LoadRef:
            wire::put_u8(out, static_cast<std::uint8_t>(op.ref));
            wire::put_u8(out, op.dim);
            wire::put_u64(out, static_cast<std::uint64_t>(op.value));
            wire::put_u8(out, static_cast<std::uint8_t>(op.name.size()));
            wire::put_bytes(out, op.name.data(), op.name.size());
            break;
        case OpCode::MakeVec: case OpCode::Neg: case OpCode::Add: case OpCode::Sub:
        case OpCode::MulSV: case OpCode::MulVS: case OpCode::DivVS:
            wire::put_u8(out, op.dim);
            break;
        case OpCode::Lane:
            wire::put_u8(out, op.dim);
            wire::put_u8(out, op.lane);
            break;
        case OpCode::Call:
            wire::put_u8(out, static_cast<std::uint8_t>(op.fn));
            wire::put_u8(out, op.dim);
            break;
        case OpCode::JumpIfZero: case OpCode::Jump:
            wire::put_u32(out, static_cast<std::uint32_t>(op.value));
            break;
        default:
            break;
        }
    }
    return out;
}

CompileError decode(const std::uint8_t* data, std::size_t size, Program& program, std::uint32_t& where) {
    program = Program{};
    where = 0;
    wire::ByteReader r(data, size);
    std::uint8_t version = 0;
    std::uint8_t dim = 0;
    std::uint32_t count = 0;
    if (!r.read_u8(version) || version != BYTECODE_VERSION || !r.read_u8(dim) || !r.read_u32(count) ||
        count == 0 || count > MAX_OPS) {
        return CompileError::BadBytes;
    }
    Program p;
    p.dim = dim;
    p.ops.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
        where = i;
        Op op;
        std::uint8_t code = 0;
        if (!r.read_u8(code) || code >= static_cast<std::uint8_t>(OpCode::COUNT)) {
            program = Program{};
            return CompileError::BadBytes;
        }
        op.code = static_cast<OpCode>(code);
        bool ok = true;
        std::uint8_t b = 0;
        std::uint64_t u = 0;
        std::uint32_t t = 0;
        switch (op.code) {
        case OpCode::PushNum:
            ok = r.read_u64(u);
            op.value = static_cast<std::int64_t>(u);
            break;
        case OpCode::LoadRef: {
            std::uint8_t ref = 0;
            std::uint8_t len = 0;
            ok = r.read_u8(ref) && ref <= static_cast<std::uint8_t>(RefKind::World) && r.read_u8(op.dim) &&
                 r.read_u64(u) && r.read_u8(len) && len > 0 && r.remaining() >= len;
            if (ok) {
                op.ref = static_cast<RefKind>(ref);
                op.value = static_cast<std::int64_t>(u);
                ok = r.read_bytes(op.name, len);
            }
            break;
        }
        case OpCode::MakeVec: case OpCode::Neg: case OpCode::Add: case OpCode::Sub:
        case OpCode::MulSV: case OpCode::MulVS: case OpCode::DivVS:
            ok = r.read_u8(op.dim);
            break;
        case OpCode::Lane:
            ok = r.read_u8(op.dim) && r.read_u8(op.lane);
            break;
        case OpCode::Call:
            ok = r.read_u8(b) && b < static_cast<std::uint8_t>(Builtin::COUNT) && r.read_u8(op.dim);
            op.fn = static_cast<Builtin>(b);
            break;
        case OpCode::JumpIfZero: case OpCode::Jump:
            ok = r.read_u32(t);
            op.value = t;
            break;
        case OpCode::Mul: case OpCode::Div:
        case OpCode::Lt: case OpCode::Le: case OpCode::Gt: case OpCode::Ge: case OpCode::Eq: case OpCode::Ne:
            break;
        case OpCode::COUNT:
            ok = false;
            break;
        }
        if (!ok) {
            program = Program{};
            return CompileError::BadBytes;
        }
        p.ops.push_back(std::move(op));
    }
    if (!r.at_end()) {
        where = count;
        return CompileError::BadBytes;
    }
    const CompileError v = verify(p, where);
    if (v != CompileError::Ok) {
        return v;
    }
    program = std::move(p);
    return CompileError::Ok;
}

std::string to_listing(const Program& program) {
    static constexpr const char* NAMES[] = {
        "PushNum", "LoadRef", "MakeVec", "Neg", "Add", "Sub", "Mul", "Div", "MulSV", "MulVS", "DivVS",
        "Lt", "Le", "Gt", "Ge", "Eq", "Ne", "Lane", "Call", "JumpIfZero", "Jump",
    };
    static_assert(sizeof(NAMES) / sizeof(NAMES[0]) == static_cast<std::size_t>(OpCode::COUNT));
    std::string out;
    for (const Op& op : program.ops) {
        out += NAMES[static_cast<std::size_t>(op.code)];
        switch (op.code) {
        case OpCode::PushNum:
            out += " " + to_decimal(op.value);
            break;
        case OpCode::LoadRef:
            out += " ";
            out += ref_name(op.ref);
            if (op.ref == RefKind::Node) {
                out += " n" + std::to_string(static_cast<std::uint64_t>(op.value));
            }
            out += " " + op.name + " dim " + std::to_string(op.dim);
            break;
        case OpCode::MakeVec: case OpCode::Neg: case OpCode::Add: case OpCode::Sub:
        case OpCode::MulSV: case OpCode::MulVS: case OpCode::DivVS:
            out += " " + std::to_string(op.dim);
            break;
        case OpCode::Lane:
            out += " " + std::to_string(op.dim) + " " + std::to_string(op.lane);
            break;
        case OpCode::Call:
            out += " ";
            out += builtin_name(op.fn);
            out += " " + std::to_string(op.dim);
            break;
        case OpCode::JumpIfZero: case OpCode::Jump:
            out += " " + std::to_string(op.value);
            break;
        default:
            break;
        }
        out += "\n";
    }
    return out;
}

} // namespace mathspace::expr
