<!-- GSD:project-start source:PROJECT.md -->

## Project

**Tapestry**

Tapestry is a spatial second brain built on a small extensible core, where people create, connect, and arrange readable nodes containing notes, drawings, structured data, people, events, concepts, and executable natural-language rules. Plugins provide the conversational companion, specialized editing tools, integrations, and other features, while the deterministic core owns the world's state and branching history. Human-readable `.tree` files preserve that history so its meaning remains accessible without Tapestry itself.

**Core Value:** Your world of thoughts must remain readable and under your control—in its spatial interface, its editable relationships and behavior, and its files and branching history.

### Constraints

- **Readability:** Core content, relationships, changes, and provenance must be inspectable without the application. Binary attachments may be referenced; their bytes cannot substitute for readable descriptions.
- **Control:** Users can edit content, properties, dates, connections, placement, and guessing policies. Historical origin remains available after correction.
- **History:** Editing the past preserves the original future in a branch. Replay must use recorded outcomes, not new model guesses.
- **Simple core:** Storage, graph state, and rule execution must be conceptually small and separable from live AI and integration adapters.
- **Plugins from the beginning:** Features extend a versioned public API. First-party plugins exercise the same API as third-party plugins; adding a normal feature must not require a core fork.
- **Developer accessibility:** Plugin authors need a short development loop and clear examples, without having to build the native application to try an extension.
- **Usable UI:** The initial milestone includes actual editing, spatial interaction, rule effects, and timeline navigation, not only backend demonstrations.
- **Development scope:** Work remains in the current Conductor workspace. Do not rename its branch or write planning artifacts into the primary checkout.
- **Unspecified:** No delivery date, budget, monetization model, AI provider, final UI toolkit, or universal cross-platform replay guarantee has been chosen.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommendation

## Local Evidence and Selective Reuse

| Evidence inspected | What it establishes | Implication |
|---|---|---|
| `tapestry/CMakeLists.txt` | C++20, CMake minimum 3.24, SDL2 app optional; core target includes Fonts/Grid/Pages/Strokes and links NanoVG | Extract a rendering-independent kernel target before treating it as a reusable engine |
| `tapestry/core/World.hpp` | Page/stroke model, mutable page access, tick counter; documented current `step()` moves only the counter | Useful IDs, geometry and interaction patterns; no evidence of the new generic graph, plugin or replay contract |
| `tapestry/core/Document.hpp` | `.tapestry` baseline plus saved-state deltas, full-precision doubles and readable text fields | Reuse serialization lessons and round-trip fixtures; this is not yet `.tree` commands, branching or plugin-version replay |
| `tapestry/app/main.cpp:649` | SDL text input inserts directly into a mutable string; custom UTF-8 caret/deletion logic | Existing editing works at a basic level, but command recording and mature editing require deliberate adaptation |
| `tapestry/tests/` | Camera, world and document test programs exist | Preserve useful invariants; this research did not run or certify the tests |

## Candidate Comparison

| Path | Editable text and spatial UI | Third-party developer experience | Reuse and cost | Decision |
|---|---|---|---|---|
| C++20 + existing SDL/NanoVG + QuickJS + custom declarative widgets | Reuses spatial renderer; complex text, focus, selection and accessibility still need a mature control or new implementation | JS modules can reload; authors must learn a Tapestry-specific widget language; runtime alone supplies no UI toolkit | Most rendering reuse, but substantial widget/bridge ownership | Retain as baseline; choose only after demonstrating adequate text and extensible widgets |
| C++20 + Qt Quick/QML, restricted JS extension interface | Qt supplies editable text controls and accessibility infrastructure; scene interaction still needs application design | QML/JS can describe UI, but arbitrary QML cannot be treated as isolated untrusted extension code | Keeps C++ kernel; changes rendering/input integration and introduces Qt packaging requirements | Strong native fallback if curated declarative controls satisfy real plugins |
| C++20 executable + Electron web UI + TS/JS SDK | DOM text/editor components with canvas/SVG drawing; browser tooling; test zoomed editing and focus | Familiar JS/TS/CSS, local package loading, source maps; privileged calls go through a small host API | Retains kernel/geometry concepts; redraws UI; ships Chromium/Node and requires protocol/process lifecycle work | **Preferred initial feasibility candidate** |
| C++20 executable + Tauri 2 web UI | Similar web UI opportunity, with different system webviews per OS | TS UI is straightforward; host plumbing includes Rust and Tauri capabilities | Reuses C++ via sidecar; three-language build and platform webview testing | Consider if distribution footprint outweighs extra bridge complexity |
| Rust kernel + Tauri 2 + TS plugins | Same UI tradeoffs as Tauri above | Clear Rust host/TS frontend split; public runtime plugin SDK still must be built | Reimplements C++ state/geometry assets and their tests | No evidence justifies immediate kernel migration |
| TS-heavy Electron app, kernel in separate process | One main application language and browser UI | Simplest language surface; typed boundary can remain narrow | C++ reuse becomes selective porting; numerical/replay discipline remains necessary | Reconsider if the gate finds little valuable C++ reuse or bridge cost dominates |

