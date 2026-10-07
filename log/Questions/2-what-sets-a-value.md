2. What actually sets a value? (from the review, and §12.4)
State keys only get checked, never enforced. That means the only things that write values are causes, through rules or directly.
My take: say so plainly. Fiat is a cause that sets a value directly, and it's the only kind of "set" that exists. Log 0003's tie-break ("later key wins") then only ever applies to fiat causes that clash.

{What do you mean by this? I need some more clarification. I do think that causes are the main thing that write values though; what else would write values? physics changes, propogation of bounds and bonds are indirectly specified causes I suppose. Forces}

[Claude: I explained this badly. There are three ways a value in the world can change:
- Rules: physics, forces, bonds breaking, heat spreading, fear rising. A cause such as "Mara pushed the table" feeds into a rule, and the rule moves the table. You're right that these are causes too, just indirect ones.
- Fiat: "and then the walls were blue." Nothing in the world made it happen; the author sets the value directly.
- Fill-ins: a state key fills in a value nobody had stated yet. I left this out before, and it does count as a write.
State keys that conflict with an existing value never write anything. They only get checked.

Why it matters: the conflict rule. Forces on the same thing add together, so they never clash. Two direct sets at the same instant ("blue" and "red") can't both happen, so one has to win. My point was only that the "later key wins" tie-break is needed for fiat and fill-ins, and never for rules. It's a small fix to the wording, not a big question.]

{Kaelen: Fiat to me sounds more like source, whereas fill-ins yeah are arbitrary filling in of gaps. I think there's a difference between a companion keying in causes between gaps as opposed to physics or rule simulated steps, and I'm wondering are both fill-ins? I see the difference between source and cause; where there is a key that describes something being a source, and then a second key is a second source, and then causes are keys that feed into other keys and resolve gaps. Does that sound about right? I'm still trying to understand I think.}

[Claude: You're close, and you've caught me mixing two things up. You're right: fiat *is* a source. My list from before mixed up *how* a value gets written with *why* it changed. Here's a cleaner picture, with three layers:

1. Keys are what authors say. Text, you, and companions all produce keys, and nothing else does.
   - Cause keys start things: "Mara bumped the table", "she chose to forgive him", "and then the walls were blue". To the engine, every cause key is a source. It never asks what caused a cause key. "Why did she bump the table?" is open surface, there to explore if you like, not a gap. (An author can still add a "because", but it's never required.)
   - Fiat is just a cause key that sets a value directly instead of going through a rule.
   - State keys say how things are: "the cup lay on the floor". These are expectations.
2. Simulation is what rules compute from the keys: the table moves, the cup slides and falls, resentment fades. These steps are not keys and are never stored. They're recomputed every time from the keys (log 0002, "store inputs").
3. Checking compares state keys with what the simulation produced. If they match, the key is satisfied. If they differ and nothing explains it, that's an unexplained change, a gap. If nobody had said anything about that value before, the state key simply fills it in. That's all a fill-in is.

So to your question, "are both fill-ins?" No, they're different:
- A companion keying in a cause to explain a gap is authoring. It writes a new cause key, exactly as you would by hand. It isn't a fill-in, it's a new key.
- Rule-simulated steps aren't keys at all. They're the simulation's output.
- A fill-in is only ever a state key landing on a value nobody had stated.

And a small correction to your summary: causes don't feed into other keys. Causes feed into rules, rules change values, and state keys are checked against those values. A gap is resolved when, after someone adds a cause, the simulation now produces what the state key said. That's the cup example in §10: k3, "Mara bumped the table", resolves k2 through gravity, not by touching k2.

In one line: authors write keys; cause keys start things; rules carry them forward; state keys get checked.

Does that picture sit right with you?]

{Kaelen: yes that sits right with me, especially if we could have a companion narrator that could add keys almost procedurally, based off of how the rules are progressing the causes to go in a certain direction. Then companion narrators could generate keys from that data, which propagates the causes, which continues the process on and on ad infinitum.}

[Claude: Good, this one's settled. And the narrator loop you describe fits the core with almost nothing added:

    simulation runs → narrator reads where things are heading → narrator writes keys → simulation runs → ...

It works because of decisions already made:
- It stays deterministic. The narrator's keys are stored as inputs, so replay never calls the narrator again. A story grown this way replays exactly.
- The narrator reads the authoritative simulation, never the preview (principle 10). It can't be steered by something that only looks a certain way.
- The narrator is just an author. It picks directions; the engine still doesn't (principle 4).

Two things to settle when we get to it:
1. Where the loop writes. I'd run it on a branch of `.tree`. You let the narrator spin the story forward on its own branch, watch it play, then keep what you like. Branches already exist, so this costs nothing new and the main story is never written to behind your back.
2. Upstream edits. If you change an early key, the simulation changes and the narrator's later keys may no longer fit. The `derived_from` link from the shambles thread helps here: the dependency query can list every narrator key built on what you changed, and you can rerun the narrator from that point.

This is the gap-filling layer (still deferred in §11). I'd write it up as its own log entry once the core questions are settled. Sound good?]

{Kaelen: }
