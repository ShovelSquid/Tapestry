// mathspace/step.cpp — World::step: force rules, the integrator, and
// bound-field evaluation. Pinned as MS_STEP_VERSION (version.hpp).
//
// A Rule note (note.hpp, NoteKind::Rule) holds its law as bound fields
// whose programs run against each *target* note as `self`, never against
// the rule note itself; the rule's own lanes stay as they were set and
// the generic bound-field pass below skips Rule notes for that reason.
// A bound `force` on a rule is evaluated once per visit of the rule's
// scope (for_each_target below: unary per target, pair per ordered pair
// of targets with `other` bound, global once on the rule itself) and
// summed into the accumulator of the visit's `self`; a bound scalar
// `select` gates each visit. The force program must yield the space dim
// (else the rule is skipped), and a per-visit evaluation failure of
// either program (a `self.mass` the note does not have, a field at
// another dim, `other` in a unary rule) skips that visit only. Forces sum
// into a per-tick accumulator that is not a field: nothing is stored,
// hashed or snapshotted, so a rule never creates fields on the notes it
// acts on. Pair scope is O(n^2) evaluations, twice the unordered pairs:
// the design's gravity example is a force on `self` in terms of `other`,
// so the pair is visited both ways and Newton's third law is the user's
// symmetric formula, not a rule of the engine.
//
// Then the integrator, notes in id order: a note with `pos` and
// `velocity` at the same dim takes `velocity += force / mass` (mass is
// the scalar `mass` field, 1 when absent or not scalar; a mass <= 0
// drops the force), then `pos += velocity`, both lane by lane with
// fx64's wrapping arithmetic and h = 1. A note without `velocity` never
// moves, however much force it collects; the rule never creates fields.
// A note whose scalar `pinned` is nonzero is held still (RULE-08): it
// still collects force (a later pair rule may read it as `other`), but
// neither its velocity nor its pos changes. Space notes are not
// excluded (nothing forbids a space from drifting).
//
// Then the set rules: for each Rule note in id order, each of its bound
// fields named `set.<f>` in name order (SET_PREFIX, world.hpp) is
// evaluated on each visit of the rule's scope, and the lanes are written
// into `self`'s own field `f` when it already holds it at the program's
// dim (a pair set visits `self` once per `other`, each visit reading
// what the last one wrote, so a running min or sum over others is one
// expression; a global set writes the rule's own field). A missing or reshaped `f`, an
// evaluation error, or a pinned target (RULE-08 covers every write) is a
// per-target skip; the rule never creates fields. Two rules setting one
// field is not detected: the later rule in id order wins. A target's
// `pos` here is this tick's integrated one.
//
// Every skip above, whole-rule or per-visit, is counted into
// World::reports (RULE-07, world.hpp) with its reason, so the plugin can
// write `mathspace.error` on the rule; a pinned target of a set rule is
// not a skip (RULE-08 is what the user asked for). The reports are
// cleared at the start of each step and never enter the hash.
//
// Then every bound field of every non-Rule note (phase 2) is evaluated:
// notes in id order, fields in name order, each against the world as it
// is at that moment, so a field can see this tick's integrated `pos` and
// the bound fields evaluated before it, and a bound field's stored lanes
// are what the snapshot shows. `other` is null here; pair rules come
// later in phase 3. An evaluation error leaves the lanes as they were
// (the plugin reports it on the node). The bytecode is decoded on every
// evaluation: set_field guarantees it decodes, and a program is small; a
// cache can come when a profile asks for one.
#include "mathspace/world.hpp"

#include "mathspace/expr/vm.hpp"

