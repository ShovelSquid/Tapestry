// ddsim/rng.hpp — seeded randomness only.
//
// xoshiro256** seeded through splitmix64 (Vigna / Blackman reference code,
// public domain). The four state words are part of the canonical byte walk,
// so the generator's state is hashed even though no Phase 1 rule draws from
// it. next() and per-entity streams arrive in 01-03.
#pragma once

#include <cstdint>

namespace ddsim {

inline constexpr std::uint64_t splitmix64(std::uint64_t& x) {
    std::uint64_t z = (x += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
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
};

} // namespace ddsim
