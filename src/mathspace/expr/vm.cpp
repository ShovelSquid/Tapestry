// expr/vm.cpp — the lane stack machine.
#include "mathspace/expr/vm.hpp"

#include "ddsim/fxmath.hpp"

namespace mathspace::expr {

const char* vm_error_name(VmError e) {
    switch (e) {
    case VmError::Ok: return "Ok";
    case VmError::NoOther: return "NoOther";
    case VmError::NoSuchNote: return "NoSuchNote";
    case VmError::NoSpace: return "NoSpace";
    case VmError::NoSuchField: return "NoSuchField";
    case VmError::UnknownRef: return "UnknownRef";
    case VmError::DimChanged: return "DimChanged";
    case VmError::BadProgram: return "BadProgram";
    }
    return "?";
}

namespace {

constexpr fx64 ONE = fx64::from_raw(fx64::ONE);
constexpr fx64 ZERO = fx64::from_raw(0);

// fx64 and fxmath return 0 outside their domains but also assert in
// Debug. An expression is user data and may hit any of these at run
// time, so the VM checks the domain first and never reaches the assert;
// the result is the same 0 in every build.
constexpr fx64 safe_div(fx64 a, fx64 b) { return b == ZERO ? ZERO : a / b; }
constexpr fx64 safe_sqrt(fx64 x) { return x < ZERO ? ZERO : ddsim::sqrt(x); }
constexpr fx64 safe_log(fx64 x) { return x <= ZERO ? ZERO : ddsim::fxmath::log(x); }
constexpr fx64 safe_pow(fx64 x, fx64 y) { return x <= ZERO ? ZERO : ddsim::fxmath::pow(x, y); }

// The note a reference names, or null with the error set.
const Note* resolve_note(RefKind ref, std::uint64_t id, const World& world, const Note& self, const Note* other,
                         VmError& err) {
    switch (ref) {
    case RefKind::Self:
        return &self;
    case RefKind::Other:
        if (other == nullptr) {
            err = VmError::NoOther;
        }
        return other;
    case RefKind::Node: {
        const Note* n = world.find(NoteId{id});
        if (n == nullptr) {
            err = VmError::NoSuchNote;
        }
        return n;
    }
    case RefKind::Space: {
        const Note* s = world.find_space(self.space);
        if (s == nullptr) {
            err = VmError::NoSpace;
        }
        return s;
    }
    case RefKind::World:
        return nullptr;
    }
    err = VmError::BadProgram;
    return nullptr;
}

struct Machine {
    std::array<fx64, MAX_STACK_LANES> st{};
    std::uint32_t sp = 0;

