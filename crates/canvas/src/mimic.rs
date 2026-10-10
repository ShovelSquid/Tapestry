//! Mimics: little creatures with a coloured core and four or five inky
//! tentacles, wandering the canvas, and between them, the swarm's links.
//!
//! What you see and what the swarm is are kept apart. The body is physics:
//! a core and tentacles of rope, reaching, gripping the paper and pulling.
//! The structure is [`Link`]s: discrete, weighted, inspectable. A tentacle
//! holding another mimic acts a link out, and only then does anything pass
//! along it: a pulse carrying the holder's state runs down to the other's
//! core, which takes it in, jiggles, and sends its own state back. What
//! each mimic makes of what it hears is its [mind](crate::mind), and its
//! colour is only a view of that.
//!
//! Links also hold the swarm together physically: a dragged mimic pulls
//! its partners, and theirs, as strongly as they're linked.
//!
//! Determinism as in the rest of the sim: fixed tick, mimics, tentacles and
//! links visited in order, everyone reading the state as it was at the start
//! of the tick, randomness only from hashing IDs and ticks, and no
//! trigonometry from the platform's libm.

use std::collections::HashMap;

use glam::{Vec2, Vec3};

use crate::key::{DT, Tick};
use crate::link::{Link, pair};
use crate::mind::{self, N, Species, THINK, Vector, cosine};
use crate::sim::{HEIGHT, MadeBy, WIDTH, disk, unit};

/// Points along a tentacle, its root (at the core) first.
pub const SEGS: usize = 9;
/// A mimic holds (or is held by) at most this many others at once, so they
/// make chains and rings rather than piling into one ball.
const MAX_HELD: usize = 2;
/// Ticks a pulse takes to run the length of a tentacle.
const PULSE_TICKS: f32 = 36.0;
/// How much of a message gets in, at full link weight.
const HEAR: f32 = 0.5;
/// Ticks a cut pair waits before either may take hold of the other again.
const CUT_FOR: Tick = 600;
/// How far in front of and behind the paper mimics roam, in depth.
pub const DEPTH: f32 = 450.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hold {
    /// Reaching for `goal`, or curled up.
    Free,
    /// Gripping the paper here, and pulling the core towards it.
    Ground(Vec3),
    /// Holding the mimic with this id: acting out their link.
    Mimic(u64),
}

/// A message travelling along a tentacle.
#[derive(Clone, Copy, Debug)]
pub struct Pulse {
    /// 0 at the root, 1 at the tip.
    pub at: f32,
    /// The sender's state when it set off.
    pub message: Vector,
    /// Root to tip: from the holder to the one held. Else back.
    pub outward: bool,
}

#[derive(Clone, Debug)]
pub struct Arm {
    pub points: [Vec3; SEGS],
    prev: [Vec3; SEGS],
    /// Which way it points from the core when nothing else says.
    home: Vec3,
    /// How long it is now: it grows while reaching and shrinks while pulling.
    pub length: f32,
    pub hold: Hold,
    goal: Vec3,
    /// Reaching for `goal`; else curled up, resting.
    reaching: bool,
    /// The mimic it's reaching for, if any.
    aim: Option<u64>,
    /// Ticks left in what it's doing.
    timer: u32,
    /// Ticks until the one held answers a pulse with its own state.
    echo: Option<u32>,
    pub pulses: Vec<Pulse>,
}

/// The note a mimic carries.
#[derive(Clone, Debug, PartialEq)]
pub struct Carried {
    /// The note's file name, without `.md`.
    pub name: String,
    pub title: String,
}

