use std::collections::BTreeMap;
use std::time::Instant;

use glam::Vec2;

use crate::key::{Body, Brush, Dab, KeyId, Keyframe, Sample, Stroke, Tick, dabs};
use crate::sim::State;

/// A keyframe and the dabs derived from it.
#[derive(Clone)]
pub(crate) struct Entry {
    pub key: Keyframe,
    pub dabs: Vec<Dab>,
}

impl Entry {
    /// Ticks from the keyframe to its last dab: how long the stroke took.
    fn span(&self) -> Tick {
        self.dabs.last().map_or(0, |d| d.dt)
    }
}

const CHECKPOINT_EVERY: Tick = 60;
/// Past this many snapshots, every other old one is dropped, so a long
/// session keeps a bounded cache that's dense near now and sparse far back.
const MAX_CHECKPOINTS: usize = 96;

/// An edit to the keyframes, kept so it can be taken back exactly.
enum Edit {
    Added(KeyId),
    Removed { entry: Entry, index: usize },
    Moved { id: KeyId, tick: Tick, index: usize },
}

/// The keyframes, and the canvas they produce at the playhead.
///
/// The keyframes are the whole document. Everything else is a cache: the
/// state shown, and snapshots so scrubbing back is cheap. An edit throws away
/// the snapshots after it, and the shown state catches up to the playhead
/// again, all at once with [`Timeline::seek`] or a slice per frame with
/// [`Timeline::catch_up`].
pub struct Timeline {
    /// Ordered by tick; within a tick, in the order they were placed there.
    script: Vec<Entry>,
    checkpoints: BTreeMap<Tick, State>,
    state: State,
    playhead: Tick,
    next_id: u32,
    edits: Vec<Edit>,
}

impl Default for Timeline {
    fn default() -> Self {
        let state = State::start(&[]);
        Self {
            script: Vec::new(),
            checkpoints: BTreeMap::from([(0, state.clone())]),
            state,
            playhead: 0,
            next_id: 1,
            edits: Vec::new(),
        }
    }
}

impl Timeline {
    /// The canvas as far as it has been worked out (see [`Timeline::caught_up`]).
    pub fn state(&self) -> &State {
        &self.state
    }

    /// The tick of [`Timeline::state`].
    pub fn tick(&self) -> Tick {
        self.state.tick
    }

    /// Where the author is looking. The state may still be catching up to it.
    pub fn playhead(&self) -> Tick {
        self.playhead
    }

    pub fn caught_up(&self) -> bool {
        self.state.tick == self.playhead
    }

    pub fn keys(&self) -> impl Iterator<Item = &Keyframe> {
        self.script.iter().map(|e| &e.key)
    }

    pub fn key(&self, id: KeyId) -> Option<&Keyframe> {
        self.keys().find(|k| k.id == id)
    }

    /// How many ticks a keyframe goes on putting things down for.
    pub fn span(&self, id: KeyId) -> Tick {
        self.script
            .iter()
            .find(|e| e.key.id == id)
            .map_or(0, Entry::span)
    }

    /// The last tick at which any keyframe still puts something down.
    pub fn last_key_tick(&self) -> Tick {
        self.script
            .iter()
            .map(|e| e.key.tick + e.span())
            .max()
            .unwrap_or(0)
    }

    /// Move the playhead and work the canvas out there before returning.
    pub fn seek(&mut self, target: Tick) {
        self.set_playhead(target);
        self.catch_up(None);
    }

    pub fn step(&mut self) {
        self.seek(self.playhead + 1);
    }

    /// Move the playhead without working anything out yet.
    pub fn set_playhead(&mut self, target: Tick) {
        self.playhead = target;
        if target < self.state.tick {
            self.restore(target);
        } else if let Some((&t, cp)) = self.checkpoints.range(..=target).next_back()
            && t > self.state.tick
        {
            self.state = cp.clone();
        }
    }

    /// Step toward the playhead until `deadline`. True once there.
    pub fn catch_up(&mut self, deadline: Option<Instant>) -> bool {
        while self.state.tick < self.playhead {
            if deadline.is_some_and(|d| Instant::now() >= d) {
                return false;
            }
            self.state.step(&self.script);
            let t = self.state.tick;
            if t.is_multiple_of(CHECKPOINT_EVERY) && !self.checkpoints.contains_key(&t) {
                self.checkpoints.insert(t, self.state.clone());
                self.thin_checkpoints();
            }
        }
        true
    }

    /// Start a stroke at the playhead. It shows at once, and keeps growing
    /// with [`Timeline::extend_stroke`] until [`Timeline::end_stroke`].
    pub fn begin_stroke(&mut self, brush: Brush, radius: f32, pos: Vec2) -> KeyId {
        self.catch_up(None);
        let stroke = Stroke {
            brush,
            radius,
            samples: vec![Sample { pos, dt: 0 }],
        };
        let at = self.insert(Body::Stroke(stroke));
        let e = &self.script[at];
        if let Body::Stroke(s) = &e.key.body {
            for (i, d) in e.dabs.iter().enumerate() {
                self.state.emit(e.key.id, s, i, *d);
            }
        }
        e.key.id
    }

