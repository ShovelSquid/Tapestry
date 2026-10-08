use crate::{Body, Cause, Id, Key, KeyId, Rejection, Rulebook, Time, Value, When, World};
use std::fmt;

/// Why a value changed. Every change records one, which is what makes the
/// world traceable (principle 9).
#[derive(Clone, Debug, PartialEq)]
pub enum Why {
    /// A cause key, carried by a rule.
    Rule { key: KeyId, rule: String },
    /// The author set it directly.
    Fiat(KeyId),
    /// A state key gave a value nobody had stated. Not a change of anything known (principle 5).
    FillIn(KeyId),
    /// A state key holds against what the rules produced (log 0007).
    Unexplained(KeyId),
}

impl Why {
    pub fn key(&self) -> &KeyId {
        match self {
            Self::Rule { key, .. }
            | Self::Fiat(key)
            | Self::FillIn(key)
            | Self::Unexplained(key) => key,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Change {
    pub time: Time,
    pub point: Id,
    pub property: String,
    pub before: Option<Value>,
    pub after: Value,
    pub why: Why,
}

/// Something the engine can't resolve from the keys it has (spec §9).
/// Reported, never ranked, never filled by the engine.
#[derive(Clone, Debug, PartialEq)]
pub enum Gap {
    /// A state key differs from a known value and nothing explains it. It holds anyway;
    /// `simulated` is the ghost, what the rules would have shown.
    Unexplained {
        key: KeyId,
        point: Id,
        property: String,
        simulated: Value,
        stated: Value,
    },
    /// A key with only order constraints.
    Unplaced { key: KeyId },
    /// A cause is missing something its rule needs.
    Unspecified { key: KeyId, parameter: String },
    /// A cause the active rules say can't happen. It has no effect.
    Rejected {
        key: KeyId,
        rule: String,
        reason: String,
    },
    /// A cause whose verb no active rule handles.
    Unhandled { key: KeyId, verb: String },
    /// A rule key naming a rule the rulebook doesn't have.
    UnknownRule { key: KeyId, rule: String },
    /// Two state keys disagree at the same instant. The later key wins (log 0003).
    Conflict {
        keys: (KeyId, KeyId),
        point: Id,
        property: String,
    },
}

impl Gap {
    pub fn key(&self) -> &KeyId {
        match self {
            Self::Unexplained { key, .. }
            | Self::Unplaced { key }
            | Self::Unspecified { key, .. }
            | Self::Rejected { key, .. }
            | Self::Unhandled { key, .. }
            | Self::UnknownRule { key, .. } => key,
            Self::Conflict { keys, .. } => &keys.1,
        }
    }
}

impl fmt::Display for Gap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unexplained {
                key,
                point,
                property,
                simulated,
                stated,
            } => write!(
                f,
                "unexplained   {key} — {point}.{property} is {stated}, but the rules had {simulated}; no cause"
            ),
            Self::Unplaced { key } => write!(f, "unplaced      {key} — only ordered, not placed"),
            Self::Unspecified { key, parameter } => {
                write!(f, "unspecified   {key} — {parameter} not given")
            }
            Self::Rejected { key, rule, reason } => {
                write!(f, "rejected      {key} — {reason} ({rule})")
            }
            Self::Unhandled { key, verb } => write!(
                f,
                "unhandled     {key} — no active rule gives '{verb}' a meaning"
            ),
            Self::UnknownRule { key, rule } => {
                write!(f, "unknown rule  {key} — no rule called '{rule}'")
            }
            Self::Conflict {
                keys: (a, b),
                point,
                property,
            } => {
                write!(
                    f,
                    "conflict      {a} and {b} disagree on {point}.{property}; {b} wins"
                )
            }
        }
    }
}

/// The world's history: every change, in order.
#[derive(Clone, Debug, Default)]
pub struct History {
    pub changes: Vec<Change>,
}

impl History {
    /// The world as it is once everything up to and including `t` has happened.
    pub fn world_at(&self, t: Time) -> World {
        let mut world = World::default();
        for c in self.changes.iter().take_while(|c| c.time <= t) {
            world.set(&c.point, &c.property, c.after.clone());
        }
        world
    }

    /// The last change to `point.property` at or before `t`.
    pub fn why(&self, point: &Id, property: &str, t: Time) -> Option<&Change> {
        self.changes
            .iter()
            .take_while(|c| c.time <= t)
            .filter(|c| &c.point == point && c.property == property)
            .last()
    }
}

pub struct Outcome {
    pub history: History,
    pub gaps: Vec<Gap>,
}

