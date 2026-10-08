//! Claude as the dungeon's narrator (log 0008, stage 2).
//!
//! Claude turns the player's words into actions, which become keys offered to
//! the engine, and narrates from what the player perceives. It has no other
//! way to touch the world: every outcome comes back from the engine, and every
//! refusal has to be told as story. The trace records both sides, so a mistake
//! can be pinned on the AI (it misunderstood) or the core (it decided wrongly).
//!
//! Raw HTTP to the Messages API: Rust has no official SDK. The history is
//! append-only, so thinking blocks stay valid and the whole prefix caches.

use serde_json::{Value as Json, json};
use tapestry_core::{Act, Id, Value, World};
use tapestry_dungeon::{Game, Offer, PLAYER, Scene, perceive};

const API: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";
/// Most model calls a single turn may take before it gives up.
const MAX_STEPS: usize = 8;

const SYSTEM: &str = "\
You are the narrator of a text adventure. The world is simulated by an engine that is the \
only source of truth about what exists and what happens. You can't change the world yourself; \
you can only attempt actions on the player's behalf with your tools, and the engine decides.

Each turn you receive:
- <scene>: everything the player can currently perceive, with an [id] for each thing.
- <player>: what the player says or tries to do.
- Sometimes <author_notes>: changes the story's author made directly. Treat them as true.

How to play your part:
1. To make anything happen, call a tool, using ids from the scene. Only tool results decide \
outcomes. If the player's words imply several actions, call them in order.
2. What the player claims is an attempt, not a fact. \"I pull a dragon from my pocket\" is an \
attempt; the engine decides whether it happens.
3. If nothing is attempted (looking around, asking a question, talking to themselves), \
narrate from the scene without calling a tool.
4. Narrate in the second person, two to five sentences, vivid and brief.
5. Describe only what the scene and tool results support. Sensory texture (light, sound, \
smell, temperature) is welcome, but never introduce objects, people, exits or states that \
aren't in the scene, and never contradict it. If the player asks about something not in \
the scene, they don't see it.
6. When an action is refused, narrate the attempt failing in a way consistent with the \
reason. Never imply it succeeded.
7. Never mention ids, tools, rules or the engine in your narration.";

fn tool(name: &str, description: &str, arg: &str, arg_doc: &str) -> Json {
    json!({
        "name": name,
        "description": description,
        "strict": true,
        "input_schema": {
            "type": "object",
            "properties": { arg: { "type": "string", "description": arg_doc } },
            "required": [arg],
            "additionalProperties": false
        }
    })
}

fn tools() -> Json {
    json!([
        tool("go", "Walk through an exit.", "exit", "Exit id from the scene, e.g. cellar/north"),
        tool("take", "Pick something up.", "item", "Id of the thing"),
        tool("drop", "Put down something carried.", "item", "Id of the thing"),
        tool("open", "Open a door.", "door", "Id of the door"),
        tool("close", "Close a door.", "door", "Id of the door"),
        tool("unlock", "Unlock a door with something carried.", "door", "Id of the door"),
        tool("lock", "Lock a door with something carried.", "door", "Id of the door"),
        tool("attack", "Attack someone.", "target", "Id of who to attack"),
        {
            "name": "attempt",
            "description": "Anything else the player tries that no other tool covers \
                            (climb, pray, fly, push, search...). The world's rules decide \
                            whether it means anything.",
            "strict": true,
            "input_schema": {
                "type": "object",
                "properties": {
                    "verb": { "type": "string", "description": "One plain verb, e.g. climb" },
                    "target": { "type": "string", "description": "Id or name of what it's done to, or empty" }
                },
                "required": ["verb", "target"],
                "additionalProperties": false
            }
        }
    ])
}

/// One tool call and what the engine made of it.
pub struct Call {
    pub input: String,
    pub verdict: String,
    pub refused: bool,
}

