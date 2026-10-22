//! A vault is a folder of plain `.md` notes that Obsidian can open too.
//!
//! This crate reads such a folder and writes back to it without ever
//! corrupting a note. Each folder is a graph and each note is a card on it;
//! a card's place (`x`, `y`, `w`, `h`) lives in the note's own YAML
//! frontmatter, next to whatever else the user keeps there, and every byte
//! the app does not own is left exactly as it was.
//!
//! There is no UI here and no network. Reading is pure: `scan` walks the
//! folder without touching it, `frontmatter` parses and splices text, and
//! `index` builds a snapshot the app can draw. Writing has one door:
//! every change goes through `store::Store`, which writes atomically and
//! records what happened in the vault's journal so growth can be replayed.

pub mod frontmatter;
pub mod links;
pub mod index;
pub mod journal;
pub mod scan;
pub mod store;
pub mod time;

pub use frontmatter::LayoutPatch;
pub use index::VaultIndex;
pub use scan::{Scan, scan};
pub use store::{Outcome, Store, VaultCmd, WriteError};