/// Turns keys into a world history and a gap report. Pure and deterministic:
/// the same keys and rulebook always give the same outcome (principle 8).
///
/// Within an instant, causes apply in key order, then state keys are checked
/// against the result (log 0008).
pub fn simulate(keys: &[Key], rulebook: &Rulebook) -> Outcome {
    let mut gaps = Vec::new();
    let mut world = World::default();
    let mut history = History::default();

    // Rule keys switch rules on from their moment onward; `Always` from the start.
    let mut rules: Vec<(Time, &str)> = Vec::new();
    let mut placed: Vec<(Time, &Key)> = Vec::new();
    for key in keys {
        match (&key.when, &key.body) {
            (When::Unplaced { .. }, _) => gaps.push(Gap::Unplaced {
                key: key.id.clone(),
            }),
            (when, Body::Rule { rule }) => {
                if rulebook.get(rule).is_none() {
                    gaps.push(Gap::UnknownRule {
                        key: key.id.clone(),
                        rule: rule.clone(),
                    });
                } else {
                    let from = if let When::At(t) = when {
                        *t
                    } else {
                        Time::ZERO
                    };
                    rules.push((from, rule));
                }
            }
            (When::At(t), _) => placed.push((*t, key)),
            (When::Always, _) => placed.push((Time::ZERO, key)),
        }
    }
    // Stable, so keys at the same instant keep their authored order.
    placed.sort_by_key(|(t, _)| *t);

    let mut record =
        |world: &mut World, t: Time, point: &Id, property: &str, value: Value, why: Why| {
            let before = world.set(point, property, value.clone());
            history.changes.push(Change {
                time: t,
                point: point.clone(),
                property: property.to_owned(),
                before,
                after: value,
                why,
            });
        };

    let mut i = 0;
    while i < placed.len() {
        let t = placed[i].0;
        let instant: Vec<&Key> = placed[i..]
            .iter()
            .take_while(|(u, _)| *u == t)
            .map(|(_, k)| *k)
            .collect();
        i += instant.len();

        for key in &instant {
            let Body::Cause(cause) = &key.body else {
                continue;
            };
            match cause {
                Cause::Fiat {
                    point,
                    property,
                    value,
                } => {
                    record(
                        &mut world,
                        t,
                        point,
                        property,
                        value.clone(),
                        Why::Fiat(key.id.clone()),
                    );
                }
                Cause::Act(act) => {
                    let active = rules
                        .iter()
                        .filter(|(from, _)| *from <= t)
                        .filter_map(|(_, name)| rulebook.get(name));
                    let Some(rule) = active
                        .into_iter()
                        .find(|r| r.verbs().contains(&act.verb.as_str()))
                    else {
                        gaps.push(Gap::Unhandled {
                            key: key.id.clone(),
                            verb: act.verb.clone(),
                        });
                        continue;
                    };
                    if !world.contains(&act.actor) {
                        let reason = format!("there is no {} to {}", act.actor, act.verb);
                        gaps.push(Gap::Rejected {
                            key: key.id.clone(),
                            rule: rule.name().to_owned(),
                            reason,
                        });
                        continue;
                    }
                    match rule.act(&world, act) {
                        Ok(effects) => {
                            for e in effects {
                                let why = Why::Rule {
                                    key: key.id.clone(),
                                    rule: rule.name().to_owned(),
                                };
                                record(&mut world, t, &e.point, &e.property, e.value, why);
                            }
                        }
                        Err(Rejection::Missing(parameter)) => {
                            gaps.push(Gap::Unspecified {
                                key: key.id.clone(),
                                parameter,
                            });
                        }
                        Err(Rejection::Cannot(reason)) => {
                            gaps.push(Gap::Rejected {
                                key: key.id.clone(),
                                rule: rule.name().to_owned(),
                                reason,
                            });
                        }
                    }
                }
            }
        }

        // State keys at this instant, checked after its causes. The later key wins a conflict.
        let states: Vec<(&Key, &Id, &str, &Value)> = instant
            .iter()
            .filter_map(|k| match &k.body {
                Body::State {
                    point,
                    property,
                    value,
                } => Some((*k, point, property.as_str(), value)),
                _ => None,
            })
            .collect();
        for (n, &(key, point, property, value)) in states.iter().enumerate() {
            if let Some(&(later, ..)) = states[n + 1..]
                .iter()
                .find(|s| s.1 == point && s.2 == property)
            {
                if states[n + 1..]
                    .iter()
                    .any(|s| s.1 == point && s.2 == property && s.3 != value)
                {
                    gaps.push(Gap::Conflict {
                        keys: (key.id.clone(), later.id.clone()),
                        point: point.clone(),
                        property: property.to_owned(),
                    });
                }
                continue;
            }
            world.touch(point);
            match world.get(point, property).cloned() {
                None => record(
                    &mut world,
                    t,
                    point,
                    property,
                    value.clone(),
                    Why::FillIn(key.id.clone()),
                ),
                Some(current) if &current == value => {} // satisfied
                Some(current) => {
                    gaps.push(Gap::Unexplained {
                        key: key.id.clone(),
                        point: point.clone(),
                        property: property.to_owned(),
                        simulated: current,
                        stated: value.clone(),
                    });
                    record(
                        &mut world,
                        t,
                        point,
                        property,
                        value.clone(),
                        Why::Unexplained(key.id.clone()),
                    );
                }
            }
        }
    }

    Outcome { history, gaps }
}
