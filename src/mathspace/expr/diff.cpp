// mathspace/expr/diff.cpp — see diff.hpp.
//
// Two linear pre-passes over f, then one bounded recursive build:
//   dim[i]   the shape of node i (the compiler's rules; an ill-shaped f
//            gets whatever, and the compiler rejects the derivative or f
//            itself later)
//   lo[i]    the first index of node i's subtree; the parser emits
//            post-order, so a subtree is the contiguous range [lo, i]
//            and every arg inside it points inside it, which is what
//            makes copying a subtree a memcpy with an index offset
//   zero[i]  d(node i) is identically zero: no `self.field` below it
// The build appends to an output Ast in post-order, so its subtrees are
// contiguous too, and copies of f's subtrees keep the invariant. The
// build runs off an explicit task stack, so f's nesting depth costs no
// machine stack; the node count is bounded by MAX_NODES.
#include "mathspace/expr/diff.hpp"

#include <algorithm>
#include <initializer_list>
#include <utility>
#include <vector>

namespace mathspace::expr {

const char* diff_error_name(DiffError e) {
    switch (e) {
    case DiffError::Ok: return "Ok";
    case DiffError::EmptyAst: return "EmptyAst";
    case DiffError::UnknownRef: return "UnknownRef";
    case DiffError::BadLane: return "BadLane";
    case DiffError::Unsupported: return "Unsupported";
    case DiffError::TooManyNodes: return "TooManyNodes";
    }
    return "?";
}

namespace {

constexpr std::uint32_t NONE = ~std::uint32_t{0};

struct Builder {
    const Ast& f;
    std::string_view field;
    std::uint8_t lane;
    const DimResolver& dims;
    Ast out;
    DiffError error = DiffError::Ok;
    std::uint32_t where = 0;
    std::vector<std::uint8_t> dim;
    std::vector<std::uint32_t> lo;
    std::vector<bool> zero;

    Builder(const Ast& f_, std::string_view field_, std::uint8_t lane_, const DimResolver& dims_)
        : f(f_), field(field_), lane(lane_), dims(dims_) {}

    bool fail(DiffError e, std::uint32_t at) {
        if (error == DiffError::Ok) {
            error = e;
            where = at;
        }
        return false;
    }

    // ---- pre-passes ------------------------------------------------------

    bool is_var(const Node& n) const { return n.kind == Kind::Ref && n.ref == RefKind::Self && n.name == field; }

    bool analyse() {
        const std::size_t count = f.nodes.size();
        dim.assign(count, 1);
        lo.assign(count, 0);
        zero.assign(count, true);
        for (std::uint32_t i = 0; i < count; ++i) {
            const Node& n = f.nodes[i];
            lo[i] = n.count ? lo[f.child(n, 0)] : i;
            bool z = true;
            for (std::uint32_t c = 0; c < n.count; ++c) z = z && zero[f.child(n, c)];
            switch (n.kind) {
            case Kind::Number:
                dim[i] = 1;
                break;
            case Kind::Vector:
                dim[i] = static_cast<std::uint8_t>(n.count);
                break;
            case Kind::Neg:
            case Kind::Add:
            case Kind::Sub:
            case Kind::Div:
                dim[i] = dim[f.child(n, 0)];
                break;
            case Kind::Mul:
                dim[i] = std::max(dim[f.child(n, 0)], dim[f.child(n, 1)]);
                break;
            case Kind::Lt: case Kind::Le: case Kind::Gt: case Kind::Ge: case Kind::Eq: case Kind::Ne:
                dim[i] = 1;
                z = true; // a step function: zero almost everywhere, and the branch it picks is handled by If
                break;
            case Kind::If:
                dim[i] = dim[f.child(n, 1)];
                z = zero[f.child(n, 1)] && zero[f.child(n, 2)];
                break;
            case Kind::Component:
                dim[i] = 1;
                break;
            case Kind::Call:
                dim[i] = 1;
                if (n.fn == Builtin::Curve && !z) return fail(DiffError::Unsupported, i);
                break;
            case Kind::Ref: {
                const std::uint8_t d = dims.dim(n.ref, static_cast<std::uint64_t>(n.value), n.name);
                if (d == 0) return fail(DiffError::UnknownRef, i);
                dim[i] = d;
                z = !is_var(n);
                break;
            }
            }
            zero[i] = z;
        }
        return true;
    }

