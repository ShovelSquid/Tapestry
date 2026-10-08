//! Play the dungeon in a terminal.
//!
//! With `ANTHROPIC_API_KEY` set, Claude narrates: write anything, and it turns
//! your words into actions the engine judges (see `ai.rs`). Without a key, or
//! after `!typed`, it's a classic verb-noun parser.
//!
//! Lines starting with `!` are author commands: say what's true, set things by
//! fiat, ask why something is the way it is, see the gap report, or undo.

mod ai;

use std::io::{BufRead, Write};
use tapestry_core::*;
use tapestry_dungeon::{Game, Offer, PLAYER, Scene, perceive};

const HELP: &str = "\
Play:    with Claude narrating, just write what you do, in any words.
         typed mode: look · inventory · go <dir> (or n/s/e/w) · take/drop <thing>
         open/close/unlock/lock <door> · attack <someone> · quit
Author:  !state <point>.<property> = <value>   say something is true (it holds, but may be flagged)
         !fiat  <point>.<property> = <value>   set something directly, as the author
         !why   <point>.<property>             what made it so
         !gaps · !keys · !undo · !help
View:    !trace  show or hide what the AI understood and what the core decided
         !typed  switch between Claude and typed commands
Values:  true, false, numbers, \"text\", or a point id such as hall";

const DIM: &str = "\x1b[2m";
const RED: &str = "\x1b[31m";
const RESET: &str = "\x1b[0m";

fn main() {
    let mut game = Game::default();
    let mut narrator = ai::Narrator::from_env();
    let mut use_ai = narrator.is_some();
    let mut trace = true;

    println!("TAPESTRY — a small dungeon. Type !help for commands.");
    match &narrator {
        Some(n) => println!(
            "{DIM}Narrated by {} (effort {}). Write anything. Under each turn, the trace shows what\n\
             the AI understood and what the core decided; !trace hides it.{RESET}\n",
            n.model(),
            n.effort()
        ),
        None => println!(
            "{DIM}No ANTHROPIC_API_KEY set, so this is typed-command mode. Set the key and restart\n\
             to play in plain English with Claude narrating.{RESET}\n"
        ),
    }
    if let (true, Some(n)) = (use_ai, narrator.as_mut()) {
        ai_turn(n, &mut game, "(The story begins. Set the scene.)", trace);
    } else {
        println!("{}", narrate(&game));
    }

    let stdin = std::io::stdin();
    loop {
        print!("\n> ");
        std::io::stdout().flush().unwrap();
        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap() == 0 {
            break;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if matches!(line, "quit" | "q" | "exit") {
            break;
        }
        match line {
            "!trace" => {
                trace = !trace;
                println!("Trace {}.", if trace { "on" } else { "off" });
                continue;
            }
            "!typed" => {
                if narrator.is_none() {
                    println!("Claude isn't available: no ANTHROPIC_API_KEY.");
                } else {
                    use_ai = !use_ai;
                    println!(
                        "{}",
                        if use_ai {
                            "Claude is narrating."
                        } else {
                            "Typed commands."
                        }
                    );
                }
                continue;
            }
            _ => {}
        }
        if let Some(cmd) = line.strip_prefix('!') {
            let reply = author(&mut game, cmd);
            println!("{reply}");
            // Claude can't see author edits happen, so it's told with its next turn.
            let changes_world = ["state", "fiat", "undo"].iter().any(|c| cmd.starts_with(c));
            if let (true, Some(n)) = (changes_world, narrator.as_mut())
                && !reply.starts_with("Use")
                && !reply.starts_with("Nothing")
            {
                n.note(format!("The author used: !{cmd}"));
            }
        } else if let (true, Some(n)) = (use_ai, narrator.as_mut()) {
            ai_turn(n, &mut game, line, trace);
        } else {
            println!("{}", play(&mut game, line));
        }
    }
}

fn ai_turn(narrator: &mut ai::Narrator, game: &mut Game, words: &str, trace: bool) {
    print!("{DIM}…{RESET}");
    std::io::stdout().flush().unwrap();
    match narrator.turn(game, words) {
        Ok(log) => {
            println!("\r{}", log.narration);
            if trace {
                println!();
                if log.calls.is_empty() {
                    println!("{DIM}┆ AI understood: no action{RESET}");
                }
                for c in &log.calls {
                    let colour = if c.refused { RED } else { DIM };
                    println!("{DIM}┆ AI understood: {}{RESET}", c.input);
                    println!("{colour}┆   core decided: {}{RESET}", c.verdict);
                }
                println!(
                    "{DIM}┆ {} · {} tokens in ({} cached) · {} out{RESET}",
                    log.model, log.tokens_in, log.tokens_cached, log.tokens_out
                );
            }
        }
        Err(e) => println!("\r{RED}Narrator error: {e}{RESET}"),
    }
}

fn name(world: &World, id: &Id) -> String {
    world
        .get(id, "name")
        .and_then(Value::as_text)
        .unwrap_or(id.as_str())
        .to_owned()
}

/// "a sword", "an old sword".
fn a(noun: &str) -> String {
    let article = if noun.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    };
    format!("{article} {noun}")
}

