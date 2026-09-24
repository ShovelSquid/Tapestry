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
// drops the force), then the geodesic correction below when its space
// has a metric, then `pos += velocity`, all lane by lane with fx64's
// wrapping arithmetic and h = 1.
//
// Metric spaces (phase 6): a Space note with a bound `metric` (world.hpp
// METRIC_FIELD) gives the diagonal g_kk(x) of the chart's metric as a
// dim-N program in `self.pos`. Before the integrator, each such metric
// is lifted, differentiated with respect to every pos lane and compiled
// (as a constraint's gradient is, once per space per step); a metric
// that is not a dim-N program, or has no gradient, is reported on the
// Space note as BadMetric and its space is Euclidean this tick. For a
// moving note of that space the integrator evaluates g and its N
// gradients at the note (as `self`) and adds the geodesic acceleration
// of a diagonal metric, Gamma^k_ij v^i v^j written out:
//   a_k = -(2 v_k (grad g_kk . v) - sum_i (d_k g_ii) v_i^2) / (2 g_kk)
// to the velocity before `pos += velocity` (semi-implicit Euler, h = 1,
// v the velocity after the force). Forces are taken as vectors in the
// chart as written (no index raised through g). An evaluation error is
// reported on the Space note and skips the correction for that note;
// a g_kk below MS_METRIC_EPS_RAW skips it silently, as the constraint
// pass skips a flat gradient. Nothing new is stored: the metric's own
// lanes on the Space note stay as set, and the bound-field pass at the
// end leaves `metric` alone as it leaves a rule's law. A note without `velocity` never
// moves, however much force it collects; the rule never creates fields.
// Identified charts (phase 6, world.hpp IDENTIFY_FIELD): after the
// velocity derivation that follows the constraint passes, a Space with a
// dim-N `identify` of half-widths L_k has each moving note's pos lane
// wrapped into [-L_k, L_k) by one fx64 expression per lane (the
// version.hpp note for 11). Pinned notes are wrapped too: a wrap is a
// change of chart representative, not motion.
//
// A note whose scalar `pinned` is nonzero is held still (RULE-08): it
// still collects force (a later pair rule may read it as `other`), but
// neither its velocity nor its pos changes. Space notes are not
// excluded (nothing forbids a space from drifting).
//
// Then the constraints (phase 4, XPBD as in ddsim/rules/constraints.hpp
// with the constraint function and its gradient looked up instead of
// inlined). A Rule note with a bound scalar `constraint` C is solved
// toward C = 0: before the passes, C's bytecode is lifted back to an Ast
// (expr/lift.hpp), differentiated with respect to each lane of
// `self.pos` (expr/diff.hpp) and compiled against the rule's dims, once
// per rule per step (a rebound field needs no cache to invalidate; a
// profile can ask for one). A `constraint` that is not scalar is
// WrongDim; one whose gradient does not lift, differentiate (`curve` of
// pos) or compile is BadGradient; both skip the rule whole. Then
// MS_CONSTRAINT_ITERATIONS Gauss-Seidel passes, each over the constraint
// rules in id order and each rule's scope visits in step order (the same
// for_each_target as forces, `select` included, unary/pair/global): a
// visit evaluates C and the gradient g on (self, other) and moves
// `self.pos` by
//   dpos = w_self * dlambda * g,  dlambda = -C / ((w_self + w_other) |g|^2 + compliance)
// where w is the inverse `mass` (1 when absent, 0 when mass <= 0 or the
// note is pinned), w_other is 0 with no `other`, `compliance` is the
// rule's scalar field (0 when absent, XPBD's alpha with h = 1), and a
// denominator below MS_CONSTRAINT_EPS_RAW (a flat gradient with no
// compliance) skips the visit silently as ddsim's len2 guard does. Only
// `self` moves, per visit: a pair rule visits both orders, so the other
// end takes its own share on its own visit, and the (w_self + w_other)
// split is ddsim's wa / (wa + wb) exactly for a rod (the gradient with
// respect to the other end is minus this one for any C of the
// difference `other.pos - self.pos`; for a C that does not depend on
// `other` the split merely under-relaxes and the fixed passes still
// converge geometrically). A pinned self is skipped without a report
// (RULE-08). Notes without `velocity` are moved too: the projection is
// a position write, and `pinned` is the one hold. An evaluation error
// on a visit is a per-visit skip, reported. No lambda persists between
// passes or ticks: nothing new enters the state or the walk.
//
// Then `velocity = pos - prev` (prev being the pos before the
// integrator) for every note the integrator moves (pos and velocity at
// one dim, not pinned): without constraints this is exactly the
// velocity the integrator wrote (the wrapping add and subtract cancel),
// with them it is the corrected motion, so the constraint acts on the
// velocity without a multiplier stored anywhere.
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

