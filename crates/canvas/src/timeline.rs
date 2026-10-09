use std::collections::BTreeMap;

use glam::Vec2;

use crate::key::{Body, Brush, Dab, KeyId, Keyframe, Sample, Stroke, Tick, dabs};
use crate::sim::State;

/// A keyframe and the dabs derived from it.
pub(crate) struct Entry {
    pub key: Keyframe,
    pub dabs: Vec<Dab>,
}

const CHECKPOINT_EVERY: Tick = 60;

/// The keyframes, and the canvas they produce at the playhead.
///
/// The keyframes are the whole document. Everything else is a cache: the
/// current state, and a snapshot every second so scrubbing back is cheap.
/// An edit throws away the snapshots after it.
pub struct Timeline {
    /// Ordered by tick, then by when they were made.
    script: Vec<Entry>,
    checkpoints: BTreeMap<Tick, State>,
    state: State,
    next_id: u32,
}

impl Default for Timeline {
    fn default() -> Self {
        let state = State::start(&[]);
        Self {
            script: Vec::new(),
            checkpoints: BTreeMap::from([(0, state.clone())]),
            state,
            next_id: 1,
        }
    }
}

impl Timeline {
    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn tick(&self) -> Tick {
        self.state.tick
    }

    pub fn keys(&self) -> impl Iterator<Item = &Keyframe> {
        self.script.iter().map(|e| &e.key)
    }

    /// The last tick at which any keyframe still puts something down.
    pub fn last_key_tick(&self) -> Tick {
        self.script
            .iter()
            .map(|e| e.key.tick + e.dabs.last().map_or(0, |d| d.dt))
            .max()
            .unwrap_or(0)
    }

    /// Move the playhead to `target`.
    pub fn seek(&mut self, target: Tick) {
        if target < self.state.tick {
            self.restore(target);
        } else if let Some((&t, cp)) = self.checkpoints.range(..=target).next_back()
            && t > self.state.tick
        {
            self.state = cp.clone();
        }
        while self.state.tick < target {
            self.state.step(&self.script);
            let t = self.state.tick;
            if t.is_multiple_of(CHECKPOINT_EVERY) {
                self.checkpoints.entry(t).or_insert_with(|| self.state.clone());
            }
        }
    }

    pub fn step(&mut self) {
        self.seek(self.state.tick + 1);
    }

    /// Start a stroke at the playhead. It shows at once, and keeps growing
    /// with [`Timeline::extend_stroke`] until [`Timeline::end_stroke`].
    pub fn begin_stroke(&mut self, brush: Brush, radius: f32, pos: Vec2) -> KeyId {
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
        // A live preview: these land now. `end_stroke` replays the stroke
        // properly, in case other keyframes share these ticks.
        for i in old..e.dabs.len() {
            self.state.emit(e.key.id, s, i, e.dabs[i]);
        }
        self.invalidate(now);
    }

    pub fn end_stroke(&mut self, id: KeyId) {
        if let Some(e) = self.script.iter().find(|e| e.key.id == id) {
            self.invalidate(e.key.tick);
            self.replay();
        }
    }

    /// Switch a rule note on or off from the playhead on.
    pub fn set_rule(&mut self, rule: usize, on: bool) {
        self.insert(Body::Rule { rule, on });
        self.state.rules_on[rule] = on;
    }

    /// Take back the most recent keyframe.
    pub fn undo(&mut self) -> Option<Keyframe> {
        let at = (0..self.script.len()).max_by_key(|&i| self.script[i].key.id)?;
        let e = self.script.remove(at);
        self.invalidate(e.key.tick);
        self.replay();
        Some(e.key)
    }

    fn insert(&mut self, body: Body) -> usize {
        let tick = self.state.tick;
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
        let at = self.script.partition_point(|e| e.key.tick <= tick);
        self.script.insert(at, Entry { key, dabs });
        self.invalidate(tick);
        at
    }

    /// Snapshots from `tick` on no longer match the keyframes.
    fn invalidate(&mut self, tick: Tick) {
        self.checkpoints.split_off(&tick);
        if self.checkpoints.is_empty() {
            self.checkpoints.insert(0, State::start(&self.script));
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

    /// Recompute the playhead's state from the keyframes.
    fn replay(&mut self) {
        let now = self.state.tick;
        self.restore(now);
        self.seek(now);
    }
}
