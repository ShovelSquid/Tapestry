//! A canvas you paint with particles that keep living after you paint them.
//!
//! Everything you do is a keyframe: a stroke of some material at a moment, or
//! a rule note switched on or off at a moment. The canvas at any tick is what
//! those keyframes produce, replayed from the start (spec principle 5: store
//! inputs only). Scrubbing, undo, and "who made this" all fall out of that.
//!
//! Materials have a nature (ink blots and dries, water falls and pools, trees
//! sway and settle, fire burns its fuel). How materials act on *each other*
//! is never built in: it comes from rule notes written in the basic rules
//! (log 0009), and a note that says nothing definite does nothing.

mod grid;
mod key;
mod link;
mod mimic;
pub(crate) mod mind;
mod rules;
mod sim;
pub(crate) mod text;
mod timeline;

#[cfg(test)]
mod tests;

pub use key::{Body, Brush, DT, KeyId, Keyframe, Sample, Stroke, TICKS_PER_SECOND, Tick};
pub use link::{Link, PROPOSE_AFTER, STRONG};
pub use mimic::{Arm, Carried, Hold, Mimic, Proposal, Pulse, SEGS, Swarm, Verdict};
pub use mind::{N, Species, THINK, Vector, color as mind_color};
pub use text::{note_id, shared as shared_words, vector as note_vector};
pub use rules::{Basic, Becomes, Problem, Prop, RuleNote, Rulebook, grammar, is_rule_line};
pub use sim::{HEIGHT, MadeBy, Material, Particle, State, WIDTH};
pub use timeline::Timeline;
