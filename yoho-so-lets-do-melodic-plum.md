# Tapestry — a native C++ spatial workspace

## Context

Three prototypes exist and none of them is the thing. [`semantic-scroll/`](semantic-scroll/public/app.js) is a working spatial canvas — world coordinates, cursor-pinned zoom, layers, text-range links, event log with replay — but it's a browser app with a single hard-coded transcript and no model. [`semantic-world/`](semantic-world/README.md) is a C++20/SDL2/CMake skeleton with excellent determinism discipline and nothing implemented past Phase 0. [`chrono_magnetic_particles/`](chrono_magnetic_particles/src/main.cpp) has the particle aesthetic but **cannot run on this machine**: it needs OpenGL 4.3 compute shaders and SSBOs, and Apple froze OpenGL at 4.1 ([logged in full](chrono_magnetic_particles/logs/2026-07-30-macos-opengl-blocker.md)).

Tapestry is a new native app. Pages occupy world space at real reading size: some are conversations, some are notes, and some are **files on disk** — editable, syntax-highlighted, and runnable, with build output streaming back into the page. Forking a conversation means dragging a highlighted passage out into the world. Pages stack and are flipped through in a fixed-perspective deck. Creating a page bursts particles from its own perimeter, bright white cooling through blue to dark blue. The cursor in empty space is a soft blue blob with a darker "plus" inside; it presses down on mousedown and releases into a new page.

Decisions made: **new sibling app**, not folded into semantic-world (whose plan defers rendering to Phase 7 and forbids most of this until deterministic replay lands — no reason to reorder it). **SDL2 + OpenGL 3.3 core**, so it runs on this Mac, on Windows/Linux, and as GLES 3.0 on a Pi. **nanovg** for text and 2D. **Node sidecar for the model, strictly optional** — if it isn't running the app starts anyway in local mode and never crashes.

---

## Why nanovg

Code is the *easier* text problem. Monospace means uniform advance, `\n` delimits lines, and there's no wrapping, kerning, or bidi — position from `(col, row)` is multiplication, hit-testing is division, a selection rect is a rectangle. The paragraph engine that Skia's `skparagraph` provides is wanted only by the conversation prose, which is the lighter half and which `nvgTextBox` covers.

Neither library provides an editor: the text buffer, caret, undo, and highlighting are ours either way. So the choice is about drawing — and nanovg draws the page frames, the cursor blob, gradients, and bezier links through the same API, making it close to a native port of the DOM+SVG prototype rather than a rewrite into a different model.

Revisit Skia if pages ever need mixed inline fonts and sizes, RTL/bidi, complex scripts, or PDF-grade export. Until then its GN/ninja build isn't worth fighting. Keep text access behind a thin `ITextRenderer` seam so that stays a possible move rather than a rewrite.

**Two facts accepted going in.** nanovg is stable but effectively unmaintained — small enough to vendor and own, which is how it's normally used. And its real risk is not blurriness but **atlas thrash**: fontstash rasterizes at whatever size is requested, so continuous zoom generates endless fractional sizes until the atlas flushes, which stutters exactly when scrubbing zoom. See the font-size ladder below; that constraint is load-bearing, not a tuning note.

---

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Language / build | C++20, CMake ≥3.24 | Port semantic-world's conventions |
| Window / input | SDL2 | Already probed for Homebrew prefix in semantic-world's CMake |
| Graphics | OpenGL 3.3 core, glad2 | `glad_add_library(glad_gl_core_33 REPRODUCIBLE API gl:core=3.3)` |
| 2D + text | nanovg (`NANOVG_GL3`), vendored | Bundle one licensed prose font + one mono font |
| Syntax | tree-sitter | Small C dep, incremental reparse on edit |
| Math | glm | |
| JSON | nlohmann/json | Single header |
| Subprocess | vendored spawn wrapper | `posix_spawn` / `CreateProcess`, pipes for stdout+stderr |
| Model | optional Node sidecar over `127.0.0.1` | Plain HTTP, no TLS, no libcurl |

**Port from semantic-world's CMakeLists**: determinism flags (`-ffp-contract=off` / `/fp:strict`), Apple Homebrew SDL2 prefix probing, graceful degradation when SDL2 is absent, `--headless` / `--frames N` smoke-test switches. It's the best-engineered file in the repo — port it, don't rewrite it.

**Port from chrono's CMakeLists**: glad2 must be fetched with `SOURCE_SUBDIR cmake` — there is no `CMakeLists.txt` at its repo root, and this already cost a debugging session. glad2 also generates its loader at configure time via Python + Jinja2; both must be present.

