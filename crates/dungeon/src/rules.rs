//! The dungeon's laws. Each is an ordinary rule: preconditions, then effects,
//! or a reason in plain words when the act can't happen.

use tapestry_core::*;

fn cannot<T>(why: impl Into<String>) -> Result<T, Rejection> {
    Err(Rejection::Cannot(why.into()))
}

fn arg<'a>(act: &'a Act, name: &str) -> Result<&'a Id, Rejection> {
    act.arg(name)
        .and_then(Value::as_ref)
        .ok_or_else(|| Rejection::Missing(name.into()))
}

fn name(world: &World, id: &Id) -> String {
    world
        .get(id, "name")
        .and_then(Value::as_text)
        .unwrap_or(id.as_str())
        .to_owned()
}

fn kind<'a>(world: &'a World, id: &Id) -> Option<&'a str> {
    world.get(id, "kind").and_then(Value::as_text)
}

/// The room a point is in, walking up through whatever holds it.
pub fn room_of(world: &World, id: &Id) -> Option<Id> {
    let mut at = world.parent(id)?;
    loop {
        if kind(world, at) == Some("room") {
            return Some(at.clone());
        }
        at = world.parent(at)?;
    }
}

/// The dead don't act. Shared by every rule that lets someone do something.
fn able(world: &World, actor: &Id) -> Result<Id, Rejection> {
    if world.is(actor, "alive", false) {
        return cannot(format!("{} is dead", name(world, actor)));
    }
    room_of(world, actor)
        .ok_or_else(|| Rejection::Cannot(format!("{} is nowhere", name(world, actor))))
}

fn holds(world: &World, actor: &Id, item: &Id) -> bool {
    world.parent(item) == Some(actor)
}

/// A door is in reach if it's in the room or one of the room's exits goes through it.
fn door_in_reach(world: &World, room: &Id, door: &Id) -> bool {
    room_of(world, door).as_ref() == Some(room)
        || world
            .children(room)
            .any(|e| world.get(e, "door").and_then(Value::as_ref) == Some(door))
}

fn a_door(world: &World, room: &Id, act: &Act, name_: &str) -> Result<Id, Rejection> {
    let door = arg(act, name_)?.clone();
    if kind(world, &door) != Some("door") {
        return cannot(format!("the {} isn't a door", name(world, &door)));
    }
    if !door_in_reach(world, room, &door) {
        return cannot(format!("there's no {} here", name(world, &door)));
    }
    Ok(door)
}

pub struct Movement;

impl Rule for Movement {
    fn name(&self) -> &str {
        "movement"
    }
    fn verbs(&self) -> &[&str] {
        &["go"]
    }
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection> {
        let room = able(world, &act.actor)?;
        let exit = arg(act, "exit")?;
        if world.parent(exit) != Some(&room) || kind(world, exit) != Some("exit") {
            return cannot(format!("there's no way {} from here", name(world, exit)));
        }
        if let Some(door) = world.get(exit, "door").and_then(Value::as_ref) {
            if world.is(door, "locked", true) {
                return cannot(format!("the {} is locked", name(world, door)));
            }
            if !world.is(door, "open", true) {
                return cannot(format!("the {} is closed", name(world, door)));
            }
        }
        if let Some(guard) = world.get(exit, "guarded_by").and_then(Value::as_ref)
            && !world.is(guard, "alive", false)
            && room_of(world, guard).as_ref() == Some(&room)
        {
            return cannot(format!("the {} bars the way", name(world, guard)));
        }
        let to = world
            .get(exit, "to")
            .cloned()
            .ok_or_else(|| Rejection::Cannot("that way leads nowhere".into()))?;
        Ok(vec![Effect::set(&act.actor, World::PARENT, to)])
    }
}

pub struct Handling;

impl Rule for Handling {
    fn name(&self) -> &str {
        "handling"
    }
    fn verbs(&self) -> &[&str] {
        &["take", "drop"]
    }
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection> {
        let room = able(world, &act.actor)?;
        let item = arg(act, "item")?;
        let n = name(world, item);
        match act.verb.as_str() {
            "take" => {
                if holds(world, &act.actor, item) {
                    return cannot(format!("you already have the {n}"));
                }
                if world.parent(item) != Some(&room) {
                    return cannot(format!("there's no {n} here"));
                }
                if kind(world, item) != Some("thing") {
                    return cannot(format!("the {n} can't be carried"));
                }
                Ok(vec![Effect::set(
                    item,
                    World::PARENT,
                    Value::Ref(act.actor.clone()),
                )])
            }
            _ => {
                if !holds(world, &act.actor, item) {
                    return cannot(format!("you don't have the {n}"));
                }
                Ok(vec![Effect::set(item, World::PARENT, Value::Ref(room))])
            }
        }
    }
}

pub struct Locks;

impl Rule for Locks {
    fn name(&self) -> &str {
        "locks"
    }
    fn verbs(&self) -> &[&str] {
        &["unlock", "lock"]
    }
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection> {
        let room = able(world, &act.actor)?;
        let door = a_door(world, &room, act, "door")?;
        let n = name(world, &door);
        let locking = act.verb == "lock";
        if world.is(&door, "locked", locking) {
            return cannot(format!(
                "the {n} is already {}",
                if locking { "locked" } else { "unlocked" }
            ));
        }
        if locking && world.is(&door, "open", true) {
            return cannot(format!("the {n} is open"));
        }
        let has_key = world
            .children(&act.actor)
            .any(|i| world.get(i, "opens").and_then(Value::as_ref) == Some(&door));
        if !has_key {
            return cannot(format!("you have nothing that fits the {n}'s lock"));
        }
        Ok(vec![Effect::set(&door, "locked", Value::Bool(locking))])
    }
}

pub struct Doors;

impl Rule for Doors {
    fn name(&self) -> &str {
        "doors"
    }
    fn verbs(&self) -> &[&str] {
        &["open", "close"]
    }
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection> {
        let room = able(world, &act.actor)?;
        let door = a_door(world, &room, act, "door")?;
        let n = name(world, &door);
        let opening = act.verb == "open";
        if world.is(&door, "open", opening) {
            return cannot(format!(
                "the {n} is already {}",
                if opening { "open" } else { "closed" }
            ));
        }
        if opening && world.is(&door, "locked", true) {
            return cannot(format!("the {n} is locked"));
        }
        Ok(vec![Effect::set(&door, "open", Value::Bool(opening))])
    }
}

pub struct Combat;

impl Rule for Combat {
    fn name(&self) -> &str {
        "combat"
    }
    fn verbs(&self) -> &[&str] {
        &["attack"]
    }
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection> {
        let room = able(world, &act.actor)?;
        let target = arg(act, "target")?;
        let n = name(world, target);
        if room_of(world, target).as_ref() != Some(&room) {
            return cannot(format!("there's no {n} here"));
        }
        if kind(world, target) != Some("person") || target == &act.actor {
            return cannot(format!("the {n} isn't something you can fight"));
        }
        if world.is(target, "alive", false) {
            return cannot(format!("the {n} is already dead"));
        }
        if !world
            .children(&act.actor)
            .any(|i| world.is(i, "weapon", true))
        {
            return cannot("you have nothing to fight with");
        }
        Ok(vec![Effect::set(target, "alive", Value::Bool(false))])
    }
}
