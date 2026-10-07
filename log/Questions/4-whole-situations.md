4. Can a state key describe a whole situation? (§12.6)
For example, "The room was in chaos." Writers say things like this all the time.
My take: yes, but as its own property, room.chaos = high. Rules can then produce it ("disorder raises chaos") or read it. It doesn't need to break down into individual cup positions. This also fits principle 1: chaos is just another property.

{I think chaos itself is nothing special (though it most certainly is) from a property standpoint; any property gets meaning for what it affects based off of examples and relative relationships. I think saying the room was in chaos does add a property to the room of chaos being high, but what that means, how it affects the individual cup positions, is important and can be defined at some point. Saying other similar things, like the room was in shambles, is the same thing; though, now that I'm thinking about it, would saying the room was in shambles add a shambles property that was high? That feels weird, because does it live in a void, what does that property affect? How does that natural language implicit understanding affect the transforms and positions of things in the room itself? Does it come from a property, or what? Does that require a companion to try and work out what a room looks like when it is in shambles?}

[Claude: "Does it live in a void?" is the right worry. In this design, a property means something only through the rules that read or write it. If shambles = high has no rules touching it, it's just a label. It's stored and it can be checked, but it doesn't move a single cup.

There are two ways an abstract word can connect to concrete things:
- Bottom-up: a rule works out chaos from how scattered things are. Then "the room was in chaos" gets checked against where the cups actually are. Good when the details already exist.
- Top-down: something expands "shambles" into concrete keys: cups on the floor, a chair tipped over. The cup positions were unspecified before, so these are just fill-ins and need no cause. If the room was tidy before, the mess needs a cause, the same as any change.

On your last question: yes, I think top-down expansion is a companion's job, not the engine's. The engine can't know what "shambles" looks like. A companion proposes the concrete keys, and each one records that it came from the "shambles" key. "Shambles" and "chaos" being the same thing is also language understanding, which belongs to extraction. The engine only needs one rule: an abstract property connects to the world through rules or through expansion. Otherwise it's an inert label, and you can ask the engine which properties are inert.]

{Kaelen: I think that seems pretty important then, companion to world state intervention/interaction. How to affect changes/keys in the world state from top down understanding of states. That sounds pretty important and like something we should define more concretely.}

[Claude: Agreed. This is the main point where companions meet the world, so it's worth pinning down. Here's a first concrete sketch. Call it expansion.

What expansion is: a companion reads an abstract key ("the room was in shambles") and writes concrete keys that make it real: the chair is tipped over, the cups are on the floor, a drawer hangs open. That's all. No new machinery in the engine, just keys from an author.

The rules it follows. These are mostly things the core already says:
1. Expanded keys are ordinary keys. The companion is an author, the same as you typing them.
2. Each one records where it came from: `derived_from: <the shambles key>`, plus which companion wrote it. That link is the only new thing.
3. Same causality as everyone else. Where a value was unspecified (nobody said where the chair was), the expansion just fills it in. Where a value was known (the chair was upright a minute ago), the companion has to add a cause too ("they fought"), or the change shows up as unexplained. Expansion gets no special pass.
4. Replay never calls the companion again. Companions are AI, so they aren't deterministic, but that doesn't matter: what they wrote is stored as keys (inputs), and replay just reads those keys. This is exactly why log 0002 stores inputs.
5. Looking must not expand. If zooming into the room made a companion invent the mess, then looking would change the world, which §8.1 forbids. So there are three steps, matching the tiers we already have:
   - Impression (appearance). A renderer may draw a generically messy room just from shambles = high. It's never real, and nothing can collide with it.
   - Proposed. A companion suggests concrete keys. They show as ghosts, not yet part of the simulation.
   - Accepted. They become real keys and the simulation uses them.

Three decisions only you can make:
- (a) If you delete "shambles", what happens to the keys derived from it? Delete them too (they only existed because of it), keep them, or ask each time? I'd lean towards asking, since the dependency query can list them.
- (b) Who starts an expansion: automatically whenever an abstract key appears, or only when someone asks? This touches the deferred gap-filling policy, so "on request" is the safe default for now.
- (c) Proposed vs accepted is the same idea as the `status` from the parked authorship log. Expansion might be the reason to bring that part back. Want to?]

{Kaelen: I think we would be fine to delete the shambles keys, as long as they're stored in cache and could be easily recreated if we made a mistake deleting. Yet, we don't need to store in persistent memory, just in temporary cache. I think having a default to on request is fine, as long as we could change it. I would love to be able to add details, and have a companion narrator fill in some gaps I wasn't thinking of.}

[Claude: Two of the three are settled. One needs a quick check against the spec.

(b) Settled. Expansion happens on request by default, and you can change that. The setting lives with the companion or your preferences, never in the engine, so the engine stays neutral (principle 4). Your wish to "add details and have a companion narrator fill in some gaps I wasn't thinking of" is exactly the kind of setting that would sit there: for example, "after I write, offer expansions for the abstract keys I just added".

(a) Mostly settled, but there's a catch. Deleting "shambles" deletes its derived keys too. The catch is that the spec currently says keys are never erased: every edit, deletions included, goes into the branching `.tree` history (§6.3). So deleted keys are already kept for good, as an earlier version of the story you can go back to. "Temporary cache only" would make derived keys the one exception. Two ways to go:
- Keep the rule as it is. Deleted derived keys go into history like everything else. They're tiny (just text and IDs), so it costs almost nothing, and you can always get them back, not just until the cache clears.
- Make an exception: companion-derived keys that you delete are dropped from history and kept only in a temporary undo cache. That keeps the history to things you actually chose, but it means a recovered mistake has a time limit.
I'd keep the rule as it is. One rule for every key is easier to trust, and history can hide deleted derived keys by default so they don't clutter it. Which do you prefer?

(c) Still open from before. Companions proposing expansions that you then accept or skip needs the proposed/accepted status from the parked authorship log. Bring just that part back?]

{Kaelen: This I suppose is a larger Tapestry question, but I've been thinking about this, I'm not sure if we want to have a global rule where nothing can be truly deleted. Deletion is a normal part of our human memory, why shouldn't it be part of Tapestry? Obviously, we've gone over deletion vs pruning, but I think that deleting finally, removing it from the file entirely, should be a possible thing. Regenerating the simulation after that seems normal. Let's talk about this though, because it leads into that memory concept. We can't remember everything, we should be able to choose what we remember, and delete things that we didn't want to write and have stored forever. That would be terrifying; a great part about writing software is you could write gibberish, and then delete it, and not have anyone know it was there. Though, in google docs, there are histories that are shown if you don't delete a thing fast enough, and I'm not sure if you could delete those points. It's a similar thing to github, I guess. Maybe we only delete things that we don't save? And then we remember things that we saved, but we should be able to remove things I think is the moreal of the story.}

[Claude: I agree. "Nothing can ever be deleted" is too strong, and you're right that it would be frightening for a writing tool. Here's a version that keeps what the rule was for (replay, undo, being able to trust the history) without making the history permanent.

Two levels, like you suggested:
- Unsaved work is free. Typing, trying things, writing gibberish, deleting it: none of that is history. It's a scratchpad, and it vanishes when you throw it away. No one ever sees it.
- Saving records it. A save is like a commit in git: a point in the history you can go back to, branch from, and compare. Kept by default.
- Saved things can still be removed for good. A purge deletes chosen keys from the file entirely, from every version, as if they were never written. This is like rewriting history in git, which Google Docs doesn't let you do.

Purging is cheap and safe for us because the history stores only inputs (log 0002). Remove the keys, replay, and the world regenerates as if they'd never been written. No outputs are left lying around holding traces.

Two honest edges:
- If other keys depend on what you purge (an answer to it, keys derived from it), the dependency query lists them first. You choose to purge those too, or keep them, in which case they become unexplained or unplaced again.
- Once a file has been shared, other people may still have copies. A purge cleans your file; it can't reach into theirs. Tapestry should say so plainly at the moment of sharing.

One distinction worth keeping, because it leads into your memory idea: this is the author forgetting, which happens outside the story. A character forgetting is different. Mara's memory fading is a rule inside the world, and the world still knows what really happened. Both are real, and they're different mechanisms.

So the rule becomes: the history is yours. It's kept by default, but you can remove things from it on purpose. Does that match what you meant?]

{Kaelen: }
