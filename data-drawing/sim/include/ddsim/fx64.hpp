// ddsim/fx64.hpp — the only numeric type in the authoritative state.
//
// Q32.32 on a signed 64-bit integer: value = raw / 2^32, range +/-2.1e9,
// resolution 2.3e-10. Every preset compiles with -fwrapv so wrap-around is
// defined, and C++20 guarantees that >> on a negative signed value is an
// arithmetic shift, so there is exactly one rounding rule in this type:
// truncate toward negative infinity.
//
// Construction from any floating-point type is deleted through a constrained
// template. The forbidden-token gate (cmake/forbidden_tokens.cmake) scans this
// header for the two floating-point type keywords, so the deletion cannot name
// them; the constraint rejects every such type, including the extended one.
// A value enters only through from_int, from_raw or from_q16 (the ABI widening
// of an int32 Q16.16 plane unit).
//
// Multiply, divide and sqrt arrive in 01-03 with their oracle tests.
#pragma once

#include <cstdint>
#include <type_traits>

namespace ddsim {

struct fx64 {
    std::int64_t raw = 0;

    static constexpr std::int64_t ONE = std::int64_t{1} << 32;

    constexpr fx64() = default;

    template <typename T, typename = std::enable_if_t<std::is_floating_point_v<T>>>
    fx64(T) = delete;

    static constexpr fx64 from_raw(std::int64_t r) {
        fx64 v;
        v.raw = r;
        return v;
    }
    static constexpr fx64 from_int(std::int32_t i) { return from_raw(std::int64_t{i} << 32); }
    static constexpr fx64 from_q16(std::int32_t q) { return from_raw(std::int64_t{q} << 16); }

    constexpr std::int32_t to_q16() const { return static_cast<std::int32_t>(raw >> 16); }
    constexpr std::int32_t floor_to_int() const { return static_cast<std::int32_t>(raw >> 32); }

    friend constexpr fx64 operator+(fx64 a, fx64 b) { return from_raw(a.raw + b.raw); }
    friend constexpr fx64 operator-(fx64 a, fx64 b) { return from_raw(a.raw - b.raw); }
    friend constexpr fx64 operator-(fx64 a) { return from_raw(-a.raw); }
    constexpr fx64& operator+=(fx64 b) { raw += b.raw; return *this; }
    constexpr fx64& operator-=(fx64 b) { raw -= b.raw; return *this; }

    friend constexpr bool operator==(fx64 a, fx64 b) { return a.raw == b.raw; }
    friend constexpr bool operator!=(fx64 a, fx64 b) { return a.raw != b.raw; }
    friend constexpr bool operator<(fx64 a, fx64 b) { return a.raw < b.raw; }
    friend constexpr bool operator<=(fx64 a, fx64 b) { return a.raw <= b.raw; }
    friend constexpr bool operator>(fx64 a, fx64 b) { return a.raw > b.raw; }
    friend constexpr bool operator>=(fx64 a, fx64 b) { return a.raw >= b.raw; }
};

} // namespace ddsim
