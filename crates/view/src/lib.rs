//! The boundary between whatever decides what happens and whatever draws it.
//!
//! Today a hand-keyed mock world sits on one side; later the authoritative
//! core will. Renderers and hosts depend on this crate only, never on either
//! side, so swapping the mock for the core changes nothing downstream
//! (spec principle 10: authority vs appearance).
//!
//! Time here is `f64`. That's fine: the view is appearance. The core keeps
//! exact rational key times (spec §8.4) and converts when it fills a frame.

use glam::{Quat, Vec3};

/// The coarsest shape anything can have: one ellipsoid at its point (spec §5.3).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Blob {
    /// Semi-axes in the point's own frame.
    pub radii: Vec3,
    /// Linear RGB plus opacity.
    pub color: [f32; 4],
}

/// One point as it is at a single moment.
#[derive(Clone, Debug)]
pub struct PointView {
    /// Stable, structural ID such as `mara/head` or `cup/shard-3` (log 0006).
    pub id: String,
    /// Index of the parent in the same [`Frame`]. Parents always come first.
    pub parent: Option<usize>,
    /// Position in the parent's frame.
    pub translation: Vec3,
    pub rotation: Quat,
    /// This point's frame scale relative to its parent (spec §4.1).
    pub scale: f32,
    /// `None` for points that only organize others, like a room.
    pub blob: Option<Blob>,
    pub label: Option<String>,
}

impl PointView {
    pub fn new(id: impl Into<String>, parent: Option<usize>, translation: Vec3) -> Self {
        Self {
            id: id.into(),
            parent,
            translation,
            rotation: Quat::IDENTITY,
            scale: 1.0,
            blob: None,
            label: None,
        }
    }
}

/// Every point at one moment, parents before children.
#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub time: f64,
    pub points: Vec<PointView>,
}

/// What kind of key a timeline mark stands for (spec §6.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyKind {
    Cause,
    State,
    Rule,
}

/// A key shown on the timeline. `time` is `None` for keys that hold always.
#[derive(Clone, Debug)]
pub struct KeyMark {
    pub id: String,
    pub kind: KeyKind,
    pub time: Option<f64>,
    pub text: String,
}

/// Anything that can say what the world looks like at a moment.
pub trait WorldView {
    /// The span to show, in its local time.
    fn time_range(&self) -> (f64, f64);
    fn frame_at(&self, t: f64) -> Frame;
    fn keys(&self) -> Vec<KeyMark>;
    /// The bounded gap report (spec §9), one line per gap.
    fn gaps(&self) -> Vec<String>;
}

/// A point's placement in world space after walking its parent chain.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldTransform {
    pub translation: Vec3,
    pub rotation: Quat,
    pub scale: f32,
}

impl WorldTransform {
    pub const IDENTITY: Self = Self {
        translation: Vec3::ZERO,
        rotation: Quat::IDENTITY,
        scale: 1.0,
    };

    fn then(&self, local: &PointView) -> Self {
        Self {
            translation: self.translation + self.rotation * (local.translation * self.scale),
            rotation: self.rotation * local.rotation,
            scale: self.scale * local.scale,
        }
    }
}

/// World transforms for every point in `frame`, in the same order.
pub fn resolve(frame: &Frame) -> Vec<WorldTransform> {
    let mut out: Vec<WorldTransform> = Vec::with_capacity(frame.points.len());
    for (i, p) in frame.points.iter().enumerate() {
        let parent = match p.parent {
            Some(j) => {
                assert!(j < i, "point {} listed before its parent", p.id);
                out[j]
            }
            None => WorldTransform::IDENTITY,
        };
        out.push(parent.then(p));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_inherits_parent_rotation_and_scale() {
        let mut parent = PointView::new("table", None, Vec3::new(1.0, 0.0, 0.0));
        parent.rotation = Quat::from_rotation_y(std::f32::consts::FRAC_PI_2);
        parent.scale = 2.0;
        let child = PointView::new("table/top", Some(0), Vec3::new(1.0, 0.0, 0.0));
        let frame = Frame {
            time: 0.0,
            points: vec![parent, child],
        };

        let world = resolve(&frame);
        // One unit along the parent's x, doubled, then turned to -z.
        assert!(
            world[1]
                .translation
                .abs_diff_eq(Vec3::new(1.0, 0.0, -2.0), 1e-6)
        );
        assert_eq!(world[1].scale, 2.0);
    }
}