#[derive(Clone, Debug)]
pub struct Mimic {
    pub id: u64,
    /// Where it is: x and y on the canvas, z in front of (less than 0) or
    /// behind (more than 0) the paper.
    pub core: Vec3,
    vel: Vec3,
    /// The core's radius; tentacles reach eleven times it.
    pub size: f32,
    pub species: Species,
    /// What it has in mind.
    pub state: Vector,
    /// What it carries: its note's vector, or an identity of its own.
    pub input: Vector,
    /// Messages that got in since it last thought.
    inbox: Vector,
    pub note: Option<Carried>,
    /// Held in place by the author.
    pub pinned: bool,
    /// How far the core is squashed from round, after a message.
    pub jiggle: f32,
    jiggle_vel: f32,
    /// Which way it's wandering.
    heading: Vec3,
    pub arms: Vec<Arm>,
    pub made_by: MadeBy,
}

impl Mimic {
    pub(crate) fn new(id: u64, at: Vec3, size: f32, made_by: MadeBy) -> Self {
        let size = size.clamp(4.0, 16.0);
        let n = if unit(id, 1) < 0.5 { 4 } else { 5 };
        // Evenly round the core, from a turn of its own. cos and sin of a
        // quarter and a fifth of a turn, written out.
        let (c, s) = if n == 4 { (0.0, 1.0) } else { (0.309_017, 0.951_056_5) };
        let mut dir = disk(id, 2).normalize_or(Vec2::X);
        // Each tentacle tilts out of the paper a little, so in depth they
        // reach every way.
        let tilt = |k: usize| (unit(id, 30 + k as u64) - 0.5) * 0.9;
        let mut arms = Vec::with_capacity(n);
        for k in 0..n {
            let length = size * 3.0;
            let home = dir.extend(tilt(k)).normalize();
            let mut points = [at; SEGS];
            for (i, p) in points.iter_mut().enumerate() {
                *p = at + home * length * i as f32 / (SEGS - 1) as f32;
            }
            arms.push(Arm {
                points,
                prev: points,
                home,
                length,
                hold: Hold::Free,
                goal: points[SEGS - 1],
                reaching: false,
                aim: None,
                // Staggered, so they don't all reach at once.
                timer: 10 + (unit(id, 10 + k as u64) * 60.0) as u32,
                echo: None,
                pulses: Vec::new(),
            });
            dir = Vec2::new(dir.x * c - dir.y * s, dir.x * s + dir.y * c);
        }
        let input = mind::identity(id);
        Self {
            id,
            core: at,
            vel: Vec3::ZERO,
            size,
            species: Species::of(id),
            state: mind::think(&[0.0; N], &input, &[0.0; N]),
            input,
            inbox: [0.0; N],
            note: None,
            pinned: false,
            jiggle: 0.0,
            jiggle_vel: 0.0,
            heading: disk(id, 4).normalize_or(Vec2::Y).extend(0.0),
            arms,
            made_by,
        }
    }

    pub fn reach(&self) -> f32 {
        self.size * 11.0
    }

    /// Its state as a colour.
    pub fn color(&self) -> [f32; 3] {
        mind::color(&self.state)
    }

    /// The mimics it's holding, or reaching for.
    fn holding(&self) -> impl Iterator<Item = u64> + '_ {
        self.arms.iter().filter_map(|a| match a.hold {
            Hold::Mimic(id) => Some(id),
            _ => a.aim,
        })
    }

    /// Take a message in, and jiggle with it.
    fn hear(&mut self, message: &Vector, weight: f32) {
        for (x, m) in self.inbox.iter_mut().zip(message) {
            *x += HEAR * weight * m;
        }
        self.jiggle_vel += 9.0;
    }
}

impl Arm {
    /// Stop reaching, and rest curled up for a while.
    fn rest(&mut self, ticks: u32) {
        self.reaching = false;
        self.aim = None;
        self.timer = ticks;
    }

    fn let_go(&mut self, ticks: u32) {
        self.hold = Hold::Free;
        self.pulses.clear();
        self.echo = None;
        self.rest(ticks);
    }
}

/// The author's say on a pair of notes' link.
#[derive(Clone, Debug, PartialEq)]
pub struct Verdict {
    pub a: u64,
    pub b: u64,
    pub keep: bool,
}

