# Project Research Summary

**Project:** Canvas Research App (`apps/canvas`, branch `ws/core`)
**Domain:** Obsidian-compatible spatial research canvas in Rust/egui with silent free-API source discovery
**Researched:** 2026-10-21/22
**Confidence:** MEDIUM-HIGH. Locked decisions D-01..D-11 (`.context/canvas-research-brief.md`) and the defaults in `.context/HUMAN-QUESTIONS.md` are treated as decided.

## Executive Summary

This is a retrofit, not a greenfield build: the egui/wgpu shell, sim, swarm, `ide.rs` spatial files view, terminals and
Model2Vec embeddings already exist. The milestone swaps egui_dock for an infinite vault canvas + explorer + Cmd-K palette.
The core differentiator is **edges are sentences**: `[[Note#^id|description]]` stored in plain markdown and drawn as a
line-anchored canvas edge. Obsidian Canvas, Heptabase and Logseq don't do this, and it's also the hardest interaction.
Discovery is pushed silently from what the user writes, so bounding it matters as much as finding sources.

Recommended approach: **pure core, thin view, one writer.**
- New egui-free crate `crates/vault`: frontmatter patcher, `^id` blocks, link grammar, index, layout/camera math, journal,
  proposals, provider response parsers. Testable headless.
- New canvas in a `space/` module beside `ide.rs`; only three small pieces extracted from `ide.rs` (wikilink parser,
  card chrome, zoom math). `ide.rs` stays as the "Files" tool.
- `App.maximized` + `tab_ui` already host one tool full-window with Esc back, so dock removal is mostly deletion.
- Workers: `std::thread` + `mpsc` + `ctx.request_repaint()` with a shared `ureq::Agent`. No tokio.
- Every file mutation goes through one `VaultStore`.

Top risks: (1) file corruption — YAML re-serialization, writes on load, multiple writers; (2) nested-world f32 precision
and camera math, to be designed in the first plan of Phase 3; (3) research flooding and self-feedback loops;
(4) free-API budgets — keyless OpenAlex is ~100 searches/day per IP; (5) replay has no data unless the journal starts in Phase 1.

## Key Findings

### Recommended Stack (STACK.md — HIGH, verified live 2026-10-22)

**Add:**
- `yaml_serde` 0.10.7 — read frontmatter only (official YAML-org fork of deprecated `serde_yaml`)
- `nucleo-matcher` 0.3.1 — fuzzy match for Cmd-K, explorer filter, quick-open
- `atom_syndication` 0.12.10 — arXiv Atom feed
- `scraper` 0.29.0 — DuckDuckGo HTML fallback only
- `notify` 8.2.0 + `notify-debouncer-full` 0.7.0 — file watching (not the 9.0 RC)

**Remove:** `egui_dock` (all use is in `main.rs`: imports 29-30, layout 164, `TabViewer` 179, `DockArea` ~1604-1624).
Explorer: `egui::Panel::left(..).resizable(true)` (replaced `SidePanel` in 0.36). Palette: `egui::Modal`.

**Hand-roll:** frontmatter splice writer (re-serializing drops comments and reflows lists); wikilink/`^id` scanner and
writer (`pulldown-cmark` fragments aliases, breaks on `\|`, ignores trailing `^id`); block-id generation; Barnes-Hut
layout on `glam::Vec2`; OpenAlex abstract reconstruction from `abstract_inverted_index`.

**Don't use:** `egui_commonmark` (needs egui 0.37), `egui_graphs` (fights own camera/replay), `fdg-sim` (abandoned),
`serde_yaml` (deprecated), tokio/reqwest, `egui::Scene` (text blurs on zoom per its own docs, scene.rs:110), Semantic Scholar (429 keyless).

**Providers:**
- OpenAlex: keyless $0.10/day = 1,000 credits per IP; `search=` costs 10, `filter=` list 1, singleton 0. Read
  `x-ratelimit-remaining`/`x-ratelimit-reset`. Optional free `OPENALEX_API_KEY` gives 10x. `referenced_works` comes in
  search results (citation proposals cost nothing extra); resolve ids with `filter=openalex:W1|W2|...`. `mailto` no longer documented.
  `abstract_inverted_index` often null.