    // ---- emitters (post-order: children first, then the node) ------------

    std::uint32_t emit(Node n) {
        if (out.nodes.size() >= MAX_NODES) {
            fail(DiffError::TooManyNodes, 0);
            return NONE;
        }
        out.nodes.push_back(std::move(n));
        return static_cast<std::uint32_t>(out.nodes.size() - 1);
    }

    std::uint32_t number(std::int64_t raw) {
        Node n;
        n.kind = Kind::Number;
        n.value = raw;
        return emit(std::move(n));
    }

    std::uint32_t unary(Kind k, std::uint32_t a) {
        if (a == NONE) return NONE;
        Node n;
        n.kind = k;
        n.first = static_cast<std::uint32_t>(out.args.size());
        n.count = 1;
        out.args.push_back(a);
        return emit(std::move(n));
    }

    std::uint32_t binary(Kind k, std::uint32_t a, std::uint32_t b) {
        if (a == NONE || b == NONE) return NONE;
        Node n;
        n.kind = k;
        n.first = static_cast<std::uint32_t>(out.args.size());
        n.count = 2;
        out.args.push_back(a);
        out.args.push_back(b);
        return emit(std::move(n));
    }

    std::uint32_t list(Node n, const std::vector<std::uint32_t>& kids) {
        for (const std::uint32_t k : kids) if (k == NONE) return NONE;
        n.first = static_cast<std::uint32_t>(out.args.size());
        n.count = static_cast<std::uint32_t>(kids.size());
        for (const std::uint32_t k : kids) out.args.push_back(k);
        return emit(std::move(n));
    }

    std::uint32_t component(std::uint32_t a, std::uint8_t k) {
        if (a == NONE) return NONE;
        Node n;
        n.kind = Kind::Component;
        n.lane = k;
        n.first = static_cast<std::uint32_t>(out.args.size());
        n.count = 1;
        out.args.push_back(a);
        return emit(std::move(n));
    }

    std::uint32_t call(Builtin fn, const std::vector<std::uint32_t>& kids) {
        Node n;
        n.kind = Kind::Call;
        n.fn = fn;
        return list(std::move(n), kids);
    }

    // A zero of dim d: `0` or `[0, .., 0]`.
    std::uint32_t zero_of(std::uint8_t d) {
        if (d <= 1) return number(0);
        std::vector<std::uint32_t> kids;
        for (std::uint8_t i = 0; i < d; ++i) kids.push_back(number(0));
        Node n;
        n.kind = Kind::Vector;
        return list(std::move(n), kids);
    }

    // The unit vector at `lane` of dim d: `1` when d is 1.
    std::uint32_t unit_of(std::uint8_t d) {
        if (d <= 1) return number(fx64::ONE);
        std::vector<std::uint32_t> kids;
        for (std::uint8_t i = 0; i < d; ++i) kids.push_back(number(i == lane ? fx64::ONE : 0));
        Node n;
        n.kind = Kind::Vector;
        return list(std::move(n), kids);
    }

    // Copy f's subtree [lo[i], i] verbatim, args shifted to the new base.
    std::uint32_t copy(std::uint32_t i) {
        const std::uint32_t base = lo[i];
        const std::uint32_t count = i - base + 1;
        if (out.nodes.size() + count > MAX_NODES) {
            fail(DiffError::TooManyNodes, i);
            return NONE;
        }
        const std::uint32_t node_delta = static_cast<std::uint32_t>(out.nodes.size()) - base;
        for (std::uint32_t j = base; j <= i; ++j) {
            Node n = f.nodes[j];
            const std::uint32_t first = static_cast<std::uint32_t>(out.args.size());
            for (std::uint32_t c = 0; c < n.count; ++c) out.args.push_back(f.child(n, c) + node_delta);
            n.first = first;
            out.nodes.push_back(std::move(n));
        }
        return static_cast<std::uint32_t>(out.nodes.size() - 1);
    }

    // ---- the rules -------------------------------------------------------
    //
    // Each rule is a short post-order script of tasks: produce the
    // derivatives and copies it needs, in order, then emit the nodes that
    // combine them. Tasks run off an explicit stack (pushed in reverse so
    // they execute in script order) with a value stack of node indices, so
    // nesting costs heap, not machine stack, and the loop has a literal
    // bound: every task either emits a node or expands into a script that
    // does, and there are at most MAX_NODES nodes.

