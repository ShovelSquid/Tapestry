//! The canvas at one tick, and how it gets to the next.
//!
//! Determinism: fixed tick, particles always visited in vector order,
//! neighbours from a stable grid, randomness only from hashing IDs, and no
//! trigonometry from the platform's libm (spec §8.4).

use glam::Vec2;

use crate::grid::Grid;
use crate::key::{Brush, DT, Dab, KeyId, Stroke, Tick};
use crate::rules::{Basic, Becomes, Prop, RULES};
use crate::timeline::Entry;

/// The canvas, in canvas units (about a pixel). y points down.
pub const WIDTH: f32 = 1600.0;
pub const HEIGHT: f32 = 1000.0;

const GRAVITY: f32 = 900.0;
const MAX_SPEED: f32 = 360.0;
const WATER_RADIUS: f32 = 4.5;
/// Fresh ink spreads into the paper for this long.
const BLOT_TICKS: Tick = 30;
/// Ink can be smudged until it dries.
const DRY_TICKS: Tick = 180;
/// Ink wetter than this flows.
const FLOWING: f32 = 0.05;
/// Ash resting this many ticks in a row settles for good.
const ASLEEP: u8 = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Material {
    Ink,
    Water,
    Tree,
    /// Something burning: it has fuel, and gives off flames while it lasts.
    Fire,
    Flame,
    Ash,
}

impl Material {
    pub fn name(self) -> &'static str {
        match self {
            Material::Ink => "ink",
            Material::Water => "water",
            Material::Tree => "tree",
            Material::Fire => "fire",
            Material::Flame => "flame",
            Material::Ash => "ash",
        }
    }
}

/// Who a particle comes from: one of the author's keyframes, or a rule note
/// that converted it. Flames take after the fire that gave them off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MadeBy {
    Key(KeyId),
    Rule(usize),
}

#[derive(Clone, Debug)]
pub struct Particle {
    /// Stable for the particle's whole life, through conversions.
    pub id: u64,
    pub material: Material,
    pub pos: Vec2,
    pub vel: Vec2,
    pub radius: f32,
    /// Ticks since it became its current material.
    pub age: Tick,
    pub heat: f32,
    pub wet: f32,
    /// Fire: seconds of burning left. Flame: seconds of life left.
    pub fuel: f32,
    /// The tree it belongs to, while attached.
    pub tree: Option<u32>,
    /// Offset from the tree's base when the tree stands straight.
    pub home: Vec2,
    pub trunk: bool,
    pub made_by: MadeBy,
    /// Ticks spent resting on something. Ash that rests long enough stops
    /// being simulated and becomes part of the ground.
    rest: u8,
    dead: bool,
}

impl Particle {
    fn new(id: u64, material: Material, pos: Vec2, radius: f32, made_by: MadeBy) -> Self {
        Self {
            id,
            material,
            pos,
            vel: Vec2::ZERO,
            radius,
            age: 0,
            heat: 0.0,
            wet: 0.0,
            fuel: 0.0,
            tree: None,
            home: Vec2::ZERO,
            trunk: false,
            made_by,
            rest: 0,
            dead: false,
        }
    }

    /// A steady 0..1 per particle, for variety in colour and timing.
    pub fn shade(&self) -> f32 {
        unit(self.id, 7)
    }

    /// Smudgeable ink: still drying, or wetted by something.
    pub fn wet_ink(&self) -> bool {
        self.material == Material::Ink && (self.age < DRY_TICKS || self.wet > FLOWING)
    }

    fn flowing_ink(&self) -> bool {
        self.material == Material::Ink && self.wet > FLOWING
    }

    /// Things that fall, pour and pile: they push each other apart.
    fn fluid(&self) -> bool {
        match self.material {
            Material::Water => true,
            Material::Ash => self.rest < ASLEEP,
            _ => self.flowing_ink(),
        }
    }

    /// Ink at rest is a wall to everything that pours, and so is ash that
    /// has settled into a pile.
    fn solid(&self) -> bool {
        match self.material {
            Material::Ink => !self.flowing_ink(),
            Material::Ash => self.rest >= ASLEEP,
            _ => false,
        }
    }

    /// Takes part in physics at all (flames, fire and trees don't).
    fn physical(&self) -> bool {
        self.fluid() || self.solid()
    }

