// mathspace/rng.hpp — seeded randomness only.
//
// xoshiro256** seeded through splitmix64 (Vigna / Blackman reference code,
// public domain), transcribed as written: no standard-library engine, no
// standard-library distribution, so the same seed gives the same sequence on every
// libc++ and in Wasm. The four state words are part of the canonical byte
// walk, so the generator's state is hashed even though no Phase 1 rule
// draws from it.
//
// Streams: seed_stream(world_seed, purpose_tag, entity_id) fills the state
// from splitmix64 run on world_seed ^ purpose_tag ^ entity_id, so an entity's
// randomness never depends on how many other entities drew before it
// (PITFALLS pitfall 4). seed_stream(seed, 0, 0) is the sim's own stream.
//
// Range mapping is project-owned as well: uniform_fx is the top 32 bits of
// one output as a Q32.32 fraction in [0, 1); range_u32 is Lemire's
// multiply-shift, (uint32(next) * n) >> 32, which is in [0, n) for n > 0.
// All arithmetic is on unsigned 64-bit values, where wrap-around is defined.
#pragma once

#include "mathspace/fx64.hpp"

#include <cstdint>

namespace ddsim {

// Reserved stream purpose for Phase 2's settle rule ("SETTLE" as big-endian
// ASCII in the top bytes); unused in Phase 1, reserved now so the tag set is
// part of the version pin story from the start.
inline constexpr std::uint64_t DD_PURPOSE_SETTLE = 0x5345544c45000000ull;

inline constexpr std::uint64_t splitmix64(std::uint64_t& x) {
    std::uint64_t z = (x += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

inline constexpr std::uint64_t rotl(std::uint64_t x, int k) {
    return (x << k) | (x >> (64 - k));
}

struct Xoshiro256ss {
    std::uint64_t s[4] = {0, 0, 0, 0};

    // Fill the state from a 64-bit seed with four splitmix64 outputs, as the
    // reference implementation recommends; the result is never all zero.
    constexpr void seed_from(std::uint64_t seed) {
        std::uint64_t x = seed;
        s[0] = splitmix64(x);
        s[1] = splitmix64(x);
        s[2] = splitmix64(x);
        s[3] = splitmix64(x);
    }

    // The reference xoshiro256** step, verbatim.
    constexpr std::uint64_t next() {
        const std::uint64_t result = rotl(s[1] * 5, 7) * 9;
        const std::uint64_t t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = rotl(s[3], 45);
        return result;
    }
};

inline constexpr Xoshiro256ss seed_stream(std::uint64_t world_seed, std::uint64_t purpose_tag, std::uint64_t entity_id) {
    Xoshiro256ss g;
    g.seed_from(world_seed ^ purpose_tag ^ entity_id);
    return g;
}

// Q32.32 fraction in [0, 1): the top 32 bits of one output.
inline constexpr fx64 uniform_fx(Xoshiro256ss& g) {
    return fx64::from_raw(static_cast<std::int64_t>(g.next() >> 32));
}

// Lemire multiply-shift onto [0, n); n == 0 yields 0 (nothing to choose from).
inline constexpr std::uint32_t range_u32(Xoshiro256ss& g, std::uint32_t n) {
    const std::uint64_t r = static_cast<std::uint32_t>(g.next());
    return static_cast<std::uint32_t>((r * n) >> 32);
}

} // namespace ddsim
