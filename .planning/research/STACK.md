# Stack Research

**Domain:** Obsidian-compatible spatial research canvas, added to the existing Rust/egui app `apps/canvas` (milestone scope: vault model, shell, graph editing, silent research, proposals, knowledge tree)
**Researched:** 2026-10-22
**Confidence:** HIGH for crate choices and API facts (each was compiled or called live in a scratch crate and via curl on 2026-10-22). MEDIUM for DuckDuckGo (works today from ureq, but it is an undocumented scrape target). The `classify-confidence` seam rates the `webfetch` provider LOW even when cross-checked, so findings below are tagged by my own verification (official doc plus live probe), not by that default.

Existing stack is kept as is: eframe/egui 0.36.2 (wgpu), glam 0.34.1, ureq 3, serde/serde_json, model2vec-rs, portable-pty/vt100, tungstenite. Nothing here re-researches it.

## Recommended Stack

### Core Technologies (new dependencies to add to `apps/canvas/Cargo.toml`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `yaml_serde` | 0.10.7 | READ frontmatter into an order-preserving `Value` | Official fork of the deprecated `serde_yaml`, published by The YAML Organization (repo `yaml/yaml-serde`, updated 2026-08). Drop-in API. I verified `Value` keeps key order and parses nested maps and lists. Used only for reading; writing is a text splice (see Patterns). |
| `nucleo-matcher` | 0.3.1 | Fuzzy match for Cmd-K palette, explorer filter, quick-open | The matcher core of Helix's `nucleo`: fzf-style scoring, smart-case, multi-word patterns, no threads or background workers. Verified: `Pattern::parse("frc dir", Smart, Smart).match_list(items, &mut matcher)` ranked "Directory forces" and "Force-directed graph drawing" correctly. A palette of a few hundred commands plus a vault of ~10k note titles scores in single-digit ms on one thread. |
| `atom_syndication` | 0.12.10 | Parse arXiv Atom feed | Verified against a live arXiv response: parsed in ~1 ms, exposes `entries[].id/title/summary/published/links/authors`, and keeps the `arxiv:` namespace in `extensions` (primary_category, doi, journal_ref). |
| `scraper` | 0.29.0 | Parse DuckDuckGo HTML results | CSS selectors (`a.result__a`, `a.result__snippet`) survive attribute-order and whitespace changes that break string scanning. Built on html5ever 0.40. Only used on the last-resort fallback, so it is the one heavy-ish dep; keep it behind the DDG provider module. |
| `notify` | 8.2.0 | Watch the vault folder (FSEvents on macOS) | Stable line. `9.0.0-rc.6` exists (2026-10-17) but is a release candidate: do not use. |
| `notify-debouncer-full` | 0.7.0 | Coalesce editor save bursts, rename tracking | Requires `notify ^8.2.0` (checked on crates.io). Verified: a file create produced a debounced event in a scratch crate. Delivers over a `std::sync::mpsc` sender, which fits the background-thread model. |

### Already present, now used for more

| Technology | Version | New role |
|------------|---------|----------|
| `ureq` | 3.4.2 in lock (3.5.0 is current; `cargo update -p ureq` is optional) | All search providers. One shared `ureq::Agent` (cheap `Clone`, shared pool, `Send + Sync`). Config: `timeout_global(15s)`, descriptive `user_agent`, `http_status_as_error(false)` so 202/429/432 can be read and handled instead of becoming errors. |
| `serde` / `serde_json` | 1.0.229 / 1.0.151 | Typed response structs for OpenAlex, Wikipedia, Tavily. Use `#[serde(default)]` everywhere; OpenAlex fields are frequently null. |
| `glam` | 0.34.1 | `Vec2` math for the hand-rolled force layout. |
| `model2vec-rs` / `embed.rs` | 0.3.0 | Query derivation and similarity for proposals. No change. |
| `egui::Panel::left(..).resizable(true)` | egui 0.36.2 | Explorer sidebar. The app already uses `egui::Panel::top`. In 0.36 `Panel` replaced `SidePanel`; it has `.resizable()` and `.show_separator_line()`. |
| `egui::Modal` / `egui::Area` | egui 0.36.2 | Cmd-K palette overlay. Detect with `i.modifiers.command && i.key_pressed(Key::K)`. No crate needed. |
| `egui::Window` (`.movable(true).resizable(true)`) | egui 0.36.2 | Only if "draggable explorer" means a floating, repositionable panel rather than a resizable docked edge. Prefer the docked Panel; add Window mode only if asked. |

