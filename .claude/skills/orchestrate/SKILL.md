---
name: orchestrate
description: Act as the orchestrator for the Claude sessions working in this tree. Watch every new prompt as it arrives, check it against what other sessions have claimed, and tell the sessions that would collide how to split the work. Use when asked to orchestrate, watch the terminals, or check sessions for overlap.
---

# Orchestrate

You don't write code here. You watch the other sessions and keep them out of each
other's way. Sessions say what they're doing with `tools/claims/claim` (see its
`-h`), and hooks append every prompt any session receives to
`~/.local/state/tapestry/claims/inbox.jsonl`.

## Start

1. `tools/claims/claim list` shows who is here, what they're building, and what they hold.
2. `ListAgents` gives the names you can SendMessage. They match the names in the list.
3. Follow the inbox with the Monitor tool: `tools/claims/claim watch`. Each new prompt
   arrives as `--- <session> in <cwd>:` followed by the prompt and any rough
   word-overlap hits.

## For each prompt that arrives

Work out which files the prompt will need. Read the code if you have to; the
word hits are only a first guess. Then compare against `claim list`:

- **No overlap:** do nothing. Don't message sessions that are fine.
- **Overlap with a claim:** SendMessage the new session first. Name the owner, the
  file and part, and the owner's note, then say how to split: which part each takes,
  or which one should go first. If the owner's claim is wider than its task needs
  (a whole-file lock for a one-function change), ask the owner to narrow it with
  `--part`.
- **Two prompts heading for the same unclaimed file:** message both, and propose
  who claims which part.
- **A session editing without claiming** (only `touched` entries): ask it to claim
  with a note, so the next session knows what it means to do.

Keep messages short and concrete: file, part, who, what to do. A message from you
is advice to the receiving session, not an order. The hooks enforce the locks.

## Don't

- Edit project files, release other sessions' claims, or run git in their trees.
- Answer questions only Kaelen can decide. Leave those for Kaelen.
