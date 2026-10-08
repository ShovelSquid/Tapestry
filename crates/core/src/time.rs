use num_rational::Ratio;
use std::fmt;

/// A moment inside a span: an exact rational, so spans can be subdivided
/// without limit and never drift (spec §8.4). `Ratio<i64>` for now; it can
/// grow to big integers behind this type.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Time(Ratio<i64>);

impl Time {
    pub const ZERO: Self = Self(Ratio::new_raw(0, 1));

    pub fn new(numer: i64, denom: i64) -> Self {
        Self(Ratio::new(numer, denom))
    }

    /// A whole step of the span's clock, such as a turn in the dungeon.
    pub fn at(n: i64) -> Self {
        Self(Ratio::from_integer(n))
    }

    pub fn to_f64(self) -> f64 {
        *self.0.numer() as f64 / *self.0.denom() as f64
    }
}

impl fmt::Display for Time {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if *self.0.denom() == 1 {
            write!(f, "@{}", self.0.numer())
        } else {
            write!(f, "@{}/{}", self.0.numer(), self.0.denom())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_and_ordered() {
        assert_eq!(Time::new(2, 4), Time::new(1, 2));
        assert!(Time::new(1, 3) < Time::new(1, 2));
        assert_eq!(Time::new(3, 6).to_string(), "@1/2");
        assert_eq!(Time::at(7).to_string(), "@7");
    }
}