#include "mathspace/expr/diff.hpp"
#include "mathspace/expr/lift.hpp"
#include "mathspace/expr/vm.hpp"
#include "mathspace/version.hpp"

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
        return n.kind == NoteKind::Note && n.space == rule.space && find_field(n, POS_FIELD) != nullptr;
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

// The solver's weight of a note: 1 / mass, 0 when it cannot move (pinned,
// or mass <= 0 which the integrator treats as immovable by force too).
fx64 inv_mass_of(const Note& n) {
    if (is_pinned(n)) {
        return fx64{};
    }
    const fx64 m = mass_of(n);
    return m > fx64{} ? fx64::from_int(1) / m : fx64{};
}

// A constraint rule prepared for the passes: C and d C / d self.pos.lane
// per lane of the space, and the rule's compliance.
struct ConstraintRule {
    std::size_t index = 0; // into World::notes
    std::uint8_t dim = 0;
    expr::Program c;
    std::vector<expr::Program> grad;
    fx64 alpha{};
    bool alive = true; // false once for_each_target skipped it whole
};

// Lifts, differentiates and compiles the gradient of `f` (the rule's
// bound `constraint`) per pos lane; false with the reason reported.
bool prepare_constraint(const World& w, const Note& rule, const Field& f, Reporter& report, ConstraintRule& out) {
    out.dim = w.space_dim(rule.space);
    if (out.dim == 0) {
        report.skip(rule.id, Skip::NoSpace);
        return false;
    }
    if (!program_of(f, 1, out.c)) {
        report.skip(rule.id, Skip::WrongDim);
        return false;
    }
    const expr::LiftResult lifted = expr::lift(out.c);
    if (!lifted.ok()) {
        report.skip(rule.id, Skip::BadGradient);
        return false;
    }
    const expr::RuleDims dims{w, rule};
    for (std::uint8_t lane = 0; lane < out.dim; ++lane) {
        const expr::DiffResult d = expr::differentiate(lifted.ast, POS_FIELD, lane, dims);
        if (!d.ok()) {
            report.skip(rule.id, Skip::BadGradient);
            return false;
        }
        expr::CompileResult c = expr::compile(d.ast, dims);
        if (!c.ok() || c.program.dim != 1) {
            report.skip(rule.id, Skip::BadGradient);
            return false;
        }
        out.grad.push_back(std::move(c.program));
    }
    const Field* alpha = find_field(rule, COMPLIANCE_FIELD);
    out.alpha = (alpha != nullptr && alpha->dim == 1 && !alpha->bound) ? alpha->value[0] : fx64{};
    return true;
}

// A space's metric prepared for the integrator: g (dim-N) and d g / d
// self.pos.lane per lane (each dim-N), compiled on the Space note.
struct MetricLaw {
    SpaceId space;
    std::uint8_t dim = 0;
    expr::Program g;
    std::vector<expr::Program> grad;
};