/// Something proposed: these two notes belong together.
#[derive(Clone, Debug)]
pub struct Proposal {
    pub a: Carried,
    pub b: Carried,
    pub weight: f32,
    /// Seconds it has been strong.
    pub for_secs: f32,
    pub history: [f32; 12],
}

/// Every mimic and every link.
#[derive(Clone, Default)]
pub struct Swarm {
    pub mimics: Vec<Mimic>,
    pub links: Vec<Link>,
    pub verdicts: Vec<Verdict>,
    /// Pairs cut by the author, and the tick until which they stay apart.
    cut: Vec<(u64, u64, Tick)>,
    /// How alike two minds in the swarm usually are: the mean and spread of
    /// their likeness, over a steady sample of pairs, as of the last thought.
    pub typical: (f32, f32),
    /// Mimics roam in depth, in front of and behind the paper. Without, the
    /// paper pulls them flat.
    pub depth: bool,
}

/// A pulse got to the end of its tentacle: whose core takes it in.
struct Arrival {
    to: usize,
    message: Vector,
    weight: f32,
}

impl Swarm {
    pub fn mimic(&self, id: u64) -> Option<&Mimic> {
        self.mimics.iter().find(|m| m.id == id)
    }

    pub fn link(&self, x: u64, y: u64) -> Option<&Link> {
        self.links.iter().find(|l| l.joins(x, y))
    }

    /// The mimic carrying the note named `name`.
    pub fn carrier(&self, name: &str) -> Option<&Mimic> {
        self.mimics.iter().find(|m| m.note.as_ref().is_some_and(|n| n.name == name))
    }

    /// Links between notes that have stayed strong long enough, and that
    /// the author hasn't ruled on: strongest first.
    pub fn proposals(&self) -> Vec<Proposal> {
        let mut out: Vec<Proposal> = self
            .links
            .iter()
            .filter(|l| !l.pinned && l.strong >= crate::link::PROPOSE_AFTER)
            .filter(|l| !self.verdicts.iter().any(|v| pair(v.a, v.b) == (l.a, l.b)))
            .filter_map(|l| {
                Some(Proposal {
                    a: self.mimic(l.a)?.note.clone()?,
                    b: self.mimic(l.b)?.note.clone()?,
                    weight: l.weight,
                    for_secs: (l.strong * THINK) as f32 / crate::key::TICKS_PER_SECOND as f32,
                    history: l.history,
                })
            })
            .collect();
        out.sort_by(|x, y| y.weight.total_cmp(&x.weight));
        out
    }

    pub(crate) fn add(&mut self, m: Mimic) {
        self.mimics.push(m);
    }

    /// Put down a mimic carrying a note, or give the one carrying it the
    /// note as it now reads.
    pub(crate) fn carry(&mut self, note: Carried, pos: Vec2, vector: Vector, made_by: MadeBy) {
        let id = crate::text::note_id(&note.name);
        if let Some(m) = self.mimics.iter_mut().find(|m| m.id == id) {
            m.input = vector;
            m.note = Some(note);
            return;
        }
        let mut m = Mimic::new(id, pos.extend(0.0), 9.0, made_by);
        m.input = vector;
        m.state = mind::think(&[0.0; N], &vector, &[0.0; N]);
        m.note = Some(note);
        self.mimics.push(m);
    }

    pub(crate) fn pin(&mut self, id: u64, on: bool) {
        if let Some(m) = self.mimics.iter_mut().find(|m| m.id == id) {
            m.pinned = on;
        }
    }

    /// Cut the link between two mimics, and keep them apart a while.
    pub(crate) fn cut(&mut self, x: u64, y: u64, tick: Tick) {
        self.links.retain(|l| !l.joins(x, y));
        self.release(x, y);
        let (a, b) = pair(x, y);
        self.cut.retain(|c| (c.0, c.1) != (a, b));
        self.cut.push((a, b, tick + CUT_FOR));
    }

