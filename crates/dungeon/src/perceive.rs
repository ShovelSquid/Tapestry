//! What someone can perceive. A query over the world, never a rule: it reads
//! and never writes (log 0008). Narration is built only from this, so it can't
//! describe what isn't there or what the player couldn't know.

use crate::rules::room_of;
use tapestry_core::*;

#[derive(Debug, Default, PartialEq)]
pub struct Scene {
    pub room: Option<Id>,
    pub description: String,
    pub goal: bool,
    /// Everything visible in the room besides the observer, exits and doors.
    pub things: Vec<Id>,
    /// Each way out, with the door it goes through, if any.
    pub exits: Vec<(Id, Option<Id>)>,
    pub held: Vec<Id>,
    pub alive: bool,
}

pub fn perceive(world: &World, who: &Id) -> Scene {
    let Some(room) = room_of(world, who) else {
        return Scene::default();
    };
    let kind = |id: &Id| {
        world
            .get(id, "kind")
            .and_then(Value::as_text)
            .map(str::to_owned)
    };
    let mut scene = Scene {
        description: world
            .get(&room, "description")
            .and_then(Value::as_text)
            .unwrap_or_default()
            .to_owned(),
        goal: world.is(&room, "goal", true),
        held: world.children(who).cloned().collect(),
        alive: !world.is(who, "alive", false),
        ..Default::default()
    };
    for id in world.children(&room) {
        match kind(id).as_deref() {
            Some("exit") => scene.exits.push((
                id.clone(),
                world.get(id, "door").and_then(Value::as_ref).cloned(),
            )),
            Some("door") => {}
            _ if id == who => {}
            _ => scene.things.push(id.clone()),
        }
    }
    scene.room = Some(room);
    scene
}

impl Scene {
    /// Every point the observer could refer to right now.
    pub fn in_view(&self) -> impl Iterator<Item = &Id> {
        self.things
            .iter()
            .chain(&self.held)
            .chain(self.exits.iter().map(|(e, _)| e))
            .chain(self.exits.iter().filter_map(|(_, d)| d.as_ref()))
    }
}