fn narrate(game: &Game) -> String {
    let world = game.world();
    let scene = perceive(&world, &PLAYER.into());
    describe(&world, &scene)
}

fn describe(world: &World, scene: &Scene) -> String {
    if !scene.alive {
        return "You are dead.".into();
    }
    let mut out = format!("You are in {}.", scene.description);
    let seen: Vec<String> = scene
        .things
        .iter()
        .map(|t| {
            let dead = if world.is(t, "alive", false) {
                " (dead)"
            } else {
                ""
            };
            format!("{}{dead}", a(&name(world, t)))
        })
        .collect();
    if !seen.is_empty() {
        out += &format!("\nYou see {}.", seen.join(", "));
    }
    let exits: Vec<String> = scene
        .exits
        .iter()
        .map(|(e, door)| match door {
            Some(d) => {
                let state = if world.is(d, "open", true) {
                    "open"
                } else {
                    "closed"
                };
                format!(
                    "{} (through the {}, {state})",
                    name(world, e),
                    name(world, d)
                )
            }
            None => name(world, e),
        })
        .collect();
    out += &format!("\nExits: {}.", exits.join(", "));
    if scene.goal {
        out += "\n\nThe night air hits your face. You're out. You've escaped the dungeon.";
    }
    out
}

/// Finds the point a word refers to, among what the player can perceive.
fn resolve(world: &World, scene: &Scene, words: &[&str]) -> Option<Id> {
    let phrase = words.join(" ");
    scene
        .in_view()
        .find(|id| {
            let n = name(world, id);
            let last = id.as_str().rsplit('/').next().unwrap_or_default();
            n == phrase || last == phrase || n.split(' ').any(|w| words.contains(&w))
        })
        .cloned()
}

fn play(game: &mut Game, line: &str) -> String {
    let world = game.world();
    let scene = perceive(&world, &PLAYER.into());
    let lower = line.to_lowercase();
    let words: Vec<&str> = lower
        .split_whitespace()
        .filter(|w| !matches!(*w, "the" | "a" | "an" | "at" | "to" | "with"))
        .collect();
    let Some((&verb, rest)) = words.split_first() else {
        return String::new();
    };

    let (verb, rest): (&str, Vec<&str>) = match verb {
        "n" | "north" | "s" | "south" | "e" | "east" | "w" | "west" => {
            let dir = match &verb[..1] {
                "n" => "north",
                "s" => "south",
                "e" => "east",
                _ => "west",
            };
            ("go", vec![dir])
        }
        "get" | "grab" | "pick" => (
            "take",
            rest.iter().copied().filter(|w| *w != "up").collect(),
        ),
        "kill" | "hit" | "fight" | "stab" => ("attack", rest.to_vec()),
        "shut" => ("close", rest.to_vec()),
        "l" => ("look", vec![]),
        "i" | "inv" => ("inventory", vec![]),
        v => (v, rest.to_vec()),
    };

    match verb {
        "look" => return describe(&world, &scene),
        "inventory" => {
            if scene.held.is_empty() {
                return "You're carrying nothing.".into();
            }
            let items: Vec<String> = scene.held.iter().map(|i| a(&name(&world, i))).collect();
            return format!("You're carrying {}.", items.join(", "));
        }
        _ => {}
    }

    let arg = match verb {
        "go" => "exit",
        "take" | "drop" => "item",
        "open" | "close" | "unlock" | "lock" => "door",
        "attack" => "target",
        _ => "",
    };
    let mut act = Act::new(PLAYER, verb);
    if !rest.is_empty() && !arg.is_empty() {
        // Words for things the player can't perceive still become keys, so the rules can refuse them.
        let target = resolve(&world, &scene, &rest).unwrap_or_else(|| Id::from(rest.join(" ")));
        act = act.with(arg, Value::Ref(target));
    }

    match game.act(act, line) {
        Offer::Refused(Gap::Rejected { reason, .. }) => format!("You can't: {reason}."),
        Offer::Refused(Gap::Unspecified { parameter, .. }) => {
            format!("{verb} what? ({parameter} not given)")
        }
        Offer::Refused(Gap::Unhandled { .. }) => {
            format!("Nothing in this world gives '{verb}' a meaning.")
        }
        Offer::Refused(other) => format!("Refused: {other}"),
        Offer::Kept(gaps) => {
            let after = game.world();
            let mut out = match verb {
                "go" => describe(&after, &perceive(&after, &PLAYER.into())),
                "attack" => format!("You strike the {} down.", rest.join(" ")),
                _ => format!("You {verb} the {}.", rest.join(" ")),
            };
            for g in gaps {
                out += &format!("\n⚑ {g}");
            }
            out
        }
    }
}

