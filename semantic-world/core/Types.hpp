#pragma once

#include <cstdint>

namespace sw {

using Tick = std::uint64_t;
using ParticleId = std::uint64_t;
using EntityId = std::uint64_t;
using MaterialId = std::uint32_t;
using WorldSeed = std::uint64_t;

using Sequence = std::uint64_t;
using SchemaVersion = std::uint32_t;

struct Vec2i {
    std::int32_t x {};
    std::int32_t y {};

    friend constexpr bool operator==(Vec2i, Vec2i) = default;

    constexpr Vec2i& operator+=(Vec2i rhs) {
        x += rhs.x;
        y += rhs.y;
        return *this;
    }

    constexpr Vec2i& operator-=(Vec2i rhs) {
        x -= rhs.x;
        y -= rhs.y;
        return *this;
    }
};

constexpr Vec2i operator+(Vec2i lhs, Vec2i rhs) { return lhs += rhs; }
constexpr Vec2i operator-(Vec2i lhs, Vec2i rhs) { return lhs -= rhs; }

// Reserved id meaning "nothing here". Real ids start at 1 so that a
// zero-initialised struct never accidentally refers to a live object.
inline constexpr ParticleId kInvalidParticleId = 0;
inline constexpr EntityId kInvalidEntityId = 0;
inline constexpr MaterialId kEmptyMaterial = 0;

} // namespace sw
