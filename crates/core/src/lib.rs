//! The Tapestry core: keys in, world history and gap report out.
//!
//! Authors write keys; cause keys start things; rules carry them forward;
//! state keys hold and get checked (log 0007). [`simulate`] is a pure
//! function of the keys and the rulebook, recomputed in full on every edit
//! (log 0008). No I/O, no threads, no hash-map iteration (log 0002).

mod key;
mod rule;
mod simulate;
mod time;
mod world;

pub use key::{Act, Body, Cause, Key, KeyId, Source, When};
pub use rule::{Effect, Rejection, Rule, Rulebook};
pub use simulate::{Change, Gap, History, Outcome, Why, simulate};
pub use time::Time;
pub use world::{Id, Value, World};