fn parse_value(world: &World, s: &str) -> Value {
    let s = s.trim();
    match s {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 => {
            Value::text(&s[1..s.len() - 1])
        }
        _ => match s.parse::<f64>() {
            Ok(n) => Value::Number(n),
            Err(_) if world.contains(&s.into()) => Value::point(s),
            Err(_) => Value::text(s),
        },
    }
}

fn split_target(s: &str) -> Option<(Id, String)> {
    let (point, property) = s.trim().rsplit_once('.')?;
    Some((point.trim().into(), property.trim().to_owned()))
}

fn author(game: &mut Game, cmd: &str) -> String {
    let (word, rest) = cmd.split_once(' ').unwrap_or((cmd, ""));
    match word {
        "help" => HELP.into(),
        "state" | "fiat" => {
            let Some((lhs, rhs)) = rest.split_once('=') else {
                return "Use: !state point.property = value".into();
            };
            let Some((point, property)) = split_target(lhs) else {
                return "Use: point.property".into();
            };
            let value = parse_value(&game.world(), rhs);
            let body = if word == "state" {
                Body::State {
                    point,
                    property,
                    value,
                }
            } else {
                Body::Cause(Cause::Fiat {
                    point,
                    property,
                    value,
                })
            };
            match game.offer(body, Source::new("author", cmd)) {
                Offer::Kept(gaps) if gaps.is_empty() => "Noted. Nothing needs explaining.".into(),
                Offer::Kept(gaps) => {
                    let lines: Vec<String> = gaps.iter().map(|g| format!("⚑ {g}")).collect();
                    format!(
                        "{}\nThe story keeps it. Explain it with a cause, or !undo.",
                        lines.join("\n")
                    )
                }
                Offer::Refused(g) => format!("Refused: {g}"),
            }
        }
        "why" => {
            let Some((point, property)) = split_target(rest) else {
                return "Use: !why point.property".into();
            };
            let outcome = game.outcome();
            let Some(change) = outcome.history.why(&point, &property, game.now()) else {
                return format!("{point}.{property} is unspecified. Nobody has said.");
            };
            let key = game.keys().iter().find(|k| &k.id == change.why.key());
            let said = key.and_then(|k| k.source.text.clone()).unwrap_or_default();
            let by = key.map(|k| k.source.author.clone()).unwrap_or_default();
            let how = match &change.why {
                Why::Rule { rule, .. } => format!("by the rule '{rule}', from"),
                Why::Fiat(_) => "by fiat, in".into(),
                Why::FillIn(_) => "filled in by".into(),
                Why::Unexplained(_) => "UNEXPLAINED — stated, with no cause, in".into(),
            };
            format!(
                "{point}.{property} = {} since {}, {how} {} ({by}: \"{said}\")",
                change.after,
                change.time,
                change.why.key()
            )
        }
        "gaps" => {
            let gaps = &game.outcome().gaps;
            if gaps.is_empty() {
                "No bounded gaps. Everything that changed has a cause.".into()
            } else {
                gaps.iter()
                    .map(|g| g.to_string())
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        "keys" => game
            .keys()
            .iter()
            .filter(|k| k.source.author != "world")
            .map(|k| {
                let when = match &k.when {
                    When::At(t) => t.to_string(),
                    _ => "?".into(),
                };
                format!(
                    "{} {when} {}: {}",
                    k.id,
                    k.source.author,
                    k.source.text.as_deref().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "undo" => match game.undo() {
            Some(k) => format!(
                "Took back {} ({}). The story replays without it.\n\n{}",
                k.id,
                k.source.text.unwrap_or_default(),
                narrate(game)
            ),
            None => "Nothing to undo.".into(),
        },
        _ => format!("Unknown author command '{word}'. Try !help."),
    }
}
