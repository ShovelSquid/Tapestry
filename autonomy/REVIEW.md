# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 6: approved`, or the issues you saw); the next session acts on it.

Items 1-4 (hands-on checks for 02.7-03 to 02.7-06) are still open in
`autonomy/windows/REVIEW.md`. Run them from this worktree
(`npm --prefix app run dev` in ~/Tapestrees/mergin) and answer them here.
New items continue the numbering from 6.

## Open

### 5. 02.7-07 Task 1: approve @anthropic-ai/sdk@0.128.0 and where to install it (open, PARKED)

Carried over from `autonomy/windows/REVIEW.md` item 5, which has the full
check. All of 02.7-07 is parked until you answer; nothing was installed. In
this worktree `node_modules` is a real directory, so "approved-own" installs
here. Answer `item 5: approved-own`, `item 5: approved-shared`, or
`item 5: rejected <reason>`.

### 6. 02.8-01 Task 1: on-disk shape of a session note, took option A (open)

Decision gate (one-way door), resolved unattended with the plan's Recommended
option **A**: a session note is node type `tapestry.chat/session@1` whose
`body` is plain text in a line grammar with `Turn k` headers, plus keys
`chat.turns int <k>` (committed turns), `width 360`, `height 440` and an
ordinary `title`.

This reads D-07 and D-18 in a way you should see. D-07 says each turn is "a
passage"; here a passage became the `Turn k` block of a plain-text body. D-18
(02.8-07, 02.8-09) names "the passage anchor (2.1)"; here that became the turn
number k, not a 2.1 ProseMirror `passage` mark. Reason: the 2.1
anchor-to-edge flow was never wired (02.1 review CR-03), and a ProseMirror
JSON body would be unreadable in `.tree`.

Sample, as a `.tree` file shows it:

    create-node n42 tapestry.chat/session@1
    set n42 body text <<TEXT
    Turn 1
    You: How do I add a test for the parser?
    Tool: read_file src/parser.ts — done
    Claude: Add it next to the feature. Here is the shape:
      describe('parser', () => { … })
    Tool: write_file src/parser.test.ts — refused: src/parser.test.ts: n12 text is locked by agent.claude
    Claude: That file is locked, so I left it alone.

    Turn 2
    Note: Shell access is on for this chat — not sandboxed. …
    You: Now run it
    Error (crashed): Claude Code stopped unexpectedly (exit code 3)
    TEXT
    set n42 chat.turns int 2

Rules: column 0 is structure (`Turn <k>`, `You: `, `Claude: `, `Tool: `,
`Note: `, `Error: `/`Error (<kind>): `, `Stopped`), continuation lines are
indented two spaces, turn blocks are separated by one empty line, and a
content line over 200,000 characters is broken into continuation lines (the
only lossy rule). Full text: 02.8-01-PLAN.md Task 1.

To check: read the sample and, once 02.8-01 is in, chat once in the app
(`npm --prefix app run dev` in ~/Tapestrees/mergin), then look at the
workspace `.tree` in a text editor. Answer `item 6: approved`, or name the
grammar, prefixes or keys you want instead. Undoing it later means adding a
`tapestry.chat/session@2` type read alongside `@1`, not rewriting saved
sessions; before any real sessions exist it is just a code change in
`app/src/shared/chat/transcript.ts`.

## Closed
