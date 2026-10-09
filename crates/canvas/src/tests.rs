use glam::Vec2;

use crate::*;

const FIRE_SPREADS: &str = "fire-spreads-to-trees";

/// The rule notes in `world/rules`, as shipped.
fn rulebook() -> Rulebook {
    Rulebook::from_sources([
        (
            FIRE_SPREADS,
            include_str!("../../../world/rules/fire-spreads-to-trees.tree"),
        ),
        (
            "water-puts-out-fire",
            include_str!("../../../world/rules/water-puts-out-fire.tree"),
        ),
        (
            "water-makes-ink-run",
            include_str!("../../../world/rules/water-makes-ink-run.tree"),
        ),
        (
            "fire-engulfs-trees",
            include_str!("../../../world/rules/fire-engulfs-trees.tree"),
        ),
    ])
}

fn timeline() -> Timeline {
    Timeline::new(rulebook())
}

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
    let mut t = timeline();
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
    let mut t = timeline();
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
    let rules = rulebook();
    let engulf = &rules
        .notes
        .iter()
        .find(|r| r.inert())
        .expect("one note says nothing definite")
        .name;
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
    t.set_rule(FIRE_SPREADS, true);
    t.seek(240);
    let early = t.state().count(Material::Tree);
    assert!(early < standing, "nearest trees catch");
    assert!(early > standing / 2, "but not all at once");
    t.seek(1200);
    assert_eq!(t.state().count(Material::Tree), 0, "the whole row burns");
    // What burned is the rule's doing, and says so.
    assert!(t.state().particles.iter().any(|p| {
        p.material == Material::Ash
            && p.made_by == MadeBy::Rule(rulebook().index(FIRE_SPREADS).unwrap())
    }));
}

#[test]
fn replay_matches_live_and_scrubbing_back_matches_forward() {
    let mut t = forest();
    t.set_rule(FIRE_SPREADS, true);
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
    again.set_rule(FIRE_SPREADS, true);
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
    let mut t = timeline();
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
    let mut t = timeline();
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
    t.seek(120);
    assert_eq!(t.state().fingerprint(), before);
}

#[test]
fn a_deleted_keyframe_is_as_if_never_made() {
    let mut never = forest();
    never.seek(300);

    let mut t = forest();
    t.seek(60);
    let ink = line(
        &mut t,
        Brush::Ink,
        5.0,
        Vec2::new(10.0, 10.0),
        Vec2::new(90.0, 10.0),
    );
    t.seek(300);
    assert_ne!(t.state().fingerprint(), never.state().fingerprint());
    t.remove(ink);
    t.seek(300);
    assert_eq!(t.state().fingerprint(), never.state().fingerprint());

    // And undoing the delete brings it back exactly.
    let mut kept = forest();
    kept.seek(60);
    line(
        &mut kept,
        Brush::Ink,
        5.0,
        Vec2::new(10.0, 10.0),
        Vec2::new(90.0, 10.0),
    );
    kept.seek(300);
    t.undo();
    t.seek(300);
    assert_eq!(t.state().fingerprint(), kept.state().fingerprint());
}

#[test]
fn moving_the_fire_moves_when_the_forest_burns() {
    let mut t = forest();
    t.set_rule(FIRE_SPREADS, true);
    let fire = t
        .keys()
        .find(|k| matches!(&k.body, Body::Stroke(s) if s.brush == Brush::Fire))
        .unwrap()
        .id;
    t.seek(180);
    let standing = t.state().count(Material::Tree);
    assert!(standing < 900, "burning by 3 s");

    // Light the fire at 2 s instead: at 3 s far fewer trees have caught.
    t.move_key(fire, 120);
    t.seek(180);
    assert!(t.state().count(Material::Tree) > standing);
    assert_eq!(t.key(fire).unwrap().tick, 120);

    t.undo();
    t.seek(180);
    assert_eq!(t.state().count(Material::Tree), standing);
}

#[test]
fn rule_files_read_back_as_written() {
    for note in &rulebook().notes {
        assert_eq!(note.problems, vec![], "{}", note.name);
        let lines: Vec<String> = note.basics.iter().map(|b| b.to_string()).collect();
        for line in &lines {
            assert!(note.source.contains(line.as_str()), "{line}");
        }
    }
}

#[test]
fn a_line_that_doesnt_read_is_reported_and_the_rest_still_works() {
    let note = RuleNote::parse(
        "rain",
        "# Rain\nRain puts out fire.\n\nchange fire wet +6/s within 11 of rain\nconvert fire to ash at wet 0.3\nspawn water above cloud\n",
    );
    assert_eq!(note.basics.len(), 1);
    assert_eq!(note.problems.len(), 2);
    assert_eq!(note.problems[0].line, 4);
    assert!(note.problems[0].message.contains("“rain” isn't a material"));
    assert!(note.problems[1].message.contains("isn't built yet"));
    assert_eq!(note.text, "Rain puts out fire.");
}

#[test]
fn editing_a_rule_replays_the_canvas_under_it() {
    let mut t = forest();
    t.set_rule(FIRE_SPREADS, true);
    t.seek(1200);
    assert_eq!(t.state().count(Material::Tree), 0);

    // Make trees much harder to light: the same scene now mostly stands.
    let mut rules = rulebook();
    let slow = rules.notes[rules.index(FIRE_SPREADS).unwrap()]
        .source
        .replace("+1.5/s", "+0.05/s");
    let i = rules.index(FIRE_SPREADS).unwrap();
    rules.notes[i] = RuleNote::parse(FIRE_SPREADS, &slow);
    t.set_rules(rules);
    t.seek(1200);
    assert!(t.state().count(Material::Tree) > 500);
}
