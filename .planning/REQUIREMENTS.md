# Requirements: Tapestry Canvas — Research App

**Defined:** 2026-10-21
**Core Value:** Write about a subject and watch a connected, spatial map of it build up: notes as cards on an infinite canvas, joined by links you describe, fed by sources the app finds on its own.

Locked decisions D-01..D-11: `.context/canvas-research-brief.md` and PROJECT.md Key Decisions.
Defaults chosen for open questions: `.context/HUMAN-QUESTIONS.md`.

## v1 Requirements

### Vault model (VAULT)

- [ ] **VAULT-01**: User can open any folder as a vault; the app remembers the last one and defaults to `world/vault/` (created if missing)
- [ ] **VAULT-02**: Every `.md` file in the vault is a note; every folder is a graph; `.obsidian/`, `.git/` and the app's hidden folder are ignored; symlinks are not followed
- [ ] **VAULT-03**: A note's card position and size are read from YAML frontmatter `x`, `y`, `w`, `h`; notes without them get a computed placement that is not written until the user moves them (opening a vault never rewrites files)
- [x] **VAULT-04**: Layout writes splice only the app-owned keys (`x`, `y`, `w`, `h`, `created`, `world-x`, `world-y`, `world-scale`) and leave every other byte of the file identical; a file whose frontmatter fails to parse is never rewritten
- [ ] **VAULT-05**: Notes created by the app get a `created:` timestamp in frontmatter, and vault changes (note created, link added/removed, card kept/dismissed) are appended to an event journal in the app's hidden folder
- [ ] **VAULT-06**: All note writes go through one serialized writer (atomic write); the file watcher picks up outside edits (Obsidian, git, editors) and ignores the app's own writes

### Links (LINK)

- [ ] **LINK-01**: The link parser reads `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Note#^id]]` and `[[Folder/Note#^id|description]]`, with byte spans, ignoring code spans/fences and handling the table-escaped `\|`
- [ ] **LINK-02**: The app can give a block (paragraph or list item) a stable `^id` anchor following Obsidian's rules (letters, digits, dashes; own line for tables/quotes/callouts), reusing an existing id if present
- [ ] **LINK-03**: One builder writes described links `[[Note#^id|description]]`; drag-to-connect, `[[` autocomplete and keeping a proposal all use it
- [ ] **LINK-04**: Links resolve across folders by Obsidian's rules (shortest unique path, folder-qualified when ambiguous); a link index maps source note + block → target note (+ block) + description, with backlinks
- [ ] **LINK-05**: Vault files written by the app open cleanly in Obsidian (frontmatter shows as properties, block refs and aliases resolve)

### Shell (SHELL)

- [ ] **SHELL-01**: The main window is one infinite 2D canvas showing the vault; egui_dock is removed
- [ ] **SHELL-02**: An Obsidian-style explorer on the left lists folders (graphs) and notes; it can be resized by its edge, closed and reopened, and dragged off to float
- [ ] **SHELL-03**: Cmd-K opens a fuzzy command palette listing every tool, note, folder and command
- [ ] **SHELL-04**: Every existing tool keeps working and opens full-window from the palette — Simulation (sim canvas + brushes + timeline + swarm), Rules, Files (spatial IDE), Terminals, Notes, editor tabs; highlight notes, tab notes and marks still work over any view
- [ ] **SHELL-05**: Esc returns from a tool to the canvas through one input router with a defined precedence; terminals get an exit chord that is never sent to the PTY; sim keyboard shortcuts only fire while the sim is shown
- [ ] **SHELL-06**: Selecting a note or folder in the explorer or palette flies the camera to it

### Canvas & graph editing (CANV)

- [ ] **CANV-01**: User can pan and zoom the infinite canvas smoothly with text that stays crisp at every zoom level
- [ ] **CANV-02**: User can create a note card by double-clicking empty canvas (creates a `.md` in that folder)
- [ ] **CANV-03**: User can move and resize note cards; the new layout is written to frontmatter on release, never per frame
- [ ] **CANV-04**: User can edit a note's text inside its card
- [ ] **CANV-05**: User can drag a connection from a line in one note to another note (including a note in another folder/graph), then type its description; this writes `[[Note#^id|description]]` on that line
- [ ] **CANV-06**: Connections are drawn as curves from the source line to the target card, with the description shown as a label; user can edit a description and remove a connection (link syntax removed, text kept)
- [ ] **CANV-07**: Each top-level folder occupies its own region of the world, placed deterministically from a stable hash of its vault-relative path; user can move a folder region (stored as `world-x/world-y` in `Folder/Folder.md`)
- [ ] **CANV-08**: Subfolders render inside their parent as smaller graphs in an empty spot; zooming into one fills the screen with it as a full canvas, with no visible float jitter at any nesting depth
- [ ] **CANV-09**: User can undo and redo canvas edits (create, move, resize, connect, edit description, remove)

### Research (RSRCH)