    fn solid_radius(&self) -> f32 {
        match self.material {
            Material::Ash => WATER_RADIUS * 0.9,
            _ => (self.radius * 0.6).min(7.0),
        }
    }
}

/// A tree is a frame its particles hang in. It sways as one spring.
#[derive(Clone, Debug)]
pub struct Tree {
    pub base: Vec2,
    pub height: f32,
    pub angle: f32,
    pub spin: f32,
}

impl Tree {
    /// Where a particle with `home` offset is now: the higher up, the more
    /// it leans with the sway.
    fn place(&self, home: Vec2) -> Vec2 {
        let lean = self.angle * (-home.y / self.height).clamp(0.0, 1.0);
        self.base + rotate(home, lean)
    }
}

#[derive(Clone)]
pub struct State {
    pub tick: Tick,
    pub particles: Vec<Particle>,
    pub trees: Vec<Tree>,
    /// Which rule notes are switched on, by index into [`RULES`].
    pub rules_on: Vec<bool>,
    /// Everything, for rules.
    grid: Grid,
    /// Only what pours or blocks, for physics: flames and trees stay out of
    /// the way.
    solids: Grid,
}

impl State {
    /// Tick 0: an empty canvas, then whatever the keyframes put down at 0.
    pub(crate) fn start(script: &[Entry]) -> Self {
        let mut s = Self {
            tick: 0,
            particles: Vec::new(),
            trees: Vec::new(),
            rules_on: vec![false; RULES.len()],
            grid: Grid::default(),
            solids: Grid::default(),
        };
        s.apply_keys(script);
        s
    }

    /// Particles physics still has to move (not settled, not hung in trees).
    pub fn active(&self) -> usize {
        self.particles.iter().filter(|p| p.fluid()).count()
    }

    pub fn count(&self, material: Material) -> usize {
        self.particles
            .iter()
            .filter(|p| p.material == material)
            .count()
    }

    /// Bit-exact summary of the canvas, for checking replays.
    pub fn fingerprint(&self) -> u64 {
        let mut h = self.tick as u64;
        for p in &self.particles {
            h = mix(h, p.id);
            h = mix(h, p.material as u64);
            h = mix(h, (p.pos.x.to_bits() as u64) << 32 | p.pos.y.to_bits() as u64);
        }
        h
    }

    /// One tick: physics, rules, nature, then any keyframes at the new tick.
    pub(crate) fn step(&mut self, script: &[Entry]) {
        self.tick += 1;
        let indexed = self.particles.iter().enumerate().map(|(i, p)| (i as u32, p.pos));
        self.solids
            .build(indexed.filter(|&(i, _)| self.particles[i as usize].physical()));

        for t in &mut self.trees {
            t.spin += (-28.0 * t.angle - 1.6 * t.spin) * DT;
            t.angle += t.spin * DT;
        }

        let prev: Vec<Vec2> = self.particles.iter().map(|p| p.pos).collect();
        self.move_particles();
        let moved: Vec<Vec2> = self.particles.iter().map(|p| p.pos).collect();
        self.blot();
        let mut touched = vec![false; prev.len()];
        for _ in 0..2 {
            self.relax();
            self.collide(&prev, &mut touched);
        }
        for (i, p) in self.particles.iter_mut().enumerate() {
            if p.fluid() || p.material == Material::Flame {
                // Being pushed apart only partly turns into speed, so a
                // pour settles instead of splashing; landing on something
                // soaks up most of the fall.
                let pushed = p.pos - moved[i];
                p.vel = (moved[i] - prev[i] + pushed * 0.35) / DT;
                if touched[i] {
                    p.vel *= 0.5;
                }
                if p.material == Material::Ash {
                    let resting = touched[i] && p.vel.length_squared() < 30.0 * 30.0;
                    p.rest = if resting { p.rest + 1 } else { 0 };
                    if p.rest >= ASLEEP {
                        p.vel = Vec2::ZERO;
                    }
                }
            }
        }

        self.apply_rules();
        self.nature();
        self.particles.retain(|p| !p.dead);
        self.apply_keys(script);
    }

