use super::*;

fn act(verb: &str, arg: &str, target: &str) -> Act {
    Act::new(PLAYER, verb).with(arg, Value::point(target))
}

fn kept(offer: Offer) -> Vec<Gap> {
    match offer {
        Offer::Kept(gaps) => gaps,
        Offer::Refused(gap) => panic!("refused: {gap}"),
    }
}

fn refused(offer: Offer) -> String {
    match offer {
        Offer::Refused(Gap::Rejected { reason, .. }) => reason,
        Offer::Refused(other) => panic!("refused for another reason: {other}"),
        Offer::Kept(_) => panic!("expected a refusal"),
    }
}

fn player_room(game: &Game) -> Id {
    room_of(&game.world(), &PLAYER.into()).unwrap()
}

#[test]
fn the_world_starts_with_no_gaps() {
    assert_eq!(Game::default().outcome().gaps, vec![]);
}

#[test]
fn escape_the_dungeon() {
    let mut g = Game::default();
    assert_eq!(
        refused(g.act(act("go", "exit", "cellar/north"), "go north")),
        "the iron door is locked"
    );
    assert_eq!(
        refused(g.act(act("open", "door", "door"), "open door")),
        "the iron door is locked"
    );
    kept(g.act(act("take", "item", "key"), "take key"));
    kept(g.act(act("unlock", "door", "door"), "unlock door"));
    kept(g.act(act("open", "door", "door"), "open door"));
    kept(g.act(act("go", "exit", "cellar/north"), "go north"));
    assert_eq!(player_room(&g).as_str(), "hall");

    assert_eq!(
        refused(g.act(act("go", "exit", "hall/east"), "go east")),
        "the guard bars the way"
    );
    assert_eq!(
        refused(g.act(act("attack", "target", "guard"), "attack guard")),
        "you have nothing to fight with"
    );
    kept(g.act(act("go", "exit", "hall/south"), "go south"));
    kept(g.act(act("take", "item", "sword"), "take sword"));
    kept(g.act(act("go", "exit", "cellar/north"), "go north"));
    kept(g.act(act("attack", "target", "guard"), "attack guard"));
    kept(g.act(act("go", "exit", "hall/east"), "go east"));
    assert!(perceive(&g.world(), &PLAYER.into()).goal);
    assert_eq!(
        g.outcome().gaps,
        vec![],
        "a fair game leaves nothing unexplained"
    );
}

#[test]
fn things_that_arent_there_cant_be_used() {
    let mut g = Game::default();
    assert_eq!(
        refused(g.act(
            act("take", "item", "dragon"),
            "pull a dragon from my pocket"
        )),
        "there's no dragon here"
    );
    assert_eq!(
        refused(g.act(act("attack", "target", "guard"), "attack the guard")),
        "there's no guard here"
    );
    // A verb nobody gave a meaning to is refused too, not improvised.
    assert!(matches!(
        g.act(Act::new(PLAYER, "teleport"), "teleport out"),
        Offer::Refused(Gap::Unhandled { .. })
    ));
}

#[test]
fn a_narrator_raising_the_dead_is_flagged_but_holds() {
    let mut g = Game::default();
    for (a, x, t) in [
        ("take", "item", "key"),
        ("take", "item", "sword"),
        ("unlock", "door", "door"),
        ("open", "door", "door"),
        ("go", "exit", "cellar/north"),
        ("attack", "target", "guard"),
    ] {
        kept(g.act(act(a, x, t), a));
    }
    // A careless narrator says the guard is standing again.
    let body = Body::State {
        point: "guard".into(),
        property: "alive".into(),
        value: Value::Bool(true),
    };
    let gaps = kept(g.offer(
        body,
        Source::new("companion:narrator", "The guard rises to his feet."),
    ));
    assert!(matches!(
        &gaps[..],
        [Gap::Unexplained {
            simulated: Value::Bool(false),
            ..
        }]
    ));
    // The author wins (log 0007): he is alive, and he bars the way again.
    assert_eq!(
        refused(g.act(act("go", "exit", "hall/east"), "go east")),
        "the guard bars the way"
    );

    // Taking it back clears the gap and the story replays without it.
    g.undo();
    assert_eq!(g.outcome().gaps, vec![]);
    kept(g.act(act("go", "exit", "hall/east"), "go east"));
}

#[test]
fn why_traces_a_value_to_the_key_that_caused_it() {
    let mut g = Game::default();
    kept(g.act(act("take", "item", "key"), "take key"));
    kept(g.act(act("unlock", "door", "door"), "unlock the door"));
    let change = g
        .outcome()
        .history
        .why(&"door".into(), "locked", g.now())
        .unwrap();
    assert_eq!(
        change.why,
        Why::Rule {
            key: KeyId("k2".into()),
            rule: "locks".into()
        }
    );
}