---

## Architecture

### Coordinates and camera

Carry the prototype's model over unchanged because it's correct and proven: `screen = world * k + pan`, cursor-pinned zoom (`x = sx - (sx - x) * f`), ported from [app.js:86-101](semantic-scroll/public/app.js:86). Pages store their **center** in world coordinates, matching the existing convention. The camera is view state — it never enters the world hash or affects replay.

### The loop

Extend the fixed-timestep accumulator already in [semantic-world/app/main.cpp:112-119](semantic-world/app/main.cpp:112) at `kTickIntervalMs = 16`. Wall-clock paces the loop; it never enters the world.

```
poll input → drain async queues → step(fixed dt) → relayout dirty pages → render
```

Everything in `step()` is deterministic: seeded PRNG, no float contraction, no wall-clock reads.

### Text rendering — the font-size ladder

The single most important implementation constraint. Never call `nvgFontSize` with a continuously-varying value. Quantize to a fixed ladder of device-pixel sizes:

```
8, 10, 12, 14, 16, 20, 24, 32, 40
```

Pick the nearest rung at or below `logicalSize * zoom`, then absorb the remainder (always ≤ ~1.25×) in the nanovg transform scale. The atlas then holds a bounded working set across the entire zoom range instead of growing without limit. Combined with the LOD tiers below — text stops drawing at all below `k = 0.45` — the live glyph set stays small and stable.

Two text paths, deliberately different:

- **Prose** (conversations, notes): `nvgTextBox` for wrapping, `nvgTextBreakLines` to get line spans for the layout cache, `nvgTextGlyphPositions` for selection and caret placement. Cache the broken-line result keyed by `(text hash, width, font, rung)` — invalidate on text or width change, **never on zoom or pan**.
- **Code**: bypass layout entirely. A monospace advance is measured once per `(font, rung)`; glyph position is `(col * advance, row * lineHeight)`. Draw only the visible line range. Selection rectangles and hit-testing are arithmetic. This path stays fast at very large files precisely because it does no layout work.

### Particles

CPU-simulated, GPU-drawn — not a compromise at this scale. Bursts of a few thousand living under two seconds are trivial arithmetic, and it keeps the app on GL 3.3. Struct-of-arrays, one fixed pool:

```cpp
struct ParticleField {          // SoA — SIMD-friendly, cache-friendly
  std::vector<float> x, y, vx, vy;
  std::vector<float> age, life;   // seconds
  std::vector<uint32_t> seed;
  size_t liveCount;               // live particles packed at the front
};
```

**Emission from page dimensions**: spawn along the page rectangle's *perimeter*, not its center. Walk the border, emit outward along the local normal with angular jitter and speed falloff. Corners get a slight extra kick, which reads as the frame snapping into existence.

**The color ramp** is the whole look, so it's an explicit curve sampled from a 1D LUT texture indexed by `age/life`:

```
t=0.00  (1.00, 1.00, 1.00)  a=1.00   bright white — the flash
t=0.18  (0.72, 0.82, 1.00)  a=0.95   cooling
t=0.45  (0.28, 0.45, 1.00)  a=0.70   blue
t=0.75  (0.08, 0.16, 0.55)  a=0.35   dark blue
t=1.00  (0.02, 0.04, 0.20)  a=0.00   gone
```

Blending eases from additive at the bright end toward normal as the ramp darkens — fully additive makes the dark-blue tail invisible against a dark background, which would erase the part of the effect you actually described.

Drawn in one instanced call outside nanovg: a unit quad, per-instance position/age/seed, soft radial falloff in the fragment shader. nanovg's frame is bracketed around it so particles composite under the page chrome.

**Determinism**: each burst's seed derives from the id of the event that caused it. Replay the log and the particles reproduce frame-for-frame — a property the JS prototype explicitly gave up on.

### Pages

```cpp
enum class PageKind { Chat, Note, File };

struct Page {
  PageId id;
  PageKind kind;
  Vec2 center;               // world coords
  float w, minH;             // frame; drawn height
  float h;                   // = max(minH, contentHeight) — pages elongate, never clip
  LayerId layer;
  StackId stack;             // invalid when free-standing
  DocumentId document;       // conversation, note buffer, or file buffer
  ForkOrigin forkOf;         // { pageId, messageId } or none
  Focus focus;               // pinned quote + source message, or none
};
```

**Elongation**: `minH` is the frame you draw; content flowing past it grows `h` downward. A streaming reply — or streaming build output — extends the page live as data lands.

