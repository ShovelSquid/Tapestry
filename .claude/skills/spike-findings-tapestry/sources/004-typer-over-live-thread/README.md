---
spike: 004
idea: thread-rendering
name: typer-over-live-thread
type: standard
validates: "Given the ProseMirror typer over a live 60 fps WebGL thread, when typing fast, composing with an IME, and pasting, then each letter lands on the line within one frame with no input lag or dropped frames"
verdict: VALIDATED
related: [003a, 001, 002b]
tags: [electron, prosemirror, webgl, input, latency]
---

# Spike 004: The Typer Over a Live Thread

## What This Validates
**Given** the app's real editor (ProseMirror, the same packages and versions `app/` uses) as a panel over a live WebGL thread in the repo's Electron on Kaelen's M4 MacBook Air,
**when** someone types fast, composes with an input method, and pastes a large block, over an empty thread and over 8 h of history (62 k letters),
**then** every letter reaches the line within one frame, typing never lags, and no frames drop.

This is the first spike where the editor is real rather than a stand-in: spikes 001–003 fed the thread from a hidden textarea or a synthetic script.

## Research
- **Versions match the app** (`app/package.json`, resolved in the repo's `node_modules`): prosemirror-view 1.42.3, -state 1.4.4, -model 1.25.11, -transform 1.12.1, -keymap 1.2.3, -commands 1.7.2, -history 1.5.0, -schema-basic 1.2.4. The spike installs those exact versions so its numbers transfer.
- **Where letters come from:** `dispatchTransaction` inspects `tr.steps`; every step's slice contributes its text, which is split into graphemes with `Intl.Segmenter` and placed at the current thread time. Deletions are counted but not drawn (this spike is about latency; Phase 2.3 D-03 keeps deleted letters on the line).
- **How latency is measured:** `beforeinput` fires before ProseMirror sees the key and its `timeStamp` shares the `performance.now()` time origin, so one keystroke is measured as **input event → JS handler → transaction → glyph added → painted frame**. The app's own editor debounces *saving* (300 ms, Phase 2 D-02), which is separate: drawing must not wait for it.
- **Real input, not simulated:** scripted runs send key events through the main process (`webContents.sendInputEvent`), so Chromium's own input pipeline is included. Clipboard shortcuts don't work that way, so paste uses `webContents.paste()`.
- **Glyphs** use the browser-SDF path from 003a (~0.5 ms per new glyph). MSDF (003b, ~8 ms) would confound an input-latency measurement; combining them is Phase 2.3 work.

## How to Run
From the repo root (after `cd .planning/spikes && npm install`):
```sh
node_modules/.bin/electron .planning/spikes/004-typer-over-live-thread/main.cjs          # interactive: type, use an IME, paste; Ctrl+L switches empty / 8 h thread
node_modules/.bin/electron .planning/spikes/004-typer-over-live-thread/main.cjs --shots  # one screenshot after scripted typing
node_modules/.bin/electron .planning/spikes/004-typer-over-live-thread/main.cjs --bench  # typing at 20/s, bursts at 40/s, and a 2000-character paste, over empty and 8 h threads
```
The HUD shows live fps and the median and p95 key→painted latency while you type.

## What to Expect
A dark editor panel near the top with the thread running into the distance behind it. Letters you type appear on the line immediately, at the head, and stream away as time passes. The HUD's key→painted median should stay under about 10 ms.

## Investigation Trail
1. **Smoke run:** scripted typing reached the editor, 69 letters landed on the thread over an 8 h history, 60 fps. But the reported latency was a 12.4 ms median against a **685 ms p95** — impossible for input that looked instant on screen.
2. **The pairing was drifting.** `beforeinput` also fires for events that produce no document change, so a first-in-first-out queue of pending events slowly matched each transaction to an older and older keystroke. Pairing each transaction with the **newest** pending event, counting and dropping the rest, fixed it: the corrected runs report **0 unpaired events** and a max latency inside one frame.
3. **The first paste measured nothing:** `sendInputEvent` with a Cmd modifier arrives as a plain key event, so Chromium never pastes. Switched to `webContents.paste()`, which ProseMirror receives as a real paste.
4. **Paste latency isn't end-to-end.** A programmatic paste records no `beforeinput`, so only the transaction's own work is timed (2.6–3.2 ms). A hand paste should be checked in interactive mode.
5. **One dropped frame during paste on a cold atlas** (33.4 ms, 1.1 % of frames): 2000 letters arrive at once, and the glyphs they need are being rasterized for the first time. With the 8 h atlas already warm, the same paste dropped nothing.
6. **New-glyph cost reappears here too:** the worst single rasterize was 26.2 ms over the 8 h load, the same first-use fallback-font cost 003 measured. It never showed up as a dropped frame during typing, because one new glyph per keystroke fits inside the frame budget.

## Results
**Verdict: VALIDATED** for typing, bursts and paste. **Input-method composition still needs a human check** (see the checkpoint below).

Benchmark (`results/bench-2026-09-16T03-34-42-950Z.json`; real Chromium key events; latency is input event → painted frame):

| Thread | Phase | Keystrokes | Letters | key→painted median / p95 / max | Transaction apply median / max | fps | Worst frame | Dropped | Private memory |
|---|---|---|---|---|---|---|---|---|---|
| empty | typing 20/s | 112 | 112 | 8.7 / 15.6 / **16.0 ms** | 0.30 / 17.7 ms | 59.9 | 17.8 ms | 0 % | 75 MB |
| empty | burst 40/s | 141 | 141 | 7.4 / 15.0 / **16.1 ms** | 0.30 / 1.1 ms | 59.9 | 17.7 ms | 0 % | 82 MB |
| empty | paste 2000 | 1 | 2000 | not captured | 2.60 ms | 59.9 | 33.4 ms | 1.1 % | 83 MB |
| 8 h (62 k letters) | typing 20/s | 112 | 112 | 9.1 / 15.8 / **16.9 ms** | 0.30 / 0.8 ms | 59.9 | 17.7 ms | 0 % | 124 MB |
| 8 h | burst 40/s | 142 | 142 | 8.3 / 15.9 / **16.1 ms** | 0.20 / 0.5 ms | 59.9 | 17.7 ms | 0 % | 120 MB |
| 8 h | paste 2000 | 1 | 2000 | not captured | 3.20 ms | 59.9 | 17.7 ms | 0 % | 121 MB |

The browser-to-handler delay was at most 0.1 ms in every phase, so the latency above is display timing (waiting for the next frame), not lost time.

**Signal for the build (Phase 2.3):**
- **The real editor over a live thread is not a performance problem.** Letters land within one frame at twice a fast typist's speed, with 8 h of history on screen, and the editor's own work is about 0.3 ms per keystroke.
- **Draw from transaction steps, not from key events.** It already covers typing, paste, undo and input methods through one path, and it's what keeps drawing independent of the 300 ms save debounce.
- **Don't measure input with a first-in-first-out queue** of `beforeinput` events; pair with the newest, or the numbers drift silently.
- **A large paste is the one place a frame can drop**, and only while its glyphs are new. That is the same first-use cost 003 found, and generating glyphs off the main thread fixes both.
- **Not tested:** input-method composition (below), a hand paste's end-to-end latency, deleted letters drawn on the line (D-03), two authors' strands (D-21), and 120 Hz displays.

### CHECKPOINT: Verification Required

**Spike 004: the typer over a live thread — input methods**
**How to run:** `node_modules/.bin/electron .planning/spikes/004-typer-over-live-thread/main.cjs`
**What to try:** type normally, then switch to an input method that composes (Japanese, Chinese or Korean), type a word, and accept it. Also try the emoji picker and a paste from another app.
**What to expect:** composing shows underlined text in the editor; letters appear on the thread when you accept the word, not while composing. Nothing should feel slower than typing in an ordinary editor.

---

**→ Does this match what you see? Describe anything that lags or lands wrong.**
