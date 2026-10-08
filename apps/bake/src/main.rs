//! Bakes a world's history into JSON for hosts that play it back natively (Blender first).
//!
//! A bake is output, not input: a regenerable cache like a snapshot (spec §8.3),
//! never a source of truth. Its frames are sampled from `WorldView`, and only
//! frames where something changes are kept, so anything at rest costs nothing (§8.1).
//!
//!     tapestry-bake [--fps 24] [--out bake.json]
//!
//! Coordinates stay in the world's own convention (Y up). Hosts convert.

use glam::{Quat, Vec3};
use serde::Serialize;
use tapestry_view::{KeyKind, WorldView};

const FORMAT: &str = "tapestry-bake/0";
const EPS: f32 = 1e-6;

#[derive(Serialize)]
struct Bake {
    format: &'static str,
    up: &'static str,
    fps: u32,
    frame_start: i64,
    frame_end: i64,
    keys: Vec<Key>,
    gaps: Vec<String>,
    points: Vec<Track>,
}

#[derive(Serialize)]
struct Key {
    id: String,
    kind: &'static str,
    /// `None` for keys that hold always.
    frame: Option<f64>,
    text: String,
}

#[derive(Serialize)]
struct BlobOut {
    radii: [f32; 3],
    color: [f32; 4],
}

/// One point's history, as flat arrays so hosts can bulk-load them.
#[derive(Serialize, Default)]
struct Track {
    id: String,
    parent: Option<String>,
    label: Option<String>,
    blob: Option<BlobOut>,
    frames: Vec<i64>,
    /// xyz per kept frame, in the parent's frame.
    location: Vec<f32>,
    /// wxyz per kept frame.
    rotation: Vec<f32>,
    scale: Vec<f32>,
    visible: Vec<bool>,
}

#[derive(Clone, Copy, PartialEq)]
struct Sample {
    location: Vec3,
    rotation: Quat,
    scale: f32,
    visible: bool,
}

impl Sample {
    fn same(&self, other: &Self) -> bool {
        self.visible == other.visible
            && self.location.abs_diff_eq(other.location, EPS)
            && self.rotation.abs_diff_eq(other.rotation, EPS)
            && (self.scale - other.scale).abs() <= EPS
    }
}

fn bake(world: &dyn WorldView, fps: u32) -> Result<Bake, String> {
    let (start, end) = world.time_range();
    let frame_start = (start * fps as f64).ceil() as i64;
    let frame_end = (end * fps as f64).floor() as i64;
    let count = (frame_end - frame_start + 1) as usize;

    // Per point: its track header, plus a sample for every frame it exists in.
    let mut tracks: Vec<Track> = Vec::new();
    let mut samples: Vec<Vec<Option<Sample>>> = Vec::new();
    let mut index: std::collections::BTreeMap<String, usize> = Default::default();

    for f in 0..count {
        let frame = world.frame_at((frame_start + f as i64) as f64 / fps as f64);
        for p in &frame.points {
            let parent = p.parent.map(|j| frame.points[j].id.clone());
            let i = *index.entry(p.id.clone()).or_insert_with(|| {
                tracks.push(Track {
                    id: p.id.clone(),
                    parent: parent.clone(),
                    ..Default::default()
                });
                samples.push(vec![None; count]);
                tracks.len() - 1
            });
            let track = &mut tracks[i];
            if track.parent != parent {
                return Err(format!(
                    "{} changes parent; reparenting isn't baked yet",
                    p.id
                ));
            }
            if track.label.is_none() {
                track.label = p.label.clone();
            }
            if let (None, Some(b)) = (&track.blob, p.blob) {
                // One shape per point: meshed once by the host, then only moved (spec §5.3).
                track.blob = Some(BlobOut {
                    radii: b.radii.into(),
                    color: b.color,
                });
            }
            samples[i][f] = Some(Sample {
                location: p.translation,
                rotation: p.rotation,
                scale: p.scale,
                visible: p.blob.is_some(),
            });
        }
    }

    for (track, s) in tracks.iter_mut().zip(&samples) {
        // Before a point exists and after it's gone, hold its nearest pose, hidden.
        let first = s
            .iter()
            .flatten()
            .next()
            .copied()
            .expect("every tracked point was seen");
        let mut filled = Vec::with_capacity(count);
        let mut last = Sample {
            visible: false,
            ..first
        };
        for x in s {
            match x {
                Some(x) => {
                    last = *x;
                    filled.push(*x);
                }
                None => filled.push(Sample {
                    visible: false,
                    ..last
                }),
            }
        }

        // Keep a frame only where the value changes, plus the ends of each still stretch,
        // so linear interpolation between kept frames reproduces every frame exactly.
        for f in 0..count {
            let differs = |g: usize| !filled[f].same(&filled[g]);
            let keep = f == 0 || f + 1 == count || differs(f - 1) || differs(f + 1);
            if keep {
                let x = filled[f];
                track.frames.push(frame_start + f as i64);
                track.location.extend(x.location.to_array());
                track
                    .rotation
                    .extend([x.rotation.w, x.rotation.x, x.rotation.y, x.rotation.z]);
                track.scale.push(x.scale);
                track.visible.push(x.visible);
            }
        }
    }

    let keys = world
        .keys()
        .into_iter()
        .map(|k| Key {
            id: k.id,
            kind: match k.kind {
                KeyKind::Cause => "cause",
                KeyKind::State => "state",
                KeyKind::Rule => "rule",
            },
            frame: k.time.map(|t| t * fps as f64),
            text: k.text,
        })
        .collect();

    Ok(Bake {
        format: FORMAT,
        up: "y",
        fps,
        frame_start,
        frame_end,
        keys,
        gaps: world.gaps(),
        points: tracks,
    })
}

fn main() {
    let mut fps = 24;
    let mut out: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--fps" => {
                fps = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .expect("--fps takes a number")
            }
            "--out" => out = args.next(),
            other => panic!("unknown argument {other}"),
        }
    }

    let bake = bake(&tapestry_mock::CupScene, fps).unwrap_or_else(|e| {
        eprintln!("bake failed: {e}");
        std::process::exit(1);
    });
    let kept: usize = bake.points.iter().map(|t| t.frames.len()).sum();
    let json = serde_json::to_string(&bake).unwrap();
    match out {
        Some(path) => std::fs::write(&path, json).unwrap(),
        None => println!("{json}"),
    }
    eprintln!(
        "baked {} points over frames {}..={} at {fps} fps, {kept} samples kept",
        bake.points.len(),
        bake.frame_start,
        bake.frame_end
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn still_points_keep_only_their_ends() {
        let bake = bake(&tapestry_mock::CupScene, 24).unwrap();
        let floor = bake
            .points
            .iter()
            .find(|t| t.id == "kitchen/floor")
            .unwrap();
        assert_eq!(floor.frames, vec![bake.frame_start, bake.frame_end]);
    }

    #[test]
    fn shards_are_hidden_until_the_cup_lands() {
        let bake = bake(&tapestry_mock::CupScene, 24).unwrap();
        let shard = bake.points.iter().find(|t| t.id == "cup/shard-0").unwrap();
        assert_eq!(shard.parent.as_deref(), Some("cup"));
        assert!(!shard.visible[0]);
        assert!(*shard.visible.last().unwrap());
    }
}
