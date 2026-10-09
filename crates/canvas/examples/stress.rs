//! A big forest on fire, timed tick by tick: `cargo run --release -p tapestry-canvas --example stress`.
use std::time::Instant;

use glam::Vec2;
use tapestry_canvas::*;

fn line(t: &mut Timeline, brush: Brush, radius: f32, a: Vec2, b: Vec2) {
    let id = t.begin_stroke(brush, radius, a);
    for k in 1..=40 {
        t.extend_stroke(id, a.lerp(b, k as f32 / 40.0));
    }
    t.end_stroke(id);
}

fn main() {
    let rules = concat!(env!("CARGO_MANIFEST_DIR"), "/../../world/rules");
    let mut t = Timeline::new(Rulebook::load(rules.as_ref()).expect("world/rules"));
    for row in 0..6 {
        let y = 300.0 + row as f32 * 110.0;
        line(&mut t, Brush::Tree, 7.0, Vec2::new(100.0, y), Vec2::new(1500.0, y));
    }
    line(&mut t, Brush::Fire, 8.0, Vec2::new(100.0, 850.0), Vec2::new(1500.0, 850.0));
    t.set_rule("fire-spreads-to-trees", true);
    let mut worst = 0.0f64;
    for s in 1..=1200 {
        let start = Instant::now();
        t.step();
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        worst = worst.max(ms);
        if s % 120 == 0 {
            let st = t.state();
            println!(
                "{:>4.0} s  {:>6} particles ({:>5} fire, {:>6} flame, {:>5} ash, {:>5} moving)  tick {ms:>6.2} ms  worst {worst:>6.2} ms",
                s as f32 / 60.0,
                st.particles.len(),
                st.count(Material::Fire),
                st.count(Material::Flame),
                st.count(Material::Ash),
                st.active(),
            );
        }
    }
}