    /// The author's verdict on two notes' link: kept, it's pinned; turned
    /// down, it's cut, and the pair learns slowly from then on.
    pub(crate) fn rule(&mut self, a: &str, b: &str, keep: bool, tick: Tick) {
        let (x, y) = (crate::text::note_id(a), crate::text::note_id(b));
        let (a, b) = pair(x, y);
        self.verdicts.retain(|v| pair(v.a, v.b) != (a, b));
        self.verdicts.push(Verdict { a, b, keep });
        if keep {
            if !self.links.iter().any(|l| l.joins(a, b)) {
                self.links.push(Link::new(a, b, tick, 1.0));
            }
            for l in self.links.iter_mut().filter(|l| l.joins(a, b)) {
                l.pinned = true;
                l.weight = 1.0;
            }
        } else {
            self.links.retain(|l| !l.joins(a, b));
            self.release(a, b);
        }
    }

    /// Any tentacle either holds the other with lets go.
    fn release(&mut self, x: u64, y: u64) {
        for m in &mut self.mimics {
            let other = if m.id == x {
                y
            } else if m.id == y {
                x
            } else {
                continue;
            };
            for arm in &mut m.arms {
                if arm.hold == Hold::Mimic(other) || arm.aim == Some(other) {
                    arm.let_go(30);
                }
            }
        }
    }

