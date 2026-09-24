# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 2: approved`, or the issues you saw); the next session acts on it.

## Open

### 1. 02.7-03 Task 3: combined hands-on check for 02.7-02 and 02.7-03 (open, deferred)

Resolved by the session at 2026-09-24 15:15, following PROTOCOL step 4: 02.7-03 continued with
`approved (deferred to human review, see autonomy/REVIEW.md)`. The SUMMARY is 5aa025f, and it marks every
step below as deferred, not passed. Before continuing, 516 tests passed and typecheck was clean.
If you find issues, write them in RESPONSE. The next session fixes them with 02.7 gap-closure plans.
To undo: there's nothing to revert beyond the SUMMARY/STATE docs commit, because the code is b9b0a4a..6a79054.

Phase 02.7, plan 02.7-03, Task 3: the combined hands-on check (checkpoint:human-verify, blocking).
It covers 02.7-02 (the chat panel, Ask Claude…, connect-on-start) and 02.7-03 (folder subspaces).

Tasks 1 and 2 of 02.7-03 are committed (b9b0a4a..6a79054). 28 test files and 516 tests pass, and typecheck is clean.
The app was NOT launched. Your first launch writes the one-time
"arrange workspace windows into folder subspaces" commit (step B1).

Before you start:
- Start Tapestry from a terminal so its PATH finds `claude`:
    npm --prefix app run dev      (in ~/Tapestrees/windows)
- Agents must be on in the Agents panel.
- Windows update from Tapestry's own writes, including the panel's edits. Other outside edits
  appear only after a relaunch until 02.7-06 adds watching.

A. Connect-on-start (D-20)
 1. Quit any running Claude Code.
 2. Start Claude Code in ~/Tapestrees/windows. Before you ask it anything, the Agents panel shows agent.claude as "Connected now".
 3. Leave it idle for more than 2 minutes. It stays connected.
 4. Quit Claude Code. Within about 2 minutes it reads "Last connected …".

B. Folder subspaces (D-21)
 1. The windows workspace frame shows its root files and a column of collapsed folder frames, each with a tree-frame-style header.
    The first open adds one commit by system tapestry, "arrange workspace windows into folder subspaces", to the tree file
    (Tree options > Show tree file in Finder).
 2. Expand app, then src, then main, then mcp. Each opens as a nested frame, its neighbours move aside, and nothing overlaps.
 3. Drag the app/src folder frame. All of its contents move with it.
 4. Collapse app. It shrinks to its header.
 5. Relaunch Tapestry. The collapsed and expanded states and the positions are as you left them.
 6. `git -C ~/Tapestrees/windows status --porcelain` shows no change from any of this.

C. The chat panel (D-12..D-14)
 1. Choose "Chat with Claude" in the workspace frame header.
 2. Send "Read app/src/main/mcp/tools.ts and tell me what it exports." The reply streams in with a "read_file … — done" row.
 3. Send "Using edit_file, add the line `// chat 2.7` as the first line of app/src/main/mcp/tools.ts."
    The tools.ts card shows the line (expand its folders if needed), its footer reads "changed by agent.claude-chat", and `git diff` shows the change.
 4. Send "Run ls in the terminal." Claude says it has no shell. Then send "Read /etc/hosts." It is refused, and the refusal names the workspace.
 5. Ask for a long answer, press Stop while it streams, then send "Continue where you stopped." It picks up with its context.
 6. Relaunch Tapestry and open the chat. It says "Continuing your earlier conversation", and "What line did you add?" gets the right answer.

D. Entry points (D-19)
 1. Right-click the tools.ts card and choose "Ask Claude…". The panel opens with "Attached: app/src/main/mcp/tools.ts",
    and "What does this file do?" gets an answer that reads the file.
 2. Use the chat button on a note in a native world. The chat opens with that note attached, and Claude reads it with read_note.
 3. Right-click empty canvas and choose "Ask Claude…". The chat opens.

E. Clean up:
    git -C ~/Tapestrees/windows checkout -- app/src/main/mcp/tools.ts

Known limits the executor reported (not part of the check):
- Agents cannot `place` workspace files yet, because the default layout lock ties file notes to plugin workspace.watcher. 02.7-05 or the lock plan should decide this.
- An open file window inside a folder can be covered by a sibling folder frame drawn later. Its z-index only applies inside its own folder.

When done, write your answer (`item 1: approved`, or the issues you saw) into `autonomy/RESPONSE`.
