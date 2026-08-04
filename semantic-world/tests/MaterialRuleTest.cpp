#include "materials/MaterialDefinition.hpp"

#include <catch2/catch_test_macros.hpp>

using namespace sw;

TEST_CASE("Material definitions default to inert", "[materials]") {
    const MaterialDefinition definition {};

    REQUIRE(definition.id == kEmptyMaterial);
    REQUIRE(definition.affectedByGravity == false);
    REQUIRE(definition.canFlow == false);
    REQUIRE(definition.immovable == false);
}

TEST_CASE("Changing a material definition changes behaviour",
    "[.pending][materials][phase2]") {
    SUCCEED("Phase 2: stone/sand/water definitions and library versioning");
}

TEST_CASE("Sand falls, water flows laterally, stone stays put",
    "[.pending][rules][phase3]") {
    SUCCEED("Phase 3: GravityRule, SandRule, WaterRule in a fixed order");
}
