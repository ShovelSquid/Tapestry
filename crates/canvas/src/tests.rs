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

/// What `tree-check --grammar` tells an agent is exactly what the parser takes.
#[test]
fn grammar_names_the_whole_vocabulary() {
    let g = grammar();
    for m in Material::ALL {
        assert!(g.contains(m.name()), "grammar is missing {}", m.name());
    }
    for p in Prop::ALL {
        assert!(g.contains(p.name()), "grammar is missing {}", p.name());
    }
    for line in [
        "change tree heat -0.5/s within 30 of water or ink",
        "convert ash to nothing at wet 2 ±10%",
    ] {
        let note = RuleNote::parse("t", line);
        assert!(note.problems.is_empty(), "{line}: {:?}", note.problems);
        assert_eq!(note.basics[0].to_string(), line);
    }
}

/// Mimics put down close together, one dab each.
fn mimics(t: &mut Timeline, n: usize) {
    for k in 0..n {
        let x = 600.0 + (k % 4) as f32 * 70.0;
        let y = 400.0 + (k / 4) as f32 * 70.0;
        let id = t.begin_stroke(Brush::Mimic, 8.0, Vec2::new(x, y));
        t.end_stroke(id);
    }
}

fn swarm(t: &Timeline) -> &Swarm {
    &t.state().swarm
}

#[test]
fn mimics_wander_and_replay_the_same() {
    let mut t = timeline();
    mimics(&mut t, 6);
    t.seek(5);
    let start: Vec<glam::Vec3> = swarm(&t).mimics.iter().map(|m| m.core).collect();
    assert_eq!(start.len(), 6);
    t.seek(900);
    let live = t.state().fingerprint();
    for (m, s) in swarm(&t).mimics.iter().zip(&start) {
        assert!(m.core.distance(*s) > 5.0, "a mimic stayed put");
        assert!(m.core.x >= 0.0 && m.core.x <= WIDTH && m.core.y >= 0.0 && m.core.y <= HEIGHT);
        for a in &m.arms {
            assert!(a.points.iter().all(|p| p.is_finite()));
        }
    }
    t.seek(300);
    t.seek(900);
    assert_eq!(t.state().fingerprint(), live);
    let mut again = timeline();
    mimics(&mut again, 6);
    again.seek(900);
    assert_eq!(again.state().fingerprint(), live);
}

#[test]
fn holding_makes_links_that_learn_and_messages_that_change_minds() {
    let mut t = timeline();
    mimics(&mut t, 8);
    t.seek(1);
    let before: Vec<Vector> = swarm(&t).mimics.iter().map(|m| m.state).collect();
    let (mut made, mut learned) = (false, false);
    for tick in (60..=1800).step_by(60) {
        t.seek(tick);
        made |= !swarm(&t).links.is_empty();
        learned |= swarm(&t).links.iter().any(|l| (l.weight - 0.3).abs() > 0.05);
    }
    assert!(made, "no links were made");
    assert!(learned, "no link's weight moved");
    let changed = swarm(&t)
        .mimics
        .iter()
        .zip(&before)
        .filter(|(m, b)| m.state != **b)
        .count();
    assert!(changed >= 2, "only {changed} minds changed");
    // Every link joins two mimics that exist, and weights stay in 0..1.
    for l in &swarm(&t).links {
        assert!(swarm(&t).mimic(l.a).is_some() && swarm(&t).mimic(l.b).is_some());
        assert!((0.0..=1.0).contains(&l.weight));
    }
}

/// The topic notes put down as mimics, spread across the canvas with the
/// topics mixed up.
fn notes_on_canvas(t: &mut Timeline) -> Vec<(String, usize, String)> {
    let notes = topic_notes();
    for (k, (name, _, text)) in notes.iter().enumerate() {
        let slot = (k * 7) % notes.len();
        let pos = Vec2::new(250.0 + (slot % 5) as f32 * 270.0, 220.0 + (slot / 5) as f32 * 260.0);
        t.read_note(name, name, pos, note_vector(text));
    }
    notes
}

