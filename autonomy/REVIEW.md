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

### 7. 02.8-01: hands-on check of session notes and New chat (open)

Built by the unattended driver (commits 67ffce6, edb7802; SUMMARY
`.planning/phases/02.8-agent-note-windows/02.8-01-SUMMARY.md`). Tests green
(84 files, 1272 tests); the app was not launched. Run
`npm --prefix app run dev` in ~/Tapestrees/mergin with a scratch workspace:

1. Click **New chat** on a workspace frame. A new note appears in the frame
   (plain fallback look until 02.8-03) and the panel opens titled "New chat",
   subtitle naming `agent.claude-chat-<8 hex>-n<k>`.
2. Send "hi". The reply streams in and stays visible after the turn ends;
   the note's body shows `Turn 1` / `You: hi` / `Claude: …`.
3. Click **New chat** again: a second note with an empty conversation, and
   the Agents panel lists two `claude-chat-…` agents.
4. Judgement call: **Ask Claude…** on a note or file card, and on the canvas
   background menu, now makes a new chat note on every click (the plan routes
   them all through one path). Until 02.8-02 adds placement beside the card
   they land at the next free spot. Say if you want a different behaviour.

Deviations to know about: NUL and broken UTF-16 in chat text become U+FFFD;
tool lines are capped at 1,000 characters (UI-SPEC says never truncated);
`chat:new` and the "earlier messages aren't shown here" notice are removed.
Answer `item 7: approved` or describe issues. Undo: revert 67ffce6 and edb7802.

### 8. 02.8-03: hands-on check of the session card and choices made (open)

Built by the unattended driver (commits 34e32c9, 232d2e1, f1050d3, 5f18a3a;
SUMMARY `.planning/phases/02.8-agent-note-windows/02.8-03-SUMMARY.md`). Tests
green (86 files, 1313 tests); the app was not launched. Run
`npm --prefix app run dev` in ~/Tapestrees/mergin with a scratch workspace:

1. **New chat** on a frame: a 360 x 440 card appears with its composer
   focused and the camera does not move. Send a message: the reply streams
   in and settles with no flicker or duplicate.
2. Backspace/Delete in the card's composer or title never deletes the card.
   The wheel over the transcript scrolls it, not the canvas.
3. Type half a message on a card, then **Enlarge**: the panel shows the same
   draft. Send from the panel and the card updates too.
4. **Back to card** while Claude is answering: the panel closes, the reply
   keeps running on the card. Only **Stop reply** stops it.
5. Right-click in a workspace, **Ask Claude…**: a card at the pointer. Ask
   Claude… on a file: a card with that file's chip.
6. Delete a working chat: "Delete this chat?" appears, Escape keeps it.
   Delete an idle chat: no dialog.
7. At the minimum size (280 x 240) header, two transcript lines and the
   composer stay visible. Closed state and scroll survive a relaunch.
   Scrolling up during a reply shows **Jump to latest**. History shows no
   commit for resize/close/scroll.
8. A title edit on the card is saved as one title change.

Choices made without asking (say if you want any changed):
- Ask Claude… on a note or file puts the chat at the workspace's next free
  spot, not beside the card (UI-SPEC A-10; reversible).
- The card's delete bubble is top-right as the UI-SPEC says, though the ws/ui
  restyle puts note delete top-left; top-left is kept for 02.8-04's "!" badge.
- Resize handles only on right, bottom and bottom-right: left/top would move
  the note, and a resize must never commit.
- Deleting a chat cannot be undone in the window; the conversation remains
  in the tree's history.

Answer `item 8: approved` or describe issues. Undo: revert 5f18a3a, f1050d3,
232d2e1 and 34e32c9 (in that order).

### 9. 02.8-04: set_status and the status reducer, choices made (open)

Built by the unattended driver (commits c44a1c4, f2db616, 9fbca78; SUMMARY
`.planning/phases/02.8-agent-note-windows/02.8-04-SUMMARY.md`). Tests green
(87 files, 1356 tests); the app was not launched. Nothing draws the status
until 02.8-05, so these checks read events and chats.json. Run
`npm --prefix app run dev` in ~/Tapestrees/mergin with a scratch workspace:

1. In a new chat, check Claude calls `set_status` on its own: `lastStatus`
   appears for the session in `<userData>/chat/chats.json`.
2. Ask something that makes Claude ask you a question back; it should call
   `set_status` with `needs: true`.
3. From an agent connected through a terminal (`agent.claude`), call
   `set_status`: it is refused with "set_status is only available to
   Tapestry's in-app chats". The tree gets no commit from set_status.

Choices made without asking (say if you want any changed):
- Needs you clears only on a message you send in that session; Done, Stop,
  errors, later statuses and looking at the card leave it. Level 3 without
  `needs` also raises it.
- `lastStatus` stores the full text, not the shorter card text, so a level-0
  status the card never showed can appear after a relaunch. Quitting mid-turn
  saves "Stopped".
- Chats started before this plan keep their first system prompt, so they
  never learn `set_status`: their line falls back to the latest tool call or
  reply, and they can never raise Needs you.
- Outside the plan's files: the live transcript no longer draws a
  `set_status` row (it would vanish once the turn is saved), in
  `app/src/renderer/state/chat.ts`; `setStatus` refuses a session being
  deleted.

Answer `item 9: approved` or describe issues. Undo: revert 9fbca78, f2db616
and c44a1c4 (in that order).

## Closed
