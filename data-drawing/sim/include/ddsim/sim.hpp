// ddsim/sim.hpp — the simulation: apply, step, tick, hash, serialize, restore.
//
// apply() decodes into a local and commits only on DD_OK. step() advances
// the tick (rules land in 01-05) and rebuilds the snapshot byte buffers the
// C ABI hands out. hash() is SHA-256 over the canonical byte walk (hash.cpp);
// serialize() returns exactly those bytes and restore() is their strict
// inverse — any deviation is DD_ERR_RESTORE and the state is unchanged.
#pragma once

#include "ddsim/state.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace ddsim {

// hash.cpp — the one canonical byte walk, every field explicit little-endian.
void write_canonical(const State& s, std::vector<std::uint8_t>& out);
// Strict inverse of write_canonical: DD_OK, or DD_ERR_RESTORE with `out` untouched.
int read_canonical(const std::uint8_t* bytes, std::uint32_t len, State& out);
// SHA-256 over exactly the bytes given (PicoSHA2, behind this one TU).
void sha256_bytes(const std::uint8_t* bytes, std::size_t len, std::uint8_t out[32]);

class Sim {
public:
    explicit Sim(std::uint64_t seed);

    int apply(const std::uint8_t* action, std::uint32_t len);
    void step();
    std::uint64_t tick() const { return state_.tick; }
    void hash(std::uint8_t out[32]) const;
    std::vector<std::uint8_t> serialize() const;
    int restore(const std::uint8_t* bytes, std::uint32_t len);

    const State& state() const { return state_; }

    // Snapshot records for the ABI pointers; refreshed by apply() and step().
    const std::vector<std::uint8_t>& node_bytes() const { return node_bytes_; }
    const std::vector<std::uint8_t>& body_bytes() const { return body_bytes_; }

private:
    void refresh_snapshots();

    State state_;
    std::vector<std::uint8_t> node_bytes_;
    std::vector<std::uint8_t> body_bytes_;
};

} // namespace ddsim
