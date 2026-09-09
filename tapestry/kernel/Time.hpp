#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace tapestry::kernel {

// When a commit was written down: the `recorded` line of a commit header.
// Whole seconds, UTC, always formatted as RFC 3339 with a `Z` suffix
// (2026-09-08T21:15:07Z). Audit information only — ordering comes from `seq`
// and `parent`, never from this stamp, because clocks tie and go backwards.
struct RecordedAt {
    std::int64_t unixSeconds = 0;

    // Proleptic Gregorian, no time zone, no gmtime: the same bytes on every
    // machine for the same instant.
    std::string rfc3339Z() const;

    // Accepts exactly the form rfc3339Z() writes. Fractional seconds, offsets
    // other than Z, and a lowercase z are rejected.
    static std::optional<RecordedAt> parse(std::string_view text);

    friend bool operator==(RecordedAt a, RecordedAt b) { return a.unixSeconds == b.unixSeconds; }
    friend bool operator!=(RecordedAt a, RecordedAt b) { return a.unixSeconds != b.unixSeconds; }
};

// When the thing happened: the value of a `time` property such as
// `set n1 event time 2026-09-07`. Kept as the user's string, so partial and
// uncertain dates stay readable; this validates it against a whitelist of
// EDTF Level 0 shapes plus the Level 1 subset below. Month and day ranges are
// calendar-checked wherever every digit is known.
//
// Accepted shapes (FORMAT.md copies this table):
//
//   Shape                          Example                     Level  Notes
//   YYYY                           2026                        0
//   YYYY-MM                        2026-09                     0      MM 01..12
//   YYYY-MM-DD                     2026-09-07                  0      day checked against month and leap year
//   YYYY-MM-DDTHH:MM:SSZ           2026-09-08T21:15:07Z        0      UTC
//   YYYY-MM-DDTHH:MM:SS+HH:MM      2026-09-08T21:15:07+02:00   0      +/- offset, HH 00..23, MM 00..59
//   date/date                      2004-06/2006-08             0      interval; each side a date shape, no time
//   date?  date~  date%            1984?  2004-06~  2004-06-11% 1     uncertain / approximate / both, suffix only
//   YYYX YYXX YXXX                 199X                        1      unspecified trailing year digits
//   YYYY-XX  YYYY-MM-XX  YYYY-XX-XX 1999-XX  1999-03-XX         1      unspecified month and/or day (whole component)
//   YYYY-SS (SS 21..24)            2001-21                     1      season: 21 spring, 22 summer, 23 autumn, 24 winter
//   -YYYY                          -0999                       1      negative year (year before 0000)
//   Y[-]DDDDD…                     Y17000  Y-17000             1      five or more digit year
//   ../date  date/..               ../1985  1985/..            1      open interval end
//   /date    date/                 /1985    1985/              1      unknown interval end
//
// Everything else is rejected: natural language, US ordering, a space instead
// of T, a time without a zone, out-of-range fields, and a bare empty string.
bool isValidEventTime(std::string_view text);

// The kernel reads the wall clock only through this interface, at commit
// time, so tests can pin `recorded` and the golden fixture never drifts.
class Clock {
public:
    virtual ~Clock() = default;
    virtual RecordedAt now() = 0;
};

// std::chrono::system_clock, truncated to whole seconds.
class SystemClock final : public Clock {
public:
    RecordedAt now() override;
};

// Returns whatever the test last stored in `at`.
class FixedClock final : public Clock {
public:
    RecordedAt at;

    RecordedAt now() override { return at; }
};

} // namespace tapestry::kernel