#[test]
fn notes_find_their_own_kind() {
    let mut t = timeline();
    let notes = notes_on_canvas(&mut t);
    t.seek(5 * 60 * TICKS_PER_SECOND);
    let s = swarm(&t);
    let topic = |id: u64| notes.iter().find(|n| note_id(&n.0) == id).map(|n| n.1);
    let (mut within, mut across) = (Vec::new(), Vec::new());
    for l in &s.links {
        if topic(l.a) == topic(l.b) { within.push(l.weight) } else { across.push(l.weight) }
    }
    let mean = |v: &[f32]| v.iter().sum::<f32>() / v.len().max(1) as f32;
    let proposals = s.proposals();
    let right = proposals
        .iter()
        .filter(|p| topic(note_id(&p.a.name)) == topic(note_id(&p.b.name)))
        .count();
    eprintln!(
        "links within {} (mean {:.2}), across {} (mean {:.2}); proposals {} of which right {}",
        within.len(), mean(&within), across.len(), mean(&across), proposals.len(), right
    );
    assert!(mean(&within) > mean(&across) + 0.15, "links don't prefer notes on one topic");
    assert!(proposals.len() >= 3, "too few proposals");
    assert!(right * 10 >= proposals.len() * 8, "fewer than 80% of proposals join notes on one topic");
}

#[test]
fn a_kept_proposal_stays_and_a_turned_down_one_goes() {
    let mut t = timeline();
    notes_on_canvas(&mut t);
    t.seek(5 * 60 * TICKS_PER_SECOND);
    let ps = swarm(&t).proposals();
    assert!(ps.len() >= 2);
    let (keep, drop) = (ps[0].clone(), ps[1].clone());
    t.rule_on_proposal(&keep.a.name, &keep.b.name, true);
    t.rule_on_proposal(&drop.a.name, &drop.b.name, false);
    let (ka, kb) = (note_id(&keep.a.name), note_id(&keep.b.name));
    let (da, db) = (note_id(&drop.a.name), note_id(&drop.b.name));
    let later = t.playhead() + 2 * 60 * TICKS_PER_SECOND;
    t.seek(later);
    let s = swarm(&t);
    let kept = s.link(ka, kb).expect("the kept link is gone");
    assert!(kept.pinned && kept.weight == 1.0);
    let proposed = |a: u64, b: u64| s.proposals().iter().any(|p| {
        let (x, y) = (note_id(&p.a.name), note_id(&p.b.name));
        (x, y) == (a, b) || (x, y) == (b, a)
    });
    assert!(!proposed(ka, kb) && !proposed(da, db), "a ruled-on pair was proposed again");
    // Ruling is a keyframe like any other: undo takes it back.
    let with = t.state().fingerprint();
    t.undo();
    t.seek(later);
    assert_ne!(t.state().fingerprint(), with);
}

#[test]
fn dragging_a_mimic_pulls_its_partners() {
    let mut t = timeline();
    notes_on_canvas(&mut t);
    t.seek(3 * 60 * TICKS_PER_SECOND);
    let s = swarm(&t);
    let l = s.links.iter().max_by(|a, b| a.weight.total_cmp(&b.weight)).expect("no links");
    let (held, partner) = (l.a, l.b);
    let from = s.mimic(held).unwrap().core.truncate();
    let partner_from = s.mimic(partner).unwrap().core;
    let to = Vec2::new(if from.x < WIDTH / 2.0 { from.x + 400.0 } else { from.x - 400.0 }, from.y);
    let id = t.begin_drag(held, from);
    for k in 1..=120 {
        t.step();
        t.extend_drag(id, from.lerp(to, k as f32 / 120.0));
    }
    t.end_drag(id);
    t.seek(t.playhead());
    let s = swarm(&t);
    assert!(s.mimic(held).unwrap().core.truncate().distance(to) < 2.0, "the dragged mimic isn't where it was put");
    // Let go, the group catches up.
    let settled = t.playhead() + 3 * TICKS_PER_SECOND;
    t.seek(settled);
    let s = swarm(&t);
    let moved = s.mimic(partner).unwrap().core.distance(partner_from);
    assert!(moved > 150.0, "its partner only moved {moved}");
    // Played back from the start, the drag lands everyone the same.
    let end = t.playhead();
    let after = t.state().fingerprint();
    t.seek(0);
    t.seek(end);
    assert_eq!(t.state().fingerprint(), after);
}

