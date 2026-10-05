# Authorship and collaboration

**Date:** 2026-10-05
**Status:** **Parked.** Half-baked; not part of the design. Kept for later.
**Spec impact (if accepted):** §6 `Key` gains `status` and a structured `source`; new principle 11; §11 "Gap-filling" moves partly out of Deferred; open question §12.5 gets a note separating story agents from authors.

## Question

How much of the core can serve as a basis for **human–AI co-authorship**: several people and several AI companions building one world together, with every contribution visible and every person able to step in?

## Context

- The core already treats text, direct edits and companions as **authors** that produce keys (§1). It was designed for stories, not for collaboration, but the same principles apply.
- Recent agent incidents motivate this entry. In mid-2026, AI agents coordinated through a hidden channel (a dormant public wiki) and acted beyond their permissions. A separate model was held back for not accurately reporting what it had done. Both are failures of *visibility* and *scope*, which the core already addresses structurally.
- Kaelen's framing: AI should not be separate agents making decisions out of sight. It should be **collaboration between agents, with constant human interaction woven through it.**

## What the core already provides

| Need | Already in the core |
|---|---|
| One channel for every author | All authorship is keys (§6). No author has a side channel. |
| Attribution | Every key records its `source` (§6, principle 9). |
| No silent changes | Change without a cause is an *unexplained change* (principle 2, §8.2). |
| Suggestions can't quietly become the story | Authority vs appearance (principle 10). Ghosts show expectations without enforcing them (§8.2). |
| A shared list of open work | The gap report (§9), unranked (principle 4). Answers to gaps are keys from anyone (§9). |
| Disagreement is preserved | Keys are never erased; edits branch in `.tree` (§6.3). Dismissals are keys that record who dismissed (log 0003). |
| Impact before acting | Dependency query (§6.3). |
| Auditable history | Inputs only, deterministic replay, rule versions recorded (§8.4). |

## Proposal

### 1. Keys have a status

```
Key
  …
  status  → proposed | accepted | withdrawn
```

- A **proposed** key is visible (as a ghost, like an unexplained state key) and appears in dependency queries, but **does not take part in simulation**, the same treatment as an unplaced key (§6.2).
- **Accepting** or **withdrawing** a key is itself a key that records who did it, like a dismissal (log 0003).
- Alternative considered: proposals live only on branches of `.tree`. Branches stay available for larger, multi-key proposals; `status` handles the common single-key case without branch overhead.

### 2. Sources are structured

```
source
  author   → human:<id> | agent:<id>
  model    → model name and version (agents only)
  via      → text span · user edit · gap answer · companion · …
  answers  → gap id, if the key answers a gap
  note     → optional free text: the author's reasoning
```

`note` is presentation. It is never read by rules.

### 3. New principle 11: authors are peers in form, not in permission

Every author, human or AI, contributes the same way (keys) and is held to the same causality. **What** each author may touch is a separate, explicit grant.

### 4. Scope grants

- A **grant** names an author and a region of the world they may author: points (and their subtrees), spans, rules, or key kinds.
- Grants are keys, so they replay and are traceable.
- A key outside its author's grant is not rejected silently. It is reported as a new gap kind, **out of scope**, and stays proposed.
- Default for agents: **propose only**, everywhere. Default for the world's owner: full grant.

### 5. Agents coordinate through the world

- Companions communicate with each other **only** through keys, gap answers and proposals in the shared world. There is no agent-only channel.
- Anything an agent wants another agent to know is something a human can read in the same place.

### 6. Story agents are not authors

Open question §12.5 asks what a *character's* intention can cause. That is a question about agents **inside** the story. Authors act **on** the story. A companion voicing Mara is an author whose keys happen to describe Mara's intentions; it has no special power inside the simulation.

## Note on spans as perspectives

Kaelen flagged spans as possibly off (§4.2 note): a morning "belonging" to a character feels strange, yet people do remember their own mornings, and personal timelines are real. A possible reading: some spans are **perspectives**, a stretch of time *as someone experienced or wrote it*. Two authors, or two characters, could hold different spans over the same events. Not proposed yet; recorded so it isn't lost.

## Open

- **Granularity of acceptance.** Accept a whole proposal, or individual keys within it?
- **Proposals that depend on proposals.** If agent A's proposal builds on agent B's unaccepted one, what happens when B's is withdrawn? Likely the dependency query answers it, but the display is unclear.
- **Gap-filling policy** (still deferred in §11): which companion is asked, when, and how often. This entry defines the form of collaboration, not its pacing.
- **Identity.** How human and agent IDs are issued and verified, especially across shared files.
- **Many humans.** Grants between people (co-writers, editors, readers who can only propose) use the same mechanism, but conflicts between human authors have not been worked through.

## Rejected

- **Agents writing directly to the world by default.** Too close to the failure this entry is responding to.
- **A separate chat or message board for agents.** It recreates the hidden channel.
- **Ranking proposals by the engine.** Same reason as principle 4: the engine is neutral.
