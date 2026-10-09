//! Rule notes, written in the basic rules.
//!
//! A note is plain text plus what it compiles to. Today the compiled form is
//! written by hand next to the text; later the text is compiled (by a parser
//! or a companion) into the same basic rules. A note with nothing definite
//! in it compiles to nothing, and switching it on changes nothing.

use std::fmt;

use crate::sim::Material;

/// A property the basic rules can change and test.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prop {
    Heat,
    Wet,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Becomes {
    Material(Material),
    Gone,
}

/// The basic rules (log 0009). Only `change` and `convert` are needed so far;
/// set, spawn, move and remove join as notes call for them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Basic {
    /// While a `who` is within `radius` of any of `near`, its `prop` rises by
    /// `rate` per second.
    Change {
        who: Material,
        near: &'static [Material],
        radius: f32,
        prop: Prop,
        rate: f32,
    },
    /// When a `who`'s `prop` reaches `at` it becomes `to`. Each point's own
    /// threshold is `at` give or take `vary` of it, from its ID, so a crowd
    /// doesn't turn all at once and a replay turns exactly the same way.
    Convert {
        who: Material,
        prop: Prop,
        at: f32,
        vary: f32,
        to: Becomes,
    },
}

pub struct RuleNote {
    pub title: &'static str,
    pub text: &'static str,
    /// `None`: the note says nothing definite yet, so it does nothing.
    pub basics: Option<&'static [Basic]>,
    /// For an empty note, what's missing.
    pub missing: &'static str,
}

use Material::*;

pub const RULES: &[RuleNote] = &[
    RuleNote {
        title: "Fire spreads to trees",
        text: "A tree near fire heats up, and catches.",
        basics: Some(&[
            Basic::Change {
                who: Tree,
                near: &[Fire, Flame],
                radius: 18.0,
                prop: Prop::Heat,
                rate: 1.5,
            },
            Basic::Convert {
                who: Tree,
                prop: Prop::Heat,
                at: 1.0,
                vary: 0.6,
                to: Becomes::Material(Fire),
            },
        ]),
        missing: "",
    },
    RuleNote {
        title: "Water puts out fire",
        text: "Wet fire goes out, leaving ash.",
        basics: Some(&[
            Basic::Change {
                who: Fire,
                near: &[Water],
                radius: 11.0,
                prop: Prop::Wet,
                rate: 6.0,
            },
            Basic::Convert {
                who: Fire,
                prop: Prop::Wet,
                at: 0.3,
                vary: 0.0,
                to: Becomes::Material(Ash),
            },
            Basic::Change {
                who: Flame,
                near: &[Water],
                radius: 9.0,
                prop: Prop::Wet,
                rate: 60.0,
            },
            Basic::Convert {
                who: Flame,
                prop: Prop::Wet,
                at: 0.5,
                vary: 0.0,
                to: Becomes::Gone,
            },
        ]),
        missing: "",
    },
    RuleNote {
        title: "Water makes ink run",
        text: "Ink that water touches gets wet, and wet ink flows.",
        basics: Some(&[Basic::Change {
            who: Ink,
            near: &[Water],
            radius: 10.0,
            prop: Prop::Wet,
            rate: 3.0,
        }]),
        missing: "",
    },
    RuleNote {
        title: "Fire engulfs trees",
        text: "Fire engulfs trees.",
        basics: None,
        missing: "nothing says what engulfing does",
    },
];

impl fmt::Display for Prop {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Prop::Heat => "heat",
            Prop::Wet => "wet",
        })
    }
}

impl fmt::Display for Basic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Basic::Change {
                who,
                near,
                radius,
                prop,
                rate,
            } => {
                let near: Vec<_> = near.iter().map(|m| m.name()).collect();
                write!(
                    f,
                    "change: {} {prop} +{rate}/s within {radius} of {}",
                    who.name(),
                    near.join(" or ")
                )
            }
            Basic::Convert {
                who,
                prop,
                at,
                vary,
                to,
            } => {
                let to = match to {
                    Becomes::Material(m) => m.name(),
                    Becomes::Gone => "nothing",
                };
                write!(f, "convert: {} becomes {to} at {prop} {at}", who.name())?;
                if *vary > 0.0 {
                    write!(f, " (±{:.0}%)", vary * 100.0)?;
                }
                Ok(())
            }
        }
    }
}
