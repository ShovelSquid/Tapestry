use crate::{Act, Id, Value, World};
use std::collections::BTreeMap;

/// A deterministic law. Physics and meaning use the same form (principle 1).
///
/// In v0 rules handle verbs: given the world as it is and an act, a rule
/// either produces effects or says why the act can't happen (log 0008).
pub trait Rule {
    fn name(&self) -> &str;
    /// The verbs this rule gives meaning to.
    fn verbs(&self) -> &[&str];
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    pub point: Id,
    pub property: String,
    pub value: Value,
}

impl Effect {
    pub fn set(point: &Id, property: &str, value: Value) -> Self {
        Self {
            point: point.clone(),
            property: property.to_owned(),
            value,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Rejection {
    /// A parameter the act needs wasn't given ("bumped, but how hard?").
    Missing(String),
    /// The act can't happen in the world as it is, and why.
    Cannot(String),
}

/// Every rule a world may switch on, by name. Rule keys decide which are active.
#[derive(Default)]
pub struct Rulebook {
    rules: BTreeMap<String, Box<dyn Rule>>,
}

impl Rulebook {
    pub fn with(mut self, rule: impl Rule + 'static) -> Self {
        self.rules.insert(rule.name().to_owned(), Box::new(rule));
        self
    }

    pub fn get(&self, name: &str) -> Option<&dyn Rule> {
        self.rules.get(name).map(|r| r.as_ref())
    }
}
