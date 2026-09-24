#pragma once

#include "mathspace/world.hpp"

#include <cstdint>
#include <vector>

namespace tapestry {

// The state behind one PageKind::Space page: a mathspace World and the
// action log that built it. mathspace keeps no journal (the action log is
// its API; mathspace/action.hpp), so the page keeps the whole log: the
// .tapestry baseline writes all of it and a delta writes only what was
// appended since the file last saw this page. The world is seeded with the
// page id so two space pages in one document never start identical.
//
// Only World::applySpaceAction appends to the log, so the log is always the
// exact sequence that produced `world`; replaying it into a fresh
// mathspace::World(pageId) reproduces the same hash.
struct SpaceState {
    std::uint64_t pageId = 0;
    mathspace::World world;
    std::vector<std::vector<std::uint8_t>> log;
};

} // namespace tapestry