    fn move_particles(&mut self) {
        for p in &mut self.particles {
            p.age += 1;
            if let Some(t) = p.tree {
                p.pos = self.trees[t as usize].place(p.home);
                continue;
            }
            match p.material {
                Material::Water => {
                    p.vel.y += GRAVITY * DT;
                    p.vel *= 0.985;
                }
                Material::Ash => {
                    p.vel.y += GRAVITY * 0.5 * DT;
                    p.vel *= 0.97;
                }
                Material::Flame => {
                    p.vel.y -= 260.0 * DT;
                    p.vel.x += (unit(p.id, p.age as u64) - 0.5) * 900.0 * DT;
                    p.vel *= 0.93;
                }
                Material::Ink if p.flowing_ink() => {
                    p.vel.y += GRAVITY * 0.15 * DT;
                    p.vel *= 0.9;
                }
                Material::Ink | Material::Fire | Material::Tree => {
                    p.vel = Vec2::ZERO;
                    continue;
                }
            }
            p.vel = p.vel.clamp_length_max(MAX_SPEED);
            p.pos += p.vel * DT;
        }
    }

    /// Fresh ink creeps into the paper: a little wander, and ink pooled in
    /// one spot pushes outward into a blot.
    fn blot(&mut self) {
        let mut near = Vec::new();
        for i in 0..self.particles.len() {
            let p = &self.particles[i];
            if p.material != Material::Ink || p.age >= BLOT_TICKS {
                continue;
            }
            let (pos, reach) = (p.pos, p.radius * 0.5);
            let mut push = disk(p.id, p.age as u64) * 0.3;
            self.solids.near(pos, &mut near);
            for &j in &near {
                let q = &self.particles[j as usize];
                if j as usize == i || q.material != Material::Ink {
                    continue;
                }
                let d = pos - q.pos;
                let dist = d.length();
                if dist < reach {
                    let dir = if dist > 1e-4 {
                        d / dist
                    } else {
                        disk(p.id ^ q.id, 1).normalize_or(Vec2::X)
                    };
                    push += dir * (reach - dist) * 0.25;
                }
            }
            self.particles[i].pos += push;
        }
    }

    /// Pouring things are disks that don't overlap.
    fn relax(&mut self) {
        let mut near = Vec::new();
        for i in 0..self.particles.len() {
            if !self.particles[i].fluid() {
                continue;
            }
            self.solids.near(self.particles[i].pos, &mut near);
            for &j in &near {
                let j = j as usize;
                if j <= i || !self.particles[j].fluid() {
                    continue;
                }
                let d = self.particles[i].pos - self.particles[j].pos;
                let dist = d.length();
                let reach = WATER_RADIUS * 2.0;
                if dist >= reach {
                    continue;
                }
                let dir = if dist > 1e-4 {
                    d / dist
                } else {
                    disk(self.particles[i].id, 2).normalize_or(Vec2::X)
                };
                let shift = dir * (reach - dist) * 0.5;
                self.particles[i].pos += shift;
                self.particles[j].pos -= shift;
            }
        }
    }

    /// Pouring things stop at resting ink and at the canvas edges.
    fn collide(&mut self, prev: &[Vec2], touched: &mut [bool]) {
        let mut near = Vec::new();
        #[allow(clippy::needless_range_loop)] // the body reborrows particles[i] mutably
        for i in 0..self.particles.len() {
            let p = &self.particles[i];
            if p.fluid() {
                let mut pos = p.pos;
                let before = prev.get(i).copied().unwrap_or(pos);
                self.solids.near(pos, &mut near);
                for &j in &near {
                    let q = &self.particles[j as usize];
                    if !q.solid() {
                        continue;
                    }
                    let reach = WATER_RADIUS + q.solid_radius();
                    let d = pos - q.pos;
                    let dist = d.length();
                    if dist >= reach {
                        continue;
                    }
                    // Pushed past the middle of the ink this tick: send it
                    // back out the side it came from, not through.
                    let from = before - q.pos;
                    let dir = if d.dot(from) < 0.0 || dist < 1e-4 {
                        from.normalize_or(Vec2::NEG_Y)
                    } else {
                        d / dist
                    };
                    pos = q.pos + dir * reach.max(dir.dot(d));
                    touched[i] = true;
                }
                self.particles[i].pos = pos;
            }
            let p = &mut self.particles[i];
            if p.fluid() {
                let r = WATER_RADIUS;
                let inside = Vec2::new(p.pos.x.clamp(r, WIDTH - r), p.pos.y.min(HEIGHT - r));
                if inside != p.pos {
                    p.pos = inside;
                    touched[i] = true;
                }
            }
        }
    }

