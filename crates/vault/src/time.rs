//! Wall-clock time as Unix milliseconds, and the `created:` date-time text.
//!
//! `created:` is written the way Obsidian documents a date-time property,
//! `2020-08-21T10:30:00`, in UTC with no suffix. The journal keeps exact
//! milliseconds, so the text form only has to be readable.

use std::time::{SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;

/// Milliseconds since 1970-01-01 UTC (0 if the clock is before the epoch).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// `ms` as `YYYY-MM-DDTHH:MM:SS` in UTC (sub-second part dropped).
pub fn iso_utc(ms: i64) -> String {
    let (days, rest) = (ms.div_euclid(DAY_MS), ms.rem_euclid(DAY_MS) / 1000);
    let (y, m, d) = civil(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Reads `YYYY-MM-DDTHH:MM:SS` or `YYYY-MM-DD` as UTC milliseconds.
pub fn parse_created(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date, clock) = match s.split_once('T') {
        Some((d, c)) => (d, Some(c)),
        None => (s, None),
    };
    let mut parts = date.split('-');
    let y: i64 = digits(parts.next()?, 4)?;
    let m: u32 = digits(parts.next()?, 2)? as u32;
    let d: u32 = digits(parts.next()?, 2)? as u32;
    if parts.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, m, d);
    // Reject dates like 2026-02-31 that would roll over.
    if civil(days) != (y, m, d) {
        return None;
    }
    let secs = match clock {
        None => 0,
        Some(c) => {
            let mut hms = c.split(':');
            let h = digits(hms.next()?, 2)?;
            let mi = digits(hms.next()?, 2)?;
            let se = digits(hms.next()?, 2)?;
            if hms.next().is_some() || h > 23 || mi > 59 || se > 59 {
                return None;
            }
            h * 3600 + mi * 60 + se
        }
    };
    Some(days * DAY_MS + secs * 1000)
}

/// Exactly `n` ASCII digits as a number.
fn digits(s: &str, n: usize) -> Option<i64> {
    if s.len() != n || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Days since 1970-01-01 to (year, month, day), after Howard Hinnant.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// (year, month, day) to days since 1970-01-01; the inverse of `civil`.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m = i64::from(m);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_734), (2026, 10, 8));
        assert_eq!(civil(11_016), (2000, 2, 29));
    }

    #[test]
    fn civil_round_trips() {
        for days in [-800_000, -1, 0, 1, 11_016, 20_734, 2_000_000] {
            let (y, m, d) = civil(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
    }

    #[test]
    fn iso_format() {
        assert_eq!(iso_utc(1_792_577_472_000), "2026-10-21T10:11:12");
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00");
    }

    #[test]
    fn parse_round_trip() {
        let ms = 1_792_577_472_000;
        assert_eq!(parse_created(&iso_utc(ms)), Some(ms));
        assert_eq!(parse_created("2026-10-01"), Some(1_790_812_800_000));
    }

    #[test]
    fn parse_rejects_junk() {
        for s in ["", "2026", "2026-13-01", "2026-02-31", "2026-10-01T25:00:00", "26-10-01", "2026-10-01T10:11", "yesterday"] {
            assert_eq!(parse_created(s), None, "{s:?}");
        }
    }
}