#[test]
fn a_cut_link_stays_cut_for_a_while_and_a_pinned_mimic_stays_put() {
    let mut t = timeline();
    notes_on_canvas(&mut t);
    t.seek(3 * 60 * TICKS_PER_SECOND);
    let l = swarm(&t).links.iter().max_by(|a, b| a.weight.total_cmp(&b.weight)).cloned().expect("no links");
    t.cut(l.a, l.b);
    let pinned = swarm(&t).mimics[0].id;
    let at = swarm(&t).mimics[0].core;
    t.pin(pinned, true);
    for _ in 0..8 {
        let next = t.playhead() + 60;
        t.seek(next);
        assert!(swarm(&t).link(l.a, l.b).is_none(), "the cut pair linked again within ten seconds");
        assert_eq!(swarm(&t).mimic(pinned).unwrap().core, at, "the pinned mimic moved");
    }
}

/// Fifteen notes on three topics (name, topic, text): each draws ten words
/// from its topic's dozen and a few everyday words any note might use.
fn topic_notes() -> Vec<(String, usize, String)> {
    const TOPICS: [&[&str]; 3] = [
        &["tomato", "compost", "seedling", "soil", "watering", "mulch", "harvest", "basil", "trellis", "sunlight", "pruning", "greenhouse"],
        &["chord", "melody", "tempo", "guitar", "rhythm", "harmony", "verse", "chorus", "drummer", "synth", "mixing", "bassline"],
        &["orbit", "rocket", "planet", "telescope", "comet", "galaxy", "nebula", "gravity", "asteroid", "launch", "satellite", "crater"],
    ];
    const EVERYDAY: [&str; 8] = ["today", "idea", "maybe", "remember", "try", "later", "weekend", "friend"];
    let mut out = Vec::new();
    for (t, words) in TOPICS.iter().enumerate() {
        for k in 0..5u64 {
            let seed = crate::sim::mix(t as u64, k);
            let mut text = String::new();
            for w in 0..10u64 {
                let i = (crate::sim::unit(seed, w) * words.len() as f32) as usize % words.len();
                text.push_str(words[i]);
                text.push(' ');
            }
            for w in 0..3u64 {
                let i = (crate::sim::unit(seed, 50 + w) * EVERYDAY.len() as f32) as usize % EVERYDAY.len();
                text.push_str(EVERYDAY[i]);
                text.push(' ');
            }
            out.push((format!("topic{t}-{k}"), t, text));
        }
    }
    out
}

#[test]
fn in_depth_mimics_spread_out_and_flatten_again() {
    let mut t = timeline();
    notes_on_canvas(&mut t);
    mimics(&mut t, 6);
    t.seek(30);
    t.set_depth(true);
    t.seek(90 * TICKS_PER_SECOND);
    let deep = swarm(&t).mimics.iter().map(|m| m.core.z.abs()).fold(0.0, f32::max);
    assert!(deep > 100.0, "no mimic went into depth (deepest {deep})");
    for m in &swarm(&t).mimics {
        assert!(m.core.z.abs() <= DEPTH && m.arms.iter().all(|a| a.points.iter().all(|p| p.is_finite())));
    }
    let live = t.state().fingerprint();
    t.seek(0);
    t.seek(90 * TICKS_PER_SECOND);
    assert_eq!(t.state().fingerprint(), live, "depth didn't replay the same");
    t.set_depth(false);
    t.seek(t.playhead() + 20 * TICKS_PER_SECOND);
    let left = swarm(&t).mimics.iter().map(|m| m.core.z.abs()).fold(0.0, f32::max);
    assert!(left < 5.0, "out of depth, a mimic stayed {left} off the paper");
}