**Stacks**: drop a page onto another and both take a `StackId`; the top card carries a count badge. Pages never push each other apart — placement is deliberate — but dragging gets Figma-style snap guides (neighbor edges and centers within ~8 screen px).

**The deck browser** (PS3/XMB): opens over one stack, cards front-facing in a *fixed* perspective, receding up and down with a slight Y-rotation. The camera never moves or orbits; only the selection changes, and each card re-derives its slot from its offset to the selection. Cards render the condensed LOD, so a thirty-page deck is thirty cheap quads.

**LOD**: full text at `k ≥ 0.45`; condensed card (title, message/line count, fork lineage, excerpt) from `0.15–0.45`; title chip below. Switch on threshold *crossings* with hysteresis, never per-frame. Plus frustum culling — pages outside the view rect skip layout and draw entirely.

### The cursor

A world-space widget with explicit states, not an OS cursor:

| State | Appearance |
| --- | --- |
| `Idle` (empty space) | Blue blob, slightly darker plus inside |
| `Pressed` | Compresses — scale ~0.88, plus shortens, slight inward ring |
| `Released` | Springs past 1.0 and settles as the page is born |
| `OverPage` | Fades to a thin I-beam or arrow |
| `Connecting` | Trails a feeler curve to the source anchor |

The blob's edge uses the prototype's three-harmonic wobble (`r = R + amp * (sin(9a + 1.1t) * 0.5 + sin(15a - 0.8t) * 0.26 + sin(5a + 0.55t) * 0.3)`, [app.js:306-317](semantic-scroll/public/app.js:306)) — as a nanovg path, which is exactly what that library is for. Press → release → page + burst is the app's signature interaction; it gets built early and tuned by feel.

### Documents, files, and running things

A `File` page is backed by a **piece table** over the file's bytes, with a line index maintained alongside. tree-sitter reparses incrementally on edit and supplies syntax spans; the code draw path colors runs from those spans. Files are opened from a world-relative or absolute path, saved explicitly, and watched for external modification.

**Running a command is a streaming producer, exactly like a model reply.** Both are async sources that append to a document and elongate a page. Build them against one interface:

```cpp
struct StreamSink { void onChunk(std::string_view); void onDone(Status); };
```

A model reply, a `cmake --build`, and a test run all drive the same code. The subprocess wrapper spawns with pipes on stdout and stderr, pumps them on a worker thread, and pushes chunks through the same lock-free queue the sidecar uses — drained at a tick boundary so nothing blocks the render loop. A `Run` page holds a working directory plus a command; its output page elongates as the build proceeds.

This is why the editor lands late in the milestone order but is designed for now: the streaming path, the page model, and the async queue all have to be right *first*, and then the editor is mostly buffer and highlighting work rather than new architecture.

### Model I/O — optional sidecar, graceful local mode

The app **never requires** the sidecar. It's a capability that may or may not be present, like a network connection.

- **Sidecar**: the existing [server.js](semantic-scroll/server.js) grows `POST /api/chat` (SSE from the Anthropic API, key from `ANTHROPIC_API_KEY`) and `GET /api/health`. Its additive port-series logic ([server.js:39-52](semantic-scroll/server.js:39)) stays — the C++ client reads `.port` to find the live instance.
- **Client**: plain HTTP/1.1 over a socket to `127.0.0.1`. Localhost means **no TLS, so no libcurl** — request writing and SSE line parsing, on a worker thread, results crossing into the sim through the same queue as subprocess output.
- **States**: `Unavailable → Probing → Ready`, non-blocking health probe at startup and a re-probe every few seconds. Starting the sidecar after the app is already running lights up the composer mid-session.
- **Local mode is a first-class mode, not an error state.** Pages, particles, editing, file editing, running commands, stacking, forking, saving, and loading all work. Conversations load from and save to local JSON. The composer shows an unobtrusive offline marker and Send is disabled. **A missing, crashed, or mid-request-killed sidecar can never take the app down** — every socket path returns a result type, and a failed request surfaces as a message-level error inside its page.

Sidecar model specifics: `claude-opus-5`, streaming, `max_tokens: 64000`. Thinking is on by default on this model — don't send a `thinking` field, and never send `temperature`/`top_p`/`top_k` (they 400). Put `cache_control: {type:'ephemeral'}` on the system prompt and on the last content block of the most recent turn. Check `stop_reason === 'refusal'` before reading content.

**Forking and prompt caching interact, and it's easy to get silently wrong**: a fork copies the parent's messages up to the cut point and therefore inherits the parent's cached prefix — but only if the copy is byte-identical. Any reformatting on the way through turns every fork into a cold cache write.

