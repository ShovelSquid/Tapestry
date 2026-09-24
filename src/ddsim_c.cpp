// ddsim_c.cpp — the flat C ABI. Every function is a forward into Sim with a
// null and length check; no validation lives here.
#include "ddsim/ddsim_c.h"

#include "ddsim/action.hpp"
#include "ddsim/sim.hpp"
#include "ddsim/state.hpp"

#include <cstdint>
#include <cstring>
#include <new>
#include <vector>

struct dd_sim {
    ddsim::Sim sim;
    explicit dd_sim(std::uint64_t seed) : sim(seed) {}
};

extern "C" {

uint32_t dd_version(void) { return ddsim::DD_SIM_VERSION; }

dd_sim* dd_create(uint64_t seed) { return new (std::nothrow) dd_sim(seed); }

void dd_destroy(dd_sim* sim) { delete sim; }

int dd_apply(dd_sim* sim, const uint8_t* action, uint32_t len) {
    if (sim == nullptr || action == nullptr || len < ddsim::DD_ACTION_HEADER_BYTES) {
        return DD_ERR_BAD_HEADER;
    }
    return sim->sim.apply(action, len);
}

void dd_step(dd_sim* sim) {
    if (sim != nullptr) {
        sim->sim.step();
    }
}

uint64_t dd_tick(const dd_sim* sim) { return sim == nullptr ? 0 : sim->sim.tick(); }

void dd_hash(const dd_sim* sim, uint8_t out[32]) {
    if (sim == nullptr || out == nullptr) {
        return;
    }
    sim->sim.hash(out);
}

uint32_t dd_serialize(const dd_sim* sim, uint8_t* out, uint32_t cap) {
    if (sim == nullptr) {
        return 0;
    }
    const std::vector<std::uint8_t> bytes = sim->sim.serialize();
    const uint32_t needed = static_cast<uint32_t>(bytes.size());
    if (cap == 0) {
        return needed;
    }
    if (out == nullptr || cap < needed) {
        return 0;
    }
    std::memcpy(out, bytes.data(), needed);
    return needed;
}

int dd_restore(dd_sim* sim, const uint8_t* in, uint32_t len) {
    if (sim == nullptr || in == nullptr) {
        return DD_ERR_RESTORE;
    }
    return sim->sim.restore(in, len);
}

const uint8_t* dd_nodes_ptr(const dd_sim* sim) { return sim == nullptr ? nullptr : sim->sim.node_bytes().data(); }

uint32_t dd_node_count(const dd_sim* sim) {
    return sim == nullptr ? 0 : static_cast<uint32_t>(sim->sim.state().nodes.size());
}

uint32_t dd_node_stride(void) { return DD_NODE_STRIDE; }

const uint8_t* dd_body_ptr(const dd_sim* sim) { return sim == nullptr ? nullptr : sim->sim.body_bytes().data(); }

uint32_t dd_body_count(const dd_sim* sim) {
    return sim == nullptr ? 0 : static_cast<uint32_t>(sim->sim.state().strokes.size());
}

uint32_t dd_body_stride(void) { return DD_BODY_STRIDE; }

} // extern "C"
