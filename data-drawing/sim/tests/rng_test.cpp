// The PRNG is project code: same seed, same sequence, on every build.
#include "ddsim/fx64.hpp"
#include "ddsim/rng.hpp"

#include <doctest.h>

#include <cstdint>

namespace {

using ddsim::Xoshiro256ss;

TEST_CASE("rng: same seed gives the same first 10000 outputs across two instances") {
    Xoshiro256ss a = ddsim::seed_stream(42, 0, 0);
    Xoshiro256ss b = ddsim::seed_stream(42, 0, 0);
    Xoshiro256ss c;
    c.seed_from(42);
    int same = 0;
    for (int i = 0; i < 10000; ++i) {
        const std::uint64_t x = a.next();
        const std::uint64_t y = b.next();
        const std::uint64_t z = c.next();
        if (x == y && y == z) {
            ++same;
        }
    }
    CHECK(same == 10000);
    // And the state words themselves agree afterwards.
    for (int i = 0; i < 4; ++i) {
        CHECK(a.s[i] == b.s[i]);
    }
}

TEST_CASE("rng: streams for different entity ids differ within the first 4 outputs") {
    for (std::uint64_t world : {0ull, 1ull, 42ull, 0xffffffffffffffffull}) {
        for (std::uint64_t purpose : {0ull, ddsim::DD_PURPOSE_SETTLE}) {
            Xoshiro256ss base = ddsim::seed_stream(world, purpose, 0);
            std::uint64_t first[4];
            for (std::uint64_t& v : first) {
                v = base.next();
            }
            for (std::uint64_t entity = 1; entity <= 64; ++entity) {
                Xoshiro256ss other = ddsim::seed_stream(world, purpose, entity);
                bool differs = false;
                for (int i = 0; i < 4; ++i) {
                    if (other.next() != first[i]) {
                        differs = true;
                    }
                }
                CHECK_MESSAGE(differs, "world " << world << " entity " << entity);
            }
        }
    }
    // Purposes differ too, and a stream is a value: copying it forks the sequence.
    Xoshiro256ss p = ddsim::seed_stream(7, 0, 1);
    Xoshiro256ss q = ddsim::seed_stream(7, ddsim::DD_PURPOSE_SETTLE, 1);
    CHECK(p.next() != q.next());
    Xoshiro256ss copy = p;
    CHECK(copy.next() == p.next());
}

TEST_CASE("rng: an all-zero seed does not produce an all-zero state") {
    Xoshiro256ss g = ddsim::seed_stream(0, 0, 0);
    CHECK((g.s[0] | g.s[1] | g.s[2] | g.s[3]) != 0);
    // splitmix64 is a bijection on the counter, so the four words are distinct.
    CHECK(g.s[0] != g.s[1]);
    CHECK(g.s[1] != g.s[2]);
    CHECK(g.s[2] != g.s[3]);
    // The state never collapses to zero while drawing.
    for (int i = 0; i < 100000; ++i) {
        g.next();
    }
    CHECK((g.s[0] | g.s[1] | g.s[2] | g.s[3]) != 0);
}

TEST_CASE("rng: uniform_fx is at least 0 and below ONE for 1e5 draws") {
    Xoshiro256ss g = ddsim::seed_stream(99, 0, 0);
    int inRange = 0;
    std::int64_t lo = INT64_MAX;
    std::int64_t hi = INT64_MIN;
    for (int i = 0; i < 100000; ++i) {
        const ddsim::fx64 u = ddsim::uniform_fx(g);
        if (u.raw >= 0 && u.raw < ddsim::fx64::ONE) {
            ++inRange;
        }
        if (u.raw < lo) lo = u.raw;
        if (u.raw > hi) hi = u.raw;
    }
    CHECK(inRange == 100000);
    // The draws actually spread over the unit interval.
    CHECK(lo < ddsim::fx64::ONE / 1000);
    CHECK(hi > ddsim::fx64::ONE - ddsim::fx64::ONE / 1000);
}

TEST_CASE("rng: range_u32(n) is below n for n in 1 2 3 7 1000 65536 UINT32_MAX over 1e4 draws each and range_u32(0) == 0") {
    for (const std::uint32_t n : {1u, 2u, 3u, 7u, 1000u, 65536u, UINT32_MAX}) {
        Xoshiro256ss g = ddsim::seed_stream(5, 0, n);
        int inRange = 0;
        std::uint32_t maxSeen = 0;
        for (int i = 0; i < 10000; ++i) {
            const std::uint32_t v = ddsim::range_u32(g, n);
            if (v < n) {
                ++inRange;
            }
            if (v > maxSeen) maxSeen = v;
        }
        CHECK_MESSAGE(inRange == 10000, "n=" << n);
        if (n > 1) {
            CHECK_MESSAGE(maxSeen > 0, "n=" << n);  // not stuck at zero
        }
    }
    Xoshiro256ss g = ddsim::seed_stream(5, 0, 0);
    for (int i = 0; i < 100; ++i) {
        CHECK(ddsim::range_u32(g, 0) == 0);
    }
    // rotl is a rotation: rotating by 64 - k undoes rotating by k.
    CHECK(ddsim::rotl(ddsim::rotl(0x8000000000000001ull, 7), 57) == 0x8000000000000001ull);
    CHECK(ddsim::rotl(1, 63) == 0x8000000000000000ull);
}

TEST_CASE("rng: golden first output") {
    // Frozen on 2026-09-23 from the first run of this test. Regenerating it
    // is a deliberate act: a different value here means DD_RNG_VERSION must
    // change, because every hash that ever draws from the stream changes.
    constexpr std::uint64_t kFrozenFirst = 0x0bab45d9a0e3ae53ull;
    Xoshiro256ss g = ddsim::seed_stream(1234, 0, 0);
    const std::uint64_t first = g.next();
    CHECK_MESSAGE(first == kFrozenFirst, "seed_stream(1234, 0, 0).next() = 0x" << std::hex << first);
    CHECK(ddsim::DD_PURPOSE_SETTLE == 0x5345544c45000000ull);
}

} // namespace