    /// One tick. `drags` are mimics the author has hold of, and where on
    /// the canvas (they keep their depth).
    pub(crate) fn step(&mut self, tick: Tick, drags: &[(u64, Vec2)]) {
        let depth = self.depth;
        // Out of depth, what points into the paper doesn't count.
        let flat = |v: Vec3| if depth { v } else { Vec3::new(v.x, v.y, 0.0) };
        let n = self.mimics.len();
        if n == 0 {
            return;
        }
        self.cut.retain(|c| c.2 > tick);
        // Everyone as they were at the start of the tick: what one mimic
        // does can't depend on what those before it did this tick.
        let cores: Vec<Vec3> = self.mimics.iter().map(|m| m.core).collect();
        let states: Vec<Vector> = self.mimics.iter().map(|m| m.state).collect();
        let ids: Vec<u64> = self.mimics.iter().map(|m| m.id).collect();
        let index: HashMap<u64, usize> = ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();
        let find = |id: u64| index.get(&id).copied();
        let weights: HashMap<(u64, u64), f32> = self.links.iter().map(|l| ((l.a, l.b), l.weight)).collect();
        let weight_of = |x: u64, y: u64| weights.get(&pair(x, y)).copied();

        // Who holds whom.
        let mut held_count = vec![0usize; n];
        let mut held_pairs: Vec<(u64, u64)> = Vec::new();
        for (i, m) in self.mimics.iter().enumerate() {
            for other in m.holding() {
                held_count[i] += 1;
                if let Some(j) = find(other) {
                    held_count[j] += 1;
                }
                held_pairs.push(pair(m.id, other));
            }
        }
        let held = |x: u64, y: u64| held_pairs.contains(&pair(x, y));
        let cut = self.cut.clone();
        let apart = |x: u64, y: u64| cut.iter().any(|c| (c.0, c.1) == pair(x, y));
        let refused: Vec<(u64, u64)> = self.verdicts.iter().filter(|v| !v.keep).map(|v| (v.a, v.b)).collect();
        let turned_down = |x: u64, y: u64| refused.contains(&pair(x, y));

        let mut force = vec![Vec3::ZERO; n];
        let mut arrivals: Vec<Arrival> = Vec::new();
        let mut made: Vec<(u64, u64)> = Vec::new();

        for i in 0..n {
            let id = ids[i];
            let m = &mut self.mimics[i];
            let (size, reach, temper) = (m.size, m.reach(), m.species.temper());

            // Wander: the heading drifts, and turns back from the edges.
            m.heading = flat(m.heading + ball(id, 1000 + tick as u64) * 0.1).normalize_or(Vec3::Y);
            let margin = reach;
            let mut back = Vec3::ZERO;
            if m.core.x < margin {
                back.x += 1.0;
            }
            if m.core.x > WIDTH - margin {
                back.x -= 1.0;
            }
            if m.core.y < margin {
                back.y += 1.0;
            }
            if m.core.y > HEIGHT - margin {
                back.y -= 1.0;
            }
            if depth && m.core.z.abs() > DEPTH - margin {
                back.z -= m.core.z.signum();
            }
            // Holding no one, it heads for the nearest mimic out of reach.
            let roam = reach * temper.roam;
            let near = (0..n)
                .filter(|&j| j != i && held_count[i] == 0 && cores[j].distance(m.core) > reach)
                .map(|j| (cores[j].distance_squared(m.core), j))
                .filter(|&(d, _)| d < roam * roam)
                .min_by(|a, b| a.0.total_cmp(&b.0));
            let toward = near.map_or(Vec3::ZERO, |(_, j)| (cores[j] - m.core).normalize_or(Vec3::ZERO));
            m.heading = flat(m.heading + back * 0.06 + toward * 0.03).normalize_or(Vec3::Y);

            let mut gripping = m.arms.iter().filter(|a| matches!(a.hold, Hold::Ground(_))).count();
            let mut holding_here = held_count[i];
            let core = m.core;
            let state = states[i];

            for (k, arm) in m.arms.iter_mut().enumerate() {
                let salt = (k as u64) << 32 | tick as u64;
                arm.timer = arm.timer.saturating_sub(1);
                match arm.hold {
                    Hold::Free => {
                        if !arm.reaching && arm.timer == 0 {
                            // Choose where to reach next. A partner it has a
                            // link with, as readily as the link is strong;
                            // else another mimic, as readily as their minds
                            // are alike; else the paper ahead.
                            let other = (0..n).find(|&j| {
                                let them = ids[j];
                                if j == i
                                    || held(id, them)
                                    || apart(id, them)
                                    || holding_here >= MAX_HELD
                                    || held_count[j] >= MAX_HELD
                                    || cores[j].distance(core) >= reach * 0.9
                                {
                                    return false;
                                }
                                let chance = match weight_of(id, them) {
                                    Some(w) => temper.recall * (0.2 + w),
                                    None => {
                                        let alike = cosine(&state, &states[j]);
                                        let shy = if turned_down(id, them) { 0.1 } else { 1.0 };
                                        temper.social * (0.5 + 0.5 * alike) * shy
                                    }
                                };
                                unit(id ^ them, salt) < chance
                            });
                            if let Some(j) = other {
                                arm.aim = Some(ids[j]);
                                holding_here += 1;
                            } else {
                                let jitter = ball(id, salt) * 0.6;
                                let dir = flat(m.heading * 1.1 + arm.home * 0.8 + jitter).normalize_or(arm.home);
                                arm.goal = core + dir * reach * (0.6 + 0.35 * unit(id, salt ^ 7));
                            }
                            arm.reaching = true;
                            arm.timer = 40 + (unit(id, salt ^ 9) * 30.0) as u32;
                        }
                        if let Some(aim) = arm.aim {
                            match find(aim) {
                                Some(j) => arm.goal = cores[j],
                                None => arm.rest(20),
                            }
                        }
                        if arm.reaching {
                            let tip = arm.points[SEGS - 1];
                            let want = arm.goal.distance(core).min(reach);
                            arm.length += (want - arm.length) * 0.12;
                            let got = tip.distance(arm.goal) < size * 1.5;
                            let tired = arm.timer == 0;
                            if let Some(aim) = arm.aim {
                                if got {
                                    arm.hold = Hold::Mimic(aim);
                                    arm.reaching = false;
                                    arm.aim = None;
                                    // Held for a while, then let go.
                                    let ticks = 300.0 + unit(id ^ aim, salt) * 420.0;
                                    arm.timer = (ticks * temper.hold) as u32;
                                    arm.pulses.push(Pulse { at: 0.0, message: state, outward: true });
                                    made.push(pair(id, aim));
                                } else if tired || arm.goal.distance(core) > reach {
                                    arm.rest(20);
                                }
                            } else if (got || tired) && gripping < 2 {
                                arm.hold = Hold::Ground(tip);
                                arm.reaching = false;
                                gripping += 1;
                                arm.timer = 50 + (unit(id, salt ^ 11) * 40.0) as u32;
                            } else if tired {
                                arm.rest(10);
                            }
                        } else {
                            // Curled up, near the core.
                            arm.length += (reach * 0.3 - arm.length) * 0.08;
                            arm.goal = core + flat(arm.home).normalize_or(arm.home) * arm.length;
                        }
                    }
                    Hold::Ground(at) => {
                        // Pull: shorten, and the core follows.
                        arm.length = (arm.length - reach * 0.012).max(reach * 0.2);
                        let d = at - core;
                        let dist = d.length();
                        if dist > arm.length {
                            force[i] += d / dist.max(1e-4) * (dist - arm.length) * 9.0;
                        }
                        // Done pulling, or dragged off: it slips.
                        if arm.timer == 0 || dist < reach * 0.25 || dist > reach {
                            arm.hold = Hold::Free;
                            arm.rest(8 + (unit(id, salt ^ 13) * 25.0) as u32);
                        }
                    }
                    Hold::Mimic(other) => {
                        let Some(j) = find(other) else {
                            arm.let_go(30);
                            continue;
                        };
                        // (The link is made at the end of the tick it took hold.)
                        let weight = weight_of(id, other).unwrap_or(crate::link::BORN);
                        let d = cores[j] - core;
                        let dist = d.length();
                        arm.length = dist.min(reach);
                        // A soft spring: they keep to about half a reach apart.
                        let rest = reach * 0.5;
                        let pull = d / dist.max(1e-4) * (dist - rest) * 2.5;
                        force[i] += pull;
                        force[j] -= pull;
                        // Pulses: out with the holder's state, back with the other's.
                        let quiet = !arm.pulses.iter().any(|p| p.outward) && arm.echo.is_none();
                        if quiet && (tick + k as Tick).is_multiple_of(90) {
                            arm.pulses.push(Pulse { at: 0.0, message: state, outward: true });
                        }
                        if let Some(e) = arm.echo.as_mut() {
                            *e = e.saturating_sub(1);
                            if *e == 0 {
                                arm.echo = None;
                                arm.pulses.push(Pulse { at: 1.0, message: states[j], outward: false });
                            }
                        }
                        for p in &mut arm.pulses {
                            p.at += if p.outward { 1.0 } else { -1.0 } / PULSE_TICKS;
                        }
                        let mut keep = Vec::with_capacity(arm.pulses.len());
                        for p in arm.pulses.drain(..) {
                            if p.outward && p.at >= 1.0 {
                                arrivals.push(Arrival { to: j, message: p.message, weight });
                                arm.echo = Some(20);
                            } else if !p.outward && p.at <= 0.0 {
                                arrivals.push(Arrival { to: i, message: p.message, weight });
                            } else {
                                keep.push(p);
                            }
                        }
                        arm.pulses = keep;
                        // Minds that disagree tire of each other sooner.
                        if cosine(&state, &states[j]) < 0.0 {
                            arm.timer = arm.timer.saturating_sub(1);
                        }
                        if arm.timer == 0 || dist > reach * 1.15 {
                            arm.let_go(30);
                        }
                    }
                }
            }
        }

        for a in arrivals {
            self.mimics[a.to].hear(&a.message, a.weight);
        }
        made.sort_unstable();
        made.dedup();
        for (a, b) in made {
            if !self.links.iter().any(|l| l.joins(a, b)) {
                let plasticity = if turned_down(a, b) { 0.2 } else { 1.0 };
                self.links.push(Link::new(a, b, tick, plasticity));
            }
        }

        // Links hold the swarm together: past a loose length, partners pull
        // on each other as hard as they're linked.
        for l in &self.links {
            let (Some(i), Some(j)) = (find(l.a), find(l.b)) else { continue };
            let d = cores[j] - cores[i];
            let dist = d.length();
            let rest = (self.mimics[i].reach() + self.mimics[j].reach()) * 0.35;
            if dist > rest {
                let pull = d / dist * (dist - rest) * 12.0 * l.weight;
                force[i] += pull;
                force[j] -= pull;
            }
        }

        // Cores keep a little apart.
        for i in 0..n {
            for j in i + 1..n {
                let d = cores[i] - cores[j];
                let dist = d.length();
                let near = (self.mimics[i].reach() + self.mimics[j].reach()) * 0.22;
                if dist < near {
                    let dir = if dist > 1e-4 { d / dist } else { flat(ball(ids[i] ^ ids[j], 5)).normalize_or(Vec3::X) };
                    let push = dir * (near - dist) * 12.0;
                    force[i] += push;
                    force[j] -= push;
                }
            }
        }

        let thinking = tick.is_multiple_of(THINK);
        for (m, f) in self.mimics.iter_mut().zip(&force) {
            let before = m.core;
            let r = m.size;
            if let Some(&(_, to)) = drags.iter().find(|d| d.0 == m.id) {
                // Held by the author: it goes where it's put, at its depth.
                m.core = Vec3::new(to.x.clamp(r, WIDTH - r), to.y.clamp(r, HEIGHT - r), m.core.z);
                m.vel = Vec3::ZERO;
            } else if m.pinned {
                m.vel = Vec3::ZERO;
            } else {
                let mut f = *f;
                if !depth {
                    // The paper pulls it flat.
                    f.z = -m.core.z * 12.0 - m.vel.z * 2.0;
                }
                m.vel = (m.vel + f * DT) * 0.86;
                m.vel = m.vel.clamp_length_max(140.0);
                m.core += m.vel * DT;
                let deep = if depth { DEPTH - r } else { DEPTH };
                m.core = Vec3::new(
                    m.core.x.clamp(r, WIDTH - r),
                    m.core.y.clamp(r, HEIGHT - r),
                    m.core.z.clamp(-deep, deep),
                );
            }
            if thinking {
                m.state = mind::think(&m.state, &m.input, &m.inbox);
                m.inbox = [0.0; N];
            }
            m.jiggle_vel += (-120.0 * m.jiggle - 7.0 * m.jiggle_vel) * DT;
            m.jiggle += m.jiggle_vel * DT;
            let moved = m.core - before;
            let (id, sway) = (m.id, tick as f32 * 0.05);
            for (k, arm) in m.arms.iter_mut().enumerate() {
                let tip_to = match arm.hold {
                    Hold::Ground(at) => Some(at),
                    Hold::Mimic(other) => find(other).map(|j| cores[j]),
                    Hold::Free => None,
                };
                arm.body(m.core, moved, tip_to, sway + unit(id, 20 + k as u64) * 3.0);
            }
        }

        if thinking {
            // Learn from the states just thought: held links toward how
            // alike their ends are, the rest fading.
            let states: Vec<Vector> = self.mimics.iter().map(|m| m.state).collect();
            self.typical = typical(&states);
            let second = tick.is_multiple_of(crate::key::TICKS_PER_SECOND);
            for l in &mut self.links {
                let (Some(i), Some(j)) = (find(l.a), find(l.b)) else { continue };
                l.learn(&states[i], &states[j], held(l.a, l.b), self.typical);
                if second {
                    l.remember();
                }
            }
            self.links
                .retain(|l| find(l.a).is_some() && find(l.b).is_some() && !l.gone(held(l.a, l.b)));
        }
    }
}

