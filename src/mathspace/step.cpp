// mathspace/step.cpp — World::step: force rules, the integrator, and
// bound-field evaluation. Pinned as MS_STEP_VERSION (version.hpp).
//
// A Rule note (note.hpp, NoteKind::Rule) holds its law as bound fields
// whose programs run against each *target* note as `self`, never against
// the rule note itself; the rule's own lanes stay as they were set and
// the generic bound-field pass below skips Rule notes for that reason.
// This tick knows one law: a bound `force` on a rule of unary scope
// (`scope` absent or 0; pair and global are later phases and are skipped
// here). Its targets are the non-Rule notes of the rule's space, in id
// order, that a bound scalar `select` accepts (nonzero; an absent
// `select` accepts every one, a bound non-scalar one skips the rule).
// The force program must yield the space dim (else the rule is
// skipped), and a per-note evaluation failure of either program (a
// `self.mass` the note does not have, a field at another dim) skips that
// note only. Forces sum into a per-tick accumulator that is not a field:
// nothing is stored, hashed or snapshotted, so a rule never creates
// fields on the notes it acts on.
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

bool is_unary(const Note& rule) {
    const Field* scope = find_field(rule, SCOPE_FIELD);
    return scope == nullptr || (scope->dim == 1 && scope->value[0].raw == 0);
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

} // namespace

void World::step() {
    // Force accumulation, indexed like `notes` so no field is created.
    std::vector<expr::Lanes> force(notes.size());
    for (const Note& rule : notes) {
        if (rule.kind != NoteKind::Rule || !is_unary(rule)) {
            continue;
        }
        const Field* f = find_field(rule, FORCE_FIELD);
        if (f == nullptr || !f->bound) {
            continue;
        }
        const std::uint8_t dim = space_dim(rule.space);
        expr::Program program;
        if (dim == 0 || !program_of(*f, dim, program)) {
            continue;
        }
        const Field* sel = find_field(rule, SELECT_FIELD);
        expr::Program select;
        if (sel != nullptr && sel->bound && !program_of(*sel, 1, select)) {
            continue;
        }
        for (std::size_t i = 0; i < notes.size(); ++i) {
            const Note& target = notes[i];
            if (target.kind == NoteKind::Rule || target.space != rule.space || find_field(target, POS_FIELD) == nullptr) {
                continue;
            }
            expr::Lanes out{};
            if (!select.ops.empty()) {
                if (expr::eval(select, *this, target, nullptr, out) != expr::VmError::Ok || out[0].raw == 0) {
                    continue;
                }
            }
            if (expr::eval(program, *this, target, nullptr, out) != expr::VmError::Ok) {
                continue;
            }
            for (std::uint8_t lane = 0; lane < dim; ++lane) {
                force[i][lane] += out[lane];
            }
        }
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
