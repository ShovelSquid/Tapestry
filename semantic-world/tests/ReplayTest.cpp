#include "events/Event.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace sw;

TEST_CASE("Events carry everything replay needs", "[replay][events]") {
    const Event event {};

    REQUIRE(event.schemaVersion == 1);
    REQUIRE_FALSE(event.causalParent.has_value());
    REQUIRE_FALSE(event.affectedRegion.has_value());
}

// Phase 5 completion criteria, kept here as the target shape of the test.
TEST_CASE("Replay produces identical state", "[.pending][replay][phase5]") {
    SUCCEED("Phase 5: runSimulation(seed, events, tick) twice, compare hashes");
}

TEST_CASE("Earliest divergence tick is identified automatically",
    "[.pending][replay][phase5]") {
    SUCCEED("Phase 5: findFirstDivergence reports tick, subsystem, id");
}
