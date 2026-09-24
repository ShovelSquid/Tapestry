#include "kernel/Time.hpp"

#include <charconv>
#include <chrono>

namespace tapestry::kernel {
namespace {

constexpr std::int64_t kSecondsPerDay = 86400;

bool isDigit(char c) { return c >= '0' && c <= '9'; }

bool allDigits(std::string_view s) {
    if (s.empty()) {
        return false;
    }
    for (const char c : s) {
        if (!isDigit(c)) {
            return false;
        }
    }
    return true;
}

// Digits-only field to a number. Callers check allDigits() first, and no
// field is wider than a few digits, so this cannot overflow.
std::int64_t digitsValue(std::string_view s) {
    std::int64_t value = 0;
    for (const char c : s) {
        value = value * 10 + (c - '0');
    }
    return value;
}

bool isLeapYear(std::int64_t year) {
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

std::int64_t daysInMonth(std::int64_t year, std::int64_t month) {
    switch (month) {
    case 2: return isLeapYear(year) ? 29 : 28;
    case 4: case 6: case 9: case 11: return 30;
    default: return 31;
    }
}

// Proleptic Gregorian calendar <-> days since 1970-01-01, after Howard
// Hinnant's public-domain algorithms. Exact for every int64 day count the
// kernel will ever see; no gmtime, no time zone, no libc calendar.
std::int64_t daysFromCivil(std::int64_t year, std::int64_t month, std::int64_t day) {
    year -= (month <= 2) ? 1 : 0;
    const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
    const std::int64_t yearOfEra = year - era * 400;                       // [0, 399]
    const std::int64_t monthFromMarch = (month + 9) % 12;                  // March = 0
    const std::int64_t dayOfYear = (153 * monthFromMarch + 2) / 5 + day - 1; // [0, 365]
    const std::int64_t dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
    return era * 146097 + dayOfEra - 719468;
}

struct Civil {
    std::int64_t year;
    std::int64_t month;
    std::int64_t day;
};

Civil civilFromDays(std::int64_t days) {
    days += 719468;
    const std::int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const std::int64_t dayOfEra = days - era * 146097;                     // [0, 146096]
    const std::int64_t yearOfEra =
        (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
    const std::int64_t dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
    const std::int64_t monthFromMarch = (5 * dayOfYear + 2) / 153;         // [0, 11]
    const std::int64_t day = dayOfYear - (153 * monthFromMarch + 2) / 5 + 1;
    const std::int64_t month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
    const std::int64_t year = yearOfEra + era * 400 + ((month <= 2) ? 1 : 0);
    return {year, month, day};
}

// Zero-padded decimal, at least `width` digits, no locale, no printf.
void appendPadded(std::string& out, std::int64_t value, std::size_t width) {
    if (value < 0) {
        out += '-';
        value = -value;
    }
    char buffer[24];
    const auto result = std::to_chars(buffer, buffer + sizeof buffer, value);
    const auto length = static_cast<std::size_t>(result.ptr - buffer);
    for (std::size_t i = length; i < width; ++i) {
        out += '0';
    }
    out.append(buffer, result.ptr);
}

// --- event-time grammar --------------------------------------------------

struct YearField {
    bool unspecified = false;
    std::int64_t value = 0;
};

// Exactly four characters: one or more digits followed only by X's.
std::optional<YearField> parseYearField(std::string_view s) {
    if (s.size() != 4) {
        return std::nullopt;
    }
    std::size_t digits = 0;
    while (digits < s.size() && isDigit(s[digits])) {
        ++digits;
    }
    if (digits == 0) {
        return std::nullopt;
    }
    for (std::size_t i = digits; i < s.size(); ++i) {
        if (s[i] != 'X') {
            return std::nullopt;
        }
    }
    YearField field;
    field.unspecified = digits < s.size();
    field.value = field.unspecified ? 0 : digitsValue(s);
    return field;
}

// HH:MM:SS followed by Z or a +HH:MM / -HH:MM offset.
bool isTimeWithZone(std::string_view t) {
    if (t.size() < 9) {
        return false;
    }
    const std::string_view hms = t.substr(0, 8);
    const std::string_view zone = t.substr(8);
    if (hms[2] != ':' || hms[5] != ':') {
        return false;
    }
    const std::string_view hh = hms.substr(0, 2);
    const std::string_view mm = hms.substr(3, 2);
    const std::string_view ss = hms.substr(6, 2);
    if (!allDigits(hh) || !allDigits(mm) || !allDigits(ss)) {
        return false;
    }
    if (digitsValue(hh) > 23 || digitsValue(mm) > 59 || digitsValue(ss) > 59) {
        return false;
    }
    if (zone == "Z") {
        return true;
    }
    if (zone.size() != 6 || (zone[0] != '+' && zone[0] != '-') || zone[3] != ':') {
        return false;
    }
    const std::string_view zh = zone.substr(1, 2);
    const std::string_view zm = zone.substr(4, 2);
    return allDigits(zh) && allDigits(zm) && digitsValue(zh) <= 23 && digitsValue(zm) <= 59;
}

// One date (or date-time when allowed) with no qualifier suffix.
bool isSingleDate(std::string_view s, bool allowTime) {
    if (s.empty()) {
        return false;
    }
    // Y17000 / Y-17000: five or more digit years, nothing else attached.
    if (s[0] == 'Y') {
        std::string_view rest = s.substr(1);
        if (!rest.empty() && rest[0] == '-') {
            rest.remove_prefix(1);
        }
        return rest.size() >= 5 && allDigits(rest);
    }
    if (s[0] == '-') {
        s.remove_prefix(1); // negative year
    }

    std::string_view datePart = s;
    std::string_view timePart;
    bool hasTime = false;
    if (const auto t = s.find('T'); t != std::string_view::npos) {
        if (!allowTime) {
            return false;
        }
        datePart = s.substr(0, t);
        timePart = s.substr(t + 1);
        hasTime = true;
    }

    // Split YYYY[-MM[-DD]] on '-': one to three non-empty components.
    std::string_view parts[3];
    std::size_t count = 0;
    while (true) {
        const auto dash = datePart.find('-');
        const std::string_view part = datePart.substr(0, dash);
        if (part.empty() || count == 3) {
            return false;
        }
        parts[count++] = part;
        if (dash == std::string_view::npos) {
            break;
        }
        datePart.remove_prefix(dash + 1);
    }

    const auto year = parseYearField(parts[0]);
    if (!year) {
        return false;
    }
    // Unspecified digits run right to left: an X in the year leaves no room
    // for a month.
    if (year->unspecified && count > 1) {
        return false;
    }

    bool monthUnspecified = false;
    bool season = false;
    std::int64_t month = 0;
    if (count >= 2) {
        const std::string_view m = parts[1];
        if (m.size() != 2) {
            return false;
        }
        if (m == "XX") {
            monthUnspecified = true;
        } else if (!allDigits(m)) {
            return false;
        } else {
            month = digitsValue(m);
            if (month >= 21 && month <= 24) {
                season = true;
            } else if (month < 1 || month > 12) {
                return false;
            }
        }
    }

    bool dayUnspecified = false;
    if (count == 3) {
        const std::string_view d = parts[2];
        if (season || d.size() != 2) {
            return false;
        }
        if (d == "XX") {
            dayUnspecified = true;
        } else if (monthUnspecified || !allDigits(d)) {
            return false;
        } else {
            const std::int64_t day = digitsValue(d);
            // With the year known, February is checked against the real
            // leap rule; a leap year stands in when the year is unknown.
            const std::int64_t calendarYear = year->unspecified ? 2000 : year->value;
            if (day < 1 || day > daysInMonth(calendarYear, month)) {
                return false;
            }
        }
    }

    if (hasTime) {
        if (count != 3 || year->unspecified || monthUnspecified || dayUnspecified || season) {
            return false;
        }
        return isTimeWithZone(timePart);
    }
    return true;
}

// A single date with an optional trailing ? ~ % qualifier (dates only, not
// date-times).
bool isQualifiedDate(std::string_view s, bool allowTime) {
    if (!s.empty() && (s.back() == '?' || s.back() == '~' || s.back() == '%')) {
        s.remove_suffix(1);
        if (s.find('T') != std::string_view::npos) {
            return false;
        }
    }
    return isSingleDate(s, allowTime);
}

} // namespace

std::string RecordedAt::rfc3339Z() const {
    std::int64_t days = unixSeconds / kSecondsPerDay;
    std::int64_t secondOfDay = unixSeconds % kSecondsPerDay;
    if (secondOfDay < 0) {
        secondOfDay += kSecondsPerDay;
        --days;
    }
    const Civil civil = civilFromDays(days);

    std::string out;
    out.reserve(20);
    appendPadded(out, civil.year, 4);
    out += '-';
    appendPadded(out, civil.month, 2);
    out += '-';
    appendPadded(out, civil.day, 2);
    out += 'T';
    appendPadded(out, secondOfDay / 3600, 2);
    out += ':';
    appendPadded(out, (secondOfDay / 60) % 60, 2);
    out += ':';
    appendPadded(out, secondOfDay % 60, 2);
    out += 'Z';
    return out;
}

std::optional<RecordedAt> RecordedAt::parse(std::string_view text) {
    // YYYY-MM-DDTHH:MM:SSZ — twenty characters, every position fixed.
    if (text.size() != 20 || text[4] != '-' || text[7] != '-' || text[10] != 'T'
        || text[13] != ':' || text[16] != ':' || text[19] != 'Z') {
        return std::nullopt;
    }
    const std::string_view fields[] = {text.substr(0, 4), text.substr(5, 2), text.substr(8, 2),
        text.substr(11, 2), text.substr(14, 2), text.substr(17, 2)};
    for (const std::string_view field : fields) {
        if (!allDigits(field)) {
            return std::nullopt;
        }
    }
    const std::int64_t year = digitsValue(fields[0]);
    const std::int64_t month = digitsValue(fields[1]);
    const std::int64_t day = digitsValue(fields[2]);
    const std::int64_t hour = digitsValue(fields[3]);
    const std::int64_t minute = digitsValue(fields[4]);
    const std::int64_t second = digitsValue(fields[5]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23
        || minute > 59 || second > 59) {
        return std::nullopt;
    }
    const std::int64_t days = daysFromCivil(year, month, day);
    return RecordedAt{days * kSecondsPerDay + hour * 3600 + minute * 60 + second};
}

bool isValidEventTime(std::string_view text) {
    if (text.empty()) {
        return false;
    }
    const auto slash = text.find('/');
    if (slash == std::string_view::npos) {
        return isQualifiedDate(text, true);
    }
    // An interval: two ends, each a date, an open end (..) or an unknown end
    // (empty). Both ends missing says nothing and is rejected.
    const std::string_view start = text.substr(0, slash);
    const std::string_view finish = text.substr(slash + 1);
    if (finish.find('/') != std::string_view::npos) {
        return false;
    }
    const bool startMissing = start.empty() || start == "..";
    const bool finishMissing = finish.empty() || finish == "..";
    if (startMissing && finishMissing) {
        return false;
    }
    if (!startMissing && !isQualifiedDate(start, false)) {
        return false;
    }
    if (!finishMissing && !isQualifiedDate(finish, false)) {
        return false;
    }
    return true;
}

RecordedAt SystemClock::now() {
    const auto sinceEpoch = std::chrono::system_clock::now().time_since_epoch();
    return RecordedAt{
        static_cast<std::int64_t>(std::chrono::duration_cast<std::chrono::seconds>(sinceEpoch).count())};
}

} // namespace tapestry::kernel