## Recommended Components and Version Policy

| Component | Version status | Responsibility | Recommendation |
|---|---|---|---|
| C++ | C++20, verified in repository | Generic state, commands, provenance, branch/replay semantics, readable storage and bounded execution primitives | Keep; separate from graphics and feature classes |
| CMake / CTest | Minimum 3.24 in repository | Build native kernel and run headless tests | Keep existing tooling and establish a true no-renderer target |
| Electron | Exact supported release not selected | Minimal desktop shell, packaged local UI, OS integration | Pin only after feasibility and current support review; do not add a web server dependency for packaged operation |
| TypeScript / JavaScript ES modules | Exact compiler release not selected | Public SDK and feature implementation | TS for types/examples; plain JS remains supported; do not expose Electron APIs as the SDK |
| Vite | Exact release not selected | Plugin/UI development bundling and hot reload | Use for web development; run separate type checking because Vite transpiles TS without checking it. [Vite features](https://vite.dev/guide/features) |
| ProseMirror family | Candidate; current release unresolved | Rich-note plugin document/selection/transaction machinery | Evaluate through the text gate; keep editor-specific state out of the core contract. [Official module](https://github.com/ProseMirror/prosemirror-state) |
| QuickJS | Official HTML manual identifies 2026-06-04 | Possible isolated behavior worker runtime if custom JS behavior is required | Defer embedding until the bounded core rule format proves insufficient; not needed merely to render web UI. [Manual](https://bellard.org/quickjs/quickjs.html) |
| `.tree` codec | New versioned format to design | Human-readable authoritative history and baseline data | Define grammar and canonical command encoding before selecting parser libraries; existing `.tapestry` is reference only |
| SQLite / search index | Deferred; no version selected | Optional rebuildable lookup acceleration | Do not make a database the only copy of user meaning or the prerequisite for an initial local world |

## Minimal Core and No-AI Offline Operation

## Public SDK and Plugin Development Loop

| Extension point | Public surface |
|---|---|
| Data and node types | Register schema/version and baseline readable representation; receive immutable snapshots or subscriptions |
| Commands | Submit typed intents; host validates authorization, preconditions and ordering, then records accepted changes |
| UI | Register node views, inspectors, tools and panels; standard controls for simple plugins and an isolated custom web surface for complex editors |
| Behavior | Register bounded declarative rules first; separately version any executable evaluator and its inputs/outputs |
| Lifecycle | Activate/deactivate, dispose subscriptions, report faults, declare migrations and expose diagnostics |

## Replay and Rendering Boundaries

## Small Feasibility Gate Before Toolkit Commitment

| Proof | Acceptance evidence | Decision it resolves |
|---|---|---|
| Editable note plugin | IME composition, emoji/grapheme deletion, multiline selection, copy/paste, undo, keyboard focus and mixed-origin text survive save/reload and zoom | Editor suitability and provenance mapping |
| Spatial interaction | Notes remain readable while panning/zooming; drag, pin, connection and drawing preview work at a documented representative load | DOM/canvas composition and input ownership |
| Independent plugin | A fresh example supplies a property tool and custom panel without host edits or native builds; reload cleans up handlers | SDK completeness and development friction |
| Command bridge | Rapid typing and drags stay responsive; pending/rejected edits recover; replayed state matches committed state | IPC granularity and C++ reuse value |
| Offline removal/replay | Disconnect network, remove AI and one renderer plugin, reopen world, inspect fallback data and replay the supported branch | Minimal core and missing-plugin policy |
| Packaged application | Launch with bundled assets and kernel; measure idle memory, startup and package size on the target machine | Whether Electron's distribution cost is acceptable |

## Research Limits and Follow-up

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
