// mathspace/fx64.hpp — the only numeric type in the authoritative state.
//
// Q32.32 on a signed 64-bit integer: value = raw / 2^32, range +/-2.1e9,
// resolution 2.3e-10.
//
// ROUNDING RULE — the one rule, used everywhere: every operation truncates
// toward negative infinity (floor). Shifts do this by construction (C++20
// guarantees that >> on a negative signed value is an arithmetic shift);
// mul_q32 keeps bits 32..95 of the exact 128-bit product, which is a floor;
// div_q32 is floor(a * 2^32 / b) exactly; sqrt is floor(sqrt(raw * 2^32)).
// There is no round-half-anything anywhere in the sim. Debug and Release run
// the same integer instruction sequence, so they cannot disagree.
//
// No 128-bit integer type appears in this header (the test reads the file
// and checks): the multiply is four 32x32->64 partial products (Hacker's
// Delight mulhs), so the native and the Wasm build execute the same
// operations instead of one of them routing through a compiler-rt helper.
// Every preset compiles with -fwrapv so wrap-around is defined; the helpers
// below are nevertheless written so that no signed intermediate overflows
// (the UBSan preset runs all of them).
//
// Contract violations — division by zero, sqrt of a negative — return 0 in
// every build (never undefined, never build-dependent) and additionally trip
// an assert in Debug.
//
// Construction from any floating-point type is deleted through a constrained
// template. The forbidden-token gate (cmake/forbidden_tokens.cmake) scans this
// header for the two floating-point type keywords, so the deletion cannot name
// them; the constraint rejects every such type, including the extended one.
// A value enters only through from_int, from_raw or from_q16 (the ABI widening
// of an int32 Q16.16 plane unit).
#pragma once

#include <cassert>
#include <cstdint>
#include <type_traits>

#define DDSIM_ASSERT(cond) assert(cond)

namespace ddsim {

// (a * b) >> 32, exact floor of the 128-bit product, from four 32x32->64
// partial products. Low halves are unsigned 32-bit, high halves are signed
// via arithmetic shift; the low 64 bits of the product come from a wrapping
// unsigned multiply. Result = low 32 of the high word | high 32 of the low
// word. No signed intermediate can overflow: |a1 * b0| < 2^63 - 2^32.
constexpr std::int64_t mul_q32(std::int64_t a, std::int64_t b) {
    const std::uint64_t a0 = static_cast<std::uint32_t>(a);
    const std::uint64_t b0 = static_cast<std::uint32_t>(b);
    const std::int64_t a1 = a >> 32;
    const std::int64_t b1 = b >> 32;
    const std::uint64_t w0 = a0 * b0;
    const std::int64_t t = a1 * static_cast<std::int64_t>(b0) + static_cast<std::int64_t>(w0 >> 32);
    std::int64_t w1 = static_cast<std::int64_t>(static_cast<std::uint32_t>(t));
    const std::int64_t w2 = t >> 32;
    w1 += static_cast<std::int64_t>(a0) * b1;
    const std::int64_t hi = a1 * b1 + w2 + (w1 >> 32);
    const std::uint64_t lo = static_cast<std::uint64_t>(a) * static_cast<std::uint64_t>(b);
    return static_cast<std::int64_t>((static_cast<std::uint64_t>(hi) << 32) | (lo >> 32));
}

// floor(a * 2^32 / b), exact. Shift-subtract long division of the 96-bit
// magnitude |a| << 32 (two 64-bit words) by |b|, a fixed 96 iterations; the
// sign is applied afterwards and, when the signs differ and the remainder is
// non-zero, one is subtracted so the result is the floor rather than the
// truncation. Quotient bits above 63 wrap away, exactly as a 128-bit oracle
// truncated to 64 bits would. b == 0 returns 0 in every build.
constexpr std::int64_t div_q32(std::int64_t a, std::int64_t b) {
    DDSIM_ASSERT(b != 0);
    if (b == 0) {
        return 0;
    }
    const bool negative = (a < 0) != (b < 0);
    const std::uint64_t ua = a < 0 ? (std::uint64_t{0} - static_cast<std::uint64_t>(a)) : static_cast<std::uint64_t>(a);
    const std::uint64_t ub = b < 0 ? (std::uint64_t{0} - static_cast<std::uint64_t>(b)) : static_cast<std::uint64_t>(b);
    const std::uint64_t nhi = ua >> 32;
    const std::uint64_t nlo = ua << 32;
    std::uint64_t rem = 0;
    std::uint64_t quo = 0;
    for (unsigned i = 96; i-- > 0;) {
        const std::uint64_t bit = i >= 64 ? ((nhi >> (i - 64)) & 1u) : ((nlo >> i) & 1u);
        rem = (rem << 1) | bit;  // rem < ub <= 2^63 before the shift, so this cannot wrap
        quo <<= 1;
        if (rem >= ub) {
            rem -= ub;
            quo |= 1u;
        }
    }
    if (!negative) {
        return static_cast<std::int64_t>(quo);
    }
    const std::uint64_t adjust = rem != 0 ? 1u : 0u;
    return static_cast<std::int64_t>(std::uint64_t{0} - quo - adjust);
}

// floor(sqrt(x)): restoring digit-by-digit binary square root, a fixed 32
// iterations (two input bits per output bit). The remainder before a step is
// at most 2 * root, so 4 * rem + 3 < 2^36 and a single word holds it.
constexpr std::uint64_t isqrt64(std::uint64_t x) {
    std::uint64_t root = 0;
    std::uint64_t rem = 0;
    for (unsigned i = 0; i < 32; ++i) {
        rem = (rem << 2) | (x >> 62);
        x <<= 2;
        root <<= 1;
        const std::uint64_t trial = (root << 1) | 1u;  // 4p + 1 for the previous root p
        if (rem >= trial) {
            rem -= trial;
            root |= 1u;
        }
    }
    return root;
}

// floor(sqrt(hi:lo)): the same method over two words, a fixed 64
// iterations. The remainder before a step is at most 2 * root (65 bits), so
// after the shift it needs 67 bits and is kept as two words (rh:rl), rh <= 7.
constexpr std::uint64_t isqrt128(std::uint64_t hi, std::uint64_t lo) {
    std::uint64_t root = 0;
    std::uint64_t rh = 0;
    std::uint64_t rl = 0;
    for (unsigned i = 0; i < 64; ++i) {
        const std::uint64_t top = hi >> 62;
        hi = (hi << 2) | (lo >> 62);
        lo <<= 2;
        rh = (rh << 2) | (rl >> 62);
        rl = (rl << 2) | top;
        root <<= 1;
        const std::uint64_t th = root >> 63;               // trial = 4p + 1, up to 65 bits
        const std::uint64_t tl = (root << 1) | 1u;
        if (rh > th || (rh == th && rl >= tl)) {
            const std::uint64_t borrow = rl < tl ? 1u : 0u;
            rl -= tl;
            rh -= th + borrow;
            root |= 1u;
        }
    }
    return root;
}

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
    friend constexpr fx64 operator-(fx64 a) { return from_raw(std::int64_t{0} - a.raw); }
    friend constexpr fx64 operator*(fx64 a, fx64 b) { return from_raw(mul_q32(a.raw, b.raw)); }
    friend constexpr fx64 operator/(fx64 a, fx64 b) { return from_raw(div_q32(a.raw, b.raw)); }
    constexpr fx64& operator+=(fx64 b) { raw += b.raw; return *this; }
    constexpr fx64& operator-=(fx64 b) { raw -= b.raw; return *this; }
    constexpr fx64& operator*=(fx64 b) { raw = mul_q32(raw, b.raw); return *this; }
    constexpr fx64& operator/=(fx64 b) { raw = div_q32(raw, b.raw); return *this; }