    fn apply_rules(&mut self) {
        if !self.rules_on.iter().any(|&on| on) {
            return;
        }
        self.grid
            .build(self.particles.iter().enumerate().map(|(i, p)| (i as u32, p.pos)));
        let mut hits = Vec::new();
        for (rule, note) in RULES.iter().enumerate() {
            let Some(basics) = note.basics else { continue };
            if !self.rules_on[rule] {
                continue;
            }
            for basic in basics {
                match *basic {
                    Basic::Change {
                        who,
                        near: of,
                        radius,
                        prop,
                        rate,
                    } => {
                        hits.clear();
                        for (i, p) in self.particles.iter().enumerate() {
                            if p.dead || p.material != who {
                                continue;
                            }
                            let touched = self.grid.any_near(p.pos, |j| {
                                let q = &self.particles[j as usize];
                                !q.dead
                                    && of.contains(&q.material)
                                    && q.pos.distance_squared(p.pos) < radius * radius
                            });
                            if touched {
                                hits.push(i);
                            }
                        }
                        for &i in &hits {
                            *prop_mut(&mut self.particles[i], prop) += rate * DT;
                        }
                    }
                    Basic::Convert {
                        who,
                        prop,
                        at,
                        vary,
                        to,
                    } => {
                        for p in &mut self.particles {
                            if p.dead || p.material != who {
                                continue;
                            }
                            let threshold = at * (1.0 + vary * (unit(p.id, 3) * 2.0 - 1.0));
                            if *prop_mut(p, prop) >= threshold {
                                convert(p, to, MadeBy::Rule(rule));
                            }
                        }
                    }
                }
            }
        }
    }

    /// What each material does on its own.
    fn nature(&mut self) {
        let mut born = Vec::new();
        for p in &mut self.particles {
            match p.material {
                Material::Fire => {
                    p.fuel -= DT;
                    if (p.age + (p.id % 6) as Tick).is_multiple_of(6) {
                        let id = mix(p.id, p.age as u64);
                        let mut f = Particle::new(
                            id,
                            Material::Flame,
                            p.pos + disk(id, 0) * p.radius * 0.6,
                            3.0 + unit(id, 1) * 2.5,
                            p.made_by,
                        );
                        f.vel = Vec2::new(0.0, -40.0);
                        f.fuel = 0.45 + unit(id, 2) * 0.5;
                        born.push(f);
                    }
                    if p.fuel <= 0.0 {
                        let made_by = p.made_by;
                        convert(p, Becomes::Material(Material::Ash), made_by);
                    }
                }
                Material::Flame => {
                    p.fuel -= DT;
                    if p.fuel <= 0.0 || p.pos.y < -20.0 {
                        p.dead = true;
                    }
                }
                Material::Ink if p.wet > 0.0 => p.wet = (p.wet - 0.15 * DT).max(0.0),
                _ => {}
            }
        }
        self.particles.extend(born);
    }

    pub(crate) fn apply_keys(&mut self, script: &[Entry]) {
        for e in script {
            if e.key.tick > self.tick {
                break;
            }
            match &e.key.body {
                crate::key::Body::Rule { rule, on } if e.key.tick == self.tick => {
                    self.rules_on[*rule] = *on;
                }
                crate::key::Body::Rule { .. } => {}
                crate::key::Body::Stroke(stroke) => {
                    let dt = self.tick - e.key.tick;
                    let lo = e.dabs.partition_point(|d| d.dt < dt);
                    let hi = e.dabs.partition_point(|d| d.dt <= dt);
                    for i in lo..hi {
                        self.emit(e.key.id, stroke, i, e.dabs[i]);
                    }
                }
            }
        }
    }

    /// Put down dab `index` of a stroke.
    pub(crate) fn emit(&mut self, key: KeyId, stroke: &Stroke, index: usize, dab: Dab) {
        let made_by = MadeBy::Key(key);
        let seed = mix(key.0 as u64, index as u64);
        let r = stroke.radius;
        match stroke.brush {
            Brush::Ink => {
                self.particles
                    .push(Particle::new(seed, Material::Ink, dab.pos, r, made_by));
            }
            Brush::Water => {
                for k in 0..2 {
                    let id = mix(seed, k);
                    let pos = dab.pos + disk(id, 0) * r * 0.6;
                    let mut p = Particle::new(id, Material::Water, pos, WATER_RADIUS, made_by);
                    p.vel = dab.step * 4.0;
                    self.particles.push(p);
                }
            }
            Brush::Fire => {
                let mut p = Particle::new(seed, Material::Fire, dab.pos, 4.0, made_by);
                p.fuel = 4.0 + unit(seed, 1) * 3.0;
                self.particles.push(p);
            }
            Brush::Tree => self.plant(seed, dab.pos, r, made_by),
            Brush::Smudge => {
                let reach = r * 2.5;
                for p in &mut self.particles {
                    let carried = p.wet_ink() || p.fluid();
                    let dist = p.pos.distance(dab.pos);
                    if carried && dist < reach {
                        p.pos += dab.step * (1.0 - dist / reach) * 0.8;
                    }
                }
            }
        }
    }

