//! A hand-keyed stand-in for the core: the cup example from spec §10.
//!
//! Nothing here is simulated. Motion is written as plain functions of time so
//! the renderer has something to show before the core exists. The scene is the
//! end state of §10, after every gap was answered: the kitchen is in meters and
//! seconds, Mara bumps the table hard at morning@35, and gravity does the rest.

use glam::{Quat, Vec3};
use tapestry_view::{Blob, Frame, KeyKind, KeyMark, PointView, WorldView};

const BUMP: f64 = 35.0;
/// The table's jolt after the bump.
const SHOVE: f64 = 0.35;
/// The cup tips off the edge once the table has moved out from under it.
const TIP: f64 = BUMP + 0.3;
const G: f64 = 9.81;
/// The cup's center falls from 0.85 on the table to 0.06 on the floor:
/// sqrt(2 * 0.79 / G) = 0.401 s.
const LAND: f64 = TIP + 0.401;
const SHARDS: usize = 7;

pub struct CupScene;

/// An opaque color from everyday sRGB values, converted to the view's linear RGB.
fn rgb(r: f32, g: f32, b: f32) -> [f32; 4] {
    let lin = |c: f32| c.powf(2.2);
    [lin(r), lin(g), lin(b), 1.0]
}

fn blob(radii: Vec3, color: [f32; 4]) -> Option<Blob> {
    Some(Blob { radii, color })
}

/// 0 before `a`, 1 after `b`, smooth in between.
fn smooth(t: f64, a: f64, b: f64) -> f32 {
    let x = ((t - a) / (b - a)).clamp(0.0, 1.0);
    (x * x * (3.0 - 2.0 * x)) as f32
}

/// 0 before `a`, 1 after `b`, fast at first then settling.
fn ease_out(t: f64, a: f64, b: f64) -> f32 {
    let x = ((t - a) / (b - a)).clamp(0.0, 1.0);
    (1.0 - (1.0 - x).powi(3)) as f32
}

impl CupScene {
    fn push(points: &mut Vec<PointView>, p: PointView) -> usize {
        points.push(p);
        points.len() - 1
    }

    fn table(points: &mut Vec<PointView>, kitchen: usize, t: f64) {
        let wood = rgb(0.42, 0.26, 0.15);
        let x = -0.3 * ease_out(t, BUMP, BUMP + SHOVE);
        let mut table = PointView::new("table", Some(kitchen), Vec3::new(x, 0.0, 0.0));
        // A small rock as it's knocked.
        let wobble = (smooth(t, BUMP, BUMP + 0.1) - smooth(t, BUMP + 0.1, BUMP + 0.5)) * 0.04;
        table.rotation = Quat::from_rotation_z(wobble);
        table.label = Some("table".into());
        let table = Self::push(points, table);

        let mut top = PointView::new("table/top", Some(table), Vec3::new(0.0, 0.76, 0.0));
        top.blob = blob(Vec3::new(0.85, 0.035, 0.55), wood);
        Self::push(points, top);
        for (i, (lx, lz)) in [(-0.7, -0.4), (0.7, -0.4), (-0.7, 0.4), (0.7, 0.4)]
            .into_iter()
            .enumerate()
        {
            let mut leg = PointView::new(
                format!("table/leg-{i}"),
                Some(table),
                Vec3::new(lx, 0.38, lz),
            );
            leg.blob = blob(Vec3::new(0.045, 0.38, 0.045), wood);
            Self::push(points, leg);
        }
    }

    fn mara(points: &mut Vec<PointView>, kitchen: usize, t: f64) {
        // She stands by the window, then crosses to the table.
        let window = Vec3::new(2.6, 0.0, -1.8);
        let at_table = Vec3::new(1.2, 0.0, 0.05);
        let walk = smooth(t, 25.0, 34.6);
        let mut pos = window.lerp(at_table, walk);
        // A step's bob while walking.
        let walking = t > 25.0 && t < 34.6;
        if walking {
            pos.y += (((t - 25.0) * 9.0).sin().abs() * 0.03) as f32;
        }
        let heading = (at_table - window).normalize();
        let facing = if t < 25.0 {
            -std::f32::consts::FRAC_PI_2
        } else {
            heading.x.atan2(heading.z)
        };
        // She lurches into the table at the bump, then rights herself.
        let lurch = (smooth(t, BUMP - 0.15, BUMP) - smooth(t, BUMP + 0.2, BUMP + 1.2)) * 0.18;

        let mut mara = PointView::new("mara", Some(kitchen), pos);
        mara.rotation =
            Quat::from_rotation_y(facing + std::f32::consts::PI) * Quat::from_rotation_x(-lurch);
        mara.label = Some("mara".into());
        let mara = Self::push(points, mara);

        let coat = rgb(0.18, 0.32, 0.55);
        let skin = rgb(0.86, 0.66, 0.52);
        let mut body = PointView::new("mara/body", Some(mara), Vec3::new(0.0, 0.85, 0.0));
        body.blob = blob(Vec3::new(0.21, 0.5, 0.15), coat);
        Self::push(points, body);
        let mut head = PointView::new("mara/head", Some(mara), Vec3::new(0.0, 1.5, 0.0));
        head.blob = blob(Vec3::splat(0.12), skin);
        Self::push(points, head);
        for (side, x) in [("left", -0.27), ("right", 0.27)] {
            let mut hand = PointView::new(
                format!("mara/{side}-hand"),
                Some(mara),
                Vec3::new(x, 0.8, 0.0),
            );
            hand.blob = blob(Vec3::splat(0.055), skin);
            Self::push(points, hand);
        }
    }

