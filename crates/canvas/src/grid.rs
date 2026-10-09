//! A uniform grid over the canvas for "who is near me". Rebuilt each tick
//! with a stable counting sort, so neighbours always come in the same order.

use glam::Vec2;

use crate::sim::{HEIGHT, WIDTH};

/// No query reaches farther than one cell.
pub const CELL: f32 = 16.0;
const COLS: usize = (WIDTH / CELL) as usize + 1;
const ROWS: usize = (HEIGHT / CELL) as usize + 1;

#[derive(Clone, Default)]
pub struct Grid {
    start: Vec<u32>,
    order: Vec<u32>,
}

fn cell_of(p: Vec2) -> (usize, usize) {
    let c = (p.x / CELL).clamp(0.0, (COLS - 1) as f32) as usize;
    let r = (p.y / CELL).clamp(0.0, (ROWS - 1) as f32) as usize;
    (c, r)
}

impl Grid {
    /// File each `(index, position)` under its cell.
    pub fn build(&mut self, items: impl Iterator<Item = (u32, Vec2)> + Clone) {
        self.start.clear();
        self.start.resize(COLS * ROWS + 1, 0);
        for (_, p) in items.clone() {
            let (c, r) = cell_of(p);
            self.start[r * COLS + c + 1] += 1;
        }
        for i in 1..self.start.len() {
            self.start[i] += self.start[i - 1];
        }
        let mut fill = self.start.clone();
        self.order.clear();
        self.order.resize(*self.start.last().unwrap() as usize, 0);
        for (i, p) in items {
            let (c, r) = cell_of(p);
            let slot = &mut fill[r * COLS + c];
            self.order[*slot as usize] = i;
            *slot += 1;
        }
    }

    /// Every index in the 3×3 cells around `p`, in a fixed order.
    pub fn near(&self, p: Vec2, out: &mut Vec<u32>) {
        out.clear();
        for run in self.runs(p) {
            out.extend_from_slice(run);
        }
    }

    /// Whether any index in the 3×3 cells around `p` passes `test`. Stops at
    /// the first, which matters in a crowd.
    pub fn any_near(&self, p: Vec2, mut test: impl FnMut(u32) -> bool) -> bool {
        self.runs(p).any(|run| run.iter().any(|&i| test(i)))
    }

    /// The three row runs of the 3×3 cells around `p`.
    fn runs(&self, p: Vec2) -> impl Iterator<Item = &[u32]> {
        let (c, r) = cell_of(p);
        (r.saturating_sub(1)..=(r + 1).min(ROWS - 1)).map(move |rr| {
            let row = rr * COLS;
            let lo = row + c.saturating_sub(1);
            let hi = row + (c + 1).min(COLS - 1);
            &self.order[self.start[lo] as usize..self.start[hi + 1] as usize]
        })
    }
}
