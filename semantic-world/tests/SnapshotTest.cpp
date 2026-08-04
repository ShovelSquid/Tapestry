#include "snapshots/Snapshot.hpp"
#include "snapshots/SnapshotStore.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace sw;

TEST_CASE("Snapshots record the versions that produced them",
    "[snapshot][versioning]") {
    const Snapshot snapshot {};

    // A snapshot without material and rule versions cannot be trusted for
    // restore, so the fields exist from the start.
    REQUIRE(snapshot.materialLibraryVersion == 0);
    REQUIRE(snapshot.rulePipelineVersion == 0);
    REQUIRE(SnapshotStore::kDefaultInterval == 1000);
}

TEST_CASE("Replay from a snapshot matches replay from tick zero",
    "[.pending][snapshot][phase6]") {
    SUCCEED("Phase 6: restore nearest snapshot, replay forward, compare hashes");
}

TEST_CASE("Scrubbing backward and forward is exact",
    "[.pending][snapshot][phase6]") {
    SUCCEED("Phase 6: scrub to ticks 250/500/750/1000 and compare hashes");
}
