use glam::Vec2;

use crate::mind::Vector;

/// Time on the canvas, in whole ticks. Exact, so replays land on the same tick.
pub type Tick = u32;
pub const TICKS_PER_SECOND: Tick = 60;
pub const DT: f32 = 1.0 / TICKS_PER_SECOND as f32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyId(pub u32);

/// What a stroke paints with. Smudge paints nothing; it pushes what's wet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Brush {
    Ink,
    Water,
    Tree,
    Fire,
    Smudge,
    /// Puts down mimics: creatures that wander and trade colour.
    Mimic,
}

impl Brush {
    pub const ALL: [Brush; 6] = [
        Brush::Ink,
        Brush::Water,
        Brush::Tree,
        Brush::Fire,
        Brush::Smudge,
        Brush::Mimic,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Brush::Ink => "ink",
            Brush::Water => "water",
            Brush::Tree => "tree",
            Brush::Fire => "fire",
            Brush::Smudge => "smudge",
            Brush::Mimic => "mimic",
        }
    }

    /// Distance between dabs along a stroke.
    fn spacing(self, radius: f32) -> f32 {
        match self {
            Brush::Ink => (radius * 0.3).max(1.5),
            Brush::Water => 5.0,
            Brush::Tree => radius * 5.5,
            Brush::Fire => 7.0,
            Brush::Smudge => 3.0,
            Brush::Mimic => radius * 12.0,
        }
    }
}

/// One pointer position, `dt` ticks after the stroke's keyframe.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub pos: Vec2,
    pub dt: Tick,
}

/// A stroke is one keyframe: a set of points laid down from one moment on.
/// Painting while time runs records when each part went down.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub brush: Brush,
    pub radius: f32,
    pub samples: Vec<Sample>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Body {
    Stroke(Stroke),
    /// Switch the rule note named `rule` (its file name) on or off.
    Rule { rule: String, on: bool },
    /// A mimic reads the note named `name` (its file name): it's put down
    /// at `pos` carrying the note, or, if one already carries it, takes in
    /// the note as it now reads. The vector is worked out when the note is
    /// read and kept here, so the canvas replays the same whatever the file
    /// says later.
    Note {
        name: String,
        title: String,
        pos: Vec2,
        vector: Box<Vector>,
    },
    /// The author holds mimic `mimic` and moves it through these points.
    Drag { mimic: u64, samples: Vec<Sample> },
    /// Cut the link between two mimics.
    Cut { a: u64, b: u64 },
    /// Hold a mimic in place, or let it go.
    Pin { mimic: u64, on: bool },
    /// The author's say on a proposal: the notes `a` and `b` belong
    /// together (keep) or don't.
    Verdict { a: String, b: String, keep: bool },
    /// Let mimics roam in depth, in front of and behind the paper, or pull
    /// them flat onto it.
    Depth { on: bool },
}

impl Body {
    /// Something done to the swarm (rather than painted, or a rule).
    pub fn is_swarm(&self) -> bool {
        !matches!(self, Body::Stroke(_) | Body::Rule { .. })
    }
}

/// Something the author said: at `tick`, this.
#[derive(Clone, Debug, PartialEq)]
pub struct Keyframe {
    pub id: KeyId,
    pub tick: Tick,
    pub body: Body,
}

/// Where a stroke actually puts things down. Derived from the samples, never
/// stored: the samples are the input.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Dab {
    pub dt: Tick,
    pub pos: Vec2,
    /// Movement since the previous dab (what a smudge pushes by).
    pub step: Vec2,
}

/// Dabs every `spacing` along the stroke. Appending a sample only ever
/// appends dabs, so a stroke can be laid down live and still replay the same.
pub(crate) fn dabs(stroke: &Stroke) -> Vec<Dab> {
    let Some(first) = stroke.samples.first() else {
        return Vec::new();
    };
    let spacing = stroke.brush.spacing(stroke.radius);
    let mut out = vec![Dab {
        dt: first.dt,
        pos: first.pos,
        step: Vec2::ZERO,
    }];
    let mut carry = 0.0;
    for w in stroke.samples.windows(2) {
        let (a, b) = (w[0], w[1]);
        let seg = b.pos - a.pos;
        let len = seg.length();
        // A pen held still on wet paper keeps bleeding ink into one spot.
        if stroke.brush == Brush::Ink && len < spacing * 0.5 && a.dt / 4 != b.dt / 4 {
            out.push(Dab {
                dt: b.dt,
                pos: b.pos,
                step: Vec2::ZERO,
            });
        }
        if len == 0.0 {
            continue;
        }
        let dir = seg / len;
        let mut d = spacing - carry;
        while d <= len {
            out.push(Dab {
                dt: b.dt,
                pos: a.pos + dir * d,
                step: dir * spacing,
            });
            d += spacing;
        }
        carry = len - (d - spacing);
    }
    out
}