// Lifts, differentiates and compiles the gradient of `f` (a Space note's
// bound `metric`); false with the reason reported on the space.
bool prepare_metric(const World& w, const Note& space, const Field& f, Reporter& report, MetricLaw& out) {
    out.space = space_of(space.id);
    out.dim = w.space_dim(out.space);
    if (out.dim == 0 || !program_of(f, out.dim, out.g)) {
        report.skip(space.id, Skip::BadMetric);
        return false;
    }
    const expr::LiftResult lifted = expr::lift(out.g);
    if (!lifted.ok()) {
        report.skip(space.id, Skip::BadMetric);
        return false;
    }
    // The space note's own `pos` has the space dim, so WorldDims on it
    // resolves `self.pos` exactly as ms_compile did when binding.
    const expr::WorldDims dims{w, space};
    for (std::uint8_t lane = 0; lane < out.dim; ++lane) {
        const expr::DiffResult d = expr::differentiate(lifted.ast, POS_FIELD, lane, dims);
        if (!d.ok()) {
            report.skip(space.id, Skip::BadMetric);
            return false;
        }
        expr::CompileResult c = expr::compile(d.ast, dims);
        if (!c.ok() || c.program.dim != out.dim) {
            report.skip(space.id, Skip::BadMetric);
            return false;
        }
        out.grad.push_back(std::move(c.program));
    }
    return true;
}