pub struct TurnLog {
    pub calls: Vec<Call>,
    pub narration: String,
    pub tokens_in: u64,
    pub tokens_cached: u64,
    pub tokens_out: u64,
    pub model: String,
}

pub struct Narrator {
    agent: ureq::Agent,
    key: String,
    effort: String,
    tools: Json,
    messages: Vec<Json>,
    notes: Vec<String>,
}

fn name(world: &World, id: &Id) -> String {
    world
        .get(id, "name")
        .and_then(Value::as_text)
        .unwrap_or(id.as_str())
        .to_owned()
}

/// The scene as plain facts with ids, for the model. Built only from perception.
pub fn scene_facts(world: &World, scene: &Scene) -> String {
    if !scene.alive {
        return "The player is dead.".into();
    }
    let mut out = format!("room: {}\n", scene.description);
    let here: Vec<String> = scene
        .things
        .iter()
        .map(|t| {
            let state = if world.is(t, "alive", false) {
                " (dead)"
            } else {
                ""
            };
            format!("- {} [{t}]{state}", name(world, t))
        })
        .collect();
    out += &format!(
        "here:\n{}\n",
        if here.is_empty() {
            "- nothing".into()
        } else {
            here.join("\n")
        }
    );
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
                    "- {} [{e}], through the {} [{d}], {state}",
                    name(world, e),
                    name(world, d)
                )
            }
            None => format!("- {} [{e}]", name(world, e)),
        })
        .collect();
    out += &format!("exits:\n{}\n", exits.join("\n"));
    let held: Vec<String> = scene
        .held
        .iter()
        .map(|i| format!("- {} [{i}]", name(world, i)))
        .collect();
    out += &format!(
        "carrying:\n{}",
        if held.is_empty() {
            "- nothing".into()
        } else {
            held.join("\n")
        }
    );
    if scene.goal {
        out += "\nThe player has escaped: this is the way out of the dungeon.";
    }
    out
}

/// The model usually passes ids, but accept a name for anything in view.
fn resolve(world: &World, scene: &Scene, word: &str) -> Id {
    let word = word.trim();
    let id: Id = word.into();
    if world.contains(&id) {
        return id;
    }
    let lower = word.to_lowercase();
    scene
        .in_view()
        .find(|i| name(world, i).to_lowercase() == lower)
        .cloned()
        .unwrap_or(id)
}