- [ ] **RSRCH-01**: While the user writes, the app derives search queries from the text (keywords + Model2Vec embeddings, no LLM) and searches only when the topic shifts after an idle pause
- [ ] **RSRCH-02**: Search goes through a pluggable provider trait with OpenAlex, arXiv, Wikipedia and DuckDuckGo built in, plus Tavily when `TAVILY_API_KEY` is set; it never costs money and respects each provider's rate limits and User-Agent rules
- [ ] **RSRCH-03**: Results arrive as source note cards (title, URL, abstract/extract, provenance: query, provider, time, prompting note) placed in empty space near the prompting note and drawn linked to it, marked as suggested until kept
- [ ] **RSRCH-04**: Research never edits the note being typed in, never researches its own source cards, and never re-adds a dismissed or already-present source
- [ ] **RSRCH-05**: User can see research status (searching / idle / offline / provider exhausted / out of searches), pause research, and set a daily cap; the cap and counters persist across restarts
- [ ] **RSRCH-06**: Network calls run on background threads with a disk cache; the UI never blocks

### Proposed connections (PROP)

- [ ] **PROP-01**: The app proposes connections between notes from embedding similarity and from citations between source cards
- [ ] **PROP-02**: User can keep a proposal (which asks for a description, then writes the link) or turn it down; nothing is written without a user-typed description
- [ ] **PROP-03**: Turned-down proposals are remembered and not proposed again; proposals are capped so they don't flood the canvas

### Knowledge tree (TREE)

- [ ] **TREE-01**: User can open a whole-vault graph view: notes as nodes, links as edges, folders as clusters, that updates live as the vault changes
- [ ] **TREE-02**: User can scrub a timeline to replay how the vault grew, from the journal and `created:` times (estimated times labeled)
- [ ] **TREE-03**: User can filter the graph (folders, sources, proposals, orphans) and open a local graph around one note; clicking a node flies the canvas to that note

## v2 Requirements

- **V2-01**: Source summaries by a local model (Ollama, already wired in translate.rs)
- **V2-02**: Moving a note between folders with inbound link rewriting
- **V2-03**: Rendered markdown previews in cards (pulldown-cmark)
- **V2-04**: Graph force sliders and color groups
- **V2-05**: Full-text extraction of web sources

## Out of Scope

| Feature | Reason |
|---------|--------|
| Chat replies from a model | Kaelen chose silent research |
| App-written connection descriptions | User writes every description (D-07) |
| Paid search or per-search cost | Search must be free (D-09) |
| Obsidian `.canvas` JSON or custom layout file | Layout lives in note frontmatter (D-04) |
| Semantic Scholar | Keyless access rate-limited immediately in testing |
| Pushing, PRs, merging into main | Work stays on `ws/core` |

## Traceability

Filled by roadmap creation (2026-10-21). Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VAULT-01 | Phase 2 | Pending |
| VAULT-02 | Phase 1 | Pending |
| VAULT-03 | Phase 1 | Pending |
| VAULT-04 | Phase 1 | Complete |
| VAULT-05 | Phase 1 | Pending |
| VAULT-06 | Phase 1 | Pending |
| LINK-01 | Phase 1 | Pending |
| LINK-02 | Phase 1 | Pending |
| LINK-03 | Phase 1 | Pending |
| LINK-04 | Phase 1 | Pending |
| LINK-05 | Phase 1 | Pending |
| SHELL-01 | Phase 2 | Pending |
| SHELL-02 | Phase 2 | Pending |
| SHELL-03 | Phase 2 | Pending |
| SHELL-04 | Phase 2 | Pending |
| SHELL-05 | Phase 2 | Pending |
| SHELL-06 | Phase 2 | Pending |
| CANV-01 | Phase 3 | Pending |
| CANV-02 | Phase 3 | Pending |
| CANV-03 | Phase 3 | Pending |
| CANV-04 | Phase 3 | Pending |
| CANV-05 | Phase 3 | Pending |
| CANV-06 | Phase 3 | Pending |
| CANV-07 | Phase 3 | Pending |
| CANV-08 | Phase 3 | Pending |
| CANV-09 | Phase 3 | Pending |
| RSRCH-01 | Phase 4 | Pending |
| RSRCH-02 | Phase 4 | Pending |
| RSRCH-03 | Phase 4 | Pending |
| RSRCH-04 | Phase 4 | Pending |
| RSRCH-05 | Phase 4 | Pending |
| RSRCH-06 | Phase 4 | Pending |
| PROP-01 | Phase 5 | Pending |
| PROP-02 | Phase 5 | Pending |
| PROP-03 | Phase 5 | Pending |
| TREE-01 | Phase 6 | Pending |
| TREE-02 | Phase 6 | Pending |
| TREE-03 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

Per phase: Phase 1 = 10, Phase 2 = 7, Phase 3 = 9, Phase 4 = 6, Phase 5 = 3, Phase 6 = 3.

---
*Requirements defined: 2026-10-21*
*Last updated: 2026-10-21 after roadmap creation (traceability filled)*