// Adds the geodesic acceleration of `law` at `self` to `vel` (see the
// header comment). False, with nothing changed, when g or a gradient
// fails to evaluate (reported) or the chart is degenerate there.
bool geodesic_correction(const World& w, const MetricLaw& law, const Note& self, Reporter& report, Field& vel) {
    expr::Lanes g{};
    expr::VmError err = expr::eval(law.g, w, self, nullptr, g);
    if (err != expr::VmError::Ok) {
        report.skip(w.find_space(law.space)->id, err);
        return false;
    }
    std::vector<expr::Lanes> jac(law.dim); // jac[i][k] = d g_kk / d pos_i
    for (std::uint8_t i = 0; i < law.dim; ++i) {
        err = expr::eval(law.grad[i], w, self, nullptr, jac[i]);
        if (err != expr::VmError::Ok) {
            report.skip(w.find_space(law.space)->id, err);
            return false;
        }
    }
    for (std::uint8_t k = 0; k < law.dim; ++k) {
        if (g[k].raw < MS_METRIC_EPS_RAW) {
            return false;
        }
    }
    const expr::Lanes v = vel.value;
    expr::Lanes a{};
    for (std::uint8_t k = 0; k < law.dim; ++k) {
        fx64 grad_dot_v{};
        fx64 sum_dk_gii_vi2{};
        for (std::uint8_t i = 0; i < law.dim; ++i) {
            grad_dot_v += jac[i][k] * v[i];
            sum_dk_gii_vi2 += jac[k][i] * v[i] * v[i];
        }
        const fx64 two = fx64::from_int(2);
        a[k] = -(two * v[k] * grad_dot_v - sum_dk_gii_vi2) / (two * g[k]);
    }
    for (std::uint8_t k = 0; k < law.dim; ++k) {
        vel.value[k] += a[k];
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
    case Skip::BadGradient: return "BadGradient";
    case Skip::BadMetric: return "BadMetric";
    case Skip::BadIdentify: return "BadIdentify";
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
    // pos before the integrator, indexed like `notes`, for the velocity
    // derivation after the constraint passes.
    std::vector<expr::Lanes> prev(notes.size());
    for (std::size_t i = 0; i < notes.size(); ++i) {
        if (const Field* pos = find_field(notes[i], POS_FIELD)) {
            prev[i] = pos->value;
        }
    }
    // Metric spaces, in space id order (World::notes is sorted).
    std::vector<MetricLaw> metrics;
    for (const Note& space : notes) {
        if (space.kind != NoteKind::Space) {
            continue;
        }
        const Field* m = find_field(space, METRIC_FIELD);
        if (m == nullptr || !m->bound) {
            continue;
        }
        MetricLaw law;
        if (prepare_metric(*this, space, *m, report, law)) {
            metrics.push_back(std::move(law));
        }
    }
    auto metric_of = [&](SpaceId space) -> const MetricLaw* {
        for (const MetricLaw& law : metrics) {
            if (law.space == space) {
                return &law;
            }
        }
        return nullptr;
    };
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
        if (const MetricLaw* law = metric_of(n.space)) {
            geodesic_correction(*this, *law, n, report, *vel);
        }
        for (std::uint8_t lane = 0; lane < pos->dim; ++lane) {
            pos->value[lane] += vel->value[lane];
        }
    }
    std::vector<ConstraintRule> constraints;
    for (std::size_t r = 0; r < notes.size(); ++r) {
        const Note& rule = notes[r];
        if (rule.kind != NoteKind::Rule) {
            continue;
        }
        const Field* f = find_field(rule, CONSTRAINT_FIELD);
        if (f == nullptr || !f->bound) {
            continue;
        }
        ConstraintRule cr;
        cr.index = r;
        if (prepare_constraint(*this, rule, *f, report, cr)) {
            constraints.push_back(std::move(cr));
        }
    }
    for (std::uint32_t pass = 0; pass < MS_CONSTRAINT_ITERATIONS && !constraints.empty(); ++pass) {
        for (ConstraintRule& cr : constraints) {
            if (!cr.alive) {
                continue;
            }
            const Note& rule = notes[cr.index];
            cr.alive = for_each_target(*this, rule, report, [&](std::size_t i, const Note& self, const Note* other) {
                const fx64 w_self = inv_mass_of(self);
                if (w_self.raw == 0) {
                    return; // pinned (RULE-08) or massless: nothing to move
                }
                expr::Lanes c{};
                expr::VmError err = expr::eval(cr.c, *this, self, other, c);
                if (err != expr::VmError::Ok) {
                    report.skip(rule.id, err);
                    return;
                }
                expr::Lanes g{};
                fx64 g2{};
                for (std::uint8_t lane = 0; lane < cr.dim; ++lane) {
                    expr::Lanes out{};
                    err = expr::eval(cr.grad[lane], *this, self, other, out);
                    if (err != expr::VmError::Ok) {
                        report.skip(rule.id, err);
                        return;
                    }
                    g[lane] = out[0];
                    g2 += out[0] * out[0];
                }
                const fx64 w_other = other != nullptr ? inv_mass_of(*other) : fx64{};
                const fx64 denom = (w_self + w_other) * g2 + cr.alpha;
                if (denom.raw < MS_CONSTRAINT_EPS_RAW) {
                    return;
                }
                const fx64 dlambda = -c[0] / denom;
                Field* pos = find_field(notes[i], POS_FIELD);
                for (std::uint8_t lane = 0; lane < cr.dim; ++lane) {
                    pos->value[lane] += w_self * dlambda * g[lane];
                }
            });
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
        for (std::uint8_t lane = 0; lane < pos->dim; ++lane) {
            vel->value[lane] = pos->value[lane] - prev[i][lane];
        }
    }
    // Identified spaces (world.hpp IDENTIFY_FIELD), space id order: wrap
    // every Note-kind note's pos lane k with L_k > 0 into [-L_k, L_k).
    // The velocity above is already derived, so a wrap never shows up
    // as a jump in it.
    for (const Note& space : notes) {
        if (space.kind != NoteKind::Space) {
            continue;
        }
        const Field* ident = find_field(space, IDENTIFY_FIELD);
        if (ident == nullptr) {
            continue;
        }
        const SpaceId sid = space_of(space.id);
        const std::uint8_t dim = space_dim(sid);
        if (ident->dim != dim) {
            report.skip(space.id, Skip::BadIdentify);
            continue;
        }
        for (Note& n : notes) {
            if (n.kind != NoteKind::Note || n.space != sid) {
                continue;
            }
            Field* pos = find_field(n, POS_FIELD);
            if (pos == nullptr || pos->dim != dim) {
                continue;
            }
            for (std::uint8_t lane = 0; lane < dim; ++lane) {
                const fx64 half = ident->value[lane];
                if (half.raw <= 0) {
                    continue;
                }
                const fx64 period = half + half;
                const fx64 turns = fx64::from_int(((pos->value[lane] + half) / period).floor_to_int());
                pos->value[lane] -= period * turns;
            }
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
        // A View's `project` (like a rule's law) runs against other notes
        // as `self`, on demand from the renderer (ms_project), never here:
        // rendering never enters the hash.
        if (n.kind == NoteKind::Rule || n.kind == NoteKind::View) {
            continue;
        }
        for (Field& f : n.fields) {
            if (!f.bound) {
                continue;
            }
            // A Space's `metric` is a law over its notes, not a value of
            // the space (the integrator evaluates it per note above).
            if (n.kind == NoteKind::Space && f.name == METRIC_FIELD) {
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