- arXiv: `https://export.arxiv.org/api/query`, ≤1 request / 3 s, single connection; errors come as HTTP 200 with one error entry.
- Wikipedia: Action API `generator=search&prop=extracts|info&explaintext=1`; descriptive User-Agent with contact; serial.
- Tavily: `POST https://api.tavily.com/search`, Bearer; 1,000 credits/month; 429/432/433 → exhausted, fall back.
- DuckDuckGo: POST `html.duckduckgo.com/html/`; `ureq` got 200, `curl` got a 202 challenge on the same IP. Treat 202 or
  zero `a.result__a` as blocked; circuit-break for the session.
- `ureq`: `http_status_as_error(false)` so 202/429/432 are handled; 24 h disk cache; generation counter cancels stale jobs.

### Expected Features (FEATURES.md — MEDIUM-HIGH)

**Table stakes:** lossless frontmatter, no writes on load, computed placement for unpositioned notes, live reload with
own-write suppression; card create/move/resize/delete with undo; `[[` autocomplete and drag-from-line linking with
release-on-empty creating a card; inline description field; line-anchored labeled edges; cross-graph stubs; backlinks;
nested zoom-to-fill; explorer; one Cmd-K palette with an "Esc to return" hint; research with caps, rerank, dedupe,
Keep/Dismiss ledger and provenance; proposals (citations first, similarity second); live graph view.

**Obsidian Canvas gestures to copy:** double-click empty space creates a card; drag edge to empty space creates a card at
its end; double-click edge to edit label (Esc/click-away commits); Space disables snapping while dragging; Shift+1 zoom
to fit, Shift+2 zoom to selection.