    enum class Task : std::uint8_t { Diff, Copy, Num, Emit, EmitCall };

    struct Step {
        Task task;
        std::uint32_t at = 0;    // Diff/Copy: node index in f
        std::int64_t raw = 0;    // Num
        Kind kind = Kind::Add;   // Emit
        std::uint8_t count = 0;  // Emit/EmitCall: children to pop
        std::uint8_t lane = 0;   // Emit Component
        Builtin fn = Builtin::Min; // EmitCall
    };

    std::vector<Step> tasks;
    std::vector<std::uint32_t> values;

    static Step Diff(std::uint32_t i) { Step s{Task::Diff}; s.at = i; return s; }
    static Step Copy(std::uint32_t i) { Step s{Task::Copy}; s.at = i; return s; }
    static Step Num(std::int64_t raw) { Step s{Task::Num}; s.raw = raw; return s; }
    static Step Emit(Kind k, std::uint8_t count, std::uint8_t lane = 0) {
        Step s{Task::Emit}; s.kind = k; s.count = count; s.lane = lane; return s;
    }
    static Step EmitCall(Builtin fn, std::uint8_t count) { Step s{Task::EmitCall}; s.fn = fn; s.count = count; return s; }

    // Queue a script to run next, in order.
    void run(std::initializer_list<Step> script) {
        for (auto it = script.end(); it != script.begin();) tasks.push_back(*--it);
    }

    void run(const std::vector<Step>& script) {
        for (auto it = script.rbegin(); it != script.rend(); ++it) tasks.push_back(*it);
    }

    std::uint32_t child(std::uint32_t i, std::uint32_t c) const { return f.child(f.nodes[i], c); }

    // Expand d(node i) into its script (or push its shaped zero).
    void expand(std::uint32_t i) {
        const Node& n = f.nodes[i];
        if (zero[i]) {
            values.push_back(zero_of(dim[i]));
            return;
        }
        switch (n.kind) {
        case Kind::Number:
        case Kind::Lt: case Kind::Le: case Kind::Gt: case Kind::Ge: case Kind::Eq: case Kind::Ne:
            values.push_back(zero_of(1)); // unreachable: zero[i] holds
            return;
        case Kind::Ref:
            values.push_back(unit_of(dim[i]));
            return;
        case Kind::Vector: {
            std::vector<Step> script;
            for (std::uint32_t c = 0; c < n.count; ++c) script.push_back(Diff(child(i, c)));
            script.push_back(Emit(Kind::Vector, static_cast<std::uint8_t>(n.count)));
            run(script);
            return;
        }
        case Kind::Neg:
            run({Diff(child(i, 0)), Emit(Kind::Neg, 1)});
            return;
        case Kind::Add:
        case Kind::Sub: {
            const std::uint32_t a = child(i, 0), b = child(i, 1);
            if (zero[b]) run({Diff(a)});
            else if (zero[a] && n.kind == Kind::Add) run({Diff(b)});
            else if (zero[a]) run({Diff(b), Emit(Kind::Neg, 1)});
            else run({Diff(a), Diff(b), Emit(n.kind, 2)});
            return;
        }
        case Kind::Component:
            run({Diff(child(i, 0)), Emit(Kind::Component, 1, n.lane)});
            return;
        case Kind::If:
            run({Copy(child(i, 0)), Diff(child(i, 1)), Diff(child(i, 2)), Emit(Kind::If, 3)});
            return;
        case Kind::Mul: {
            // da * b + a * db, dropping the constant side's term.
            const std::uint32_t a = child(i, 0), b = child(i, 1);
            if (zero[b]) run({Diff(a), Copy(b), Emit(Kind::Mul, 2)});
            else if (zero[a]) run({Copy(a), Diff(b), Emit(Kind::Mul, 2)});
            else run({Diff(a), Copy(b), Emit(Kind::Mul, 2), Copy(a), Diff(b), Emit(Kind::Mul, 2), Emit(Kind::Add, 2)});
            return;
        }
        case Kind::Div: {
            // (da * b - a * db) / (b * b); da / b when b is constant.
            const std::uint32_t a = child(i, 0), b = child(i, 1);
            if (zero[b]) { run({Diff(a), Copy(b), Emit(Kind::Div, 2)}); return; }
            std::vector<Step> script;
            if (zero[a]) script = {Copy(a), Diff(b), Emit(Kind::Mul, 2), Emit(Kind::Neg, 1)};
            else script = {Diff(a), Copy(b), Emit(Kind::Mul, 2), Copy(a), Diff(b), Emit(Kind::Mul, 2), Emit(Kind::Sub, 2)};
            for (const Step& t : {Copy(b), Copy(b), Emit(Kind::Mul, 2), Emit(Kind::Div, 2)}) script.push_back(t);
            run(script);
            return;
        }
        case Kind::Call:
            expand_call(i);
            return;
        }
    }

