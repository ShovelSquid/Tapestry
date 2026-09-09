# Stack Research: Tapestry

**Domain:** Offline spatial knowledge workspace with a minimal replay kernel and public plugin SDK
**Researched:** 2026-09-08
**Confidence:** MEDIUM for the stack recommendation; implementation feasibility remains unproven

## Recommendation

Retain **C++20 for an independently testable state/replay kernel** and prototype **TypeScript/JavaScript plugins with a web UI** before locking the application toolkit. Use an Electron shell with a bundled C++ executable as the first feasibility candidate: it offers a direct C++/TypeScript division without also introducing Rust. This is a scoped UI/SDK experiment, not authorization for a wholesale rewrite. Keep SDL/NanoVG operational as the comparison baseline.

The decisive uncertainty is extensible editing UI, not language speed. Third parties need editable text, panels, tools and custom node presentations without rebuilding the app. A web surface offers existing editor components and familiar extension tooling; a custom native declarative surface would require Tapestry to design and maintain its own widget API. Electron's browser-based renderer and native bridge are documented capabilities; its suitability for Tapestry is an engineering inference. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)

The existing C++20 + embedded-JS proposal remains viable if the native candidate passes the same text and SDK tests with less total complexity. Do not make that decision from a particle benchmark or prototype appearance alone.

## Local Evidence and Selective Reuse

| Evidence inspected | What it establishes | Implication |
|---|---|---|
| `tapestry/CMakeLists.txt` | C++20, CMake minimum 3.24, SDL2 app optional; core target includes Fonts/Grid/Pages/Strokes and links NanoVG | Extract a rendering-independent kernel target before treating it as a reusable engine |
| `tapestry/core/World.hpp` | Page/stroke model, mutable page access, tick counter; documented current `step()` moves only the counter | Useful IDs, geometry and interaction patterns; no evidence of the new generic graph, plugin or replay contract |
| `tapestry/core/Document.hpp` | `.tapestry` baseline plus saved-state deltas, full-precision doubles and readable text fields | Reuse serialization lessons and round-trip fixtures; this is not yet `.tree` commands, branching or plugin-version replay |
| `tapestry/app/main.cpp:649` | SDL text input inserts directly into a mutable string; custom UTF-8 caret/deletion logic | Existing editing works at a basic level, but command recording and mature editing require deliberate adaptation |
| `tapestry/tests/` | Camera, world and document test programs exist | Preserve useful invariants; this research did not run or certify the tests |

These are direct source observations. Compiler floating-point flags and a fixed tick interface are useful controls, not proof of identical results across hardware, compiler versions or future plugins.

## Candidate Comparison

| Path | Editable text and spatial UI | Third-party developer experience | Reuse and cost | Decision |
|---|---|---|---|---|
| C++20 + existing SDL/NanoVG + QuickJS + custom declarative widgets | Reuses spatial renderer; complex text, focus, selection and accessibility still need a mature control or new implementation | JS modules can reload; authors must learn a Tapestry-specific widget language; runtime alone supplies no UI toolkit | Most rendering reuse, but substantial widget/bridge ownership | Retain as baseline; choose only after demonstrating adequate text and extensible widgets |
| C++20 + Qt Quick/QML, restricted JS extension interface | Qt supplies editable text controls and accessibility infrastructure; scene interaction still needs application design | QML/JS can describe UI, but arbitrary QML cannot be treated as isolated untrusted extension code | Keeps C++ kernel; changes rendering/input integration and introduces Qt packaging requirements | Strong native fallback if curated declarative controls satisfy real plugins |
| C++20 executable + Electron web UI + TS/JS SDK | DOM text/editor components with canvas/SVG drawing; browser tooling; test zoomed editing and focus | Familiar JS/TS/CSS, local package loading, source maps; privileged calls go through a small host API | Retains kernel/geometry concepts; redraws UI; ships Chromium/Node and requires protocol/process lifecycle work | **Preferred initial feasibility candidate** |
| C++20 executable + Tauri 2 web UI | Similar web UI opportunity, with different system webviews per OS | TS UI is straightforward; host plumbing includes Rust and Tauri capabilities | Reuses C++ via sidecar; three-language build and platform webview testing | Consider if distribution footprint outweighs extra bridge complexity |
| Rust kernel + Tauri 2 + TS plugins | Same UI tradeoffs as Tauri above | Clear Rust host/TS frontend split; public runtime plugin SDK still must be built | Reimplements C++ state/geometry assets and their tests | No evidence justifies immediate kernel migration |
| TS-heavy Electron app, kernel in separate process | One main application language and browser UI | Simplest language surface; typed boundary can remain narrow | C++ reuse becomes selective porting; numerical/replay discipline remains necessary | Reconsider if the gate finds little valuable C++ reuse or bridge cost dominates |

