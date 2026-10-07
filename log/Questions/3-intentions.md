3. What can a character's intention cause? (§12.5)
This is the biggest one, because it decides how believable characters are. If "Mara decides to leave" can only move Mara's own body, then fear, trust and similar feelings all have to come from rules. If an intention can also change her own feelings directly, then "she chose to forgive him" is a source, a cause that needs nothing behind it.
My take: an intention can directly change only the agent's own properties: body, attention, and feelings they choose. Anything outside the agent has to go through rules. That keeps the world strictly causal without making people feel mechanical.

{Everything should adhere to rules; yet the mechanical rules that govern people may be quite complex, and can emerge organically. I think "She chose to forgive him" is a valid key, and does affect other mental properties that she has inside herself before and after. }

[Claude: Your answer is better than mine. The way I read it:
- The choice itself is the source. "She chose to forgive him" needs nothing behind it. It's a valid key and it starts things.
- Everything after it follows rules, even inside her. Forgiving lowers resentment, trust maybe only comes back slowly, the anger may still flare up. Those are rules about how a mind works, and they can be as complex and emergent as you like.
So the line isn't "her own properties versus everything else" (my version). It's: the decision has no cause, and its effects always go through rules.

One consequence: verbs start to matter. "She chose to forgive him" is a source; "she felt afraid" is a change that needs a cause. Telling them apart is the extraction layer's job (deferred), but the engine needs both kinds of key. A choice can still be given a cause if the author wants one ("because she saw him cry"). That's optional, not required.

Is that the right reading?]

{Kaelen: Yes I think that's closer, yet what's the difference between a source and a change?}

[Claude: They are two different kinds of thing. A source is an *event*. A change is what happens to a *value*.
- A change is a property's value differing from what it was before: the cup's position, Mara's resentment. Every change needs a cause to explain it.
- A cause is the event that explains a change. Causes can have causes of their own (the push moved the table, the table moved the cup), so they form a chain.
- A source is where that chain stops: an event that needs no explanation itself. A decision, an earthquake, the author's fiat, the world's starting state.

So in "she chose to forgive him", the choice is the source. Her resentment going down is a change, and the choice (through mind rules) is its explanation. The engine is happy with this: the change is explained, and the explanation stops at something that's allowed to stop.

"She felt afraid", with no reason given, is different. Fear rising is a change with nothing explaining it, so it shows up as an unexplained change. The question is "what frightened her?"

That leaves the real design question underneath yours: which events are allowed to be sources? So far it's agents' decisions, external events like the earthquake, starting conditions, and fiat. Writers do sometimes want a feeling to arrive with no reason ("a dread came over her, and she didn't know why"). I'd allow that as fiat: legal, but recorded as fiat, so the gap report can still show it if anyone asks. Should a feeling ever count as a source in its own right, the way a choice does?]

{Kaelen: Yet, I think that causes stopping at sources is only partly accurate; sources are the knitted moments where a thing is where it is and what it is at a certain point of time, and those may or may not include changes to values/properties at those source points. I think sources are analogous to keys, at least in my mind. I think there's no real difference between a feeling or a choice; it's all just properties and values attached to points, so changing a feeling at a moment "She felt sad," should have the same effect as "she went to the store." Just changing positions, values, properties at certain intervals of time, and leaving the gaps to be resolved either by deterministic engines wherever possible or companion narrators when needed.}

[Claude: I think you're right, and it's simpler than what I had. Let me restate your model to check I have it:

- A key pins a thing at a moment: where it is, what it is, what it feels. "She felt sad", "she went to the store" and "the cup lay on the floor" are all the same kind of statement: a value on a point at a time. Feelings and choices get no special treatment.
- Between pins are gaps, and the gaps get resolved: by deterministic rules wherever they can (physics, mind rules), and by companion narrators where they can't.
- Even "Mara bumped the table" fits this: it pins a contact or force at a moment. That makes keys very much like keyframes in animation, which is where the name came from in the first place.

That removes my choice/feeling split, and I think that's an improvement. The engine shouldn't decide that choosing is free and feeling isn't. That's the same kind of judgment principle 4 keeps out.

There's one thing your model makes us decide, and it's the core of the whole engine. Suppose a pin and the simulation disagree. "She felt sad" at noon, but nothing in the world has made her sad. What does the world show at noon?

- (1) Simulation wins (what the spec says now, principle 3). The world shows her not sad. "Sad" appears as a ghost, plus a gap: "what made her sad?" Strict, never cheats, but the story you wrote doesn't show up until someone explains it.
- (2) The pin wins, and the jump is flagged. From noon she is sad. The jump from not-sad to sad is recorded as an unexplained change, a gap still waiting for an explanation. The engine doesn't blend or pull toward the pin (log 0001 rejected that); it just takes the value at that moment, like fiat, and keeps a list of every place that happened.

Option (2) seems closest to what you're describing: "changing values at moments, leaving the gaps to be resolved". It also keeps the honesty that principle 3 cares about, because nothing is hidden: every unexplained jump is listed. The cost is that the world can have unexplained jumps in it until someone resolves them. Option (1) keeps the world causally clean, but the story you wrote stays a ghost until someone explains it.

Which feels right? If (2), I'd rewrite principle 3 as: the engine never hides a jump, rather than the engine never shows one.]

{Kaelen: Yes 2 most definitely, it flags the jump and if it shouldn't be that way, it can be said to the author: are you sure she's sad? What made her sad? the simulation says she should be happy right now. Yet, the author is the controller of the story, so if they're sad, they're sad, and that proposes a bunch of possible reasons not in the current context of the simulation for why she may be sad. Perhaps, at noon this day, it was her brother's death. You know what I mean? There could be any myriad of explanations for why that deviation from the rules has occurred, while being within the rules.}

[Claude: Yes, I know exactly what you mean, and this settles the biggest question we have. Option 2: the author is in control, and the engine is honest about it. Here's how I'd write it down.

The decision:
- A state key holds. If you say she's sad at noon, she's sad at noon, and from then on the rules run forward from "sad".
- If the rules didn't lead there, the jump is flagged as an unexplained change. It's not an error and it's not a refusal. It's an invitation: "the simulation had her happy; what made her sad?"
- The ghost flips. Before, the ghost showed your expectation while the world showed the simulation. Now the world shows what you wrote, and the ghost shows what the rules would have produced: the happy Mara who would have been. That's a nice view in itself: the story that would have happened.
- There's still no pulling or blending toward a target (log 0001 rejected that). It's a clean jump at a moment, recorded.

Your brother example shows the best part: explanations can arrive later and come from anywhere in time. Someone (you, or a companion narrator) adds "her brother died a year ago today" earlier in the timeline, plus a rule like "anniversaries of a loss bring grief". The simulation now produces sadness at noon by itself, the jump has an explanation, and the flag clears automatically. Nothing about her being sad changed; it just stopped being unexplained. Keys can already be placed anywhere in time, so this needs nothing new.

What this changes elsewhere:
- Principle 3 becomes something like: "The simulation never hides a jump. The author's keys hold, and every place where they depart from the rules is reported."
- §8.2 (checking): unexplained state keys are applied, not just displayed.
- Thread 2's one-line summary needs a small fix: "state keys hold and get checked", not just "get checked".
- Two state keys disagreeing at the same moment is still a conflict, decided by the tie-break from log 0003.

This is the most important change since log 0001, so it deserves its own log entry. I'll draft it once you've finished the other threads. Anything you'd change in how I've written it?]

{Kaelen: }