    bool need(std::uint32_t n) const { return sp >= n; }
    bool room(std::uint32_t n) const { return sp + n <= MAX_STACK_LANES; }
    fx64& at(std::uint32_t from_top) { return st[sp - 1 - from_top]; }
};

fx64 curve(const fx64* knots, std::uint8_t d, fx64 t) {
    if (d == 1) {
        return knots[0];
    }
    t = ddsim::clamp(t, ZERO, ONE);
    const fx64 u = t * fx64::from_int(static_cast<std::int32_t>(d - 1));
    std::int32_t i = u.floor_to_int();
    if (i < 0) i = 0;
    if (i > d - 2) i = d - 2;
    const fx64 frac = u - fx64::from_int(i);
    return knots[i] + (knots[i + 1] - knots[i]) * frac;
}

} // namespace

VmError eval(const Program& program, const World& world, const Note& self, const Note* other, Lanes& out) {
    out.fill(ZERO);
    if (program.ops.empty() || program.ops.size() > MAX_OPS || !valid_dim(program.dim)) {
        return VmError::BadProgram;
    }
    Machine m;
    const std::uint32_t n = static_cast<std::uint32_t>(program.ops.size());
    std::uint32_t pc = 0;
    // Jumps only move forward, so `pc` strictly increases and the loop
    // ends within n iterations; the counter makes the bound literal.
    for (std::uint32_t step = 0; step < n && pc < n; ++step) {
        const Op& op = program.ops[pc];
        const std::uint32_t d = op.dim;
        if (!valid_dim(op.dim)) {
            return VmError::BadProgram;
        }
        std::uint32_t next = pc + 1;
        switch (op.code) {
        case OpCode::PushNum:
            if (!m.room(1)) return VmError::BadProgram;
            m.st[m.sp++] = fx64::from_raw(op.value);
            break;
        case OpCode::LoadRef: {
            if (!m.room(d)) return VmError::BadProgram;
            if (op.ref == RefKind::World) {
                if (op.name != "tick" || d != 1) return VmError::UnknownRef;
                m.st[m.sp++] = fx64::from_int(static_cast<std::int32_t>(world.tick & 0x7fffffffu));
                break;
            }
            VmError err = VmError::Ok;
            const Note* note = resolve_note(op.ref, static_cast<std::uint64_t>(op.value), world, self, other, err);
            if (note == nullptr) return err;
            if (op.ref == RefKind::Space && op.name == "dim") {
                if (d != 1) return VmError::DimChanged;
                const Field* pos = find_field(*note, POS_FIELD);
                if (pos == nullptr) return VmError::NoSpace;
                m.st[m.sp++] = fx64::from_int(pos->dim);
                break;
            }
            const Field* f = find_field(*note, op.name);
            if (f == nullptr) return VmError::NoSuchField;
            if (f->dim != d) return VmError::DimChanged;
            for (std::uint32_t i = 0; i < d; ++i) {
                m.st[m.sp++] = f->value[i];
            }
            break;
        }
        case OpCode::MakeVec:
            if (!m.need(d)) return VmError::BadProgram;
            break;
        case OpCode::Neg:
            if (!m.need(d)) return VmError::BadProgram;
            for (std::uint32_t i = 0; i < d; ++i) m.at(i) = -m.at(i);
            break;
        case OpCode::Add:
        case OpCode::Sub:
            if (!m.need(2 * d)) return VmError::BadProgram;
            for (std::uint32_t i = 0; i < d; ++i) {
                fx64& a = m.st[m.sp - 2 * d + i];
                const fx64 b = m.st[m.sp - d + i];
                a = op.code == OpCode::Add ? a + b : a - b;
            }
            m.sp -= d;
            break;
        case OpCode::Mul:
        case OpCode::Div: {
            if (d != 1 || !m.need(2)) return VmError::BadProgram;
            const fx64 b = m.at(0);
            fx64& a = m.at(1);
            a = op.code == OpCode::Mul ? a * b : safe_div(a, b);
            m.sp -= 1;
            break;
        }
        case OpCode::MulSV: {
            if (!m.need(d + 1)) return VmError::BadProgram;
            const fx64 s = m.st[m.sp - d - 1];
            for (std::uint32_t i = 0; i < d; ++i) {
                m.st[m.sp - d - 1 + i] = s * m.st[m.sp - d + i];
            }
            m.sp -= 1;
            break;
        }
        case OpCode::MulVS:
        case OpCode::DivVS: {
            if (!m.need(d + 1)) return VmError::BadProgram;
            const fx64 s = m.at(0);
            for (std::uint32_t i = 0; i < d; ++i) {
                fx64& v = m.st[m.sp - 1 - d + i];
                v = op.code == OpCode::MulVS ? v * s : safe_div(v, s);
            }
            m.sp -= 1;
            break;
        }
        case OpCode::Lt: case OpCode::Le: case OpCode::Gt: case OpCode::Ge: case OpCode::Eq: case OpCode::Ne: {
            if (d != 1 || !m.need(2)) return VmError::BadProgram;
            const fx64 b = m.at(0);
            const fx64 a = m.at(1);
            bool r = false;
            switch (op.code) {
            case OpCode::Lt: r = a < b; break;
            case OpCode::Le: r = a <= b; break;
            case OpCode::Gt: r = a > b; break;
            case OpCode::Ge: r = a >= b; break;
            case OpCode::Eq: r = a == b; break;
            default: r = a != b; break;
            }
            m.at(1) = r ? ONE : ZERO;
            m.sp -= 1;
            break;
        }
        case OpCode::Lane: {
            if (op.lane >= d || !m.need(d)) return VmError::BadProgram;
            const fx64 v = m.st[m.sp - d + op.lane];
            m.sp -= d;
            m.st[m.sp++] = v;
            break;
        }
        case OpCode::Call: {
            fx64 r = ZERO;
            switch (op.fn) {
            case Builtin::Min: case Builtin::Max: case Builtin::Atan2: case Builtin::Pow: {
                if (d != 1 || !m.need(2)) return VmError::BadProgram;
                const fx64 a = m.at(1);
                const fx64 b = m.at(0);
                r = op.fn == Builtin::Min ? ddsim::min(a, b)
                  : op.fn == Builtin::Max ? ddsim::max(a, b)
                  : op.fn == Builtin::Atan2 ? ddsim::fxmath::atan2(a, b)
                  : safe_pow(a, b);
                m.sp -= 2;
                break;
            }
            case Builtin::Clamp: {
                if (d != 1 || !m.need(3)) return VmError::BadProgram;
                r = ddsim::clamp(m.at(2), m.at(1), m.at(0));
                m.sp -= 3;
                break;
            }
            case Builtin::Abs: case Builtin::Sqrt: case Builtin::Sin: case Builtin::Cos:
            case Builtin::Exp: case Builtin::Log: {
                if (d != 1 || !m.need(1)) return VmError::BadProgram;
                const fx64 a = m.at(0);
                r = op.fn == Builtin::Abs ? ddsim::abs(a)
                  : op.fn == Builtin::Sqrt ? safe_sqrt(a)
                  : op.fn == Builtin::Sin ? ddsim::fxmath::sin(a)
                  : op.fn == Builtin::Cos ? ddsim::fxmath::cos(a)
                  : op.fn == Builtin::Exp ? ddsim::fxmath::exp(a)
                  : safe_log(a);
                m.sp -= 1;
                break;
            }
            case Builtin::Dot: {
                if (!m.need(2 * d)) return VmError::BadProgram;
                for (std::uint32_t i = 0; i < d; ++i) {
                    r += m.st[m.sp - 2 * d + i] * m.st[m.sp - d + i];
                }
                m.sp -= 2 * d;
                break;
            }
            case Builtin::Norm: {
                if (!m.need(d)) return VmError::BadProgram;
                for (std::uint32_t i = 0; i < d; ++i) {
                    const fx64 v = m.st[m.sp - d + i];
                    r += v * v;
                }
                r = safe_sqrt(r);
                m.sp -= d;
                break;
            }
            case Builtin::Curve: {
                if (!m.need(d + 1)) return VmError::BadProgram;
                r = curve(&m.st[m.sp - 1 - d], static_cast<std::uint8_t>(d), m.at(0));
                m.sp -= d + 1;
                break;
            }
            case Builtin::COUNT:
                return VmError::BadProgram;
            }
            m.st[m.sp++] = r;
            break;
        }
        case OpCode::JumpIfZero: {
            if (!m.need(1)) return VmError::BadProgram;
            const fx64 c = m.st[--m.sp];
            if (op.value <= pc || op.value > n) return VmError::BadProgram;
            if (c == ZERO) next = static_cast<std::uint32_t>(op.value);
            break;
        }
        case OpCode::Jump:
            if (op.value <= pc || op.value > n) return VmError::BadProgram;
            next = static_cast<std::uint32_t>(op.value);
            break;
        case OpCode::COUNT:
            return VmError::BadProgram;
        }
        pc = next;
    }
    if (pc != n || m.sp != program.dim) {
        out.fill(ZERO);
        return VmError::BadProgram;
    }
    for (std::uint32_t i = 0; i < program.dim; ++i) {
        out[i] = m.st[i];
    }
    return VmError::Ok;
}

std::uint8_t WorldDims::dim(RefKind ref, std::uint64_t id, std::string_view name) const {
    const Note* note = nullptr;
    switch (ref) {
    case RefKind::Self: note = &self; break;
    case RefKind::Other: note = other; break;
    case RefKind::Node: note = world.find(NoteId{id}); break;
    case RefKind::Space:
        if (name == "dim") {
            return world.space_dim(self.space) != 0 ? 1 : 0;
        }
        note = world.find_space(self.space);
        break;
    case RefKind::World:
        return name == "tick" ? 1 : 0;
    }
    if (note == nullptr) {
        return 0;
    }
    const Field* f = find_field(*note, name);
    return f == nullptr ? 0 : f->dim;
}

std::uint8_t RuleDims::dim(RefKind ref, std::uint64_t id, std::string_view name) const {
    const Note* note = nullptr;
    switch (ref) {
    case RefKind::Self:
    case RefKind::Other:
        if (name == POS_FIELD) {
            return world.space_dim(rule.space);
        }
        for (const Note& n : world.notes) {
            if (n.kind != NoteKind::Note || n.space != rule.space) {
                continue;
            }
            if (const Field* f = find_field(n, name)) {
                return f->dim;
            }
        }
        return 0;
    case RefKind::Node: note = world.find(NoteId{id}); break;
    case RefKind::Space:
        if (name == "dim") {
            return world.space_dim(rule.space) != 0 ? 1 : 0;
        }
        note = world.find_space(rule.space);
        break;
    case RefKind::World:
        return name == "tick" ? 1 : 0;
    }
    if (note == nullptr) {
        return 0;
    }
    const Field* f = find_field(*note, name);
    return f == nullptr ? 0 : f->dim;
}

} // namespace mathspace::expr
