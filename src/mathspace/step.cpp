// mathspace/step.cpp — World::step: the tick and the bootstrap rule.
//
// Phase 1 has one rule compiled in so that something moves before the
// rule engine of phase 3 exists: for every note in id order that has both
// `pos` and `velocity` at the same dim, `pos += velocity` lane by lane
// with fx64's wrapping add. A note missing either field, or holding them
// at different dims, is left alone; the rule never creates fields. Space
// notes are not excluded (nothing forbids a space from drifting), and a
// bound field's stored lanes are integrated like any other's, since
// bound evaluation does not exist yet. The rule's version is pinned in
// the hash walk (version.hpp), so the goldens catch any change here.
#include "mathspace/world.hpp"

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
    ++tick;
    notes_dirty = true;
}

} // namespace mathspace