    friend constexpr bool operator==(fx64 a, fx64 b) { return a.raw == b.raw; }
    friend constexpr bool operator!=(fx64 a, fx64 b) { return a.raw != b.raw; }
    friend constexpr bool operator<(fx64 a, fx64 b) { return a.raw < b.raw; }
    friend constexpr bool operator<=(fx64 a, fx64 b) { return a.raw <= b.raw; }
    friend constexpr bool operator>(fx64 a, fx64 b) { return a.raw > b.raw; }
    friend constexpr bool operator>=(fx64 a, fx64 b) { return a.raw >= b.raw; }
};

// floor(sqrt(x)) in Q32.32: isqrt of the 96-bit value raw * 2^32. A negative
// input yields exactly 0 in every build, and asserts in Debug.
constexpr fx64 sqrt(fx64 x) {
    DDSIM_ASSERT(x.raw >= 0);
    if (x.raw < 0) {
        return fx64::from_raw(0);
    }
    const std::uint64_t r = static_cast<std::uint64_t>(x.raw);
    return fx64::from_raw(static_cast<std::int64_t>(isqrt128(r >> 32, r << 32)));
}

// |x|; the negation runs in unsigned arithmetic so INT64_MIN maps to itself
// with no signed overflow (there is no representable positive counterpart).
constexpr fx64 abs(fx64 x) {
    return x.raw < 0 ? fx64::from_raw(static_cast<std::int64_t>(std::uint64_t{0} - static_cast<std::uint64_t>(x.raw))) : x;
}

constexpr fx64 min(fx64 a, fx64 b) { return b < a ? b : a; }
constexpr fx64 max(fx64 a, fx64 b) { return a < b ? b : a; }
constexpr fx64 clamp(fx64 v, fx64 lo, fx64 hi) { return v < lo ? lo : (hi < v ? hi : v); }

// a + (b - a) * t, floor at the multiply like every other product.
constexpr fx64 lerp(fx64 a, fx64 b, fx64 t) { return a + (b - a) * t; }

} // namespace ddsim
