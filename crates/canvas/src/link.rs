//! Links: who is connected to whom, and how strongly. These are the
//! swarm's real structure; tentacles only act them out.
//!
//! A link is made when one mimic takes hold of another. While held, it
//! learns: its weight moves toward how much more alike the two minds are
//! than two in the swarm usually are (Hebb's rule on what fires together,
//! measured against the swarm so it suits any set of notes, and kept
//! between 0 and 1). Let go,
//! it slowly fades, unless a tentacle takes it up again first; a strong link
//! is one its mimics keep going back to, which is the swarm's memory. One
//! that fades away is gone.
//!
//! A link between two note-carrying mimics that stays strong long enough is
//! a proposal: these two notes belong together. Keeping it pins it; turning
//! it down cuts it, and that pair is slow to link again.

use crate::key::Tick;
use crate::mind::{Vector, cosine};

/// Weight a new link starts at.
pub const BORN: f32 = 0.3;
/// Weight above which a link counts as strong.
pub const STRONG: f32 = 0.4;
/// Thoughts in a row (at six a second) a link must stay strong to be proposed.
pub const PROPOSE_AFTER: u32 = 60;
/// Below this, a link nobody holds is gone.
const GONE: f32 = 0.04;
/// How fast a held link learns, per thought.
const LEARN: f32 = 0.05;
/// How much a link nobody holds fades, per thought.
const FADE: f32 = 0.003;

#[derive(Clone, Debug)]
pub struct Link {
    /// The two mimics' ids, the smaller first.
    pub a: u64,
    pub b: u64,
    pub weight: f32,
    pub born: Tick,
    /// Thoughts in a row it has been strong.
    pub strong: u32,
    /// Kept by the author: it stays, at full weight.
    pub pinned: bool,
    /// How readily it learns: turned down once, a pair learns slowly.
    pub plasticity: f32,
    /// Its weight once a second, oldest first: the evidence for a proposal.
    pub history: [f32; 12],
}

impl Link {
    pub fn new(x: u64, y: u64, tick: Tick, plasticity: f32) -> Self {
        let (a, b) = pair(x, y);
        Self {
            a,
            b,
            weight: BORN,
            born: tick,
            strong: 0,
            pinned: false,
            plasticity,
            history: [0.0; 12],
        }
    }

    pub fn joins(&self, x: u64, y: u64) -> bool {
        (self.a, self.b) == pair(x, y)
    }

    pub fn has(&self, id: u64) -> bool {
        self.a == id || self.b == id
    }

    pub fn other(&self, id: u64) -> u64 {
        if self.a == id { self.b } else { self.a }
    }

    /// One thought's learning. `held`: a tentacle is acting it out.
    /// `typical` is how alike two minds in the swarm usually are (mean and
    /// spread): what counts is being more alike than that.
    pub(crate) fn learn(&mut self, sa: &Vector, sb: &Vector, held: bool, typical: (f32, f32)) {
        if self.pinned {
            self.weight = 1.0;
            return;
        }
        if held {
            let (mean, spread) = typical;
            let alike = ((cosine(sa, sb) - mean) / (2.5 * spread.max(0.02))).clamp(0.0, 1.0);
            self.weight += LEARN * self.plasticity * (alike - self.weight);
        } else {
            self.weight -= FADE;
        }
        self.weight = self.weight.clamp(0.0, 1.0);
        self.strong = if self.weight >= STRONG { self.strong + 1 } else { 0 };
    }

    pub(crate) fn gone(&self, held: bool) -> bool {
        !self.pinned && !held && self.weight < GONE
    }

    pub(crate) fn remember(&mut self) {
        self.history.rotate_left(1);
        self.history[self.history.len() - 1] = self.weight;
    }
}

/// Two ids in a fixed order, so a pair is the same pair either way round.
pub fn pair(x: u64, y: u64) -> (u64, u64) {
    if x < y { (x, y) } else { (y, x) }
}