### Hand-rolled on purpose (no crate)

| Piece | Why not a crate |
|-------|-----------------|
| Wikilink and `^id` scanner/writer | Obsidian's grammar is not CommonMark. I tested `pulldown-cmark 0.13.5` with `ENABLE_WIKILINKS`: it does parse `[[Note#^a1\|desc]]` into `WikiLink{has_pothole}` with `dest="Note#^a1"` and byte ranges, and it correctly skips code spans and fences. But it splits the alias into several `Text` events (a description with `[brackets]` came back as 5 fragments), breaks on the table-escaped `\|` form (`dest="N#^a1\\"`), does not recognise trailing ` ^id` anchors at all, and gives you nothing for writing. A 60-line scanner that splits on the first `|`, masks fenced and inline code, and returns exact byte spans serves both read and write. Extends the existing parser at `ide.rs:86`. |
| Block-id generation | 6 chars of `[a-z0-9]` from a xorshift seeded by `SystemTime` plus a per-note collision check. Obsidian allows only Latin letters, digits and dashes. Avoid `nanoid` (0.5.0) and `ulid` (3.0.0): new dependency for 5 lines. |
| Force-directed layout | See Patterns. Barnes-Hut repulsion plus springs plus folder-cluster gravity on `glam::Vec2`, about 150 lines, ticked incrementally per frame. |
| OpenAlex abstract reconstruction | `abstract_inverted_index` is `{word: [positions]}`; invert it. About 15 lines. |
| UTC timestamp formatting | Optional: use `time` 0.3.55 (already in Cargo.lock transitively) with `formatting`/`parsing`, or write `created: 2026-10-21T10:11:12` using a small civil-from-days function. Do not add `chrono` or `jiff` for this. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `cargo test -p tapestry-canvas-app` | Round-trip tests for the vault layer | Put frontmatter splice, scanner, and OpenAlex/arXiv/Wikipedia/DDG parsers in modules that take `&str` and return structs, with fixture files. These are the highest-risk parts and need no network or UI to test. Save one real response per provider under `apps/canvas/tests/fixtures/`. |
| `tempfile` (dev-dependency only) | Vault round-trip and watcher tests | Optional; `std::env::temp_dir()` is enough if you want zero new deps. |

## Free Search Endpoints (exact, verified live 2026-10-22)

All requests: send `User-Agent: TapestryCanvas/0.1 (+mailto:kaelen1cook@gmail.com)` style string (name/version plus contact). Wikimedia requires it; the others tolerate it. Always `.query(k, v)` so ureq does the URL encoding (no `urlencoding` crate needed).