    /// A tree: a trunk and a canopy, hung in a frame that sways and settles.
    fn plant(&mut self, seed: u64, base: Vec2, size: f32, made_by: MadeBy) {
        let height = size * 8.0;
        let index = self.trees.len() as u32;
        let sign = if unit(seed, 1) < 0.5 { -1.0 } else { 1.0 };
        let tree = Tree {
            base,
            height,
            angle: 0.0,
            spin: sign * (0.8 + unit(seed, 2) * 0.8),
        };
        let hang = |id: u64, home: Vec2, radius: f32, trunk: bool| {
            let mut p = Particle::new(id, Material::Tree, tree.place(home), radius, made_by);
            p.tree = Some(index);
            p.home = home;
            p.trunk = trunk;
            p
        };
        let mut parts = Vec::new();
        let trunk_len = height * 0.55;
        let mut y = 0.0;
        let mut k = 0;
        while y <= trunk_len {
            parts.push(hang(mix(seed, 100 + k), Vec2::new(0.0, -y), size * 0.45, true));
            y += 2.5;
            k += 1;
        }
        let crown = Vec2::new(0.0, -height * 0.68);
        for k in 0..28 {
            let id = mix(seed, 200 + k);
            let off = disk(id, 0) * height * 0.3 * Vec2::new(1.0, 0.85);
            parts.push(hang(id, crown + off, (height * 0.09).max(3.0), false));
        }
        self.trees.push(tree);
        self.particles.extend(parts);
    }
}

fn prop_mut(p: &mut Particle, prop: Prop) -> &mut f32 {
    match prop {
        Prop::Heat => &mut p.heat,
        Prop::Wet => &mut p.wet,
    }
}

fn convert(p: &mut Particle, to: Becomes, made_by: MadeBy) {
    let Becomes::Material(m) = to else {
        p.dead = true;
        return;
    };
    p.material = m;
    p.made_by = made_by;
    p.age = 0;
    p.heat = 0.0;
    p.wet = 0.0;
    match m {
        Material::Fire => p.fuel = 3.5 + unit(p.id, 4) * 3.0,
        Material::Ash => {
            p.tree = None;
            p.vel = Vec2::ZERO;
            p.radius = (p.radius * 0.8).max(2.0);
        }
        _ => {}
    }
}

/// Rotation by a small angle, from series rather than libm so every machine
/// agrees bit for bit. Trees never lean past half a radian.
fn rotate(v: Vec2, a: f32) -> Vec2 {
    let a2 = a * a;
    let s = a * (1.0 - a2 / 6.0);
    let c = 1.0 - a2 / 2.0 + a2 * a2 / 24.0;
    Vec2::new(v.x * c - v.y * s, v.x * s + v.y * c)
}

fn splitmix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

pub(crate) fn mix(a: u64, b: u64) -> u64 {
    splitmix(a ^ splitmix(b).rotate_left(17))
}

/// A steady value in 0..1 for `id` and `salt`.
pub(crate) fn unit(id: u64, salt: u64) -> f32 {
    (mix(id, salt) >> 40) as f32 / (1u64 << 24) as f32
}

/// A steady point in the unit disk for `id` and `salt`.
fn disk(id: u64, salt: u64) -> Vec2 {
    let mut j = 0;
    loop {
        let h = mix(id, salt.wrapping_mul(31).wrapping_add(j));
        let x = (h >> 40) as f32 / (1u64 << 24) as f32 * 2.0 - 1.0;
        let y = ((h >> 16) & 0xFF_FFFF) as f32 / (1u64 << 24) as f32 * 2.0 - 1.0;
        if x * x + y * y <= 1.0 {
            return Vec2::new(x, y);
        }
        j += 1;
    }
}
