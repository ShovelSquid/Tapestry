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

### 2. 02.7-04: hands-on check of the Allow shell switch (open, deferred)

Queued by the session at 2026-09-24 15:20. 02.7-04 is autonomous, but its last must-have is a backstop
check that needs the app and the real `claude`, which an unattended session must not run. The code is
2401525 (feat) and 4603701 (test), and the SUMMARY is 8b1cc76. 28 test files and 534 tests pass, and typecheck is clean.
The tool names (Bash, Read, Edit, Write, Glob, Grep) were read from the installed claude 2.1.282 binary, not from a live session.

Start Tapestry from a terminal (`npm --prefix app run dev` in ~/Tapestrees/windows), with Agents on.
 1. Open "Chat with Claude" on the windows workspace. The switch reads "Allow shell (not sandboxed)" and is off.
    Turning it on shows a confirmation; **Keep shell off** leaves it off.
 2. Turn it on and confirm. A red "Shell on — not sandboxed" banner shows.
    Ask Claude to "run `echo checked >> README.md` in the shell". After the turn, the README card shows the line
    and its footer reads "changed by workspace.watcher" (not agent.claude-chat).
 3. Relaunch Tapestry and open the chat. It says shell access was reset to off, and the switch is off.
 4. Clean up: `git -C ~/Tapestrees/windows checkout -- README.md`

If something's wrong, write it in RESPONSE. The next session will fix it with a 02.7 gap-closure plan.
To undo the whole feature, `git revert 4603701 2401525`.
Known limit: 02.7-07's API-key engine won't act on the switch, so that plan has to hide it or define what it does.

### 3. 02.7-05: hands-on check of open_file and the workspace-window guards (open, deferred)

Queued by the session at 2026-09-24 15:32. 02.7-05 is autonomous, with no checkpoint in its plan, but three of its behaviours
are on screen and only the tests have checked them. The unattended session did not launch the app.
The code is ce2a5c2, 1b5d530 and 8add94d, and the SUMMARY is 55c20cc. 32 test files and 652 tests pass, and typecheck is clean.

Start Tapestry from a terminal (`npm --prefix app run dev` in ~/Tapestrees/windows), with Agents on and Claude Code connected.
 1. Ask Claude to "open app/src/main/index.ts with the tapestry open_file tool". The canvas pans to that card and its window opens.
    If its folder was collapsed, it shows open, and history has no new "Expand folder" commit.
 2. Ask Claude to "use list_files on app/src/main/mcp". It lists files with their sizes and notes.
 3. Ask Claude to "use write_file to create scratch/review-3.txt containing hello". The file exists on disk
    (`cat ~/Tapestrees/windows/scratch/review-3.txt`) and a card appears. Then ask it to read /etc/hosts. It refuses.
 4. Select the workspace frame and press Cmd+Z. A notice says undo isn't available in a workspace window, and nothing rewinds.
 5. Double-click empty space inside the workspace frame. No note is created, and the workspace-files notice appears.
 6. Clean up: `rm -r ~/Tapestrees/windows/scratch`

If something's wrong, write it in RESPONSE. The next session will fix it with a 02.7 gap-closure plan.
To undo the whole plan, `git revert 8add94d 1b5d530 ce2a5c2`.
Known limit: agents can now `place` workspace files unless the note has a layout lock, and nothing in the app sets locks yet.

### 4. 02.7-06: hands-on check of live watching, watch status and Retry write (open, deferred)

Queued by the session at 2026-09-24 15:52. 02.7-06 is autonomous and has no checkpoint, but what it does shows up on screen
and only the tests have checked it. The unattended session did not launch the app.
The code is b63d4a9, 339b2c9, a2c5b52 and 10bf222, and the SUMMARY is 90375b4. 38 test files and 681 tests pass,
and typecheck is clean.

Start Tapestry from a terminal (`npm --prefix app run dev` in ~/Tapestrees/windows) and open ~/Tapestrees/windows as a workspace.
 1. **Live edit.** In a terminal, ask Claude Code to change a comment in any file using its own Edit tool, not the Tapestry tools.
    Within about 2 s:
    - the file's card shows the change;
    - its footer reads `changed by workspace.watcher · author unknown` with the eye icon;
    - the second row of the frame header reads "Watching".
    Undo the change afterwards with `git checkout -- <file>`.
 2. **Grouped checkout.** Open a scratch clone as a workspace, for example
    `git clone ~/Tapestrees/windows /tmp/ws-review && git -C /tmp/ws-review checkout -b other HEAD~5`.
    Then run `git -C /tmp/ws-review checkout ws/windows`. History gets one entry, `observed changes: ...`, that lists every changed file.
 3. **Retry write.**
    - In that scratch workspace, run `chmod a-w <folder>` and type in the window of a file inside it.
    - After about 1 s the card shows "Not written to file" in red and a **Retry write** button.
    - Run `chmod u+w <folder>` and choose Retry write. The file on disk now has the typed text.
 4. **Missing folder.** In Finder, rename the scratch workspace folder away.
    - The header says "The folder is missing; nothing is being recorded.", and no cards disappear.
    - Rename it back. Within about 5 s the header says "Watching" again.
 5. **Feel.** Pan and zoom across the whole ~/Tapestrees/windows frame, and type in an open window.
    If it lags, say so: the next step would be loading file text on demand, or caching the tree read (each agent edit costs about 42 ms).
 6. **Clean up.** Run `rm -rf /tmp/ws-review`.

If something's wrong, write it in RESPONSE. The next session will fix it with a 02.7 gap-closure plan.
To undo the whole plan, run `git revert 10bf222 a2c5b52 339b2c9 b63d4a9`.