    void expand_call(std::uint32_t i) {
        const Node& n = f.nodes[i];
        const auto arg = [&](std::uint32_t c) { return child(i, c); };
        switch (n.fn) {
        case Builtin::Sqrt: // da / (2 * sqrt(a))
            run({Diff(arg(0)), Num(2 * fx64::ONE), Copy(i), Emit(Kind::Mul, 2), Emit(Kind::Div, 2)});
            return;
        case Builtin::Sin: // cos(a) * da
            run({Copy(arg(0)), EmitCall(Builtin::Cos, 1), Diff(arg(0)), Emit(Kind::Mul, 2)});
            return;
        case Builtin::Cos: // -(sin(a) * da)
            run({Copy(arg(0)), EmitCall(Builtin::Sin, 1), Diff(arg(0)), Emit(Kind::Mul, 2), Emit(Kind::Neg, 1)});
            return;
        case Builtin::Exp: // exp(a) * da
            run({Copy(i), Diff(arg(0)), Emit(Kind::Mul, 2)});
            return;
        case Builtin::Log: // da / a
            run({Diff(arg(0)), Copy(arg(0)), Emit(Kind::Div, 2)});
            return;
        case Builtin::Pow: {
            const std::uint32_t a = arg(0), b = arg(1);
            if (zero[b]) {
                // b * pow(a, b - 1) * da
                run({Copy(b), Copy(a), Copy(b), Num(fx64::ONE), Emit(Kind::Sub, 2), EmitCall(Builtin::Pow, 2),
                     Emit(Kind::Mul, 2), Diff(a), Emit(Kind::Mul, 2)});
                return;
            }
            // pow(a, b) * (db * log(a) + b * da / a)
            std::vector<Step> script = {Copy(i), Diff(b), Copy(a), EmitCall(Builtin::Log, 1), Emit(Kind::Mul, 2)};
            if (!zero[a]) {
                for (const Step& t : {Copy(b), Diff(a), Emit(Kind::Mul, 2), Copy(a), Emit(Kind::Div, 2), Emit(Kind::Add, 2)})
                    script.push_back(t);
            }
            script.push_back(Emit(Kind::Mul, 2));
            run(script);
            return;
        }
        case Builtin::Atan2: {
            // (x * dy - y * dx) / (x * x + y * y)   for atan2(y, x)
            const std::uint32_t y = arg(0), x = arg(1);
            std::vector<Step> script;
            if (zero[x]) script = {Copy(x), Diff(y), Emit(Kind::Mul, 2)};
            else if (zero[y]) script = {Copy(y), Diff(x), Emit(Kind::Mul, 2), Emit(Kind::Neg, 1)};
            else script = {Copy(x), Diff(y), Emit(Kind::Mul, 2), Copy(y), Diff(x), Emit(Kind::Mul, 2), Emit(Kind::Sub, 2)};
            for (const Step& t : {Copy(x), Copy(x), Emit(Kind::Mul, 2), Copy(y), Copy(y), Emit(Kind::Mul, 2),
                                  Emit(Kind::Add, 2), Emit(Kind::Div, 2)})
                script.push_back(t);
            run(script);
            return;
        }
        case Builtin::Abs: // if a < 0 then -da else da
            run({Copy(arg(0)), Num(0), Emit(Kind::Lt, 2), Diff(arg(0)), Emit(Kind::Neg, 1), Diff(arg(0)), Emit(Kind::If, 3)});
            return;
        case Builtin::Min: // fx64: min(a, b) = b < a ? b : a
            run({Copy(arg(1)), Copy(arg(0)), Emit(Kind::Lt, 2), Diff(arg(1)), Diff(arg(0)), Emit(Kind::If, 3)});
            return;
        case Builtin::Max: // fx64: max(a, b) = a < b ? b : a
            run({Copy(arg(0)), Copy(arg(1)), Emit(Kind::Lt, 2), Diff(arg(1)), Diff(arg(0)), Emit(Kind::If, 3)});
            return;
        case Builtin::Clamp: {
            // fx64: clamp(v, lo, hi) = v < lo ? lo : (hi < v ? hi : v)
            const std::uint32_t v = arg(0), lo_ = arg(1), hi_ = arg(2);
            run({Copy(v), Copy(lo_), Emit(Kind::Lt, 2), Diff(lo_), Copy(hi_), Copy(v), Emit(Kind::Lt, 2), Diff(hi_),
                 Diff(v), Emit(Kind::If, 3), Emit(Kind::If, 3)});
            return;
        }
        case Builtin::Dot: { // dot(da, b) + dot(a, db)
            const std::uint32_t a = arg(0), b = arg(1);
            if (zero[b]) run({Diff(a), Copy(b), EmitCall(Builtin::Dot, 2)});
            else if (zero[a]) run({Copy(a), Diff(b), EmitCall(Builtin::Dot, 2)});
            else run({Diff(a), Copy(b), EmitCall(Builtin::Dot, 2), Copy(a), Diff(b), EmitCall(Builtin::Dot, 2), Emit(Kind::Add, 2)});
            return;
        }
        case Builtin::Norm: // dot(a, da) / norm(a)
            run({Copy(arg(0)), Diff(arg(0)), EmitCall(Builtin::Dot, 2), Copy(i), Emit(Kind::Div, 2)});
            return;
        case Builtin::Curve:
        case Builtin::COUNT:
            break;
        }
        fail(DiffError::Unsupported, i); // unreachable: analyse() rejected it
    }