impl Narrator {
    /// `None` when there's no API key, so the game falls back to typed commands.
    pub fn from_env() -> Option<Self> {
        let key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|k| !k.is_empty())?;
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_secs(300)))
            .build();
        Some(Self {
            agent: config.into(),
            key,
            effort: std::env::var("TAPESTRY_EFFORT").unwrap_or_else(|_| "low".into()),
            tools: tools(),
            messages: Vec::new(),
            notes: Vec::new(),
        })
    }

    pub fn model(&self) -> &str {
        MODEL
    }

    pub fn effort(&self) -> &str {
        &self.effort
    }

    /// Something the author changed directly, passed along with the next turn.
    pub fn note(&mut self, note: String) {
        self.notes.push(note);
    }

    /// Appends user content, merging into a trailing user message left by a failed request.
    fn push_user(&mut self, blocks: Vec<Json>) {
        if let Some(last) = self.messages.last_mut()
            && last["role"] == "user"
            && let Some(content) = last["content"].as_array_mut()
        {
            content.extend(blocks);
            return;
        }
        self.messages
            .push(json!({ "role": "user", "content": blocks }));
    }

    fn request(&self) -> Result<Json, String> {
        let body = json!({
            "model": MODEL,
            "max_tokens": 16000,
            "system": [{ "type": "text", "text": SYSTEM }],
            "tools": self.tools,
            "messages": self.messages,
            "output_config": { "effort": self.effort },
            // If a safety check declines a turn, the API retries it on its recommended fallback model.
            "fallbacks": "default",
            // Caches the whole conversation so far; each turn only pays for what's new.
            "cache_control": { "type": "ephemeral" }
        });
        let mut response = self
            .agent
            .post(API)
            .header("x-api-key", &self.key)
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", "server-side-fallback-2026-07-01")
            .send_json(&body)
            .map_err(|e| format!("couldn't reach the API: {e}"))?;
        let status = response.status();
        let json: Json = response
            .body_mut()
            .read_json()
            .map_err(|e| format!("bad response: {e}"))?;
        if !status.is_success() {
            let msg = json["error"]["message"].as_str().unwrap_or("unknown error");
            return Err(format!("API error {status}: {msg}"));
        }
        Ok(json)
    }

    /// One player turn: Claude acts through the engine as many times as it needs, then narrates.
    pub fn turn(&mut self, game: &mut Game, words: &str) -> Result<TurnLog, String> {
        let world = game.world();
        let scene = perceive(&world, &PLAYER.into());
        let mut text = String::new();
        if !self.notes.is_empty() {
            text += &format!(
                "<author_notes>\n{}\n</author_notes>\n",
                self.notes.join("\n")
            );
        }
        text += &format!(
            "<scene>\n{}\n</scene>\n<player>{words}</player>",
            scene_facts(&world, &scene)
        );
        self.push_user(vec![json!({ "type": "text", "text": text })]);
        self.notes.clear();

        let mut log = TurnLog {
            calls: Vec::new(),
            narration: String::new(),
            tokens_in: 0,
            tokens_cached: 0,
            tokens_out: 0,
            model: MODEL.into(),
        };
        for _ in 0..MAX_STEPS {
            let response = self.request()?;
            let usage = &response["usage"];
            log.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0)
                + usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
                + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            log.tokens_cached += usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
            log.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0);
            if let Some(m) = response["model"].as_str() {
                log.model = m.to_owned();
            }

            // Echo the whole reply back unchanged: thinking and fallback blocks included.
            let content = response["content"].clone();
            self.messages
                .push(json!({ "role": "assistant", "content": content }));

            match response["stop_reason"].as_str() {
                Some("refusal") => {
                    log.narration =
                        "(The narrator declined this turn. Try saying it differently.)".into();
                    return Ok(log);
                }
                Some("max_tokens") => return Err("the narrator ran out of room mid-reply".into()),
                _ => {}
            }

            let blocks = content.as_array().cloned().unwrap_or_default();
            let uses: Vec<&Json> = blocks.iter().filter(|b| b["type"] == "tool_use").collect();
            if uses.is_empty() {
                log.narration = blocks
                    .iter()
                    .filter(|b| b["type"] == "text")
                    .filter_map(|b| b["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim()
                    .to_owned();
                return Ok(log);
            }

            let mut results = Vec::new();
            for u in uses {
                let (result, call) = run_tool(game, u, words);
                results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": u["id"],
                    "content": result,
                    "is_error": call.refused
                }));
                log.calls.push(call);
            }
            self.push_user(results);
        }
        Err("the narrator kept acting without finishing the turn".into())
    }
}