    /// Add the pointer's position now. Lingering while time runs counts.
    pub fn extend_stroke(&mut self, id: KeyId, pos: Vec2) {
        let now = self.state.tick;
        let Some(e) = self.script.iter_mut().find(|e| e.key.id == id) else {
            return;
        };
        let Body::Stroke(s) = &mut e.key.body else {
            return;
        };
        if now < e.key.tick {
            return;
        }
        let dt = now - e.key.tick;
        s.samples.push(Sample { pos, dt });
        let old = e.dabs.len();
        e.dabs = dabs(s);
        // These land now, as a live preview; `end_stroke` checks whether a
        // replay would have put them down in a different order.
        for i in old..e.dabs.len() {
            self.state.emit(e.key.id, s, i, e.dabs[i]);
        }
        self.invalidate(now);
    }

    pub fn end_stroke(&mut self, id: KeyId) {
        let Some(e) = self.script.iter().find(|e| e.key.id == id) else {
            return;
        };
        let (start, end) = (e.key.tick, e.key.tick + e.span());
        // Snapshots taken while painting missed the dabs that landed after.
        self.invalidate(start);
        // If another stroke later in the script put things down during this
        // one, a replay orders them differently from the live preview.
        let crossed = self.script.iter().any(|o| {
            o.key.id != id
                && o.key.tick > start
                && o.key.tick <= end
                && matches!(o.key.body, Body::Stroke(_))
        });
        if crossed {
            self.restore(self.state.tick);
        }
    }

    /// Switch a rule note on or off from the playhead on.
    pub fn set_rule(&mut self, rule: usize, on: bool) {
        self.insert(Body::Rule { rule, on });
        if self.caught_up() {
            self.state.rules_on[rule] = on;
        }
    }

    /// Delete a keyframe. The canvas after it replays without it.
    pub fn remove(&mut self, id: KeyId) -> Option<Keyframe> {
        let index = self.script.iter().position(|e| e.key.id == id)?;
        let entry = self.script.remove(index);
        self.edited(entry.key.tick);
        let key = entry.key.clone();
        self.edits.push(Edit::Removed { entry, index });
        Some(key)
    }

    /// Move a keyframe to another tick, everything it puts down with it.
    pub fn move_key(&mut self, id: KeyId, to: Tick) {
        let Some(index) = self.script.iter().position(|e| e.key.id == id) else {
            return;
        };
        let from = self.script[index].key.tick;
        if from == to {
            return;
        }
        let mut entry = self.script.remove(index);
        entry.key.tick = to;
        let at = self.script.partition_point(|e| e.key.tick <= to);
        self.script.insert(at, entry);
        self.edited(from.min(to));
        self.edits.push(Edit::Moved {
            id,
            tick: from,
            index,
        });
    }

    /// Take back the last edit: a keyframe added, removed, or moved.
    pub fn undo(&mut self) -> bool {
        let Some(edit) = self.edits.pop() else {
            return false;
        };
        match edit {
            Edit::Added(id) => {
                if let Some(i) = self.script.iter().position(|e| e.key.id == id) {
                    let e = self.script.remove(i);
                    self.edited(e.key.tick);
                }
            }
            Edit::Removed { entry, index } => {
                let tick = entry.key.tick;
                self.script.insert(index.min(self.script.len()), entry);
                self.edited(tick);
            }
            Edit::Moved { id, tick, index } => {
                if let Some(i) = self.script.iter().position(|e| e.key.id == id) {
                    let mut e = self.script.remove(i);
                    let now = e.key.tick;
                    e.key.tick = tick;
                    self.script.insert(index.min(self.script.len()), e);
                    self.edited(now.min(tick));
                }
            }
        }
        true
    }

    /// Add a keyframe at the playhead. The shown state must be there.
    fn insert(&mut self, body: Body) -> usize {
        let tick = self.playhead;
        let key = Keyframe {
            id: KeyId(self.next_id),
            tick,
            body,
        };
        self.next_id += 1;
        let dabs = match &key.body {
            Body::Stroke(s) => dabs(s),
            Body::Rule { .. } => Vec::new(),
        };
        let id = key.id;
        let at = self.script.partition_point(|e| e.key.tick <= tick);
        self.script.insert(at, Entry { key, dabs });
        self.invalidate(tick);
        self.edits.push(Edit::Added(id));
        at
    }

    /// The keyframes changed from `tick` on: drop what's stale and, if the
    /// shown state is past that, go back to before it. Catching up redoes it.
    fn edited(&mut self, tick: Tick) {
        self.invalidate(tick);
        if self.state.tick >= tick {
            self.restore(self.state.tick);
        }
    }

    /// Snapshots from `tick` on no longer match the keyframes.
    fn invalidate(&mut self, tick: Tick) {
        self.checkpoints.split_off(&tick);
        if self.checkpoints.is_empty() {
            self.checkpoints.insert(0, State::start(&self.script));
        }
    }

    fn thin_checkpoints(&mut self) {
        if self.checkpoints.len() <= MAX_CHECKPOINTS {
            return;
        }
        let ticks: Vec<Tick> = self.checkpoints.keys().copied().collect();
        let keep_from = ticks.len() - MAX_CHECKPOINTS / 4;
        for (n, t) in ticks.iter().enumerate().take(keep_from) {
            if n % 2 == 1 {
                self.checkpoints.remove(t);
            }
        }
    }

    fn restore(&mut self, tick: Tick) {
        let (_, cp) = self
            .checkpoints
            .range(..=tick)
            .next_back()
            .expect("there is always a snapshot at 0");
        self.state = cp.clone();
    }
}