**Evidence behind the comparison:** Qt offers [TextEdit](https://doc.qt.io/qt-6/qml-qtquick-textedit.html) and [Qt Quick accessibility](https://doc.qt.io/qt-6/accessible-qtquick.html), while its [security model explicitly excludes untrusted QML](https://doc.qt.io/qt-6/shared-security-model.html). QuickJS documents modules and resource limits in its [embedding manual](https://bellard.org/quickjs/quickjs.html). Tauri documents [Rust/webview architecture](https://v2.tauri.app/concept/architecture/), [external binaries](https://v2.tauri.app/develop/sidecar/) and [platform webview versions](https://v2.tauri.app/reference/webview-versions/). The comparative costs above are project-specific inferences, not measured benchmarks.

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

The ProseMirror GitHub repositories report a move to the author's forge, not simple project abandonment. The new forge and main guide could not be retrieved in this run; verify current releases, documentation and provenance before installing. The archived official source still demonstrates the [transaction abstraction](https://github.com/ProseMirror/prosemirror-state/blob/master/src/transaction.ts).

No installation command is prescribed before the gate. Existing core developers can use the repository's CMake workflow; future plugin authors should install a released host and SDK starter, not CMake, SDL or the C++ compiler. Pin host, SDK, editor and build-tool versions in lockfiles once validated together.

## Minimal Core and No-AI Offline Operation

The core owns generic values, IDs, relationships, validated ordered commands, provenance, branches, `.tree` I/O, replay semantics and the minimum host services needed to load extensions and inspect their data. It should not know concepts such as dinner, anger inference, chat, drawing tools or timeline presentation.

Notes, drawing, timeline views, layout/force strategies and AI all ship as plugins using the public contract. A renderer host may provide transforms, pointer routing, generic surfaces and accessible controls; plugin-specific interpretation and interaction remain outside it. A baseline inspector must display unknown plugin records, text descriptions, schemas and relationships without executing their plugin.

**No-AI offline core means:** a packaged app can start, open/save a world, display baseline content, accept manual plugin edits and replay its supported history without accounts, network access, model downloads or API keys. Local bundled assets and first-party non-AI plugins provide the usable default experience. Generic file access is a host service; AI requests are optional permissioned plugin operations.

AI output and external observations become recorded data/commands. Replay never requests a fresh model answer. Rules already expressed in a supported bounded core instruction format can continue executing offline; a history that needs missing custom executable semantics must visibly report that limitation rather than invent compatible behavior.

## Public SDK and Plugin Development Loop

**Proposed contract:** a small manifest with plugin ID, version, host API range, data-schema versions, entrypoints, requested capabilities and readable fallback descriptions. Stable IDs and typed messages form the boundary; native pointers, SDL events and editor-internal objects do not.

| Extension point | Public surface |
|---|---|
| Data and node types | Register schema/version and baseline readable representation; receive immutable snapshots or subscriptions |
| Commands | Submit typed intents; host validates authorization, preconditions and ordering, then records accepted changes |
| UI | Register node views, inspectors, tools and panels; standard controls for simple plugins and an isolated custom web surface for complex editors |
| Behavior | Register bounded declarative rules first; separately version any executable evaluator and its inputs/outputs |
| Lifecycle | Activate/deactivate, dispose subscriptions, report faults, declare migrations and expose diagnostics |

1. Download a prebuilt development host; copy a tiny JS example or scaffold a TS starter with a declared SDK version.
2. Load the local plugin directory through the application and edit its source; compilation/watch tooling produces browser-compatible JS without rebuilding the host.
3. Show source-mapped console errors, manifest errors, capability denials and rejected command details in developer tools.
4. Reload disposes views/subscriptions before activation; incomplete edits remain recoverable. Reload must not silently replace the evaluator used by old history.
5. Run SDK contract fixtures and package manifest + bundled JS/CSS/assets; install that package in a fresh host to prove the loop.

The same starter workflow must build the bundled note plugin and a second independently implemented tool. A scaffold alone is insufficient evidence that the API can support rich editing and custom behavior.

**Isolation is part of the host contract:** keep renderer Node integration disabled, use context isolation and sandboxing, validate IPC senders/payloads and expose narrowly scoped methods. These are documented [Electron controls](https://www.electronjs.org/docs/latest/tutorial/security); the proposed per-plugin origin/surface and broker design still requires a tested threat boundary. Tauri's [capabilities](https://v2.tauri.app/security/capabilities/) constrain its frontend API, but do not automatically implement Tapestry's runtime plugin permissions.

## Replay and Rendering Boundaries

The UI sends semantic edits and receives state updates; selection, hover animation and drawing previews can remain local until they produce a defined observation or command. Batch high-frequency updates and tag snapshots/commands with revisions so stale plugin views cannot overwrite newer state. Do not send every visible node through IPC on every frame.

Render readable note text with a mature text surface; use canvas/SVG for spatial connectors, strokes and inexpensive distant representations. Start with visible-node culling and a small number of active editors. Exact graphics backend and scale thresholds require measurement; adopting a GPU library does not solve text editing or accessibility automatically.

Replay runs against core-understandable recorded commands plus explicitly versioned behavior semantics. Fix command ordering, numeric encoding, time/random inputs and evaluator versions; test replay hashes against known fixtures. C++, Rust, JavaScript, QuickJS and fixed timesteps do not individually guarantee cross-platform equality.

For plugin removal, distinguish replay of recorded outcomes from re-execution of custom behavior. Preserve text/data and inspectable provenance regardless. Preserve compatible behavior code or sufficient recorded outcomes for promised historical states; if neither exists, report unsupported replay. Snapshots alone cannot reconstruct every missing intermediate state.

## Small Feasibility Gate Before Toolkit Commitment

Build one throwaway vertical slice using the preferred web candidate and compare against the retained native baseline. Do not implement all three competing shells.

| Proof | Acceptance evidence | Decision it resolves |
|---|---|---|
| Editable note plugin | IME composition, emoji/grapheme deletion, multiline selection, copy/paste, undo, keyboard focus and mixed-origin text survive save/reload and zoom | Editor suitability and provenance mapping |
| Spatial interaction | Notes remain readable while panning/zooming; drag, pin, connection and drawing preview work at a documented representative load | DOM/canvas composition and input ownership |
| Independent plugin | A fresh example supplies a property tool and custom panel without host edits or native builds; reload cleans up handlers | SDK completeness and development friction |
| Command bridge | Rapid typing and drags stay responsive; pending/rejected edits recover; replayed state matches committed state | IPC granularity and C++ reuse value |
| Offline removal/replay | Disconnect network, remove AI and one renderer plugin, reopen world, inspect fallback data and replay the supported branch | Minimal core and missing-plugin policy |
| Packaged application | Launch with bundled assets and kernel; measure idle memory, startup and package size on the target machine | Whether Electron's distribution cost is acceptable |

Set the load fixture and latency/memory budgets before running the gate; report measurements rather than claiming universal performance. If the web path passes, formalize it. If it fails on text or interaction, test the Qt native fallback. If bridge/reuse economics fail, compare a TS kernel on the same fixtures before considering a language migration.

## Research Limits and Follow-up

Primary documentation was browsed on the research date. `research-plan` selected Context7 for library queries; neither its MCP tools nor `ctx7` CLI were available, so built-in web research was used. `classify-confidence --provider websearch --verified` returned **MEDIUM**, used conservatively for the synthesis. Digests were cached under `/tmp/.planning/research/.cache` to respect this agent's exclusive ownership of this file.

Unresolved: current compatible Electron/editor/tooling release pins; editor source migration verification; per-plugin custom-view isolation; acceptable spatial load; exact text/provenance schema; packaging cost; cross-platform replay promise. Resolve these through the first feasibility phase and focused API/storage design, before broad feature implementation.
