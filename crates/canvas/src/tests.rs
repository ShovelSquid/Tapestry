use glam::Vec2;

use crate::*;

fn line(t: &mut Timeline, brush: Brush, radius: f32, from: Vec2, to: Vec2) -> KeyId {
    let id = t.begin_stroke(brush, radius, from);
    for k in 1..=20 {
        t.extend_stroke(id, from.lerp(to, k as f32 / 20.0));
    }
    t.end_stroke(id);
    id
}

/// A row of trees with a fire painted among them.
fn forest() -> Timeline {
    let mut t = Timeline::default();
    line(
        &mut t,
        Brush::Tree,
        6.0,
        Vec2::new(300.0, 800.0),
        Vec2::new(900.0, 800.0),
    );
    line(
        &mut t,
        Brush::Fire,
        6.0,
        Vec2::new(300.0, 790.0),
        Vec2::new(330.0, 760.0),
    );
    t
}

fn burnt(t: &Timeline) -> usize {
    t.state()
        .particles
        .iter()
        .filter(|p| matches!(p.made_by, MadeBy::Rule(_)))
        .count()
}

#[test]
fn trees_sway_and_settle() {
    let mut t = Timeline::default();
    line(
        &mut t,
        Brush::Tree,
        6.0,
        Vec2::new(500.0, 800.0),
        Vec2::new(510.0, 800.0),
    );
    t.seek(30);
    assert!(t.state().trees[0].angle.abs() > 0.02, "a new tree sways");
    t.seek(600);
    assert!(t.state().trees[0].angle.abs() < 0.005, "and then settles");
}

#[test]
fn fire_does_nothing_to_trees_without_a_rule() {
    let mut t = forest();
    t.seek(600);
    assert_eq!(burnt(&t), 0);
    assert!(t.state().count(Material::Tree) > 100);
}

#[test]
fn an_empty_note_changes_nothing() {
    let engulf = RULES
        .iter()
        .position(|r| r.basics.is_none())
        .expect("one note says nothing definite");
    let mut quiet = forest();
    quiet.seek(600);
    let mut t = forest();
    t.set_rule(engulf, true);
    t.seek(600);
    assert_eq!(t.state().fingerprint(), quiet.state().fingerprint());
}

#[test]
fn with_the_rule_fire_spreads_down_the_row() {
    let mut t = forest();
    let standing = t.state().count(Material::Tree);
    t.set_rule(0, true);
    t.seek(240);
    let early = t.state().count(Material::Tree);
    assert!(early < standing, "nearest trees catch");
    assert!(early > standing / 2, "but not all at once");
    t.seek(1200);
    assert_eq!(t.state().count(Material::Tree), 0, "the whole row burns");
    // What burned is the rule's doing, and says so.
    assert!(t.state().particles.iter().any(|p| {
        p.material == Material::Ash && p.made_by == MadeBy::Rule(0)
    }));
}

#[test]
fn replay_matches_live_and_scrubbing_back_matches_forward() {
    let mut t = forest();
    t.set_rule(0, true);
    line(
        &mut t,
        Brush::Water,
        8.0,
        Vec2::new(600.0, 200.0),
        Vec2::new(700.0, 200.0),
    );
    t.seek(400);
    let forward = t.state().fingerprint();
    t.seek(37);
    t.seek(400);
    assert_eq!(t.state().fingerprint(), forward);

    // The same keyframes in a fresh timeline land on the same bits.
    let mut again = forest();
    again.set_rule(0, true);
    line(
        &mut again,
        Brush::Water,
        8.0,
        Vec2::new(600.0, 200.0),
        Vec2::new(700.0, 200.0),
    );
    again.seek(400);
    assert_eq!(again.state().fingerprint(), forward);
}

#[test]
fn a_stroke_painted_while_time_runs_replays_the_same() {
    let mut t = Timeline::default();
    t.seek(10);
    let id = t.begin_stroke(Brush::Ink, 5.0, Vec2::new(100.0, 100.0));
    for k in 1..40 {
        t.step();
        t.extend_stroke(id, Vec2::new(100.0 + k as f32 * 4.0, 100.0));
    }
    let live = t.state().fingerprint();
    t.end_stroke(id);
    assert_eq!(t.state().fingerprint(), live);
    t.seek(0);
    t.seek(49);
    assert_eq!(t.state().fingerprint(), live);
}

#[test]
fn an_ink_cup_holds_water() {
    let mut t = Timeline::default();
    let cup = [
        Vec2::new(450.0, 450.0),
        Vec2::new(480.0, 650.0),
        Vec2::new(720.0, 650.0),
        Vec2::new(750.0, 450.0),
    ];
    let id = t.begin_stroke(Brush::Ink, 5.0, cup[0]);
    for w in cup.windows(2) {
        for k in 1..=20 {
            t.extend_stroke(id, w[0].lerp(w[1], k as f32 / 20.0));
        }
    }
    t.end_stroke(id);
    line(
        &mut t,
        Brush::Water,
        8.0,
        Vec2::new(550.0, 300.0),
        Vec2::new(650.0, 300.0),
    );
    t.seek(300);
    let water: Vec<_> = t
        .state()
        .particles
        .iter()
        .filter(|p| p.material == Material::Water)
        .collect();
    let held = water
        .iter()
        .filter(|p| p.pos.y < 650.0 && (460.0..740.0).contains(&p.pos.x))
        .count();
    assert!(held * 10 >= water.len() * 9, "{held} of {} held", water.len());
}

#[test]
fn undo_takes_back_the_last_keyframe() {
    let mut t = forest();
    t.seek(120);
    let before = t.state().fingerprint();
    line(
        &mut t,
        Brush::Ink,
        5.0,
        Vec2::new(10.0, 10.0),
        Vec2::new(90.0, 10.0),
    );
    assert_ne!(t.state().fingerprint(), before);
    t.undo();
    assert_eq!(t.state().fingerprint(), before);
}
