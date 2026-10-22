//! Stable layout math shared by the vault index and canvas.

pub const CARD_W: f64 = 230.0;
pub const CARD_H: f64 = 150.0;
pub const GAP: f64 = 30.0;
pub const MAX_RING: i64 = 512;

pub fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

pub fn normalize_rel(rel: &str) -> String {
    let mut s = rel.replace('\\', "/");
    while let Some(rest) = s.strip_prefix("./") {
        s = rest.to_owned();
    }
    while let Some(rest) = s.strip_prefix('/') {
        s = rest.to_owned();
    }
    let mut parts = Vec::new();
    for part in s.split('/') {
        if !part.is_empty() {
            parts.push(part);
        }
    }
    parts.join("/")
}

pub fn stable_point(rel: &str, salt: u64) -> (f64, f64) {
    let mut bytes = normalize_rel(rel).into_bytes();
    bytes.extend_from_slice(&salt.to_le_bytes());
    let hash = fnv1a64(&bytes);
    let scale = 1.0 / 4_294_967_296.0;
    ((hash >> 32) as f64 * scale, (hash as u32) as f64 * scale)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn intersects(&self, other: &Rect) -> bool {
        self.x < other.x + other.w
            && other.x < self.x + self.w
            && self.y < other.y + other.h
            && other.y < self.y + self.h
    }
}

/// Find the nearest free grid cell, with deterministic ring and tie ordering.
pub fn place_free(occupied: &[Rect], size: (f64, f64), anchor: (f64, f64), gap: f64) -> Rect {
    let (w, h) = size;
    let step_x = w + gap;
    let step_y = h + gap;
    for ring in 0..=MAX_RING {
        let mut cells = Vec::new();
        for i in -ring..=ring {
            for j in -ring..=ring {
                if i.abs().max(j.abs()) == ring {
                    cells.push((i, j));
                }
            }
        }
        cells.sort_by_key(|(i, j)| (i * i + j * j, -*i, *j));
        for (i, j) in cells {
            let candidate = Rect {
                x: anchor.0 + i as f64 * step_x,
                y: anchor.1 + j as f64 * step_y,
                w,
                h,
            };
            if occupied.iter().all(|r| !candidate.intersects(r)) {
                return candidate;
            }
        }
    }
    Rect {
        x: anchor.0,
        y: anchor.1,
        w,
        h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_and_normalization_are_stable() {
        assert_eq!(fnv1a64(b""), 0xcbf29ce484222325);
        assert_eq!(fnv1a64(b"a"), 0xaf63dc4c8601ec8c);
        assert_eq!(normalize_rel("./Topic/"), "Topic");
        assert_eq!(normalize_rel("Topic//"), "Topic");
        assert_eq!(normalize_rel("/Topic"), "Topic");
        assert_eq!(normalize_rel("Topic\\"), "Topic");
        assert_eq!(
            place_free(&[], (230.0, 150.0), (0.0, 0.0), 30.0),
            Rect {
                x: 0.0,
                y: 0.0,
                w: 230.0,
                h: 150.0
            }
        );
        assert_eq!(
            place_free(
                &[Rect {
                    x: 0.0,
                    y: 0.0,
                    w: 230.0,
                    h: 150.0
                }],
                (230.0, 150.0),
                (0.0, 0.0),
                30.0
            ),
            Rect {
                x: 260.0,
                y: 0.0,
                w: 230.0,
                h: 150.0
            }
        );
        let point = stable_point("Topic", 0);
        assert_eq!(point, (0.5465028097387403, 0.16080470476299524));
        assert_eq!(stable_point("./Topic/", 0), point);
        let mut occupied = Vec::new();
        for _ in 0..50 {
            let next = place_free(&occupied, (CARD_W, CARD_H), (0.0, 0.0), GAP);
            assert!(occupied.iter().all(|rect: &Rect| !rect.intersects(&next)));
            occupied.push(next);
        }
    }
}
