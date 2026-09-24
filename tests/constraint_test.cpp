// Particle and constraint actions (kinds 5, 6) and the constraint rule
// (rules/constraints.hpp): validation rejects, a rigid two-particle
// constraint settling at its rest length (the pendulum/hinge case), a
// three-particle chain staying within tolerance of both rest lengths (the
// rope case), determinism across two independent Sim instances, and the
// serialize/restore round trip with particles and constraints present.
#include "ddsim/action.hpp"
#include "ddsim/ddsim_c.h"
#include "ddsim/particle.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <cstdint>
#include <string>
#include <vector>

namespace {

using ddsim::fx64;
using ddsim::Sim;
using ddsim_test::encodeCreateConstraint;
using ddsim_test::encodeCreateParticle;
using ddsim_test::hex;

std::string hashHex(const Sim& sim) {
    std::uint8_t digest[32];
    sim.hash(digest);
    return hex(digest);
}

int applyBytes(Sim& sim, const std::vector<std::uint8_t>& a) {
    return sim.apply(a.data(), static_cast<std::uint32_t>(a.size()));
}

// A static anchor at the origin (id 1) and a dynamic particle of mass 1 at
// (rest, 0) (id 2), connected by a stiffness-1 constraint of that rest
// length. The setup every pendulum-shaped test starts from.
std::vector<std::uint8_t> anchorParticle() { return encodeCreateParticle(1, true, 0, 0, 0); }

std::vector<std::uint8_t> bobParticle(std::int64_t rest) { return encodeCreateParticle(2, false, fx64::ONE, rest, 0); }

std::vector<std::uint8_t> rigidConstraint(std::uint32_t id, std::uint32_t a, std::uint32_t b, std::int64_t rest) {
    return encodeCreateConstraint(id, a, b, rest, fx64::ONE);
}

fx64 distance(const ddsim::Particle& a, const ddsim::Particle& b) {
    const fx64 dx = b.x - a.x;
    const fx64 dy = b.y - a.y;
    return sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Validation rejects. Each case asserts the exact error code and that the
// hash is untouched, the same rule action_test.cpp follows for brushes.
// ---------------------------------------------------------------------------

TEST_CASE("particle: sequential ids only, out of order or duplicate is DD_ERR_PARTICLE_ID") {
    Sim sim(1);
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, encodeCreateParticle(2, true, 0, 0, 0)) == DD_ERR_PARTICLE_ID);
    CHECK(hashHex(sim) == before);
    REQUIRE(applyBytes(sim, encodeCreateParticle(1, true, 0, 0, 0)) == DD_OK);
    CHECK(applyBytes(sim, encodeCreateParticle(1, true, 0, 0, 0)) == DD_ERR_PARTICLE_ID);
}

TEST_CASE("particle: a dynamic particle needs mass > 0, a static one needs mass == 0") {
    Sim sim(1);
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, encodeCreateParticle(1, false, 0, 0, 0)) == DD_ERR_PARTICLE_INVALID);
    CHECK(applyBytes(sim, encodeCreateParticle(1, false, -fx64::ONE, 0, 0)) == DD_ERR_PARTICLE_INVALID);
    CHECK(applyBytes(sim, encodeCreateParticle(1, true, fx64::ONE, 0, 0)) == DD_ERR_PARTICLE_INVALID);
    CHECK(hashHex(sim) == before);
    CHECK(applyBytes(sim, encodeCreateParticle(1, false, fx64::ONE, 0, 0)) == DD_OK);
}

TEST_CASE("constraint: particle ids must exist, differ, and be sequential") {
    Sim sim(1);
    REQUIRE(applyBytes(sim, anchorParticle()) == DD_OK);
    REQUIRE(applyBytes(sim, bobParticle(fx64::ONE * 2)) == DD_OK);
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, encodeCreateConstraint(1, 1, 3, fx64::ONE * 2, fx64::ONE)) == DD_ERR_PARTICLE_ID);
    CHECK(applyBytes(sim, encodeCreateConstraint(1, 1, 1, fx64::ONE * 2, fx64::ONE)) == DD_ERR_CONSTRAINT_INVALID);
    CHECK(applyBytes(sim, encodeCreateConstraint(2, 1, 2, fx64::ONE * 2, fx64::ONE)) == DD_ERR_CONSTRAINT_ID);
    CHECK(hashHex(sim) == before);
    REQUIRE(applyBytes(sim, encodeCreateConstraint(1, 1, 2, fx64::ONE * 2, fx64::ONE)) == DD_OK);
}

TEST_CASE("constraint: rest length must be non-negative and stiffness must be positive and at most 1") {
    Sim sim(1);
    REQUIRE(applyBytes(sim, anchorParticle()) == DD_OK);
    REQUIRE(applyBytes(sim, bobParticle(fx64::ONE * 2)) == DD_OK);
    const std::string before = hashHex(sim);
    CHECK(applyBytes(sim, encodeCreateConstraint(1, 1, 2, -fx64::ONE, fx64::ONE)) == DD_ERR_CONSTRAINT_INVALID);
    CHECK(applyBytes(sim, encodeCreateConstraint(1, 1, 2, fx64::ONE * 2, 0)) == DD_ERR_CONSTRAINT_INVALID);
    CHECK(applyBytes(sim, encodeCreateConstraint(1, 1, 2, fx64::ONE * 2, -fx64::ONE)) == DD_ERR_CONSTRAINT_INVALID);
    CHECK(applyBytes(sim, encodeCreateConstraint(1, 1, 2, fx64::ONE * 2, fx64::ONE * 2)) == DD_ERR_CONSTRAINT_INVALID);
    CHECK(hashHex(sim) == before);
    REQUIRE(applyBytes(sim, encodeCreateConstraint(1, 1, 2, fx64::ONE * 2, fx64::ONE)) == DD_OK);
}