### Persistence

`~/.tapestry/worlds/<name>/`, or `--world <path>` for a project-local world.

- `world.json` — pages, stacks, layers, links, camera
- `conversations/<id>.json` — message arrays
- `events.jsonl` — append-only log, same what/when/why/where/who schema the JS version settled on ([history.js:68-91](semantic-scroll/public/history.js:68))
- `snapshots/` — periodic full state for replay scrubbing

File pages store a **path**, not contents — the file on disk is the source of truth.

---

## Build order

Each milestone leaves a runnable binary.

**0 — Skeleton.** New `tapestry/` tree. CMake ported from semantic-world plus glad2 at GL 3.3 with the `SOURCE_SUBDIR cmake` fix. nanovg vendored and drawing. Window, fixed-timestep loop, world-space camera with pan and cursor-pinned zoom, grid that scales with the world.
*Verify: opens on macOS, grid pans and zooms, `--headless --frames 60` exits clean.*

**1 — The signature interaction.** Cursor blob with the plus, press compression, release spring. Release in empty space creates a blank page frame and fires a perimeter burst with the white→blue→dark-blue ramp. No text yet — frames with corner marks.
*Verify: it feels right. Tuned by hand, not by test. Watch frame time with a few thousand live particles.*

**2 — Text and LOD.** The font-size ladder. Prose path via `nvgTextBox` with a layout cache keyed on text and width. Conversations rendered from local JSON. Elongation. LOD tiers with hysteresis, frustum culling.
*Verify: a 200-message conversation renders; scrub zoom 5%→400% continuously and confirm no atlas-thrash stutter; 60+ pages at fit-all zoom stays smooth.*

**3 — Persistence and replay.** World and conversation files, append-only event log, snapshots, burst seeds derived from event ids.
*Verify: create pages, quit, relaunch — identical world. Replay the log from empty and confirm bursts reproduce frame-for-frame.*

**4 — The streaming spine and the sidecar.** `StreamSink`, the worker-thread queue, and the subprocess wrapper. Then `POST /api/chat` with SSE as the first consumer, streaming replies elongating pages live.
*Verify: with the sidecar up, a two-turn conversation streams and `cache_read_input_tokens` is non-zero on turn 2. Then **kill the sidecar mid-stream** — the app keeps running, the page shows an error, and restarting it restores Send with no app restart. Then launch with no sidecar at all and confirm full local-mode operation.*

**5 — Selection, forking, stacks, deck.** Selection via `nvgTextGlyphPositions`; drag a highlighted passage into space to fork; stacks and the fixed-perspective deck browser.
*Verify: fork mid-conversation, ask "what do you mean by that?", confirm the reply reflects inherited context and the call was a cache read. Stack six pages, flip the deck, promote one, reload and confirm order survived.*

**6 — The file harness.** Piece-table buffer, the monospace code draw path, tree-sitter highlighting, open/save/watch. Then `Run` pages: working directory plus command, output streaming into a page through the Milestone 4 spine.
*Verify: open a real source file from one of the existing projects, edit it, save it, and run `cmake --build` from a Run page with output streaming live into the page as it elongates.*

`semantic-scroll/` stays as the design reference and becomes the sidecar. `semantic-world/` and `chrono_magnetic_particles/` are untouched.

---

## Things that will bite

- **Never request a GL context above 3.3 core.** The moment something creeps to 4.3 the app stops launching on this machine, and it fails at window creation with no useful message.
- **glad2 needs Python + Jinja2 at configure time** and has no root `CMakeLists.txt`. Both already cost a session on chrono; the fix is in that log.
- **Continuously-varying font sizes will thrash the atlas.** This is the failure mode most likely to make nanovg look like the wrong choice when it isn't. Ladder from day one.
- **Layout cache invalidation.** Re-laying-out paragraphs on zoom instead of on text/width change will quietly destroy the frame rate and will look like a text-rendering problem rather than a caching one.
- **LOD thrash.** Switching tiers every frame instead of on threshold crossings tanks performance in exactly the situation LOD exists to fix.
- **Silent cache misses.** If `cache_read_input_tokens` stays zero across turns, something is mutating the prompt prefix — a timestamp in the system prompt, non-deterministic JSON key order, or a fork that re-serialized its copied messages. Log the usage block during development.
- **Additive blending eats the tail.** Fully additive particles make the dark-blue end invisible on a dark background.
- **Subprocess pipes deadlock** if stdout and stderr aren't both drained — a build that writes heavily to stderr will hang forever while you wait on stdout. Pump both.
