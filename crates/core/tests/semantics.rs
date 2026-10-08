//! The engine's rules about keys, as worked through in the spec and logs 0007–0008.

use tapestry_core::*;

/// A toy law: pushing the table knocks whatever is on it to the floor.
struct Knock;

impl Rule for Knock {
    fn name(&self) -> &str {
        "knock"
    }
    fn verbs(&self) -> &[&str] {
        &["push"]
    }
    fn act(&self, world: &World, act: &Act) -> Result<Vec<Effect>, Rejection> {
        let target = act
            .arg("target")
            .and_then(Value::as_ref)
            .ok_or(Rejection::Missing("target".into()))?;
        if act.arg("strength").is_none() {
            return Err(Rejection::Missing("strength".into()));
        }
        if world.is(&act.actor, "alive", false) {
            return Err(Rejection::Cannot(format!("{} is dead", act.actor)));
        }
        let cup: Id = "cup".into();
        if world.get(&cup, "on") == Some(&Value::Ref(target.clone())) {
            Ok(vec![Effect::set(&cup, "on", Value::point("floor"))])
        } else {
            Ok(vec![])
        }
    }
}

fn rules() -> Rulebook {
    Rulebook::default().with(Knock)
}

fn key(id: &str, when: When, body: Body) -> Key {
    Key {
        id: KeyId(id.into()),
        when,
        body,
        source: Source::new("test", id),
    }
}

fn state(id: &str, t: i64, point: &str, property: &str, value: Value) -> Key {
    key(
        id,
        When::At(Time::at(t)),
        Body::State {
            point: point.into(),
            property: property.into(),
            value,
        },
    )
}

fn push(id: &str, t: i64, strength: Option<f64>) -> Key {
    let mut act = Act::new("mara", "push").with("target", Value::point("table"));
    if let Some(s) = strength {
        act = act.with("strength", Value::Number(s));
    }
    key(id, When::At(Time::at(t)), Body::Cause(Cause::Act(act)))
}

fn knock_rule() -> Key {
    key(
        "k4",
        When::Always,
        Body::Rule {
            rule: "knock".into(),
        },
    )
}

fn setting() -> Vec<Key> {
    vec![
        knock_rule(),
        state("k0", 0, "mara", "alive", Value::Bool(true)),
        state("k1", 0, "cup", "on", Value::point("table")),
    ]
}

#[test]
fn the_cup_example_resolves_once_a_cause_is_given() {
    // Spec §10: "Later, it lay on the floor." with no cause is unexplained...
    let mut keys = setting();
    keys.push(state("k2", 40, "cup", "on", Value::point("floor")));
    let out = simulate(&keys, &rules());
    assert!(matches!(&out.gaps[..], [Gap::Unexplained { key, .. }] if key.0 == "k2"));

    // ...but the author still wins: the cup is on the floor at @40 (log 0007).
    let world = out.history.world_at(Time::at(40));
    assert_eq!(world.get(&"cup".into(), "on"), Some(&Value::point("floor")));

    // Adding "Mara bumped the table" explains it, and the gap clears by itself.
    keys.push(push("k3", 35, Some(5.0)));
    let out = simulate(&keys, &rules());
    assert_eq!(out.gaps, vec![]);
    let why = out.history.why(&"cup".into(), "on", Time::at(40)).unwrap();
    assert_eq!(
        why.why,
        Why::Rule {
            key: KeyId("k3".into()),
            rule: "knock".into()
        }
    );
}

#[test]
fn unstated_values_are_filled_in_not_changed() {
    let mut keys = setting();
    keys.push(state("k2", 40, "cup", "intact", Value::Bool(false)));
    let out = simulate(&keys, &rules());
    assert_eq!(out.gaps, vec![]);
    let change = out
        .history
        .why(&"cup".into(), "intact", Time::at(40))
        .unwrap();
    assert_eq!(change.why, Why::FillIn(KeyId("k2".into())));
    // A fill-in counts from where it's placed; before that it stays unspecified (log 0007).
    assert_eq!(
        out.history
            .world_at(Time::at(39))
            .get(&"cup".into(), "intact"),
        None
    );
}

#[test]
fn a_missing_parameter_is_unspecified() {
    let mut keys = setting();
    keys.push(push("k3", 35, None));
    let out = simulate(&keys, &rules());
    assert_eq!(
        out.gaps,
        vec![Gap::Unspecified {
            key: KeyId("k3".into()),
            parameter: "strength".into()
        }]
    );
}

#[test]
fn rejected_and_unhandled_causes_change_nothing() {
    let mut keys = setting();
    keys.push(state("k5", 10, "mara", "alive", Value::Bool(false)));
    keys.push(push("k3", 35, Some(5.0)));
    keys.push(key(
        "k6",
        When::At(Time::at(36)),
        Body::Cause(Cause::Act(Act::new("mara", "fly"))),
    ));
    let out = simulate(&keys, &rules());
    let world = out.history.world_at(Time::at(50));
    assert_eq!(world.get(&"cup".into(), "on"), Some(&Value::point("table")));
    assert!(
        out.gaps
            .iter()
            .any(|g| matches!(g, Gap::Rejected { key, .. } if key.0 == "k3"))
    );
    assert!(
        out.gaps
            .iter()
            .any(|g| matches!(g, Gap::Unhandled { verb, .. } if verb == "fly"))
    );
    // Mara dying with no cause is itself unexplained.
    assert!(
        out.gaps
            .iter()
            .any(|g| matches!(g, Gap::Unexplained { key, .. } if key.0 == "k5"))
    );
}

#[test]
fn rules_do_nothing_until_a_rule_key_switches_them_on() {
    let mut keys = setting();
    keys.retain(|k| k.id.0 != "k4");
    keys.push(push("k3", 35, Some(5.0)));
    let out = simulate(&keys, &rules());
    assert_eq!(
        out.gaps,
        vec![Gap::Unhandled {
            key: KeyId("k3".into()),
            verb: "push".into()
        }]
    );
}

#[test]
fn same_instant_disagreement_is_a_conflict_and_the_later_key_wins() {
    let mut keys = setting();
    keys.push(state("a", 5, "walls", "color", Value::text("yellow")));
    keys.push(state("b", 5, "walls", "color", Value::text("blue")));
    let out = simulate(&keys, &rules());
    assert!(matches!(&out.gaps[..], [Gap::Conflict { keys, .. }] if keys.1 .0 == "b"));
    let world = out.history.world_at(Time::at(5));
    assert_eq!(
        world.get(&"walls".into(), "color"),
        Some(&Value::text("blue"))
    );
}

#[test]
fn unplaced_keys_are_reported_and_take_no_part() {
    let mut keys = setting();
    let after = vec![KeyId("k1".into())];
    keys.push(key(
        "k2",
        When::Unplaced {
            after,
            before: vec![],
        },
        Body::State {
            point: "cup".into(),
            property: "on".into(),
            value: Value::point("floor"),
        },
    ));
    let out = simulate(&keys, &rules());
    assert_eq!(
        out.gaps,
        vec![Gap::Unplaced {
            key: KeyId("k2".into())
        }]
    );
}

#[test]
fn simulation_is_deterministic() {
    let mut keys = setting();
    keys.push(push("k3", 35, Some(5.0)));
    keys.push(state("k2", 40, "cup", "on", Value::point("floor")));
    let a = simulate(&keys, &rules());
    let b = simulate(&keys, &rules());
    assert_eq!(format!("{:?}", a.history), format!("{:?}", b.history));
}