// ---------------------------------------------------------------------------
// Behaviour.
// ---------------------------------------------------------------------------

TEST_CASE("constraint: a rigid pendulum stays at its rest length every tick under gravity") {
    Sim sim(1);
    const std::int64_t rest = fx64::ONE * 2;
    REQUIRE(applyBytes(sim, anchorParticle()) == DD_OK);
    REQUIRE(applyBytes(sim, bobParticle(rest)) == DD_OK);
    REQUIRE(applyBytes(sim, rigidConstraint(1, 1, 2, rest)) == DD_OK);

    const fx64 tol = fx64::from_raw(fx64::ONE >> 8);  // ~0.0039
    for (int t = 0; t < 300; ++t) {
        sim.step();
        REQUIRE(sim.state().particles.size() == 2);
        const fx64 d = distance(sim.state().particles[0], sim.state().particles[1]);
        CHECK_MESSAGE(ddsim::abs(d - fx64::from_raw(rest)) < tol, "tick " << (t + 1) << ": distance raw " << d.raw);
    }
    // Gravity did something: the bob is not still sitting where it started.
    CHECK(sim.state().particles[1].y != fx64::from_raw(0));
    // The anchor never moved.
    CHECK(sim.state().particles[0].x == fx64::from_raw(0));
    CHECK(sim.state().particles[0].y == fx64::from_raw(0));
}

TEST_CASE("constraint: a three-particle chain stays within tolerance of both rest lengths") {
    Sim sim(1);
    const std::int64_t rest = fx64::ONE * 2;
    REQUIRE(applyBytes(sim, encodeCreateParticle(1, true, 0, 0, 0)) == DD_OK);
    REQUIRE(applyBytes(sim, encodeCreateParticle(2, false, fx64::ONE, rest, 0)) == DD_OK);
    REQUIRE(applyBytes(sim, encodeCreateParticle(3, false, fx64::ONE, rest * 2, 0)) == DD_OK);
    REQUIRE(applyBytes(sim, rigidConstraint(1, 1, 2, rest)) == DD_OK);
    REQUIRE(applyBytes(sim, rigidConstraint(2, 2, 3, rest)) == DD_OK);

    const fx64 tol = fx64::from_raw(fx64::ONE >> 5);  // ~0.03: a chain needs more iterations to fully converge
    for (int t = 0; t < 300; ++t) {
        sim.step();
        REQUIRE(sim.state().particles.size() == 3);
        const fx64 d1 = distance(sim.state().particles[0], sim.state().particles[1]);
        const fx64 d2 = distance(sim.state().particles[1], sim.state().particles[2]);
        CHECK_MESSAGE(ddsim::abs(d1 - fx64::from_raw(rest)) < tol, "tick " << (t + 1) << " link 1: raw " << d1.raw);
        CHECK_MESSAGE(ddsim::abs(d2 - fx64::from_raw(rest)) < tol, "tick " << (t + 1) << " link 2: raw " << d2.raw);
    }
}

TEST_CASE("constraint: two independent sims replaying the same actions hash identically at every tick") {
    const std::int64_t rest = fx64::ONE * 2;
    std::vector<std::vector<std::uint8_t>> log = {anchorParticle(), bobParticle(rest), rigidConstraint(1, 1, 2, rest)};

    Sim a(7);
    Sim b(7);
    for (const auto& bytes : log) {
        REQUIRE(applyBytes(a, bytes) == DD_OK);
        REQUIRE(applyBytes(b, bytes) == DD_OK);
    }
    for (int t = 0; t < 200; ++t) {
        a.step();
        b.step();
        CHECK_MESSAGE(hashHex(a) == hashHex(b), "tick " << (t + 1));
    }
}

TEST_CASE("constraint: serialize/restore round trip preserves particles, constraints and their hash") {
    const std::int64_t rest = fx64::ONE * 2;
    Sim sim(3);
    REQUIRE(applyBytes(sim, anchorParticle()) == DD_OK);
    REQUIRE(applyBytes(sim, bobParticle(rest)) == DD_OK);
    REQUIRE(applyBytes(sim, rigidConstraint(1, 1, 2, rest)) == DD_OK);
    for (int t = 0; t < 50; ++t) {
        sim.step();
    }
    const std::string before = hashHex(sim);
    const std::vector<std::uint8_t> bytes = sim.serialize();

    Sim restored(99);
    REQUIRE(restored.restore(bytes.data(), static_cast<std::uint32_t>(bytes.size())) == DD_OK);
    CHECK(hashHex(restored) == before);
    CHECK(restored.serialize() == bytes);
    REQUIRE(restored.state().particles.size() == 2);
    REQUIRE(restored.state().constraints.size() == 1);
    CHECK(restored.state().particles[0].is_static == 1);
    CHECK(restored.state().particles[1].mass == fx64::from_raw(fx64::ONE));
    CHECK(restored.state().constraints[0].particle_a == 1);
    CHECK(restored.state().constraints[0].particle_b == 2);

    // And it keeps stepping identically to the live sim from here.
    for (int t = 0; t < 50; ++t) {
        sim.step();
        restored.step();
        CHECK(hashHex(sim) == hashHex(restored));
    }
}

} // namespace