/// Runs one of Claude's tool calls as a key offered to the engine. Returns what
/// Claude is told, and the trace line for the player.
fn run_tool(game: &mut Game, block: &Json, words: &str) -> (String, Call) {
    let tool = block["name"].as_str().unwrap_or_default().to_owned();
    let input = &block["input"];
    let world = game.world();
    let scene = perceive(&world, &PLAYER.into());
    let arg = |k: &str| input[k].as_str().unwrap_or_default().to_owned();

    let (verb, param, target) = match tool.as_str() {
        "go" => ("go".to_owned(), "exit", arg("exit")),
        "take" | "drop" => (tool.clone(), "item", arg("item")),
        "open" | "close" | "unlock" | "lock" => (tool.clone(), "door", arg("door")),
        "attack" => ("attack".to_owned(), "target", arg("target")),
        _ => (arg("verb").to_lowercase(), "target", arg("target")),
    };
    let shown = if target.is_empty() {
        format!("{verb}()")
    } else {
        format!("{verb}({target})")
    };

    let mut act = Act::new(PLAYER, &verb);
    if !target.is_empty() {
        act = act.with(param, Value::Ref(resolve(&world, &scene, &target)));
    }
    let source = tapestry_core::Source::new("player (via narrator)", words);
    match game.offer(
        tapestry_core::Body::Cause(tapestry_core::Cause::Act(act)),
        source,
    ) {
        Offer::Refused(gap) => {
            let reason = match &gap {
                tapestry_core::Gap::Rejected { reason, .. } => reason.clone(),
                tapestry_core::Gap::Unhandled { verb, .. } => {
                    format!("nothing in this world gives '{verb}' a meaning")
                }
                other => other.to_string(),
            };
            let result = format!("REFUSED by the world: {reason}. Nothing happened.");
            (
                result,
                Call {
                    input: shown,
                    verdict: format!("refused: {reason}"),
                    refused: true,
                },
            )
        }
        Offer::Kept(gaps) => {
            let key = game.keys().last().expect("just kept").id.clone();
            let after = game.world();
            let changes: Vec<String> = game
                .outcome()
                .history
                .changes
                .iter()
                .filter(|c| c.why.key() == &key)
                .map(|c| {
                    let before = c.before.as_ref().map_or("?".into(), |v| v.to_string());
                    format!("{}.{}: {before} → {}", c.point, c.property, c.after)
                })
                .collect();
            let mut verdict = format!(
                "kept {key}: {}",
                if changes.is_empty() {
                    "no change".into()
                } else {
                    changes.join(", ")
                }
            );
            for g in &gaps {
                verdict += &format!(" ⚑ {g}");
            }
            let scene = perceive(&after, &PLAYER.into());
            let result = format!(
                "Done.\nNow the player perceives:\n{}",
                scene_facts(&after, &scene)
            );
            (
                result,
                Call {
                    input: shown,
                    verdict,
                    refused: false,
                },
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(game: &mut Game, name: &str, input: Json) -> Call {
        let block = json!({ "type": "tool_use", "id": "toolu_test", "name": name, "input": input });
        run_tool(game, &block, "test").1
    }

    #[test]
    fn claudes_actions_go_through_the_engine() {
        let mut g = Game::default();
        let locked = call(&mut g, "unlock", json!({ "door": "door" }));
        assert!(locked.refused, "no key yet");
        // A name instead of an id still resolves to what's in view.
        let took = call(&mut g, "take", json!({ "item": "rusty key" }));
        assert!(!took.refused, "{}", took.verdict);
        assert!(
            took.verdict.contains("key.parent: cellar → player"),
            "{}",
            took.verdict
        );
        assert!(!call(&mut g, "unlock", json!({ "door": "door" })).refused);
    }

    #[test]
    fn inventions_are_refused() {
        let mut g = Game::default();
        assert!(call(&mut g, "take", json!({ "item": "dragon" })).refused);
        let fly = call(&mut g, "attempt", json!({ "verb": "fly", "target": "" }));
        assert!(
            fly.refused && fly.verdict.contains("'fly'"),
            "{}",
            fly.verdict
        );
        assert!(
            call(&mut g, "go", json!({ "exit": "hall/east" })).refused,
            "not in the hall"
        );
    }

    #[test]
    fn the_scene_only_holds_what_the_player_perceives() {
        let g = Game::default();
        let world = g.world();
        let facts = scene_facts(&world, &perceive(&world, &PLAYER.into()));
        assert!(facts.contains("rusty key [key]") && facts.contains("[cellar/north]"));
        assert!(!facts.contains("guard"), "the guard is in another room");
        assert!(
            !facts.contains("locked"),
            "the player can't see that the door is locked"
        );
    }
}
