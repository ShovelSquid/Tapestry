#include "core/Particle.hpp"
#include "core/Types.hpp"

#include <catch2/catch_test_macros.hpp>

#include <type_traits>

using namespace sw;

// Phase 0 guards the properties the determinism work rests on: fixed-width
// integer state, value semantics, and no floating point anywhere in a particle.

TEST_CASE("Core state types have fixed widths", "[determinism][types]") {
    STATIC_REQUIRE(sizeof(Tick) == 8);
    STATIC_REQUIRE(sizeof(ParticleId) == 8);
    STATIC_REQUIRE(sizeof(EntityId) == 8);
    STATIC_REQUIRE(sizeof(MaterialId) == 4);
    STATIC_REQUIRE(sizeof(WorldSeed) == 8);
    STATIC_REQUIRE(sizeof(Vec2i) == 8);
}

TEST_CASE("Particle state contains no floating point", "[determinism][types]") {
    STATIC_REQUIRE(std::is_trivially_copyable_v<Particle>);
    STATIC_REQUIRE(std::is_standard_layout_v<Particle>);

    STATIC_REQUIRE_FALSE(std::is_floating_point_v<decltype(Particle::temperature)>);
    STATIC_REQUIRE_FALSE(std::is_floating_point_v<decltype(Vec2i::x)>);
}

TEST_CASE("Default-constructed particles are identical", "[determinism]") {
    const Particle a {};
    const Particle b {};

    REQUIRE(a == b);
    REQUIRE(a.id == kInvalidParticleId);
    REQUIRE(a.material == kEmptyMaterial);
}

TEST_CASE("Vec2i arithmetic is exact", "[determinism][types]") {
    constexpr Vec2i position {3, -7};
    constexpr Vec2i gravity {0, 1};

    STATIC_REQUIRE(position + gravity == Vec2i {3, -6});
    STATIC_REQUIRE(position - gravity == Vec2i {3, -8});
    STATIC_REQUIRE(position + gravity - gravity == position);
}

// Phase 1 replaces this with: two worlds built from the same seed hash equal.
TEST_CASE("Two worlds from the same seed have identical hashes",
    "[.pending][determinism][phase1]") {
    SUCCEED("Phase 1: World + hashWorld");
}