    // Pop `count` values into a node of `kind` (or a call of `fn`).
    void emit_step(const Step& s) {
        if (values.size() < s.count) {
            fail(DiffError::TooManyNodes, 0); // a script bug; never on user data
            return;
        }
        std::vector<std::uint32_t> kids(values.end() - s.count, values.end());
        values.resize(values.size() - s.count);
        Node n;
        if (s.task == Task::EmitCall) {
            n.kind = Kind::Call;
            n.fn = s.fn;
        } else {
            n.kind = s.kind;
            n.lane = s.lane;
        }
        values.push_back(list(std::move(n), kids));
    }

    // Build d(root). The bound: every task either emits a node or expands
    // into a script that ends in one, scripts have at most 12 steps, and
    // MAX_NODES nodes fit; 16 * MAX_NODES iterations therefore always
    // suffice unless the node cap fails first.
    std::uint32_t build(std::uint32_t root) {
        tasks.push_back(Diff(root));
        const std::uint32_t max_iter = 16 * MAX_NODES;
        for (std::uint32_t it = 0; it < max_iter && !tasks.empty() && error == DiffError::Ok; ++it) {
            const Step s = tasks.back();
            tasks.pop_back();
            switch (s.task) {
            case Task::Diff: expand(s.at); break;
            case Task::Copy: values.push_back(copy(s.at)); break;
            case Task::Num: values.push_back(number(s.raw)); break;
            case Task::Emit:
            case Task::EmitCall: emit_step(s); break;
            }
        }
        if (error != DiffError::Ok) return NONE;
        if (!tasks.empty() || values.size() != 1) {
            fail(DiffError::TooManyNodes, root);
            return NONE;
        }
        return values.back();
    }
};

} // namespace

DiffResult differentiate(const Ast& f, std::string_view field, std::uint8_t lane, const DimResolver& dims) {
    DiffResult r;
    if (f.nodes.empty()) {
        r.error = DiffError::EmptyAst;
        return r;
    }
    const std::uint8_t var_dim = dims.dim(RefKind::Self, 0, field);
    if (var_dim == 0) {
        r.error = DiffError::UnknownRef;
        return r;
    }
    if (lane >= var_dim) {
        r.error = DiffError::BadLane;
        return r;
    }
    Builder b(f, field, lane, dims);
    if (!b.analyse()) {
        r.error = b.error;
        r.where = b.where;
        return r;
    }
    const std::uint32_t root = b.build(f.root());
    if (root == NONE || b.error != DiffError::Ok) {
        r.error = b.error == DiffError::Ok ? DiffError::TooManyNodes : b.error;
        r.where = b.where;
        return r;
    }
    r.ast = std::move(b.out);
    return r;
}

} // namespace mathspace::expr