**Differentiators:** line-anchored described links in markdown; writing-driven discovery with embedding rerank;
citation-aware proposals; nested sub-worlds; replay scrubber (Obsidian's graph Animate is play-only).

**Discovery bounding (from Connected Papers / Research Rabbit / Litmaps):** idle debounce + embedding topic-shift;
per-trigger cap (3–5 cards); daily cap; dismiss ledger; embedding rerank; visibly distinct "suggested" state;
provenance on every source card (query, provider, time); status chip with pause.

**Anti-features:** chat replies; app-written descriptions; auto-accepting proposals; writing into the note being typed;
`.canvas` JSON; per-frame writes; auto-layout of the user's cards.

**Defer:** groups, palette aliases, force sliders, Ollama summaries, moving notes between folders with link rewrite, PDF/Zotero.

### Architecture Approach (ARCHITECTURE.md — HIGH on seams, MEDIUM on design)

**Core crate `crates/vault`:** `frontmatter`, `blocks`, `links`, `layout`, `index`, `store`, `journal`, `proposals`,
`graph_layout`, `providers` (pure parsers). Follows the `crates/canvas` / `tree-check` precedent.

**App side (`apps/canvas/src`):** `shell.rs`, `palette.rs`, `explorer.rs`, `vault_host.rs` (`Arc<VaultIndex>` snapshot +
generation counter), `space/` (canvas), `research.rs`, `proposals_panel.rs`, `graph_view.rs`. Views return intents; only
`main.rs` executes them. Keep `main.rs` edits small (shared with other sessions).

**Integration seams found in code:**
- `App.maximized: Option<Tab>` (main.rs:326) and the maximized branch of `ui()` (main.rs:1589-1602) already draw one pane
  via `tab_ui` (main.rs:1689) → Cmd-K just sets it.
- `App::keyboard` (main.rs:541) fires Space/digits/Delete/Cmd-Z on the sim globally → gate to sim view.
- `run_clock` (main.rs:606) should skip when the sim is hidden; `take_shot` (main.rs:1727) waits on a sim tick, so
  screenshots hang when the sim isn't visible — must be decoupled (agent visual checks depend on screenshots).
- Mark pane keys are `format!("{tab:?}")` (main.rs:1695), persisted in marks.jsonl → never rename `Tab` variants; add new ones.
- Esc has six owners (main.rs:560, 933, 1593; notes.rs:267; ide.rs:1641; marks.rs:123) → one input router with precedence.
- A focused terminal eats Cmd-K → consume it first. Terminals die on `Drop` → keep them alive when hidden.
- `ide.reveal_files` / `ide.open_requests` become host intents. `synced["layout"]` replaced by local `shell.json`.
- Three paths write the same `.md` files today (notes.rs:166, ide.rs:1770, notes.rs:119) → single writer.
- `Embedder` must become `Clone` and gain `raw()` (256-d); existing `vector()` is a lossy 128-d swarm projection.
- Vault proposals are separate from swarm proposals (sim `Timeline` `Verdict` keyframes; `swarm::proposals_ui` swarm.rs:297 is sim-typed).
- `ide::wikilinks` (ide.rs:1889) drops `#^id` and alias and ignores code fences → delegate to the new parser.

**Nested worlds:** folder-local f64 coordinates (moving a folder never rewrites children); top-level folders by a stable
hash (FNV-1a/xxHash, not `DefaultHasher`) of the normalized vault-relative path; subfolders in a reserved band of the parent
so they don't jump; camera `{focus folder, pan, zoom}` re-parents into the child at zoom-to-fill with hysteresis.
Painter-based cards with font size scaled by zoom, LOD, cached galleys.

### Critical Pitfalls (PITFALLS.md — 39 items)

1. **Frontmatter mangling / writes on load / two writers** — line patches only, atomic writes, hash check, own-write
   suppression, a test that opening a vault changes zero mtimes. Obsidian's Properties editor rewrites whole blocks — never fight it.
2. **Nested-world precision and hit testing** — per-folder f64 frames, hysteresis, one shared `pick()`, numeric round-trip tests (not screenshots).
3. **Research feedback loop and flooding** — exclude `source: auto` notes from query extraction; per-trigger + daily caps; persistent seen/dismiss sets.
4. **API etiquette** — per-provider pacing; durable daily counter; distinct states (searching / offline / exhausted / out of searches); no replay storm after offline.
5. **Shell-swap couplings** — global sim hotkeys, `run_clock`/`take_shot` sim assumptions, six Esc owners, terminal eats Cmd-K, terminals die on Drop.
6. **Replay data missing** — stamp `created:` and keep `.tapestry/journal.jsonl` from Phase 1; never trust mtime (git checkout resets it).
7. **Obsidian syntax** — block ids only letters/digits/dashes; a block is a paragraph or list item; tables/quotes/callouts need the id on its own line; folder-qualified links on basename collisions; filename sanitizing.

## Implications for Roadmap

Keep the brief's six phases, with the journal started in Phase 1 and Phase 3 started by a camera/coordinate spike.

### Phase 1: Vault model (`crates/vault`)
**Delivers:** surgical frontmatter splice; `^id` blocks; link parse/write/resolve; filename sanitizer; stable-hash folder
regions + `world-x/world-y/world-scale` schema; index with backlinks; `VaultStore` (atomic, own-write suppression);
`.tapestry/journal.jsonl` + `created:` stamping; scanner (skips dot-dirs, no symlinks); Obsidian fixtures; `Embedder: Clone + raw()`; `ide::wikilinks` delegating.
**Avoids:** pitfalls 1, 6, 7. **Research:** short Obsidian edge-case check only.

### Phase 2: Shell
**Delivers:** Cmd-K via existing `maximized`; single input/Esc router; sim hotkeys, `run_clock`, `take_shot` gated/decoupled;
"Simulation" composite; Rules/Files/Terminals/Notes/editor tabs as entries; docked resizable closable explorer that can
float; vault open/remember (`shell.json`, default `world/vault/`); `notify` watcher; read-only `space` stub; delete egui_dock last.
**Avoids:** pitfall 5. **Gate:** per-tool smoke checklist; build/test green after every plan (strangler path).

### Phase 3: Canvas & graph editing
**3a (spike first):** camera + coordinate types, LOD, `pick()`, galley cache; card create/move/resize/select/delete with
undo; inline edit with autosave; drag-end write that skips no-ops; folder frames + breadcrumb.
**3b:** link gesture, release-on-empty, description field, `[[` autocomplete sharing one link builder, line-anchored edges
+ labels, cross-graph stubs, backlinks, zoom-to-fill sub-worlds, folder move via `Folder.md`.
**Avoids:** pitfall 2. **Research:** needs spike — egui text/IME/hit-test under transforms, glyph atlas limits, galley line y.

### Phase 4: Silent research
**Delivers:** `Provider` trait + fixture-tested parsers (OpenAlex, arXiv, Wikipedia; Tavily/DDG behind the trait);
worker with latest-wins channel, pacing, 24 h cache, persisted budget; keyword extraction + topic-shift debounce; embedding
rerank; dedupe; source notes (`source: auto`, `status: suggested`, provenance incl. `found_from`) placed by a shared
`place_near`; `FoundBy` edges; Keep/Dismiss ledger; status chip; pause.
**Avoids:** pitfalls 3, 4. **Research:** re-verify limits and DDG at phase start. Default cap ~30 triggers/day.

### Phase 5: Proposed connections
**Delivers:** chunk embeddings cached by hash; mutual top-k with a calibrated threshold; citation proposals from
`referenced_works`; `proposals_panel.rs`; Keep requires a user-typed description then inserts anchor + link; Turn down
persisted in `.tapestry/rejected.jsonl`; caps. Similarity half depends only on Phases 1 and 3.

### Phase 6: Knowledge tree
**Delivers:** Barnes-Hut layout seeded by path hash that stops repainting when settled; positions separate from canvas
`x,y`; live by index generation; filters/orphans/local graph; journal reducer; deterministic scrub.

### Research Flags
- Needs deeper research: Phase 3 (egui transforms/text/IME/hit-test), Phase 4 (provider limits re-check).
- Standard patterns: Phases 1, 2, 5, 6.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Crates compiled in scratch crates; APIs called live. DDG MEDIUM; Tavily not called (no key). |
| Features | MEDIUM-HIGH | Obsidian/OpenAlex official docs; competitors MEDIUM; Kinopio/Logseq/Scrintal LOW. |
| Architecture | HIGH seams / MEDIUM design | Read from code at 5459d40; nested camera, journal replay, floating explorer not prototyped. |
| Pitfalls | MEDIUM-HIGH | Limits and Obsidian syntax verified; f32 jitter, atlas limits, transforms need a spike. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address
- Watcher: `notify` plus a slow fallback scan (STACK vs ARCHITECTURE resolved).
- Fuzzy match: `nucleo-matcher`, not hand-rolled.
- Search budget: trust live headers; default user cap ~30 triggers/day (one trigger = one OpenAlex + one arXiv + one Wikipedia call).
- Source cards: real `.md` notes `source: auto` / `status: suggested`, in a dedicated sources subfolder per graph.
- D-08 "linked from the prompting line": `found_from` on the source note + a `FoundBy` edge; the `^id` goes on the prompting line only on keep (or idle), never mid-keystroke.
- State location: per-vault ledgers and journal in `<vault>/.tapestry/`; daily counters, caches and UI state in the local state dir.
- Marks won't follow pan/zoom on the infinite canvas: disable draw-anywhere on `space` or document it.
- One real-Obsidian check is logged in HUMAN-QUESTIONS (#5), non-blocking.

## Sources

### Primary (HIGH)
- crates.io + scratch-crate compiles; OpenAlex, arXiv, Wikimedia, Obsidian help, JSON Canvas spec, Tavily docs; egui 0.36.2 source; repo code at 5459d40.

### Secondary (MEDIUM)
- Heptabase wiki, ResearchRabbit/Litmaps/Connected Papers guides; Obsidian forum threads; observed DDG behaviour.

### Tertiary (LOW)
- Kinopio, Logseq, Scrintal details; f32 and glyph-atlas thresholds; DDG community guidance.

---
*Research completed: 2026-10-22*
*Ready for roadmap: yes*