impl Arm {
    /// Move the tentacle's points: a rope from the core, its tip drawn to
    /// where it's going, with a slow wave along it.
    /// `tip_to` is what the tip is holding, if anything; `sway` where its
    /// wave is up to.
    fn body(&mut self, core: Vec3, moved: Vec3, tip_to: Option<Vec3>, sway: f32) {
        let seg = self.length / (SEGS - 1) as f32;
        for i in 1..SEGS {
            let p = self.points[i];
            // Free points drift along a little when the core moves.
            let v = (p - self.prev[i]) * 0.8 + moved * 0.3;
            self.prev[i] = p;
            self.points[i] = p + v;
        }
        match tip_to {
            Some(at) => self.points[SEGS - 1] = at,
            None => {
                let tip = &mut self.points[SEGS - 1];
                *tip += (self.goal - *tip) * 0.18;
            }
        }
        // A wave along the tentacle, side to side, slower near the root.
        let along = (self.points[SEGS - 1] - core).normalize_or(self.home);
        // Sideways: across the paper's plane where it can be.
        let side = along.cross(Vec3::Z).try_normalize().unwrap_or(Vec3::X);
        for i in 1..SEGS - 1 {
            let f = i as f32 / (SEGS - 1) as f32;
            self.points[i] += side * wave(sway * 2.0 + f * 3.0) * 0.35 * f;
        }
        // Keep the segments their length, root pinned to the core.
        for _ in 0..4 {
            self.points[0] = core;
            for i in 0..SEGS - 1 {
                let d = self.points[i + 1] - self.points[i];
                let dist = d.length();
                if dist < 1e-4 {
                    continue;
                }
                let fix = d * ((dist - seg) / dist) * 0.5;
                if i == 0 {
                    self.points[i + 1] -= fix * 2.0;
                } else {
                    self.points[i] += fix;
                    self.points[i + 1] -= fix;
                }
            }
            if let Some(at) = tip_to {
                self.points[SEGS - 1] = at;
            }
        }
        self.points[0] = core;
    }
}

