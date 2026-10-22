# Tapestry Canvas — Research App

## What This Is

The Tapestry canvas app (`apps/canvas`, Rust + egui/eframe + wgpu) turned into a research app for building a mental
model of a subject. It is an Obsidian-like vault of plain markdown notes laid out as spatial graphs on one infinite
2D canvas: you write about a subject, the app silently searches free sources and brings them in as linked note cards,
you connect lines in notes to other notes with your own written descriptions, and a knowledge tree of the whole vault
grows over time. It's for Kaelen, as a personal thinking and research tool.

## Core Value

Write about a subject and watch a connected, spatial map of it build up: notes as cards on an infinite canvas, joined
by links you describe, fed by sources the app finds on its own.

## Requirements

### Validated

<!-- Existing capabilities in apps/canvas as of 2ddd5c8. All must keep working (reachable from the Cmd-K palette). -->

- ✓ Cellular sim canvas with brushes, rules (`world/rules/*.tree`, prose translated by translate.rs), timeline — existing
- ✓ Mimic swarm: mimics that think, link, learn and propose; keep/turn-down proposals; 3D view — existing
- ✓ Notes read by meaning: Model2Vec potion-base-8M embeddings (embed.rs) — existing
- ✓ Spatial IDE: any folder as pan/zoom cards with folder frames, per-folder cameras, `[[wikilinks]]` drawn as curves — existing
- ✓ PTY terminal cards, optionally hosted on tapestry-server — existing
- ✓ Editor tabs, highlight "+" notes, green-select tab notes, marks drawn over any pane — existing

### Active

- [ ] Vault of plain `.md` notes, Obsidian-compatible; a folder is a graph; layout in YAML frontmatter
- [ ] Line-anchored described links `[[Note#^id|description]]`, across folders
- [ ] One infinite 2D canvas with an Obsidian-style explorer sidebar and a Cmd-K palette replacing the dock
- [ ] Create, move, resize and connect note cards; nested folders as scaled sub-worlds you zoom into
- [ ] Silent research from free sources, arriving as linked source cards
- [ ] Proposed connections from citations and embedding similarity, kept or turned down by the user
- [ ] Knowledge tree: live whole-vault graph plus growth replay

### Out of Scope

- Chat replies from a model — Kaelen chose silent research; the app doesn't talk back
- App-written connection descriptions — the user writes every description (D-07)
- Paid search APIs or any per-search cost — search must be free (D-09)
- A custom file format or Obsidian `.canvas` JSON for layout — layout lives in note frontmatter (D-04)
- Source summarization by a local model — possible later via Ollama (already in translate.rs), not in this milestone
- Pushing, PRs, merging into main — work stays on `ws/core`

## Context

- Brownfield Rust workspace. `apps/canvas` (crate `tapestry-canvas-app`, ~8.6k lines) depends on `crates/canvas`
  (`tapestry-canvas`: sim, rules, timeline, mimic/link/mind swarm; depends only on glam).
- Dependencies already present: eframe 0.36.2 (wgpu), egui_dock 0.21, ureq 3 (json), tungstenite, portable-pty + vt100, model2vec-rs.
- Key code: `main.rs` (`enum Tab` main.rs:153, dock layout main.rs:164, dispatch main.rs:1689), `ide.rs` (spatial file
  view, wikilink parse ide.rs:86/1873/1889, curves ide.rs:1025-1045), `notes.rs` (`struct Note` notes.rs:20),
  `swarm.rs` (proposals_ui swarm.rs:297), `embed.rs`, `translate.rs` (Ollama/claude CLI), `server.rs`.
- Example HTTP client pattern with ureq: `apps/dungeon/src/ai.rs`.
- Notes today: `world/notes/*.md` named by timestamp, title = first line, no frontmatter.
- Screenshots: `TAPESTRY_VIEW=yaw,pitch` opens the 3D view turned, used for screenshots.
- Shared worktree (`~/Tapestrees/core`, branch `ws/core`) with other Claude sessions coordinated by `tools/claims/claim`.
- Full brief with locked decisions: `.context/canvas-research-brief.md`.

## Constraints

- **Tech stack**: Rust, egui/eframe 0.36 — keep the existing app; no rewrite in another framework.
- **Cost**: All search sources free; Tavily only when `TAVILY_API_KEY` set; never block on a paid service.
- **Compatibility**: Vault files must open cleanly in Obsidian (frontmatter properties, block refs, wikilinks).
- **Performance**: Network and file IO never block the UI thread; frontmatter written on drag/resize end, never per frame.
- **Autonomy**: Runs unattended. No `blocking-human` gates; visual checks done by the agent and logged to
  `.context/HUMAN-QUESTIONS.md`.
- **Shared tree hygiene**: Commit only own paths with pathspec commits; never `git add -A/./-u`, `git stash`,
  `git reset --hard`, `git clean`; never commit `world/notes/*` you didn't create. `cargo build`/`cargo test` for
  `tapestry-canvas` and `tapestry-canvas-app` must pass after every plan.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| D-01 Remove egui_dock; one infinite canvas + left explorer (drag/resize/close) | Obsidian-like single workspace | — Pending |
| D-02 All existing tools stay, opened full-window from Cmd-K; Esc returns | Keep functionality without windows | — Pending |
| D-03 Vault = folders of plain .md; folder = graph | Obsidian compatibility, no custom format | — Pending |
| D-04 Card x/y/w/h in YAML frontmatter, written on drag end; unknown keys preserved | Kaelen chose md-only over .canvas file | — Pending |
| D-05 Folder regions deterministic from path; subfolders nested at smaller scale, zoom to fill; moved folder position in `Folder/Folder.md` | Infinite world with stable places | — Pending |
| D-06 Block refs `^id`; links `[[Note#^id\|description]]`, cross-folder; plain `[[Note]]` still works | Line-level links that survive edits and render in Obsidian | — Pending |
| D-07 User writes all descriptions; app only proposes | Kaelen's choice | — Pending |
| D-08 Silent research: queries from keywords + embeddings, debounced, daily cap, "out of searches" shown | No chat model; free tier lasts | — Pending |
| D-09 Free pluggable search: OpenAlex, arXiv, Wikipedia, Tavily (if key), DuckDuckGo fallback | Must cost nothing | — Pending |
| D-10 Knowledge tree: live vault graph + growth replay scrubber | "grown over time" | — Pending |
| D-11 Open any folder as vault, remember last; default `world/vault/` | Obsidian-style | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-21 after initialization*
