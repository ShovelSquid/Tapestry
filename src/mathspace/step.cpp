// mathspace/step.cpp — World::step: the tick, the bootstrap rule, and
// bound-field evaluation. Pinned as MS_STEP_VERSION (version.hpp).
//
// Phase 1's one rule is compiled in so that something moves before the
// rule engine of phase 3 exists: for every note in id order that has both
// `pos` and `velocity` at the same dim, `pos += velocity` lane by lane
// with fx64's wrapping add. A note missing either field, or holding them
// at different dims, is left alone; the rule never creates fields. Space
// notes are not excluded (nothing forbids a space from drifting).
//
// Then every bound field (phase 2) is evaluated: notes in id order,
// fields in name order, each against the world as it is at that moment,
// so a field can see this tick's integrated `pos` and the bound fields
// evaluated before it, and a bound field's stored lanes are what the
// snapshot shows. `other` is null here; pair rules come in phase 3. An
// evaluation error leaves the lanes as they were (phase 3 reports it on
// the node). The bytecode is decoded on every evaluation: set_field
// guarantees it decodes, and a program is small; a cache can come when
// a profile asks for one.
#include "mathspace/world.hpp"

#include "mathspace/expr/vm.hpp"

namespace mathspace {

void World::step() {
    for (Note& n : notes) {
        Field* pos = find_field(n, POS_FIELD);
        if (pos == nullptr) {
            continue;
        }
        const Field* vel = find_field(n, VELOCITY_FIELD);
        if (vel == nullptr || vel->dim != pos->dim) {
            continue;
        }
        for (std::uint8_t lane = 0; lane < pos->dim; ++lane) {
            pos->value[lane] += vel->value[lane];
        }
    }
    for (Note& n : notes) {
        for (Field& f : n.fields) {
            if (!f.bound) {
                continue;
            }
            expr::Program program;
            std::uint32_t where = 0;
            if (expr::decode(f.bytecode.data(), f.bytecode.size(), program, where) != expr::CompileError::Ok ||
                program.dim != f.dim) {
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