/// The mean and spread of how alike minds are, over each mimic and the
/// next eight after it (all pairs, in a small swarm).
fn typical(states: &[Vector]) -> (f32, f32) {
    let n = states.len();
    let (mut sum, mut sq, mut count) = (0.0, 0.0, 0.0);
    for i in 0..n {
        for k in 1..=8.min(n.saturating_sub(1) / 2).max(1) {
            let j = (i + k) % n;
            if j == i {
                continue;
            }
            let c = cosine(&states[i], &states[j]);
            sum += c;
            sq += c * c;
            count += 1.0;
        }
    }
    if count == 0.0 {
        return (0.0, 0.1);
    }
    let mean = sum / count;
    (mean, (sq / count - mean * mean).max(0.0).sqrt())
}

/// A sine-like wave from a parabola, the same on every machine.
fn wave(x: f32) -> f32 {
    const TAU: f32 = std::f32::consts::TAU;
    const PI: f32 = std::f32::consts::PI;
    let t = x - (x / TAU).floor() * TAU - PI;
    let y = 4.0 / PI * t - 4.0 / (PI * PI) * t * t.abs();
    -y
}

/// A steady point in the unit ball for `id` and `salt`.
fn ball(id: u64, salt: u64) -> Vec3 {
    let mut j = 0;
    loop {
        let k = salt.wrapping_mul(31).wrapping_add(j);
        let v = Vec3::new(unit(id, k) * 2.0 - 1.0, unit(id, k ^ 0x5555) * 2.0 - 1.0, unit(id, k ^ 0xaaaa) * 2.0 - 1.0);
        if v.length_squared() <= 1.0 {
            return v;
        }
        j += 1;
    }
}
