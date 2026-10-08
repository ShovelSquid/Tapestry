//! A small dungeon on the Tapestry core: the first playable demo (log 0008).
//!
//! The world is nothing but keys, written by the "world" author at @0. Its laws
//! (moving, carrying, locks, doors, fighting) are rules, switched on by rule keys.
//! The game loop holds every author, player or narrator, to one policy: a cause
//! the rules reject never enters the story, and a stated jump is kept but flagged.

mod perceive;
mod rules;

pub use perceive::{Scene, perceive};
pub use rules::{Combat, Doors, Handling, Locks, Movement, room_of};

use tapestry_core::*;

pub const PLAYER: &str = "player";

pub fn rulebook() -> Rulebook {
    Rulebook::default()
        .with(Movement)
        .with(Handling)
        .with(Locks)
        .with(Doors)
        .with(Combat)
}

/// The starting world, as the keys that describe it.
pub fn world() -> Vec<Key> {
    let mut keys = Vec::new();
    let mut n = 0;
    let mut say = |point: &str, property: &str, value: Value| {
        n += 1;
        keys.push(Key {
            id: KeyId(format!("w{n}")),
            when: When::At(Time::ZERO),
            body: Body::State {
                point: point.into(),
                property: property.into(),
                value,
            },
            source: Source::new("world", "the dungeon as it begins"),
        });
    };
    let text = Value::text;
    let to = Value::point;
    let yes = Value::Bool(true);
    let no = Value::Bool(false);

    for (room, name, desc) in [
        (
            "cellar",
            "cellar",
            "a damp cellar, straw rotting on the stone floor",
        ),
        (
            "hall",
            "hall",
            "a long hall lit by a single guttering torch",
        ),
        ("yard", "courtyard", "an open courtyard under the stars"),
    ] {
        say(room, "kind", text("room"));
        say(room, "name", text(name));
        say(room, "description", text(desc));
    }
    say("yard", "goal", yes.clone());

    say("door", "kind", text("door"));
    say("door", "name", text("iron door"));
    say("door", World::PARENT, to("cellar"));
    say("door", "locked", yes.clone());
    say("door", "open", no.clone());

    for (exit, room, dir, dest) in [
        ("cellar/north", "cellar", "north", "hall"),
        ("hall/south", "hall", "south", "cellar"),
        ("hall/east", "hall", "east", "yard"),
        ("yard/west", "yard", "west", "hall"),
    ] {
        say(exit, "kind", text("exit"));
        say(exit, "name", text(dir));
        say(exit, World::PARENT, to(room));
        say(exit, "to", to(dest));
    }
    say("cellar/north", "door", to("door"));
    say("hall/south", "door", to("door"));
    say("hall/east", "guarded_by", to("guard"));

    say(PLAYER, "kind", text("person"));
    say(PLAYER, "name", text("you"));
    say(PLAYER, World::PARENT, to("cellar"));
    say(PLAYER, "alive", yes.clone());

    say("guard", "kind", text("person"));
    say("guard", "name", text("guard"));
    say("guard", World::PARENT, to("hall"));
    say("guard", "alive", yes.clone());

    say("key", "kind", text("thing"));
    say("key", "name", text("rusty key"));
    say("key", World::PARENT, to("cellar"));
    say("key", "opens", to("door"));

    say("sword", "kind", text("thing"));
    say("sword", "name", text("old sword"));
    say("sword", World::PARENT, to("cellar"));
    say("sword", "weapon", yes);

    for (i, rule) in ["movement", "handling", "locks", "doors", "combat"]
        .into_iter()
        .enumerate()
    {
        keys.push(Key {
            id: KeyId(format!("r{}", i + 1)),
            when: When::Always,
            body: Body::Rule { rule: rule.into() },
            source: Source::new("world", "the laws of the dungeon"),
        });
    }
    keys
}

/// What happened when a key was offered to the story.
pub enum Offer {
    /// The key is in the story. Any gaps it opened (such as an unexplained jump) are listed.
    Kept(Vec<Gap>),
    /// The rules refused it, so it was left out.
    Refused(Gap),
}

/// A story in progress: its keys, its laws, and the policy that guards it.
pub struct Game {
    keys: Vec<Key>,
    rulebook: Rulebook,
    turn: i64,
    next_id: usize,
    outcome: Outcome,
}

impl Default for Game {
    fn default() -> Self {
        Self::new(world())
    }
}

impl Game {
    pub fn new(keys: Vec<Key>) -> Self {
        let rulebook = rulebook();
        let outcome = simulate(&keys, &rulebook);
        Self {
            keys,
            rulebook,
            turn: 0,
            next_id: 1,
            outcome,
        }
    }

    pub fn now(&self) -> Time {
        Time::at(self.turn)
    }

    pub fn world(&self) -> World {
        self.outcome.history.world_at(self.now())
    }

    pub fn outcome(&self) -> &Outcome {
        &self.outcome
    }

    pub fn keys(&self) -> &[Key] {
        &self.keys
    }

    /// Offers a key at the next turn. Causes the rules reject, and verbs no rule
    /// knows, are refused and left out. Anything else is kept, gaps and all.
    pub fn offer(&mut self, body: Body, source: Source) -> Offer {
        let id = KeyId(format!("k{}", self.next_id));
        self.keys.push(Key {
            id: id.clone(),
            when: When::At(Time::at(self.turn + 1)),
            body,
            source,
        });
        let outcome = simulate(&self.keys, &self.rulebook);
        let mine: Vec<Gap> = outcome
            .gaps
            .iter()
            .filter(|g| g.key() == &id)
            .cloned()
            .collect();
        let refused = mine.iter().find(|g| {
            matches!(
                g,
                Gap::Rejected { .. } | Gap::Unhandled { .. } | Gap::Unspecified { .. }
            )
        });
        if let Some(gap) = refused {
            let gap = gap.clone();
            self.keys.pop();
            return Offer::Refused(gap);
        }
        self.next_id += 1;
        self.turn += 1;
        self.outcome = outcome;
        Offer::Kept(mine)
    }

    pub fn act(&mut self, act: Act, text: &str) -> Offer {
        self.offer(Body::Cause(Cause::Act(act)), Source::new("player", text))
    }

    /// Takes back the last key and replays the story without it (spec §6.3).
    pub fn undo(&mut self) -> Option<Key> {
        let last = self.keys.last()?;
        if last.source.author == "world" {
            return None;
        }
        let key = self.keys.pop()?;
        self.turn -= 1;
        self.outcome = simulate(&self.keys, &self.rulebook);
        Some(key)
    }
}

#[cfg(test)]
mod tests;
