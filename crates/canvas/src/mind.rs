//! What a mimic has in mind: a few numbers, changed by what it's told.
//!
//! Each mimic keeps a state of [`N`] numbers. A few times a second (every
//! [`THINK`] ticks) it thinks: its state becomes a squashed mix of what it
//! was, what it's carrying (its input: a note's text, or for a mimic with
//! no note, a steady identity of its own), and the messages that reached it
//! along held tentacles since it last thought. Its colour is only a view of
//! that state, so mimics with similar states look alike.
//!
//! Species differ only in temper: how sociable, how clingy, how far they
//! roam, how readily they go back to old partners.

use crate::key::Tick;
use crate::sim::unit;

/// Numbers in a mimic's state, and in a note's vector.
pub const N: usize = 128;
pub type Vector = [f32; N];
/// Ticks between thoughts: six a second.
pub const THINK: Tick = 10;

/// How much of its last state a mimic keeps when it thinks.
const KEEP: f32 = 0.5;
/// How strongly what it carries speaks.
const INPUT: f32 = 1.5;

/// Squash into -1..1 without libm: x / (1 + |x|).
pub fn softsign(x: f32) -> f32 {
    x / (1.0 + x.abs())
}

pub fn dot(a: &Vector, b: &Vector) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// How alike two vectors point, -1..1 (0 if either is all zeros).
pub fn cosine(a: &Vector, b: &Vector) -> f32 {
    let d = (dot(a, a) * dot(b, b)).sqrt();
    if d < 1e-9 { 0.0 } else { (dot(a, b) / d).clamp(-1.0, 1.0) }
}

/// Scale to length 1 (all zeros stays zeros).
pub fn normalize(mut v: Vector) -> Vector {
    let len = dot(&v, &v).sqrt();
    if len > 1e-9 {
        for x in &mut v {
            *x /= len;
        }
    }
    v
}

/// A steady vector of length 1 for a mimic that carries no note.
pub fn identity(id: u64) -> Vector {
    let mut v = [0.0; N];
    for (d, x) in v.iter_mut().enumerate() {
        *x = unit(id, 500 + d as u64) * 2.0 - 1.0;
    }
    normalize(v)
}

/// One thought.
pub fn think(state: &Vector, input: &Vector, inbox: &Vector) -> Vector {
    let mut next = [0.0; N];
    for d in 0..N {
        next[d] = softsign(KEEP * state[d] + INPUT * input[d] + inbox[d]);
    }
    next
}

/// A state as a colour, red, green and blue 0..1: a fixed projection, so
/// similar states get similar colours.
pub fn color(state: &Vector) -> [f32; 3] {
    let mut c = [0.0; 3];
    for (k, out) in c.iter_mut().enumerate() {
        let mut x = 0.0;
        for (d, s) in state.iter().enumerate() {
            let sign = if unit(k as u64, 900 + d as u64) < 0.5 { -1.0 } else { 1.0 };
            x += sign * s;
        }
        *out = 0.5 + 0.5 * softsign(x * 1.2);
    }
    c
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Species {
    /// Middling at everything.
    Wanderer,
    /// Reaches for others often and holds on long.
    Binder,
    /// Roams far, holds briefly: it carries news between groups.
    Scout,
}

/// How a species behaves, as numbers the body uses.
#[derive(Clone, Copy, Debug)]
pub struct Temper {
    /// Chance, when an arm is free, of reaching for a mimic in range.
    pub social: f32,
    /// How long it holds on, as a multiple.
    pub hold: f32,
    /// How far away (in reaches) it notices mimics to head for.
    pub roam: f32,
    /// How readily it goes back to a partner it has a link with.
    pub recall: f32,
}

impl Species {
    pub fn of(id: u64) -> Self {
        match (unit(id, 6) * 10.0) as u32 {
            0..=4 => Species::Wanderer,
            5..=7 => Species::Binder,
            _ => Species::Scout,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Species::Wanderer => "wanderer",
            Species::Binder => "binder",
            Species::Scout => "scout",
        }
    }

    pub fn temper(self) -> Temper {
        match self {
            Species::Wanderer => Temper { social: 0.3, hold: 1.0, roam: 5.0, recall: 1.0 },
            Species::Binder => Temper { social: 0.5, hold: 1.6, roam: 3.0, recall: 1.5 },
            Species::Scout => Temper { social: 0.2, hold: 0.6, roam: 10.0, recall: 0.5 },
        }
    }
}