namespace mathspace {

namespace {

// Decodes `f`'s program; false when it does not decode or its dim is not
// `dim` (set_field guarantees the former, the latter guards a reshaped
// field or a rule whose force is not a space vector).
bool program_of(const Field& f, std::uint8_t dim, expr::Program& program) {
    std::uint32_t where = 0;
    return expr::decode(f.bytecode.data(), f.bytecode.size(), program, where) == expr::CompileError::Ok &&
           program.dim == dim;
}

// The rule's `scope` as step() reads it: absent is unary; a bound, vector
// or out-of-range scalar is no scope at all and the rule is skipped.
enum class Scope : std::uint8_t { Unary = 0, Pair = 1, Global = 2, None };

Scope scope_of(const Note& rule) {
    const Field* scope = find_field(rule, SCOPE_FIELD);
    if (scope == nullptr) {
        return Scope::Unary;
    }
    if (scope->dim != 1 || scope->bound) {
        return Scope::None;
    }
    const std::int64_t raw = scope->value[0].raw;
    if (raw == 0) return Scope::Unary;
    if (raw == fx64::from_int(1).raw) return Scope::Pair;
    if (raw == fx64::from_int(2).raw) return Scope::Global;
    return Scope::None;
}

// `mass` of a note for the integrator: 1 unless a scalar field says otherwise.
fx64 mass_of(const Note& n) {
    const Field* m = find_field(n, MASS_FIELD);
    return (m == nullptr || m->dim != 1) ? fx64::from_int(1) : m->value[0];
}

// RULE-08: a nonzero scalar `pinned` holds the note still.
bool is_pinned(const Note& n) {
    const Field* p = find_field(n, PINNED_FIELD);
    return p != nullptr && p->dim == 1 && p->value[0].raw != 0;
}

// Decodes `f`'s program whatever its dim.
bool decode_program(const Field& f, expr::Program& program) {
    std::uint32_t where = 0;
    return expr::decode(f.bytecode.data(), f.bytecode.size(), program, where) == expr::CompileError::Ok;
}


// Collects RULE-07 reports (world.hpp) for the step in progress: one
// entry per rule that skipped anything, in id order, holding the count
// and the reason of the last skip. Rules are visited in id order twice
// (force pass, then set pass), so an entry is found or inserted by
// lower_bound rather than appended.
struct Reporter {
    std::vector<RuleReport>& reports;

