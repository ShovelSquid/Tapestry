// mathspace/snapshot.cpp — World::notes_bytes, the lazy snapshot.
//
// The plugin's run loop reads this after a batch of steps and diffs it
// against the image it built from the kernel, turning every changed lane
// into a `set` op for one kernel commit. So the record is exactly the
// values the kernel does not already know: per note in id order, the
// fields in name order with their first `dim` lanes as raw fx64. Layout
// is documented on the declaration in world.hpp.
//
// It is a separate walk from serialize() on purpose: serialize is the
// hashed, versioned, restorable form; this is a transient read-out that
// can change shape freely without touching the goldens. Rebuilding only
// when notes_dirty is set means a world that is stepped a thousand times
// between reads pays for one encode, and a rejected apply, which never
// reaches a mutator's write, leaves the cache untouched.
#include "mathspace/world.hpp"
#include "wire.hpp"

namespace mathspace {

const std::vector<std::uint8_t>& World::notes_bytes() const {
    if (!notes_dirty) {
        return notes_cache;
    }
    notes_cache.clear();
    for (const Note& n : notes) {
        wire::put_u64(notes_cache, n.id.value);
        wire::put_u8(notes_cache, static_cast<std::uint8_t>(n.fields.size()));
        for (const Field& f : n.fields) {
            wire::put_u8(notes_cache, static_cast<std::uint8_t>(f.name.size()));
            wire::put_bytes(notes_cache, f.name.data(), f.name.size());
            wire::put_u8(notes_cache, f.dim);
            for (std::uint8_t lane = 0; lane < f.dim; ++lane) {
                wire::put_fx(notes_cache, f.value[lane]);
            }
        }
    }
    notes_dirty = false;
    return notes_cache;
}

} // namespace mathspace