| Provider | Request | Limits and cost | Notes |
|----------|---------|-----------------|-------|
| **OpenAlex** | `GET https://api.openalex.org/works?search=<q>&per_page=5&select=id,doi,title,display_name,publication_year,cited_by_count,referenced_works,related_works,abstract_inverted_index,primary_location,authorships` | **Changed from the old "polite pool" model.** Keyless: shared budget of **$0.10/day = 1,000 credits per IP address** (the response `meta.notice` says it is shared with everyone on your network IP). A `search=` call costs **10 credits (about 100 searches/day keyless)**; `filter=` list calls cost **1 credit**; `GET /works/{id}` singletons cost **0**. Free key (`api_key=` query param or `Authorization: Bearer`) gives **$1/day (about 1,000 searches/day)**. Rate: 10 req/s keyless, 30 req/s with key. 429 when the daily budget is gone. Headers on every response: `x-ratelimit-remaining` (credits), `x-ratelimit-reset` (seconds until reset), `x-ratelimit-cost-usd`. | Read `x-ratelimit-remaining` after each call and feed it into the "out of searches" UI instead of guessing. Support optional `OPENALEX_API_KEY` env var the same way as Tavily. `mailto=` is no longer documented; it is harmless but do not rely on it. `abstract_inverted_index` was null for 3 of 5 sample results: always handle absence (fall back to title only). **Citations are cheap:** `referenced_works` (OpenAlex ids) comes back inside the search result at no extra cost; resolve many ids at once with `filter=openalex:W1\|W2\|...` (up to 100 values, 1 credit). Store `openalex: W123` in source-note frontmatter so citation proposals between notes already in the vault cost zero requests. |
| **arXiv** | `GET https://export.arxiv.org/api/query?search_query=all:"<phrase>"&start=0&max_results=5&sortBy=relevance` (https works; the manual's examples use http) | **At most 1 request per 3 seconds, single connection, across all your machines** (official Terms of Use). Max 2000 results per call. The manual asks you to **cache** because results only change when papers are added. | Response is Atom 1.0 with `opensearch:totalResults`. Errors come back as HTTP 200 with a single entry whose summary is the error: check for `totalResults == 0` and an `Error` title. Strip the version suffix from `<id>` (`.../abs/2009.10035v1` becomes `2009.10035`) for dedupe. Link `rel="alternate"` is the abstract page, `rel="related" title="pdf"` is the PDF. Metadata is CC0; link to the abstract page; do not imply arXiv endorsement. Field prefixes: `ti:`, `au:`, `abs:`, `cat:`, `all:`; booleans `AND`/`OR`/`ANDNOT`. |
| **Wikipedia (use the Action API)** | `GET https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=<q>&gsrlimit=5&prop=extracts%7Cinfo&exintro=1&explaintext=1&exlimit=max&inprop=url&redirects=1&maxlag=5` | No hard read limit; Wikimedia asks for **serial requests, gzip, and a descriptive User-Agent that includes contact info (and "bot" for automated agents)**. A generic or missing UA can get HTTP 403. | One request returns title, plain-text intro (`extract`), and `fullurl` for all N results. Verified live. Prefer this over REST `/w/rest.php/v1/search/page`, which returns excerpts wrapped in `<span class="searchmatch">` HTML and needs a second call per page for a summary. Use `https://en.wikipedia.org/api/rest_v1/page/summary/<Title>` only to fetch one known page. Pace at 1 request per second at most; you will never get near any ceiling. |
| **Tavily** (only if `TAVILY_API_KEY` set) | `POST https://api.tavily.com/search`, header `Authorization: Bearer tvly-...`, JSON body `{"query": "...", "search_depth": "basic", "max_results": 5, "include_answer": false}` via `ureq` `.send_json(...)` | Free tier **1,000 credits per month**, no card. `basic` = 1 credit, `advanced` = 2 (always send `basic`; `auto_parameters` can silently upgrade to 2). No documented per-second limit. | Response `results[]` has `title, url, content, score`. Errors: **429** (read `Retry-After`), **432** (key or plan limit exceeded) and **433** (pay-as-you-go limit exceeded). On 432/433 mark Tavily exhausted for the month and fall through to the next provider; surface "out of searches". Set `include_answer: false`: the LLM answer is out of scope (silent research, no chat). |
| **DuckDuckGo HTML** (last resort) | `POST https://html.duckduckgo.com/html/` with form `q=<query>` via `.send_form([("q", q)])` | No published limit; unofficial. | **Fragile, treat as best effort.** Verified today: from `ureq` (any UA, including the plain default) it returned HTTP 200 and 10 results; from `curl` (HTTP/2) on the same machine and IP it returned **HTTP 202 with an anti-bot "anomaly" page and no results**. So block detection is mandatory: status 202, or zero `a.result__a` nodes, means blocked; back off for the rest of the session and stop retrying. Selectors: `div.result` containing `a.result__a` (title and href) and `a.result__snippet`. Hrefs were direct URLs in the live response, but older responses wrap them as `//duckduckgo.com/l/?uddg=<percent-encoded-url>&rut=...`: if the href contains `uddg=`, percent-decode that parameter. Use at most 1 request per 3+ seconds. Pagination uses a POST form with hidden `s`, `vqd` etc.; do not paginate. |

Fallback order (per D-09): OpenAlex + arXiv + Wikipedia run for every trigger (all free). Tavily is added when the key is set and quota remains. DDG runs only when everything else returned nothing or is exhausted.

## Installation

```toml
# apps/canvas/Cargo.toml  (changes)

# REMOVE
# egui_dock = { version = "0.21.1", features = ["serde"] }

# ADD
yaml_serde = "0.10.7"
nucleo-matcher = "0.3.1"
atom_syndication = "0.12.10"
scraper = "0.29.0"
notify = "8.2.0"
notify-debouncer-full = "0.7.0"

# OPTIONAL
# time = { version = "0.3.55", features = ["formatting", "parsing"] }   # only if ISO-8601 `created` is wanted
# ureq: bump with `cargo update -p ureq` (3.4.2 -> 3.5.0); no Cargo.toml edit needed
```

## Answers to the specific questions

1. **YAML frontmatter, preserve unknown keys and order:** read with `yaml_serde` (`Value::Mapping` keeps order), but **write by splicing text, not by re-serialising**. I confirmed that a `Value` round trip drops comments and rewrites list indentation (`  - a` became `- a`), which would churn the user's files and Obsidian diffs on every drag. Splice rules: locate the block between the first line `---` and the next line `---` or `...`; for each key we own (`x`, `y`, `w`, `h`, `created`, and for folder notes the folder position keys), replace that top-level line (`^key:`) in place, otherwise insert before the closing delimiter; every other byte is untouched. Detect and keep the file's line ending (`\n` vs `\r\n`). Write numbers rounded to one decimal so drags do not produce noisy diffs. If the frontmatter fails to parse, show the card at a default position and **never rewrite that file's frontmatter**.
2. **Markdown parsing:** hand-rolled scanner for `[[...]]` and trailing ` ^id`; `pulldown-cmark` 0.13.5 is not needed this milestone (reasons in the table above). If a rendered-markdown preview is wanted later, use `pulldown-cmark` directly; **do not use `egui_commonmark` 0.26.0, it depends on `egui ^0.37` and will not unify with egui 0.36.2.**
3. **Fuzzy matching:** `nucleo-matcher` 0.3.1. Not `nucleo` 0.5.0 (adds `rayon` and a background-thread worker you do not need at this scale). Not `fuzzy-matcher` 0.3.7 (last release 2020). Not `sublime_fuzzy` (2020).
4. **HTTP and JSON off the UI thread:** `std::thread` plus `std::sync::mpsc`, not tokio. `ureq` is blocking, arXiv requires a single connection with 3 s spacing so there is no concurrency to exploit, the repo already runs threads (`term.rs`, `server.rs`), and tokio would add a runtime and dozens of crates for nothing. Detail in Patterns. `reqwest` 0.13.5 is not needed either (the project constraint is to use ureq).
5. **HTML for DuckDuckGo:** `scraper` 0.29.0.
6. **Atom for arXiv:** `atom_syndication` 0.12.10. `feed-rs` 3.0.0 also works but parsed the same feed in 8 ms vs 1 ms (single cold run, indicative only) and is a heavier generic RSS/Atom/JSON-feed multi-parser; raw `quick-xml` 0.42.0 would mean hand-writing the Atom and namespace handling.
7. **File watching:** `notify` 8.2.0 plus `notify-debouncer-full` 0.7.0.
8. **Force-directed layout:** hand-rolled on `glam::Vec2`.
9. **Endpoints, limits, etiquette:** see the table above.
10. **egui_dock:** remove it entirely. See below.

## egui_dock: remove, keep nothing

Every use is in `apps/canvas/src/main.rs` (imports at lines 29-30; `default_layout` at 164; `TabViewer` impl at 179; context menu at 221; `DockState<Tab>` fields at 263 and 324; `egui_dock::Style` and `DockArea` at 1604-1624). Nothing in `ide.rs`, `edit.rs`, `swarm.rs`, `tabnote.rs` or `term.rs` references it. Its only jobs (split panes, tab strip, serialized layout) are exactly what D-01 removes, and D-02 replaces them with "open full-window from Cmd-K, Esc returns". Editor tabs and green-select tab notes are the app's own concepts (`tabnote.rs`, `edit.rs`), not egui_dock features, so they are unaffected. Removing it also drops the `serde` feature on that dependency and the saved dock layout, which means a one-time migration: ignore any persisted `DockState` blob on load. Replace `enum Tab` dispatch (main.rs:153, 1689) with a `View` enum (`Canvas`, `Sim`, `Brushes`, `Rules`, `Timeline`, `Files`, `Terminals`, `Swarm`, `Graph`) and a `current: Option<View>` where `None` means the vault canvas.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `yaml_serde` (read) + text splice (write) | `serde-saphyr` 2.0.0 / `saphyr` 0.2.2 | If you hit a hand-edited YAML construct `yaml_serde` rejects. Both are maintained (updated 2026-10) and pure Rust; `saphyr` exposes spans, which could replace the line-based splice with exact byte ranges. Worth a spike only if splice proves brittle. |
| `yaml_serde` | `serde_yaml_ng` 0.10.0 / `serde_norway` 0.9.42 | Only if you need an actively used community fork; both are fine but `yaml_serde` is the official-organisation fork. |
| `yaml_serde` | `gray_matter` 0.3.2 / `markdown-frontmatter` 0.5.1 | Never for write-back: they split and deserialise but do not preserve unknown keys or formatting. |
| `yaml_serde` | `obsidian-parser` 0.9.4 | Ignore: young crate (5.7k downloads), would impose its own note model on top of ours. |
| Hand-rolled wikilink scanner | `pulldown-cmark` 0.13.5 `ENABLE_WIKILINKS` | If you later render markdown bodies; then use it for rendering and still keep the scanner for link write-back. |
| `nucleo-matcher` | `nucleo` 0.5.0 | If the vault grows past ~100k titles and typing latency shows up; it matches on a background pool. |
| `std::thread` + `mpsc` | `tokio` 1.54.1 + `reqwest` 0.13.5 | If the app ever needs dozens of concurrent connections (e.g. crawling full page bodies in parallel). Not this milestone. |
| `std::sync::mpsc` | `crossbeam-channel` 0.5.17 / `flume` 0.12.0 | Only if you need `select!` across several channels or multiple consumers. Not needed for one worker. |
| `notify` 8.2.0 | Polling `mtime` once per second on a background thread | If FSEvents misbehaves on the network drive or you want zero deps. Simpler, a little less live, and you must still skip your own writes. |
| `atom_syndication` | `feed-rs` 3.0.0 | If you later add RSS or JSON-feed sources (blogs). |
| `scraper` | `tl` (zero-dep HTML parser) | If compile time of html5ever bothers you; selectors are weaker. |
| Hand-rolled force layout | `egui_graphs` 0.32.0 | It **does** require `egui ^0.36`, so it is compatible. Still not recommended: it owns the camera, node drawing, interaction and a `petgraph` graph model, which collide with this app's own camera, folder-cluster rendering, pinning and time-replay. Use only as a throwaway prototype. |
| Hand-rolled force layout | `forceatlas2` 0.8.0 (needs `rayon`), `fdg-sim` 0.9.1 (last release 2022) | `forceatlas2` for a one-shot offline layout. `fdg-sim` is abandoned. |
| `egui::Panel::left` | `egui::Window` | If "draggable" is meant literally as a floating panel. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `serde_yaml` 0.9.34 | Marked `+deprecated` on crates.io; unmaintained since 2024-03 | `yaml_serde` 0.10.7 |
| `serde_yml` 0.0.13 | Deprecated and unmaintained; the release is a shim | `yaml_serde` |
| Re-serialising frontmatter with any YAML crate | Drops comments, reflows lists, changes quoting; every drag would rewrite the whole header and show up in Obsidian and git | Line-based splice of the keys we own |
| `notify` 9.0.0-rc.x | Release candidate | `notify` 8.2.0 |
| `egui_commonmark` 0.26.0 | Requires egui 0.37, conflicts with 0.36.2 | `pulldown-cmark` directly if rendering is ever needed |
| `egui_dock` | Removed by D-01 | `egui::Panel` plus a `View` enum |
| `tokio`, `reqwest` | Second HTTP stack and async runtime for one serial worker; contradicts "use the existing ureq" | `ureq` on a worker thread |
| OpenAlex `mailto=` as the identification scheme | Not in current docs; the real access model is per-IP budget plus optional free key | Optional `OPENALEX_API_KEY`, read `x-ratelimit-*` headers |
| Scraping Google or Bing | Terms and blocking; no benefit over DDG as last resort | DDG HTML, best effort |
| Semantic Scholar keyless | Returned HTTP 429 on the first call (shared unauthenticated pool) | OpenAlex `referenced_works` for citations |
| Per-frame file writes or `fs::metadata` calls | Violates the project's "never per frame" constraint and triggers the watcher | Write on drag end; watcher handles the rest |

## Stack Patterns by Variant

**Background research worker (phase 4):**
- One `std::thread` owns a clone of the `ureq::Agent`, a `Receiver<Job>`, and a `Sender<Event>`; every `Event` is followed by `ctx.request_repaint()` (`egui::Context` is `Send`).
- Providers implement a trait like `fn search(&self, q: &Query, agent: &Agent) -> Result<Vec<Hit>, ProviderError>` with `ProviderError::{RateLimited{retry_after}, Exhausted, Blocked, Network, Parse}`. `Exhausted` (Tavily 432/433, OpenAlex remaining credits below 10) turns into the visible "out of searches" state.
- Per-provider minimum spacing enforced by `Instant` bookkeeping in the worker: arXiv 3 s, DDG 3 s, Wikipedia 1 s, OpenAlex 0.2 s, Tavily 1 s. Never run two arXiv requests at once.
- Cancel stale jobs with an `Arc<AtomicU64>` generation counter: the debounce in the UI thread bumps it, the worker drops jobs with an older number before sending.
- Cache every response on disk keyed by `sha256(provider + normalized query)` with a 24 h TTL (arXiv asks for this; it also saves OpenAlex credits). Persist the daily counter and OpenAlex `x-ratelimit-reset` in a small state file so a restart does not forget the cap.
- Default budget guidance: keyless OpenAlex allows about 100 `search=` calls per day per IP, so the user-settable daily cap should default well below that (suggest 30 triggers/day) and count one trigger as one OpenAlex search plus one arXiv plus one Wikipedia call.

**Vault watcher (phase 1/2):**
- `notify_debouncer_full::new_debouncer(Duration::from_millis(300), None, tx)`, watch the vault root `Recursive`, ignore `.obsidian/`, `.git/`, `.trash/`, and non-`.md` files.
- Keep a map `path -> (mtime, content hash)` of the app's own last writes and drop watcher events that match, otherwise every frontmatter write on drag end echoes back as an external edit. On real external edits, reparse that one file and merge into the model; never reload the whole vault.

**Force layout and growth replay (phase 6):**
- State per node: `pos: Vec2, vel: Vec2, pinned: bool, cluster: FolderId`. Forces: Barnes-Hut quadtree repulsion (theta about 0.8), spring along each link (rest length scaled by link count), weak gravity toward the folder centroid for clustering, velocity damping, and a cooling `alpha` as in d3-force. Tick 1 to 3 iterations per frame while `alpha > 0.01`, then idle and stop requesting repaints.
- Replay: sort nodes by `created` and edges by `max(created of endpoints)` (the markdown link text itself carries no timestamp, so edge time must be derived this way or tracked in a sidecar). Scrubbing re-reveals nodes and edges; run the sim continuously and spawn each new node at its linked neighbour's position so layouts evolve smoothly instead of re-solving per scrub step. Note that file birth-time is unreliable after a git checkout, so write `created:` (ISO-8601) into frontmatter when the app creates a note and fall back to file birthtime then mtime for imported notes.

**Block refs (phase 1/3):**
- Writing an anchor: for a paragraph, append ` ^id` to the line; for a list item, append to that bullet; for tables, quotes and callouts, Obsidian requires the id on its own line with blank lines around it. IDs are Latin letters, digits and dashes only. Block links do not resolve outside Obsidian, which is acceptable here (the vault must open cleanly in Obsidian, not elsewhere).
- Obsidian Properties are flat (nested properties are unsupported in its UI) and a property name has one vault-wide type, so keep `x`, `y`, `w`, `h` as flat numeric keys and the folder-position keys in `Folder/Folder.md` flat too.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `egui`/`eframe` 0.36.2 | `egui_graphs` 0.32.0 (needs `egui ^0.36`) | Compatible but not recommended. |
| `egui`/`eframe` 0.36.2 | `egui_commonmark` 0.26.0 (needs `egui ^0.37`) | **Incompatible.** |
| `notify` 8.2.0 | `notify-debouncer-full` 0.7.0 (needs `notify ^8.2.0`) | Matched pair. Do not mix with `notify` 9 RC. |
| `ureq` 3.4.2 (lock) | 3.5.0 | Patch-level bump; same API. All calls used here (`Agent::config_builder`, `.query`, `.send_form`, `.send_json`, `body_mut().read_json`) compiled against 3.5.0 in a scratch crate. |
| `pulldown-cmark` 0.13.5 | `egui_commonmark` 0.26.0 (`^0.13`) | Only relevant if rendering is added later. |
| `yaml_serde` 0.10.7 | `serde` 1.0.229 | No conflict. |

Scratch crates used for verification lived outside the repo (session scratchpad); no repo files were changed other than this document.

## Sources

- crates.io API (versions, update dates, dependency requirements for all crates named above): HIGH, queried 2026-10-22.
- Scratch-crate compile and run tests (2026-10-22): `pulldown-cmark` 0.13.5 wikilink behaviour, `yaml_serde` 0.10.7 round trip, `nucleo-matcher` 0.3.1 ranking, `atom_syndication` and `feed-rs` on a live arXiv response, `scraper` selector on DDG markup, `ureq` 3.5.0 agent config and form POST, `notify-debouncer-full` event delivery: HIGH.
- https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication (page dated 2026-10-15) and live response headers and `meta.notice` from `api.openalex.org` (credits per request type measured: search 10, filter list 1, singleton 0): HIGH.
- https://info.arxiv.org/help/api/tou.html and https://info.arxiv.org/help/api/user-manual.html (1 request/3 s, single connection, caching, Atom schema, query syntax): HIGH; live request to `export.arxiv.org` over https returned 200.
- https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy and https://www.mediawiki.org/wiki/API:Etiquette (UA format, serial requests, gzip, maxlag): HIGH; live Action API and REST calls returned 200.
- https://docs.tavily.com/documentation/api-credits and https://docs.tavily.com/documentation/api-reference/endpoint/search (1,000 free credits/month, request and response schema, 429/432/433): HIGH. Not called live (no key).
- https://docs.rs/ureq/3.5.0/ureq/struct.Agent.html and `.../config/struct.ConfigBuilder.html` (Agent is `Send + Sync` and cheap to clone; config options): HIGH.
- https://obsidian.md/help/links and https://obsidian.md/help/properties (block id characters and placement, alias syntax, flat properties, number and date types): HIGH.
- DuckDuckGo `html.duckduckgo.com/html/` behaviour: MEDIUM. Observed directly (200 from `ureq`, 202 challenge from `curl`), undocumented and subject to change.
- Local sources: `Cargo.toml`, `Cargo.lock`, `~/.cargo/registry/src/*/egui-0.36.2/src/containers/panel.rs` and `window.rs` (Panel and Window APIs), `apps/canvas/src/main.rs` (all egui_dock usage).

---
*Stack research for: Obsidian-compatible spatial research canvas in Rust/egui*
*Researched: 2026-10-22*