    void skip(NoteId rule, std::uint8_t reason) {
        auto it = reports.begin();
        while (it != reports.end() && it->rule.value < rule.value) {
            ++it;
        }
        if (it == reports.end() || it->rule != rule) {
            it = reports.insert(it, RuleReport{rule, 0, 0});
        }
        ++it->skipped;
        it->reason = reason;
    }
    void skip(NoteId rule, Skip reason) { skip(rule, static_cast<std::uint8_t>(reason)); }
    void skip(NoteId rule, expr::VmError err) { skip(rule, static_cast<std::uint8_t>(err)); }
};

static_assert(static_cast<std::uint8_t>(expr::VmError::BadProgram) < static_cast<std::uint8_t>(Skip::NoScope),
              "VmError codes share Skip's byte below 16");

// Calls fn(index, self, other) for each evaluation a rule's scope asks
// for, where `self` is the note that receives the rule's writes: unary
// visits each target once with `other` null; pair visits every ordered
// pair (self, other) of distinct targets, self in id order and other in
// id order within it, so a symmetric law acts on both ends and an
// asymmetric one is a law on `self`; global visits the rule note itself
// once with `other` null. A target is a non-Rule note of the rule's
// space that has `pos`. A bound scalar `select` is evaluated per visit
// with the same `self` and `other` and gates it (nonzero passes; an
// error skips the visit and is reported). Returns false when the rule is
// skipped whole, reporting why: no scope, a space without a dim, or a
// bound non-scalar `select`.
template <class Fn>
bool for_each_target(const World& w, const Note& rule, Reporter& report, Fn&& fn) {
    const std::vector<Note>& notes = w.notes;
    if (rule.kind != NoteKind::Rule) {
        return false;
    }
    const Scope scope = scope_of(rule);
    if (scope == Scope::None) {
        report.skip(rule.id, Skip::NoScope);
        return false;
    }
    if (w.space_dim(rule.space) == 0) {
        report.skip(rule.id, Skip::NoSpace);
        return false;
    }
    const Field* sel = find_field(rule, SELECT_FIELD);
    expr::Program select;
    if (sel != nullptr && sel->bound && !program_of(*sel, 1, select)) {
        report.skip(rule.id, Skip::BadSelect);
        return false;
    }
    auto selected = [&](const Note& self, const Note* other) {
        if (select.ops.empty()) {
            return true;
        }
        expr::Lanes out{};
        const expr::VmError err = expr::eval(select, w, self, other, out);
        if (err != expr::VmError::Ok) {
            report.skip(rule.id, err);
            return false;
        }
        return out[0].raw != 0;
    };
    auto is_target = [&](const Note& n) {
        return n.kind != NoteKind::Rule && n.space == rule.space && find_field(n, POS_FIELD) != nullptr;
    };
    if (scope == Scope::Global) {
        const std::size_t i = w.note_lower_bound(rule.id);
        if (selected(rule, nullptr)) {
            fn(i, rule, nullptr);
        }
        return true;
    }
    for (std::size_t i = 0; i < notes.size(); ++i) {
        const Note& self = notes[i];
        if (!is_target(self)) {
            continue;
        }
        if (scope == Scope::Unary) {
            if (selected(self, nullptr)) {
                fn(i, self, nullptr);
            }
            continue;
        }
        for (std::size_t j = 0; j < notes.size(); ++j) {
            const Note& other = notes[j];
            if (j == i || !is_target(other)) {
                continue;
            }
            if (selected(self, &other)) {
                fn(i, self, &other);
            }
        }
    }
    return true;
}

} // namespace

const char* skip_name(std::uint8_t reason) {
    if (reason < static_cast<std::uint8_t>(Skip::NoScope)) {
        return expr::vm_error_name(static_cast<expr::VmError>(reason));
    }
    switch (static_cast<Skip>(reason)) {
    case Skip::NoScope: return "NoScope";
    case Skip::NoSpace: return "NoSpace";
    case Skip::BadSelect: return "BadSelect";
    case Skip::WrongDim: return "WrongDim";
    case Skip::NoTargetField: return "NoTargetField";
    default: return "?";
    }
}

void World::step() {
    reports.clear();
    Reporter report{reports};
    // Force accumulation, indexed like `notes` so no field is created.
    std::vector<expr::Lanes> force(notes.size());
    for (const Note& rule : notes) {
        if (rule.kind != NoteKind::Rule) {
            continue;
        }
        const Field* f = find_field(rule, FORCE_FIELD);
        if (f == nullptr || !f->bound) {
            continue;
        }
        const std::uint8_t dim = space_dim(rule.space);
        expr::Program program;
        if (dim == 0) {
            report.skip(rule.id, Skip::NoSpace);
            continue;
        }
        if (!program_of(*f, dim, program)) {
            report.skip(rule.id, Skip::WrongDim);
            continue;
        }
        for_each_target(*this, rule, report, [&](std::size_t i, const Note& self, const Note* other) {
            expr::Lanes out{};
            const expr::VmError err = expr::eval(program, *this, self, other, out);
            if (err != expr::VmError::Ok) {
                report.skip(rule.id, err);
                return;
            }
            for (std::uint8_t lane = 0; lane < dim; ++lane) {
                force[i][lane] += out[lane];
            }
        });
    }
    for (std::size_t i = 0; i < notes.size(); ++i) {
        Note& n = notes[i];
        Field* pos = find_field(n, POS_FIELD);
        if (pos == nullptr || is_pinned(n)) {
            continue;
        }
        Field* vel = find_field(n, VELOCITY_FIELD);
        if (vel == nullptr || vel->dim != pos->dim) {
            continue;
        }
        const fx64 mass = mass_of(n);
        if (mass > fx64{}) {
            for (std::uint8_t lane = 0; lane < pos->dim; ++lane) {
                vel->value[lane] += force[i][lane] / mass;
            }
        }
        for (std::uint8_t lane = 0; lane < pos->dim; ++lane) {
            pos->value[lane] += vel->value[lane];
        }
    }
    for (std::size_t r = 0; r < notes.size(); ++r) {
        const Note& rule = notes[r];
        if (rule.kind != NoteKind::Rule) {
            continue;
        }
        for (const Field& f : rule.fields) {
            if (!f.bound || !f.name.starts_with(SET_PREFIX)) {
                continue;
            }
            const std::string_view target_name = std::string_view(f.name).substr(SET_PREFIX.size());
            expr::Program program;
            if (!decode_program(f, program)) {
                continue;
            }
            for_each_target(*this, rule, report, [&](std::size_t i, const Note& self, const Note* other) {
                if (is_pinned(self)) {
                    return; // RULE-08 is the user's choice, not a failure
                }
                Field* dst = find_field(notes[i], target_name);
                if (dst == nullptr || dst->dim != program.dim) {
                    report.skip(rule.id, Skip::NoTargetField);
                    return;
                }
                expr::Lanes out{};
                const expr::VmError err = expr::eval(program, *this, self, other, out);
                if (err != expr::VmError::Ok) {
                    report.skip(rule.id, err);
                    return;
                }
                for (std::uint8_t lane = 0; lane < dst->dim; ++lane) {
                    dst->value[lane] = out[lane];
                }
            });
        }
    }
    for (Note& n : notes) {
        if (n.kind == NoteKind::Rule) {
            continue;
        }
        for (Field& f : n.fields) {
            if (!f.bound) {
                continue;
            }
            expr::Program program;
            if (!program_of(f, f.dim, program)) {
                continue;
            }
            expr::Lanes out{};
            if (expr::eval(program, *this, n, nullptr, out) != expr::VmError::Ok) {
                continue;
            }
            for (std::uint8_t lane = 0; lane < f.dim; ++lane) {
                f.value[lane] = out[lane];
            }
        }
    }
    ++tick;
    notes_dirty = true;
}

} // namespace mathspace
