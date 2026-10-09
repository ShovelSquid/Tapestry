//! Mimics: little creatures with a coloured core and four or five inky
//! tentacles, wandering the canvas.
//!
//! They aren't clever. A tentacle reaches out, grips the paper, and pulls
//! the core after it; reaching for another mimic instead, it holds on and
//! the two trade colour along it. A pulse of the holder's colour runs down
//! to the other's core, which takes some in, jiggles, and sends its own
//! colour back. Mimics that hold each other long enough come to share a
//! colour, so a colour on the canvas marks who has been in touch with whom;
//! apart, each drifts back to the colour it was born with.
//!
//! Determinism as in the rest of the sim: fixed tick, mimics and their
//! tentacles visited in order, randomness only from hashing IDs and ticks,
//! and no trigonometry from the platform's libm.

use glam::Vec2;

use crate::key::{DT, Tick};
use crate::sim::{HEIGHT, MadeBy, WIDTH, disk, unit};

/// Points along a tentacle, its root (at the core) first.
pub const SEGS: usize = 9;
/// A mimic holds at most this many others at once, so they make chains
/// and rings rather than piling into one ball.
const MAX_LINKS: usize = 2;
/// Ticks a pulse takes to run the length of a tentacle.
const PULSE_TICKS: f32 = 36.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hold {
    /// Reaching for `goal`, or curled up.
    Free,
    /// Gripping the paper here, and pulling the core towards it.
    Ground(Vec2),
    /// Holding the mimic with this id.
    Mimic(u64),
}

/// Colour travelling along a tentacle.
#[derive(Clone, Copy, Debug)]
pub struct Pulse {
    /// 0 at the root, 1 at the tip.
    pub at: f32,
    pub color: [f32; 3],
    /// Root to tip: from the holder to the one held. Else back.
    pub outward: bool,
}

#[derive(Clone, Debug)]
pub struct Arm {
    pub points: [Vec2; SEGS],
    prev: [Vec2; SEGS],
    /// Which way it points from the core when nothing else says.
    home: Vec2,
    /// How long it is now: it grows while reaching and shrinks while pulling.
    pub length: f32,
    pub hold: Hold,
    goal: Vec2,
    /// Reaching for `goal`; else curled up, resting.
    reaching: bool,
    /// The mimic it's reaching for, if any.
    aim: Option<u64>,
    /// Ticks left in what it's doing.
    timer: u32,
    /// Ticks until the one held answers a pulse with its own colour.
    echo: Option<u32>,
    pub pulses: Vec<Pulse>,
}

#[derive(Clone, Debug)]
pub struct Mimic {
    pub id: u64,
    pub core: Vec2,
    vel: Vec2,
    /// The core's radius; tentacles reach about nine times it.
    pub size: f32,
    /// Red, green, blue, 0..1.
    pub color: [f32; 3],
    /// The colour it was born with, which it slowly drifts back to: what it
    /// takes in from others is a tint, not a replacement.
    pub own: [f32; 3],
    /// How far the core is squashed from round, after taking in colour.
    pub jiggle: f32,
    jiggle_vel: f32,
    /// Which way it's wandering.
    heading: Vec2,
    pub arms: Vec<Arm>,
    pub made_by: MadeBy,
}

/// Inks a new mimic's core can start as.
const PALETTE: [[f32; 3]; 7] = [
    [0.86, 0.22, 0.20],
    [0.95, 0.62, 0.12],
    [0.93, 0.83, 0.20],
    [0.25, 0.66, 0.36],
    [0.18, 0.52, 0.80],
    [0.48, 0.30, 0.78],
    [0.88, 0.36, 0.62],
];

