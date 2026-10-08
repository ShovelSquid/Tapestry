use crate::{Id, Time, Value};
use std::collections::BTreeMap;
use std::fmt;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct KeyId(pub String);

impl fmt::Display for KeyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A single authored statement, and the only way anything enters the world (spec §6).
#[derive(Clone, Debug)]
pub struct Key {
    pub id: KeyId,
    pub when: When,
    pub body: Body,
    pub source: Source,
}

/// Placement in time (spec §6.2).
#[derive(Clone, Debug)]
pub enum When {
    At(Time),
    /// The whole span. Used by rule keys.
    Always,
    /// Only ordered relative to other keys. Takes no part in simulation until placed.
    Unplaced {
        after: Vec<KeyId>,
        before: Vec<KeyId>,
    },
}

#[derive(Clone, Debug)]
pub enum Body {
    /// Something acts. The engine never asks what caused a cause key (log 0007).
    Cause(Cause),
    /// Something is true. It holds, and is checked against the simulation (log 0007).
    State {
        point: Id,
        property: String,
        value: Value,
    },
    /// A law is in effect, by name.
    Rule { rule: String },
}

#[derive(Clone, Debug)]
pub enum Cause {
    /// An agent does something. Active rules decide what it does to the world.
    Act(Act),
    /// The author sets a value directly. Legal, and recorded as fiat.
    Fiat {
        point: Id,
        property: String,
        value: Value,
    },
}

#[derive(Clone, Debug)]
pub struct Act {
    pub actor: Id,
    pub verb: String,
    pub args: BTreeMap<String, Value>,
}

impl Act {
    pub fn new(actor: &str, verb: &str) -> Self {
        Self {
            actor: actor.into(),
            verb: verb.to_owned(),
            args: BTreeMap::new(),
        }
    }

    pub fn with(mut self, name: &str, value: Value) -> Self {
        self.args.insert(name.to_owned(), value);
        self
    }

    pub fn arg(&self, name: &str) -> Option<&Value> {
        self.args.get(name)
    }
}

/// Where a key came from (principle 9).
#[derive(Clone, Debug, Default)]
pub struct Source {
    /// Who wrote it: `world`, `player`, `author`, `companion:narrator`, ...
    pub author: String,
    /// The words it came from, if any.
    pub text: Option<String>,
}

impl Source {
    pub fn new(author: &str, text: &str) -> Self {
        Self {
            author: author.to_owned(),
            text: Some(text.to_owned()),
        }
    }
}
