// fx64 op set against integer oracles.
//
// The oracle is native 128-bit integer arithmetic (never a floating-point
// value), seeds come from splitmix64 (never <random>), so the harness can
// only certify results the sim itself could reproduce. The 128-bit cases are
// native-only; everything else runs in every native preset, including the
// sanitized one.
#include "ddsim/fx64.hpp"
#include "ddsim/rng.hpp"
#include "golden_support.hpp"

#include <doctest.h>

#include <csignal>
#include <cstdint>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

namespace {

using ddsim::fx64;

constexpr std::uint64_t kOracleSeed = 0x0123456789abcdefULL;

// Magnitude from the low 63 bits, sign chosen by the caller; INT64_MIN is
// added explicitly by the edge cases, so -m never overflows here.
std::int64_t shape(std::uint64_t u, bool negative) {
    const std::int64_t m = static_cast<std::int64_t>(u & 0x7fffffffffffffffULL);
    return negative ? -m : m;
}

TEST_CASE("fx64: the header holds no 128-bit integer type") {
    const std::string header = ddsim_test::readFile(std::string(DDSIM_GOLDEN_DIR) + "/../../include/mathspace/fx64.hpp");
    REQUIRE(!header.empty());
    CHECK(header.find("__int128") == std::string::npos);
    CHECK(header.find("mul_q32") != std::string::npos);
}

#if defined(__SIZEOF_INT128__)

using i128 = __int128;
using u128 = unsigned __int128;

std::int64_t oracle_mul(std::int64_t a, std::int64_t b) {
    return static_cast<std::int64_t>((static_cast<i128>(a) * static_cast<i128>(b)) >> 32);
}

std::int64_t oracle_div(std::int64_t a, std::int64_t b) {
    const i128 n = static_cast<i128>(a) * (static_cast<i128>(1) << 32);
    i128 q = n / b;
    const i128 r = n % b;
    if (r != 0 && ((r < 0) != (b < 0))) {
        q -= 1;
    }
    return static_cast<std::int64_t>(q);
}

TEST_CASE("fx64: mul_q32 matches __int128 oracle on 1e6 seeded pairs") {
    constexpr int N = 1000000;
    std::uint64_t x = kOracleSeed;
    int mismatches = 0;
    for (int i = 0; i < N; ++i) {
        std::uint64_t ua = ddsim::splitmix64(x);
        std::uint64_t ub = ddsim::splitmix64(x);
        if (i % 10 == 0) {  // a 10% share of small magnitudes
            ua &= 0xffffu;
            ub &= 0xfffffu;
        }
        const std::int64_t a = shape(ua, (i & 1) != 0);
        const std::int64_t b = shape(ub, (i & 2) != 0);
        if (ddsim::mul_q32(a, b) != oracle_mul(a, b)) {
            ++mismatches;
            if (mismatches < 4) {
                CHECK_MESSAGE(false, "a=" << a << " b=" << b << " got=" << ddsim::mul_q32(a, b) << " want=" << oracle_mul(a, b));
            }
        }
    }
    CHECK(mismatches == 0);
    MESSAGE("mul_q32 oracle: " << N << " iterations, " << mismatches << " mismatches");
}

TEST_CASE("fx64: mul edge cases") {
    constexpr std::int64_t MIN = INT64_MIN;
    constexpr std::int64_t MAX = INT64_MAX;
    const std::int64_t edges[] = {MIN, MIN + 1, -1, 0, 1, fx64::ONE, fx64::ONE - 1, -fx64::ONE, MAX, MAX - 1};
    for (const std::int64_t a : edges) {
        for (const std::int64_t b : edges) {
            CHECK_MESSAGE(ddsim::mul_q32(a, b) == oracle_mul(a, b), "a=" << a << " b=" << b);
            CHECK(ddsim::mul_q32(a, b) == ddsim::mul_q32(b, a));
        }
    }
    CHECK(ddsim::mul_q32(MIN, 1) == oracle_mul(MIN, 1));
    CHECK(ddsim::mul_q32(MIN, -1) == oracle_mul(MIN, -1));
    CHECK(ddsim::mul_q32(-1, -1) == oracle_mul(-1, -1));
    CHECK(ddsim::mul_q32(fx64::ONE, fx64::ONE) == fx64::ONE);
    CHECK(ddsim::mul_q32(-fx64::ONE, fx64::ONE) == -fx64::ONE);
    // -1 raw times -1 raw is +2^-64, which floors to 0.
    CHECK(ddsim::mul_q32(-1, -1) == 0);
    // x * ONE == x for 1000 seeded x, and the operator forms agree.
    std::uint64_t s = kOracleSeed ^ 0xa5a5a5a5a5a5a5a5ULL;
    for (int i = 0; i < 1000; ++i) {
        const std::int64_t xr = static_cast<std::int64_t>(ddsim::splitmix64(s));
        CHECK(ddsim::mul_q32(xr, fx64::ONE) == xr);
        CHECK((fx64::from_raw(xr) * fx64::from_int(1)).raw == xr);
    }
    static_assert((fx64::from_int(3) * fx64::from_int(-4)) == fx64::from_int(-12));
    static_assert(ddsim::mul_q32(fx64::ONE / 2, fx64::ONE / 2) == fx64::ONE / 4);
}

TEST_CASE("fx64: div_q32 equals floor((a<<32)/b) oracle") {
    constexpr int N = 100000;
    std::uint64_t x = kOracleSeed ^ 0x5555555555555555ULL;
    int mismatches = 0;
    int smallDivisor = 0;
    for (int i = 0; i < N; ++i) {
        std::uint64_t ua = ddsim::splitmix64(x);
        std::uint64_t ub = ddsim::splitmix64(x);
        switch (i % 5) {
        case 0: ub &= 0xffffu; break;                 // |b| << |a|
        case 1: ua &= 0xffffffffu; break;             // small numerator
        case 2: ua &= 0xffffu; ub &= 0xffffu; break;  // both small
        default: break;
        }
        std::int64_t a = shape(ua, (i & 1) != 0);
        std::int64_t b = shape(ub, (i & 2) != 0);
        if (b == 0) {
            b = 1;
        }
        if ((b < 0 ? std::uint64_t{0} - static_cast<std::uint64_t>(b) : static_cast<std::uint64_t>(b)) <
            (a < 0 ? std::uint64_t{0} - static_cast<std::uint64_t>(a) : static_cast<std::uint64_t>(a))) {
            ++smallDivisor;
        }
        if (ddsim::div_q32(a, b) != oracle_div(a, b)) {
            ++mismatches;
            if (mismatches < 4) {
                CHECK_MESSAGE(false, "a=" << a << " b=" << b << " got=" << ddsim::div_q32(a, b) << " want=" << oracle_div(a, b));
            }
        }
    }
    CHECK(mismatches == 0);
    CHECK(smallDivisor > N / 4);
    MESSAGE("div_q32 oracle: " << N << " iterations, " << smallDivisor << " with |b| < |a|");

    constexpr std::int64_t MIN = INT64_MIN;
    constexpr std::int64_t MAX = INT64_MAX;
    const std::int64_t edges[] = {MIN, MIN + 1, -fx64::ONE, -3, -2, -1, 1, 2, 3, fx64::ONE, fx64::ONE - 1, MAX};
    for (const std::int64_t a : edges) {
        for (const std::int64_t b : edges) {
            CHECK_MESSAGE(ddsim::div_q32(a, b) == oracle_div(a, b), "a=" << a << " b=" << b);
        }
    }
    // Floor, not truncation: -1/2 is -0.5, and -1 raw / ONE floors to -1 raw.
    CHECK((fx64::from_int(-1) / fx64::from_int(2)) == fx64::from_raw(-(fx64::ONE / 2)));
    CHECK(ddsim::div_q32(-1, fx64::ONE) == -1);
    CHECK(ddsim::div_q32(1, fx64::ONE) == 1);
    CHECK(ddsim::div_q32(-1, 2 * fx64::ONE) == -1);
    CHECK(ddsim::div_q32(1, 2 * fx64::ONE) == 0);
    static_assert((fx64::from_int(6) / fx64::from_int(3)) == fx64::from_int(2));
    static_assert((fx64::from_int(1) / fx64::from_int(4)) == fx64::from_raw(fx64::ONE / 4));
}

TEST_CASE("fx64: isqrt64/isqrt128 satisfy r*r <= x < (r+1)*(r+1)") {
    constexpr int N = 100000;
    std::uint64_t s = kOracleSeed ^ 0x3333333333333333ULL;
    int bad = 0;
    auto check64 = [&](std::uint64_t x) {
        const std::uint64_t r = ddsim::isqrt64(x);
        const u128 lo = static_cast<u128>(r) * r;
        const u128 hi = static_cast<u128>(r + 1) * (r + 1);
        if (!(lo <= x && x < hi)) {
            ++bad;
            if (bad < 4) {
                CHECK_MESSAGE(false, "isqrt64(" << x << ") = " << r);
            }
        }
    };
    auto check128 = [&](std::uint64_t hi, std::uint64_t lo) {
        const u128 x = (static_cast<u128>(hi) << 64) | lo;
        const std::uint64_t r = ddsim::isqrt128(hi, lo);
        const u128 sq = static_cast<u128>(r) * r;
        bool ok = sq <= x;
        if (r != UINT64_MAX) {
            ok = ok && x < static_cast<u128>(r + 1) * (r + 1);
        }
        if (!ok) {
            ++bad;
            if (bad < 4) {
                CHECK_MESSAGE(false, "isqrt128(" << hi << ":" << lo << ") = " << r);
            }
        }
        // The 64-bit form is the 128-bit form with an empty high word.
        if (hi == 0 && ddsim::isqrt64(lo) != r) {
            ++bad;
        }
    };
    for (int i = 0; i < N; ++i) {
        std::uint64_t x = ddsim::splitmix64(s);
        if (i % 4 == 0) {
            x >>= (i % 61);
        }
        check64(x);
        std::uint64_t hi = ddsim::splitmix64(s);
        if (i % 3 == 0) {
            hi = 0;
        } else if (i % 3 == 1) {
            hi >>= (i % 63);
        }
        check128(hi, x);
    }
    for (const std::uint64_t x : {0ull, 1ull, 2ull, 3ull, 4ull, 5ull, 8ull, 9ull, 15ull, 16ull, 17ull, UINT64_MAX, UINT64_MAX - 1}) {
        check64(x);
        check128(0, x);
        check128(x, 0);
        check128(x, x);
    }
    for (unsigned k = 0; k < 64; ++k) {
        check64(std::uint64_t{1} << k);
        check64((std::uint64_t{1} << k) - 1);
        check128(std::uint64_t{1} << k, 0);
        check128(0, std::uint64_t{1} << k);
        check128((std::uint64_t{1} << k) - 1, UINT64_MAX);
    }
    CHECK(bad == 0);
    CHECK(ddsim::isqrt64(UINT64_MAX) == 0xffffffffull);
    CHECK(ddsim::isqrt128(UINT64_MAX, UINT64_MAX) == UINT64_MAX);
    MESSAGE("isqrt oracle: " << N << " seeded inputs each for isqrt64 and isqrt128, " << bad << " bad");
}

#endif  // __SIZEOF_INT128__

TEST_CASE("fx64: div by zero returns 0") {
    // Runs the clamp in Release; in Debug the contract assert fires first,
    // so the same call is observed from a forked child whose abort proves it.
#if defined(NDEBUG)
    CHECK(ddsim::div_q32(fx64::ONE, 0) == 0);
    CHECK(ddsim::div_q32(-fx64::ONE, 0) == 0);
    CHECK(ddsim::div_q32(0, 0) == 0);
    CHECK((fx64::from_int(7) / fx64::from_int(0)).raw == 0);
#else
    const pid_t pid = fork();
    REQUIRE(pid >= 0);
    if (pid == 0) {
        std::signal(SIGABRT, SIG_DFL);  // not doctest's handler: the abort itself is the evidence
        const fx64 r = fx64::from_int(7) / fx64::from_int(0);
        _exit(r.raw == 0 ? 0 : 1);
    }
    int status = 0;
    REQUIRE(waitpid(pid, &status, 0) == pid);
    CHECK(WIFSIGNALED(status));
    CHECK(WTERMSIG(status) == SIGABRT);
#endif
}

TEST_CASE("fx64: sqrt(from_int(k*k)) == from_int(k)") {
    for (std::int32_t k = 0; k <= 1000; ++k) {
        CHECK_MESSAGE(ddsim::sqrt(fx64::from_int(k * k)) == fx64::from_int(k), "k=" << k);
    }
    // Between perfect squares the result floors: sqrt(2) = 1.4142135623...
    // is 6074000999 raw (floor(sqrt(2) * 2^32)), and sqrt(0.25) = 0.5 exactly.
    CHECK(ddsim::sqrt(fx64::from_int(2)).raw == 6074000999LL);
    CHECK(ddsim::sqrt(fx64::from_raw(fx64::ONE / 4)) == fx64::from_raw(fx64::ONE / 2));
    CHECK(ddsim::sqrt(fx64::from_raw(1)).raw == 65536);  // sqrt(2^-32) = 2^-16
    CHECK(ddsim::sqrt(fx64::from_raw(INT64_MAX)).raw == 199032864766430LL);  // floor(sqrt((2^63 - 1) * 2^32))
    static_assert(ddsim::sqrt(fx64::from_int(144)) == fx64::from_int(12));
    // A negative input yields 0 in every build; Debug additionally asserts.
#if defined(NDEBUG)
    CHECK(ddsim::sqrt(fx64::from_int(-1)).raw == 0);
    CHECK(ddsim::sqrt(fx64::from_raw(INT64_MIN)).raw == 0);
#else
    const pid_t pid = fork();
    REQUIRE(pid >= 0);
    if (pid == 0) {
        std::signal(SIGABRT, SIG_DFL);
        const fx64 r = ddsim::sqrt(fx64::from_int(-1));
        _exit(r.raw == 0 ? 0 : 1);
    }
    int status = 0;
    REQUIRE(waitpid(pid, &status, 0) == pid);
    CHECK(WIFSIGNALED(status));
    CHECK(WTERMSIG(status) == SIGABRT);
#endif
}

TEST_CASE("fx64: lerp endpoints and midpoint") {
    const fx64 a = fx64::from_int(-10);
    const fx64 b = fx64::from_int(30);
    CHECK(ddsim::lerp(a, b, fx64::from_raw(0)) == a);
    CHECK(ddsim::lerp(a, b, fx64::from_int(1)) == b);
    CHECK(ddsim::lerp(a, b, fx64::from_raw(fx64::ONE / 2)) == fx64::from_int(10));
    CHECK(ddsim::lerp(b, a, fx64::from_raw(fx64::ONE / 2)) == fx64::from_int(10));
    CHECK(ddsim::lerp(a, a, fx64::from_raw(fx64::ONE / 3)) == a);
    static_assert(ddsim::lerp(fx64::from_int(0), fx64::from_int(8), fx64::from_raw(fx64::ONE / 4)) == fx64::from_int(2));

    // abs / min / max / clamp, including the one value abs cannot negate.
    CHECK(ddsim::abs(fx64::from_int(-5)) == fx64::from_int(5));
    CHECK(ddsim::abs(fx64::from_int(5)) == fx64::from_int(5));
    CHECK(ddsim::abs(fx64::from_raw(INT64_MIN)).raw == INT64_MIN);
    CHECK(ddsim::min(a, b) == a);
    CHECK(ddsim::max(a, b) == b);
    CHECK(ddsim::clamp(fx64::from_int(50), a, b) == b);
    CHECK(ddsim::clamp(fx64::from_int(-50), a, b) == a);
    CHECK(ddsim::clamp(fx64::from_int(3), a, b) == fx64::from_int(3));
    fx64 v = fx64::from_int(6);
    v *= fx64::from_int(2);
    v /= fx64::from_int(4);
    CHECK(v == fx64::from_int(3));
}

} // namespace