    fn cup(points: &mut Vec<PointView>, kitchen: usize, t: f64) {
        let glaze = rgb(0.93, 0.92, 0.88);
        let on_table = Vec3::new(0.55, 0.85, 0.1);
        // Friction drags it a little with the table before it goes over the edge.
        let drag = -0.07 * ease_out(t, BUMP, TIP);
        let mut cup = PointView::new("cup", Some(kitchen), on_table + Vec3::new(drag, 0.0, 0.0));
        cup.label = Some("cup".into());

        if t < TIP {
            cup.blob = blob(Vec3::new(0.05, 0.06, 0.05), glaze);
            Self::push(points, cup);
            return;
        }

        // Free fall off the edge, tumbling, drifting a little outward.
        let fall = (t.min(LAND) - TIP) as f32;
        cup.translation += Vec3::new(0.25 * fall, -(0.5 * G as f32) * fall * fall, 0.0);
        if t < LAND {
            cup.rotation = Quat::from_rotation_z(-fall * 5.0);
            cup.blob = blob(Vec3::new(0.05, 0.06, 0.05), glaze);
            Self::push(points, cup);
            return;
        }

        // Shattered: cup.intact = false. The cup point stays where it landed and
        // its pieces become new child points, named by structure (log 0005).
        cup.label = Some("cup (shattered)".into());
        let cup = Self::push(points, cup);
        let spread = ease_out(t, LAND, LAND + 0.7);
        for i in 0..SHARDS {
            let a = i as f32 / SHARDS as f32 * std::f32::consts::TAU + 0.4;
            let reach = 0.12 + 0.09 * ((i * 7 % 5) as f32 / 4.0);
            let out = Vec3::new(a.cos() * reach, 0.0, a.sin() * reach) * spread;
            let mut shard = PointView::new(
                format!("cup/shard-{i}"),
                Some(cup),
                out - Vec3::new(0.0, 0.05, 0.0),
            );
            shard.rotation = Quat::from_rotation_y(a) * Quat::from_rotation_x(1.2 * spread);
            let s = 0.018 + 0.01 * ((i * 3 % 4) as f32 / 3.0);
            shard.blob = blob(Vec3::new(s * 1.6, s * 0.5, s), glaze);
            Self::push(points, shard);
        }
    }
}

impl WorldView for CupScene {
    fn time_range(&self) -> (f64, f64) {
        (0.0, 45.0)
    }

    fn frame_at(&self, t: f64) -> Frame {
        let mut points = Vec::new();
        let kitchen = Self::push(&mut points, PointView::new("kitchen", None, Vec3::ZERO));

        let mut floor = PointView::new("kitchen/floor", Some(kitchen), Vec3::new(0.0, -0.04, 0.0));
        floor.blob = blob(Vec3::new(4.5, 0.04, 3.5), rgb(0.55, 0.47, 0.38));
        Self::push(&mut points, floor);
        let mut wall = PointView::new("kitchen/wall", Some(kitchen), Vec3::new(0.0, 1.4, -3.2));
        // "The walls were yellow": a fill-in, so it needs no cause (spec principle 5).
        wall.blob = blob(Vec3::new(4.5, 1.4, 0.06), rgb(0.85, 0.74, 0.36));
        Self::push(&mut points, wall);

        Self::table(&mut points, kitchen, t);
        Self::mara(&mut points, kitchen, t);
        Self::cup(&mut points, kitchen, t);
        Frame { time: t, points }
    }

    fn keys(&self) -> Vec<KeyMark> {
        let mark = |id: &str, kind, time, text: &str| KeyMark {
            id: id.into(),
            kind,
            time,
            text: text.into(),
        };
        vec![
            mark(
                "k1",
                KeyKind::State,
                Some(0.0),
                "cup.position = on(table) — \"The cup sat on the table.\"",
            ),
            mark(
                "k3",
                KeyKind::Cause,
                Some(BUMP),
                "mara → push(table), hard — answer to the gap on k2",
            ),
            mark(
                "k2",
                KeyKind::State,
                Some(40.0),
                "cup on floor, intact = false — \"Later, it lay shattered on the floor.\"",
            ),
            mark(
                "k4",
                KeyKind::Rule,
                None,
                "gravity, rigid-contact in kitchen (meters, seconds)",
            ),
        ]
    }

    fn gaps(&self) -> Vec<String> {
        // Every bounded gap from §10 has been answered: k2 is satisfied by k3 through k4.
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tapestry_view::resolve;

    fn cup_y(t: f64) -> f32 {
        let frame = CupScene.frame_at(t);
        let i = frame.points.iter().position(|p| p.id == "cup").unwrap();
        resolve(&frame)[i].translation.y
    }

    #[test]
    fn cup_is_on_the_table_until_the_bump() {
        assert!((cup_y(0.0) - 0.85).abs() < 1e-4);
        assert!((cup_y(BUMP) - 0.85).abs() < 1e-4);
    }

    #[test]
    fn cup_is_shattered_on_the_floor_by_k2() {
        let frame = CupScene.frame_at(40.0);
        assert!(cup_y(40.0) < 0.1);
        assert!(frame.points.iter().any(|p| p.id == "cup/shard-0"));
        let cup = frame.points.iter().find(|p| p.id == "cup").unwrap();
        assert!(
            cup.blob.is_none(),
            "the whole cup is gone once it has shattered"
        );
    }
}