impl Mimic {
    pub(crate) fn new(id: u64, at: Vec2, size: f32, made_by: MadeBy) -> Self {
        let size = size.clamp(4.0, 16.0);
        let n = if unit(id, 1) < 0.5 { 4 } else { 5 };
        // Evenly round the core, from a turn of its own. cos and sin of a
        // quarter and a fifth of a turn, written out.
        let (c, s) = if n == 4 { (0.0, 1.0) } else { (0.309_017, 0.951_056_5) };
        let mut dir = disk(id, 2).normalize_or(Vec2::X);
        let mut arms = Vec::with_capacity(n);
        for k in 0..n {
            let length = size * 3.0;
            let mut points = [at; SEGS];
            for (i, p) in points.iter_mut().enumerate() {
                *p = at + dir * length * i as f32 / (SEGS - 1) as f32;
            }
            arms.push(Arm {
                points,
                prev: points,
                home: dir,
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
        Self {
            id,
            core: at,
            vel: Vec2::ZERO,
            size,
            color: PALETTE[(unit(id, 3) * PALETTE.len() as f32) as usize % PALETTE.len()],
            own: PALETTE[(unit(id, 3) * PALETTE.len() as f32) as usize % PALETTE.len()],
            jiggle: 0.0,
            jiggle_vel: 0.0,
            heading: disk(id, 4).normalize_or(Vec2::Y),
            arms,
            made_by,
        }
    }

    pub fn reach(&self) -> f32 {
        self.size * 11.0
    }

    /// The mimics it's holding, or reaching for.
    fn links(&self) -> impl Iterator<Item = u64> + '_ {
        self.arms.iter().filter_map(|a| match a.hold {
            Hold::Mimic(id) => Some(id),
            _ => a.aim,
        })
    }

    /// Take in some of a colour, and jiggle with it. A core keeps its colour
    /// a little brighter than a plain mix, so a group settles on a shared
    /// ink rather than fading together to grey.
    fn absorb(&mut self, color: [f32; 3]) {
        for (mine, theirs) in self.color.iter_mut().zip(color) {
            *mine += (theirs - *mine) * 0.35;
        }
        let mean = self.color.iter().sum::<f32>() / 3.0;
        for c in &mut self.color {
            *c = (mean + (*c - mean) * 1.08).clamp(0.0, 1.0);
        }
        self.jiggle_vel += 9.0;
    }
}

/// A pulse got to the end of its tentacle: whose core takes it in.
struct Arrival {
    to: usize,
    color: [f32; 3],
}

impl Arm {
    /// Stop reaching, and rest curled up for a while.
    fn rest(&mut self, ticks: u32) {
        self.reaching = false;
        self.aim = None;
        self.timer = ticks;
    }
}

/// One tick for every mimic.
pub(crate) fn step(mimics: &mut [Mimic], tick: Tick) {
    let n = mimics.len();
    if n == 0 {
        return;
    }
    // Everyone as they were at the start of the tick: what one mimic does
    // can't depend on what those before it did this tick.
    let cores: Vec<Vec2> = mimics.iter().map(|m| m.core).collect();
    let colors: Vec<[f32; 3]> = mimics.iter().map(|m| m.color).collect();
    let ids: Vec<u64> = mimics.iter().map(|m| m.id).collect();
    let find = |id: u64| ids.iter().position(|&i| i == id);

    let link_counts: Vec<usize> = {
        let mut c = vec![0; n];
        for (i, m) in mimics.iter().enumerate() {
            for id in m.links() {
                c[i] += 1;
                if let Some(j) = find(id) {
                    c[j] += 1;
                }
            }
        }
        c
    };
    let linked = |a: usize, b: usize, ms: &[Mimic]| {
        ms[a].links().any(|id| id == ms[b].id) || ms[b].links().any(|id| id == ms[a].id)
    };

    let mut force = vec![Vec2::ZERO; n];
    let mut arrivals: Vec<Arrival> = Vec::new();

    for i in 0..n {
        let snapshot_links: Vec<bool> = (0..n).map(|j| j != i && linked(i, j, mimics)).collect();
        let m = &mut mimics[i];
        let (id, size, reach) = (m.id, m.size, m.reach());

        // Wander: the heading drifts, and turns back from the edges.
        let turn = (unit(id, 1000 + tick as u64) - 0.5) * 0.12;
        m.heading = rotate(m.heading, turn);
        let margin = reach;
        let mut back = Vec2::ZERO;
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
        // Alone, it heads for the nearest mimic out of reach: they're curious.
        let near = (0..n)
            .filter(|&j| j != i && link_counts[i] == 0 && cores[j].distance(m.core) > reach)
            .map(|j| (cores[j].distance_squared(m.core), j))
            .filter(|&(d, _)| d < (reach * 5.0) * (reach * 5.0))
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let toward = near.map_or(Vec2::ZERO, |(_, j)| (cores[j] - m.core).normalize_or(Vec2::ZERO));
        m.heading = (m.heading + back * 0.06 + toward * 0.03).normalize_or(Vec2::Y);

        let mut gripping = m.arms.iter().filter(|a| matches!(a.hold, Hold::Ground(_))).count();
        let mut links_here = link_counts[i];
        let core = m.core;
        let color = m.color;

        for (k, arm) in m.arms.iter_mut().enumerate() {
            let salt = (k as u64) << 32 | tick as u64;
            arm.timer = arm.timer.saturating_sub(1);
            match arm.hold {
                Hold::Free => {
                    if !arm.reaching && arm.timer == 0 {
                        // Choose where to reach next: now and then another
                        // mimic in range, else the paper ahead.
                        let other = (0..n).find(|&j| {
                            j != i
                                && !snapshot_links[j]
                                && links_here < MAX_LINKS
                                && link_counts[j] < MAX_LINKS
                                && cores[j].distance(core) < reach * 0.9
                                && unit(id ^ ids[j], salt) < 0.35
                        });
                        if let Some(j) = other {
                            arm.aim = Some(ids[j]);
                            links_here += 1;
                        } else {
                            let jitter = disk(id, salt) * 0.6;
                            let dir = (m.heading * 1.1 + arm.home * 0.8 + jitter).normalize_or(arm.home);
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
                                arm.timer = 300 + (unit(id ^ aim, salt) * 420.0) as u32;
                                arm.pulses.push(Pulse { at: 0.0, color, outward: true });
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
                        arm.goal = core + arm.home * arm.length;
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
                    if arm.timer == 0 || dist < reach * 0.25 {
                        arm.hold = Hold::Free;
                        arm.rest(8 + (unit(id, salt ^ 13) * 25.0) as u32);
                    }
                }
                Hold::Mimic(other) => {
                    let Some(j) = find(other) else {
                        arm.hold = Hold::Free;
                        arm.rest(30);
                        continue;
                    };
                    let d = cores[j] - core;
                    let dist = d.length();
                    arm.length = dist.min(reach);
                    // A soft spring: they keep to about half a reach apart.
                    let rest = reach * 0.5;
                    let pull = d / dist.max(1e-4) * (dist - rest) * 2.5;
                    force[i] += pull;
                    force[j] -= pull;
                    // Pulses: out with the holder's colour, back with the other's.
                    if !arm.pulses.iter().any(|p| p.outward) && arm.echo.is_none() && (tick + k as Tick).is_multiple_of(90) {
                        arm.pulses.push(Pulse { at: 0.0, color, outward: true });
                    }
                    if let Some(e) = arm.echo.as_mut() {
                        *e = e.saturating_sub(1);
                        if *e == 0 {
                            arm.echo = None;
                            arm.pulses.push(Pulse { at: 1.0, color: colors[j], outward: false });
                        }
                    }
                    for p in &mut arm.pulses {
                        p.at += if p.outward { 1.0 } else { -1.0 } / PULSE_TICKS;
                    }
                    let mut keep = Vec::with_capacity(arm.pulses.len());
                    for p in arm.pulses.drain(..) {
                        if p.outward && p.at >= 1.0 {
                            arrivals.push(Arrival { to: j, color: p.color });
                            arm.echo = Some(20);
                        } else if !p.outward && p.at <= 0.0 {
                            arrivals.push(Arrival { to: i, color: p.color });
                        } else {
                            keep.push(p);
                        }
                    }
                    arm.pulses = keep;
                    if arm.timer == 0 || dist > reach * 1.15 {
                        arm.hold = Hold::Free;
                        arm.pulses.clear();
                        arm.echo = None;
                        arm.rest(30);
                    }
                }
            }
        }
    }

    for a in arrivals {
        mimics[a.to].absorb(a.color);
    }

    // Cores keep a little apart.
    for i in 0..n {
        for j in i + 1..n {
            let d = cores[i] - cores[j];
            let dist = d.length();
            let near = (mimics[i].reach() + mimics[j].reach()) * 0.22;
            if dist < near {
                let dir = if dist > 1e-4 { d / dist } else { disk(ids[i] ^ ids[j], 5).normalize_or(Vec2::X) };
                let push = dir * (near - dist) * 12.0;
                force[i] += push;
                force[j] -= push;
            }
        }
    }

    for (m, f) in mimics.iter_mut().zip(&force) {
        m.vel = (m.vel + *f * DT) * 0.86;
        m.vel = m.vel.clamp_length_max(140.0);
        let before = m.core;
        let r = m.size;
        m.core += m.vel * DT;
        m.core = Vec2::new(m.core.x.clamp(r, WIDTH - r), m.core.y.clamp(r, HEIGHT - r));
        for (c, o) in m.color.iter_mut().zip(m.own) {
            *c += (o - *c) * 0.004;
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
}

impl Arm {
    /// Move the tentacle's points: a rope from the core, its tip drawn to
    /// where it's going, with a slow wave along it.
    /// `tip_to` is what the tip is holding, if anything; `sway` where its
    /// wave is up to.
    fn body(&mut self, core: Vec2, moved: Vec2, tip_to: Option<Vec2>, sway: f32) {
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
        let side = Vec2::new(-along.y, along.x);
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

/// A sine-like wave from a parabola, the same on every machine.
fn wave(x: f32) -> f32 {
    const TAU: f32 = std::f32::consts::TAU;
    const PI: f32 = std::f32::consts::PI;
    let t = x - (x / TAU).floor() * TAU - PI;
    let y = 4.0 / PI * t - 4.0 / (PI * PI) * t * t.abs();
    -y
}

/// Turn a unit vector by a small angle, renormalised.
fn rotate(v: Vec2, a: f32) -> Vec2 {
    let a2 = a * a;
    let s = a * (1.0 - a2 / 6.0);
    let c = 1.0 - a2 / 2.0;
    Vec2::new(v.x * c - v.y * s, v.x * s + v.y * c).normalize_or(v)
}
