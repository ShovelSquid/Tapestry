# Phase 1: Deterministic Core & Readable Format - Pattern Map

**Mapped:** 2026-09-08
**Files analyzed:** 31 (27 new, 2 modified, 2 vendored-dir additions)
**Analogs found:** 19 / 31 (0 exact, 19 role-match or partial, 12 no analog)

No `01-CONTEXT.md` exists; the file list is derived from `01-RESEARCH.md` ("Recommended Project Structure" and "Wave 0 Gaps"). All analog paths below were verified git-tracked with `git ls-files` (no gitignored mirrors). All analog files are small (< 600 lines) and were read in full once.

**How to read this document.** The existing prototype (`tapestry/core`, `tapestry/tests`) is the *only* C++ in the repo, and RESEARCH.md is explicit that it is reference material, not a linking dependency. So most assignments below are "copy the *shape* (namespace, header comment style, anonymous-namespace helpers, `key value` line parsing, ID-counter adoption, scratch-path helper, CMake target wiring) but NOT the behaviour that Phase 1 exists to replace" (`%.17g`, `\n` escaping, `std::ofstream`, refuse-unknown-key, stop-at-first-bad-block). Every such "copy this / do NOT copy that" split is called out inline.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tapestry/CMakeLists.txt` (modify) | config | batch (build) | itself — `tapestry/CMakeLists.txt` lines 17-37, 59-76, 153-168 | exact (same file) |
| `tapestry/.gitignore` (modify) | config | — | itself — `tapestry/.gitignore` | exact (same file) |
| `tapestry/third_party/doctest/*` (vendor) | config / vendored dep | — | `tapestry/third_party/CMakeLists.txt` lines 1-36 (nanovg vendoring) | role-match |
| `tapestry/third_party/picosha2/*` (vendor) | config / vendored dep | — | `tapestry/third_party/CMakeLists.txt` lines 38-50 (stb single-header) | role-match |
| `tapestry/kernel/Ids.hpp` | model (strong ID types) | transform (parse/format) | `tapestry/core/Types.hpp` (value types), `tapestry/core/World.cpp` 120-127 (counter adoption) | role-match |
| `tapestry/kernel/Value.hpp/.cpp` | model + utility | transform (format/parse) | `tapestry/core/Document.cpp` 15-73 (escape/unescape, `valueAfter`) | partial — copy shape only, never `%.17g`/`sscanf` |
| `tapestry/kernel/Time.hpp/.cpp` | model + utility | transform (validate/format) | `tapestry/core/Document.cpp` 46-62 (`kindName`/`kindFromName` enum<->text pair) | partial |
| `tapestry/kernel/World.hpp/.cpp` | model (graph state) | CRUD (in-memory) | `tapestry/core/World.hpp` + `World.cpp` | role-match (generic nodes/edges replace Page/Stroke) |
| `tapestry/kernel/Ops.hpp` | model (command structs) | transform | `tapestry/core/Document.hpp` 38-53 (documented op-line vocabulary) | partial |
| `tapestry/kernel/Record.hpp` | model (record structs) | transform | `tapestry/core/Document.cpp` 75-83 (`Accumulated`), `Document.hpp` 13-19 (`DocumentState`) | partial |
| `tapestry/kernel/tree/Encoder.cpp` | service (codec, pure) | transform (struct -> bytes) | `tapestry/core/Document.cpp` 136-166, 170-246 (`writePage`/`writeBaseline`/`writeDelta` into `std::ostringstream`) | role-match |
| `tapestry/kernel/tree/Decoder.cpp` | service (codec, pure) | transform (bytes -> struct) | `tapestry/core/Document.cpp` 64-73, 250-423 (`valueAfter`, `applyBlock` key dispatch) | role-match |
| `tapestry/kernel/journal/Sink.hpp` | middleware (I/O seam) | file-I/O | none — see No Analog | none |
| `tapestry/kernel/journal/Journal.cpp` | service (durable append / scan / classify) | file-I/O, append-only | `tapestry/core/Document.cpp` 425-456, 472-508 (`readAccumulated`, `saveDocument` probe-then-append) | partial — shape only; replace `ofstream` and stop-at-first-bad-block |
| `tapestry/kernel/Kernel.hpp/.cpp` | controller (single mutation entry) | request-response (submit -> result) | `tapestry/core/Document.cpp` 472-518 (`saveDocument`/`loadDocument` public API shape) | partial |
| `tapestry/kernel_tests/main.cpp` | test (runner) | — | none (doctest macro); see `tapestry/tests/DocumentTest.cpp` 308-322 for what it replaces | none |
| `tapestry/kernel_tests/support.hpp` | test utility | file-I/O | `tapestry/tests/DocumentTest.cpp` 32-44 (`scratchPath`), 128-137 (`fileSize`), 280-303 (raw `fopen` file writes) | role-match |
| `tapestry/kernel_tests/value_test.cpp` | test | transform | `tapestry/tests/DocumentTest.cpp` 46-70 (sample fixtures with edge-case doubles) | role-match |
| `tapestry/kernel_tests/codec_test.cpp` | test | transform | `tapestry/tests/DocumentTest.cpp` 105-126 (`roundTripsExactly`) | role-match |
| `tapestry/kernel_tests/journal_test.cpp` | test | file-I/O | `tapestry/tests/DocumentTest.cpp` 139-171 (append + count), 269-304 (foreign-file refusal, verbatim byte check) | role-match |
| `tapestry/kernel_tests/kernel_test.cpp` | test | request-response | `tapestry/tests/WorldTest.cpp` 40-50 (ids unique/ordered), `DocumentTest.cpp` 120-123 (fresh ids after load) | role-match |
| `tapestry/kernel_tests/readability_test.cpp` | test (golden fixture) | file-I/O | `tapestry/tests/DocumentTest.cpp` 293-302 (assert exact bytes on disk) | partial |
| `tapestry/docs/tree/example.tree` | fixture / data | — | `tapestry/core/Document.hpp` 21-53 (format shown as comment example) | partial (no fixture files exist) |
| `tapestry/docs/tree/FORMAT.md` | docs | — | `tapestry/core/Document.hpp` 21-53 (in-header grammar prose) | partial |

---

## Pattern Assignments

### `tapestry/CMakeLists.txt` (config, build) — MODIFY

**Analog:** itself. Keep the existing structure and add the kernel/test targets; gate the renderer.

**Shared settings target to link** (`tapestry/CMakeLists.txt` lines 28-37) — `tapestry_kernel` MUST link `tapestry_settings` and nothing else from the render stack:
```cmake
add_library(tapestry_settings INTERFACE)
target_compile_features(tapestry_settings INTERFACE cxx_std_20)

if(MSVC)
    target_compile_options(tapestry_settings INTERFACE /W4 /permissive- /fp:strict)
else()
    target_compile_options(tapestry_settings INTERFACE
        -Wall -Wextra -Wpedantic -Wshadow -Wconversion
        -ffp-contract=off)
endif()
```

**Option declaration pattern** (lines 17-18) — add `TAPESTRY_BUILD_RENDER` next to these:
```cmake
option(TAPESTRY_BUILD_APP "Build the SDL2 application" ON)
option(TAPESTRY_BUILD_TESTS "Build the test suite" ON)
```

**Library target pattern** (lines 61-76) — copy the section-banner comment style and `PUBLIC ${PROJECT_SOURCE_DIR}` include root (so kernel headers are included as `"kernel/World.hpp"`, mirroring `"core/World.hpp"`):
```cmake
# ---------------------------------------------------------------------------
# Core library — camera, geometry, the page world, and rendering primitives.
# No windowing, no SDL, no event loop, so it stays testable without a display.
# ---------------------------------------------------------------------------
add_library(tapestry_core STATIC
    core/Camera.cpp
    core/Document.cpp
    core/World.cpp
    render/Fonts.cpp
    render/Grid.cpp
    render/Pages.cpp)
target_sources(tapestry_core PRIVATE render/Strokes.cpp)

target_include_directories(tapestry_core PUBLIC ${PROJECT_SOURCE_DIR})
target_link_libraries(tapestry_core
    PUBLIC tapestry_settings nanovg)
```

**What must move behind `if(TAPESTRY_BUILD_RENDER)`** (lines 51-59 and 65-76): `include(FetchContent)` / `FetchContent_Declare(glad …)` / `glad_add_library(...)`, `add_subdirectory(third_party)` (nanovg + stb — but see the note under third_party below: doctest/picosha2 must remain reachable when render is OFF), `tapestry_core`, the app block (lines 82-147), and the three legacy test targets (lines 156-167).

**Test wiring pattern** (lines 153-168) — legacy style, one executable per test with a plain `add_test`; the kernel tests replace `add_test` with `doctest_discover_tests` but keep `enable_testing()` inside `if(TAPESTRY_BUILD_TESTS)`:
```cmake
if(TAPESTRY_BUILD_TESTS)
    enable_testing()

    add_executable(tapestry_tests tests/CameraTest.cpp)
    target_link_libraries(tapestry_tests PRIVATE tapestry_core)
    ...
    add_test(NAME camera COMMAND tapestry_tests)
    add_test(NAME world COMMAND tapestry_world_tests)
    add_test(NAME document COMMAND tapestry_document_tests)
endif()
```

**Compile-definition-for-asset-dir pattern** (lines 121-122) — reuse verbatim for `TAPESTRY_FIXTURE_DIR`:
```cmake
target_compile_definitions(tapestry PRIVATE
    TAPESTRY_ASSET_DIR="${PROJECT_SOURCE_DIR}/assets")
```

Target skeleton to add is already spelled out in RESEARCH.md "Code Examples > CMake" (verified offline at `/tmp/dtcmake`); the planner should merge that skeleton into this file using the banner/ordering conventions above. Ordering constraint: `tapestry_settings` must be defined before `tapestry_kernel`; `tapestry_kernel` and `doctest` targets must be defined *outside* the `TAPESTRY_BUILD_RENDER` block.

---

### `tapestry/third_party/doctest/*` and `tapestry/third_party/picosha2/*` (vendored deps)

**Analog:** `tapestry/third_party/CMakeLists.txt`

**Vendoring rationale + pin comment pattern** (lines 1-10) — replicate the "pinned to upstream commit/tag, license noted" header for both new dirs:
```cmake
# ---------------------------------------------------------------------------
# nanovg — vendored rather than fetched.
#
# Upstream (https://github.com/memononen/nanovg) has no CMakeLists and is
# effectively unmaintained, so pinning a FetchContent tag would buy nothing over
# copying seven files in. Vendoring also keeps `cmake` working with no network.
#
# Pinned to upstream commit ce3bf745eb2d2dbc14a50bf2446783f691ac4353.
# zlib license — see nanovg/LICENSE.txt.
# ---------------------------------------------------------------------------
```

**Header-only SYSTEM include pattern** (lines 43-50, stb) — the exact shape for picosha2 (research notes 12 `-Wconversion` warnings without `SYSTEM`) and doctest:
```cmake
add_library(stb_image_write STATIC stb/stb_image_write_impl.c)
target_include_directories(stb_image_write SYSTEM PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/stb)

if(MSVC)
    target_compile_options(stb_image_write PRIVATE /w)
else()
    target_compile_options(stb_image_write PRIVATE -w)
endif()
```
For header-only libs use `add_library(doctest INTERFACE)` + `target_include_directories(doctest SYSTEM INTERFACE …)` + `add_library(doctest::doctest ALIAS doctest)` (RESEARCH.md skeleton); no `-w` needed since nothing is compiled.

**Structural caveat:** `third_party/CMakeLists.txt` currently defines `nanovg` which links `glad_gl_core_33` (line 27). If `add_subdirectory(third_party)` is gated behind `TAPESTRY_BUILD_RENDER`, the doctest/picosha2 targets must be declared either in the root `CMakeLists.txt` (as the research skeleton does) or in `third_party/CMakeLists.txt` with the nanovg/stb blocks wrapped in `if(TAPESTRY_BUILD_RENDER)`. Planner picks one; do not let the kernel build pull in nanovg.

---

### `tapestry/kernel/Ids.hpp` (model, transform)

**Analog:** `tapestry/core/Types.hpp` (small value structs, constexpr ops) + `tapestry/core/World.cpp` 120-127 (counter adoption on load)

**Header shape / namespace / comment style** (`Types.hpp` lines 1-11): `#pragma once`, `namespace tapestry {`, a prose comment above each type explaining *why*, default member initializers:
```cpp
#pragma once

namespace tapestry {

// World- and screen-space point. Doubles throughout: these coordinates are view
// state and page geometry, never simulation state, so precision here costs
// nothing and keeps long pan sessions from accumulating drift.
struct Vec2 {
    double x = 0.0;
    double y = 0.0;
};
```
Recommend `namespace tapestry::kernel` (or `tapestry::tree`/`tapestry::journal` per subdir) so kernel types cannot collide with legacy `tapestry::World`/`tapestry::Page` when both libraries are in one process later.

**ID counter restoration on load** (`World.cpp` lines 120-127) — this is the Pattern 6 rule ("loading restores counters from the max id seen; deleted ids never reused"). Copy the max-plus-one logic; replace `Page` with a generic node/edge id:
```cpp
void World::adopt(Page page) {
    // Deserialization path: the page keeps the id it was saved with, and the
    // id counter moves past it so later addPage calls never collide.
    if (page.id >= m_nextId) {
        m_nextId = page.id + 1;
    }
    m_pages.push_back(std::move(page));
}
```
and the equivalent one-liner for the second counter (`World.cpp` lines 98-101):
```cpp
void World::adoptStroke(Stroke stroke) {
    m_nextStrokeId = std::max(m_nextStrokeId, stroke.id + 1);
    m_strokes.push_back(std::move(stroke));
}
```
Legacy ids are bare `std::uint64_t` (`Page.hpp` line 46, `World.hpp` lines 65-66: `m_nextId = 1`, `m_nextStrokeId = 1`); the kernel adds a strong type plus `n<k>`/`e<k>` text form. Do NOT copy the raw-integer-as-id convention.

---

### `tapestry/kernel/Value.hpp/.cpp` (model + utility, transform)

**Analog:** `tapestry/core/Document.cpp` lines 15-44 (text escape/unescape) and 64-73 (`valueAfter`). Partial match: copy the *pair-of-inverse-functions-in-an-anonymous-namespace* shape; do NOT copy the escaping rules or any numeric code.

**Anonymous-namespace helper pair shape** (`Document.cpp` lines 10-44):
```cpp
namespace tapestry {
namespace {

constexpr const char* kMagic = "tapestry 1";

// Field values are single lines; real newlines and backslashes are escaped so
// a page body survives the line-based format.
std::string escapeText(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (const char c : text) {
        if (c == '\\') {
            out += "\\\\";
        } else if (c == '\n') {
            out += "\\n";
        } else {
            out += c;
        }
    }
    return out;
}

std::string unescapeText(const std::string& text) { ... }
```
For `.tree` inline `text` values: JSON-string escapes (`\" \\ \n \t \uXXXX` for controls) on one line, and the writer must switch to a `<<TEXT` block whenever the text contains `\n` (RESEARCH.md Pattern 2). The legacy `\n`-escape-everything approach is the exact anti-pattern TREE-01 forbids.

**Numeric formatting — explicit DO-NOT-COPY** (`Document.cpp` lines 107-109, 138-142, 150-151, 269-270): every `std::snprintf(... "%.17g" ...)` and `std::sscanf(... "%lf" ...)` call. RESEARCH.md verified `%.17g` prints `0.10000000000000001` and `strtod`/`sscanf` are locale-dependent. Use the verified `formatReal`/`parseReal` pair from RESEARCH.md "Code Examples > Numbers" (`std::to_chars`, `strtod_l` under `newlocale(LC_NUMERIC_MASK,"C")` fallback) confined to `Value.cpp`.

---

### `tapestry/kernel/Time.hpp/.cpp` (model + utility, validate/format)

**Analog:** `tapestry/core/Document.cpp` lines 46-62 — the enum<->name pair is the closest existing "closed vocabulary validated on parse" pattern:
```cpp
const char* kindName(PageKind kind) {
    switch (kind) {
    case PageKind::Conversation: return "conversation";
    case PageKind::File:         return "file";
    case PageKind::Settings:     return "settings";
    case PageKind::Note:         break;
    }
    return "note";
}

bool kindFromName(const std::string& name, PageKind& kind) {
    if (name == "note")         { kind = PageKind::Note; return true; }
    if (name == "conversation") { kind = PageKind::Conversation; return true; }
    ...
    return false;
}
```
Apply the shape (format function + `bool parse(string, out&)` returning false on rejection) to `RecordedAt` (RFC 3339 `Z`), `EventTime` (EDTF L0/L1 grammar) and `Actor.kind` (`human|plugin|system`). Prefer `std::optional<T> parse(std::string_view)` over the out-param form for new code (RESEARCH.md's `parseReal` uses `std::optional`). No wall-clock reads inside the kernel except at commit via an injectable clock (the `fixedClock(...)` in the readability test), consistent with `World.hpp` lines 15-18 ("never reads wall-clock time").

---

### `tapestry/kernel/World.hpp/.cpp` (model, in-memory CRUD)

**Analog:** `tapestry/core/World.hpp` + `tapestry/core/World.cpp` (role-match: same responsibility, but generic nodes/edges/typed props replace `Page`/`Stroke`).

**Class header shape** (`World.hpp` lines 12-24, 52-68) — determinism comment, id-returning create, const accessors, private counters:
```cpp
// The world advances only through step(), in fixed ticks, and never reads
// wall-clock time. That is inherited from semantic-world and it is what makes
// a recorded session replayable: identical inputs at identical ticks produce
// an identical world.
class World {
public:
    // Appends on top of the draw order and assigns the next id. Returns the id
    // rather than a reference: the vector reallocates as pages are added, so a
    // reference would be an invitation to dangle.
    std::uint64_t addPage(PageKind kind, std::string title, std::string body,
                          Rect rect);
    ...
    // Deserialization only: appends a page that keeps its saved id, and moves
    // the id counter past it. Everything else should go through addPage.
    void adopt(Page page);
    void setTicks(std::uint64_t ticks);

    const std::vector<Page>& pages() const { return m_pages; }
    const std::vector<Stroke>& strokes() const { return m_strokes; }
    std::uint64_t ticks() const { return m_ticks; }
    bool empty() const { return m_pages.empty() && m_strokes.empty(); }

private:
    std::vector<Page> m_pages;
    std::vector<Stroke> m_strokes;
    std::uint64_t m_nextId = 1;
    std::uint64_t m_nextStrokeId = 1;
    std::uint64_t m_ticks = 0;
};
```
Keep: `m_` member prefix, return-id-not-reference rule, `adopt` (load path) vs create (live path) split, `ticks()` accessor and tick counter (`World.cpp` 133-136: `step` only increments `m_ticks`; the kernel's `advance` op is the same idea).

**Lookup-by-id shape** (`World.cpp` lines 41-57) — linear scan returning nullable pointer; acceptable for Phase 1 but a `std::map`/`unordered_map<NodeId, Node>` is the natural choice once ids are strong types:
```cpp
Page* World::pageById(std::uint64_t id) {
    for (Page& page : m_pages) {
        if (page.id == id) {
            return &page;
        }
    }
    return nullptr;
}
```

**Explicit DO-NOT-COPY:** `PageKind` enum (`Page.hpp` lines 15-20), `Page`/`Stroke` structs, `pageAt`, `bringToFront`, `contentBounds`, and the `#include "core/Page.hpp"`/`"core/Stroke.hpp"` lines. Node types are opaque namespaced strings; the kernel's `World::apply(Op)` must be the only mutator (no public `pageById()` returning mutable pointers — the legacy `mutable page access` is what made command recording impossible).

---

### `tapestry/kernel/Ops.hpp` and `tapestry/kernel/Record.hpp` (model structs)

**Analog:** `tapestry/core/Document.hpp` lines 13-19 (plain aggregate with defaults) and `Document.cpp` lines 75-83 (`Accumulated` — the "what the file describes, in memory" struct):
```cpp
struct DocumentState {
    std::string title = "Untitled tapestry";
    bool invertScroll = false;
    double panX = 0.0;
    double panY = 0.0;
    double zoom = 1.0;
};
```
```cpp
// The accumulated document as the file describes it: a baseline with every
// delta applied. Both saving (to diff against) and loading build one.
struct Accumulated {
    DocumentState state;
    std::vector<Page> pages;
    std::vector<Stroke> strokes;
    std::uint64_t ticks = 0;
    bool hasBaseline = false;
};
```
Apply: `CommitRecord { seq, parent, branch, recorded, tick, actor, message, ops, unknownLines, digest }` and `Op` as `std::variant<CreateNode, Set, Unset, CreateEdge, DeleteNode, DeleteEdge, Advance>`. Per RESEARCH.md Pattern 5, keep the *original text* of each parsed value in the struct so `encode(decode(x)) == x`. No analog for the variant-of-ops shape; the legacy format dispatches on string keys inline.

---

### `tapestry/kernel/tree/Encoder.cpp` (service, struct -> bytes)

**Analog:** `tapestry/core/Document.cpp` lines 136-166 (`writePage`, `writeBaseline`) and 170-246 (`writeDelta`).

**Build-body-in-memory-then-frame pattern** (`Document.cpp` lines 170-172, 239-246) — this is the direct ancestor of the byte-counted envelope: body into an `std::ostringstream`, then emit `header + body + "end\n"`. The kernel version replaces `delta <tick>` with `@commit <seq> <bytes>` and `end` with `@end sha256:<hex>`:
```cpp
bool writeDelta(std::ostream& out, const Accumulated& previous,
                const DocumentState& state, const World& world) {
    std::ostringstream body;
    ...
    const std::string text = body.str();
    if (text.empty() && world.ticks() == previous.ticks) {
        return false; // nothing to record
    }

    out << "delta " << world.ticks() << '\n' << text << "end\n";
    return true;
}
```

**One-line-per-field `key value` emission** (`Document.cpp` lines 155-166):
```cpp
void writeBaseline(std::ostream& out, const DocumentState& state,
                   const World& world) {
    out << "snapshot " << world.ticks() << '\n';
    out << "title " << escapeText(state.title) << '\n';
    writeCamera(out, state);
    out << "settings invert " << (state.invertScroll ? 1 : 0) << '\n';
    for (const Page& page : world.pages()) {
        writePage(out, page);
    }
    writeStrokes(out, world.strokes());
    out << "end\n";
}
```
Keep the lowercase-verb + space-separated-tokens + `\n` convention. Replace: `snprintf("%.17g")` (lines 138-142) with `Value::format`; `escapeText` with inline-quote-or-block selection; `std::ostream&` output with a `std::string`/`std::vector<std::byte>` return so the codec stays pure (no I/O). Then hash the exact bytes with `picosha2::hash256_hex_string` (RESEARCH.md Encoder example).

---

### `tapestry/kernel/tree/Decoder.cpp` (service, bytes -> struct)

**Analog:** `tapestry/core/Document.cpp` lines 64-73 (`valueAfter`) and 250-423 (`applyBlock`).

**Key-prefix extraction helper** (`Document.cpp` lines 64-73) — copy as-is (it is correct and locale-free), extend to return `std::string_view`:
```cpp
// The value part of a "key value" line, or false if the key does not match.
bool valueAfter(const std::string& line, const char* key, std::string& value) {
    const size_t keyLen = std::char_traits<char>::length(key);
    if (line.compare(0, keyLen, key) != 0 || line.size() < keyLen + 1
        || line[keyLen] != ' ') {
        return false;
    }
    value = line.substr(keyLen + 1);
    return true;
}
```

**Line-dispatch loop with early `return false` on malformed input** (`Document.cpp` lines 259-268, 418-423):
```cpp
    std::string line;
    while (std::getline(in, line)) {
        if (line == "end") {
            return true;
        }

        std::string value;
        if (valueAfter(line, "title", value)) {
            acc.state.title = unescapeText(value);
        } else if (valueAfter(line, "camera", value)) {
            ...
        } else {
            return false; // unknown key — refuse rather than silently drop
        }
    }
    return false; // hit EOF before "end"
```
Keep: strict "reject on malformed, never guess" stance and the EOF-before-terminator failure. Change: (1) the terminator is found by byte count, not by scanning for a sentinel line, so a body line equal to `@end` is inert; (2) the `else` branch splits into two rules — unknown *header key* (conventionally `x-…`) -> preserve verbatim in order and record a diagnostic; unknown *op verb* -> stop with `UNSUPPORTED_OP{seq, verb}`; (3) return a `Diagnostic{offset, reason}` instead of bare `false`; (4) no `sscanf`/`std::getline` on an `istream` — decode from an in-memory byte span so the same function serves the truncation/bit-flip sweeps.

**Nested multi-line read** (`Document.cpp` lines 293-301, `ptitle`/`pbody` follow-up lines) is the ancestor of `<<TEXT … TEXT` block reading: read following lines until the delimiter, all within the byte-counted region.

---

### `tapestry/kernel/journal/Journal.cpp` (service, append-only file I/O)

**Analog:** `tapestry/core/Document.cpp` lines 425-456 (`readAccumulated`) and 472-508 (`saveDocument`). Partial match: copy the *probe-then-append* and *magic-line-first* flow; replace all the I/O primitives and the failure policy.

**Magic/header record check first** (`Document.cpp` lines 13, 426-434):
```cpp
constexpr const char* kMagic = "tapestry 1";
...
bool readAccumulated(const std::string& path, Accumulated& acc) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        return false;
    }
    std::string line;
    if (!std::getline(in, line) || line != kMagic) {
        return false;
    }
```
`.tree` equivalent: first record must be `@tree 1 <bytes> … @end sha256:…`.

**Probe-before-write to avoid clobbering a foreign file** (`Document.cpp` lines 474-484):
```cpp
    // Read what the file already describes, both to diff against and to be
    // sure we are not about to append to somebody else's file format.
    Accumulated previous;
    bool exists = false;
    {
        std::ifstream probe(path, std::ios::binary);
        exists = static_cast<bool>(probe);
    }
    if (exists && !readAccumulated(path, previous)) {
        return false;
    }
```
Keep the intent (open = full scan + classify before any append is allowed).

**Explicit DO-NOT-COPY:**
- `Document.cpp` lines 436-449 `readAccumulated` loop: `continue` on unrecognised block header and `break; // stop at the first corrupt block; keep what came before` — this is the silent-acceptance anti-pattern TREE-03 forbids. Replace with sequential record validation that classifies OK / TORN_TAIL / CORRUPT with offsets (RESEARCH.md Pattern 4).
- `Document.cpp` lines 487-507 `std::ofstream out(path, std::ios::binary | std::ios::app); out << delta.str(); return out.good();` — no partial-write control, no fsync. Replace with `Sink::write(span)` -> `Sink::sync()` (`F_FULLFSYNC`) -> acknowledge (RESEARCH.md Pattern 3), plus `flock(LOCK_EX|LOCK_NB)` on open.
- `countSnapshots` (lines 520-538) re-scans headers by `sscanf`; the kernel exposes `commitCount()` from the scan result instead.

---

### `tapestry/kernel/Kernel.hpp/.cpp` (controller, submit -> result)

**Analog:** `tapestry/core/Document.hpp` lines 55-69 — the public free-function API with contract comments is the closest thing to a "controller" surface:
```cpp
// Appends this state to the document: a baseline if the file is new,
// otherwise a delta against what the file already holds. Saving a state
// identical to the newest version writes nothing and succeeds. Returns false
// on I/O failure, or if the path exists and is not a tapestry document.
bool saveDocument(const std::string& path, const DocumentState& state,
                  const World& world);

// Restores the newest version — the baseline with every delta applied in
// order — into `state` and `world`. Returns false if the file cannot be read
// or holds no valid baseline; on failure the outputs are untouched.
bool loadDocument(const std::string& path, DocumentState& state, World& world);
```
Keep: the "on failure the outputs are untouched" contract (becomes PLUG-06 "failed transactions leave prior state intact") and the contract-in-comment style. Change: `bool` -> structured `CommitResult`/`Expected<…, Diagnostic>`; free functions -> a `Kernel` class owning `World` + `Journal` + `Sink`, because the single-writer lock and journal status are session state. The `loadDocument` "replay every delta in order onto an accumulator" (`Document.cpp` 458-468 `toWorld`) is the same shape as `open()` applying every validated record to `World`.

Order inside `submit` is fixed by RESEARCH.md Pattern 1: validate -> encode -> `sink.write` -> `sink.sync` -> apply -> return. No legacy analog for this ordering; the prototype applies to `World` first and saves later.

---

### `tapestry/kernel_tests/support.hpp` (test utility, file I/O)

**Analog:** `tapestry/tests/DocumentTest.cpp` lines 32-44, 128-137, 280-303.

**Scratch path helper** (lines 32-44) — port directly; change the extension to `.tree` and consider a per-test unique suffix so doctest cases can run in parallel:
```cpp
// A scratch path that will not collide between runs, cleaned up per test.
std::string scratchPath(const char* name) {
    const char* base = std::getenv("TMPDIR");
    std::string path = (base != nullptr) ? base : "/tmp";
    if (!path.empty() && path.back() != '/') {
        path += '/';
    }
    path += "tapestry-test-";
    path += name;
    path += ".tapestry";
    std::remove(path.c_str());
    return path;
}
```

**File size via C stdio** (lines 128-137):
```cpp
long fileSize(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (f == nullptr) {
        return -1;
    }
    std::fseek(f, 0, SEEK_END);
    const long size = std::ftell(f);
    std::fclose(f);
    return size;
}
```

**Raw byte write / read-back** (lines 280-302) — the seed for `writeFile`/`readFile` used by the truncation and bit-flip sweeps:
```cpp
    const std::string foreign = scratchPath("foreign");
    {
        std::FILE* f = std::fopen(foreign.c_str(), "wb");
        check(f != nullptr, "can create the foreign file");
        if (f != nullptr) {
            std::fputs("definitely not a tapestry file\n", f);
            std::fclose(f);
        }
    }
    ...
    {
        std::FILE* f = std::fopen(foreign.c_str(), "rb");
        char buffer[16] = {0};
        if (f != nullptr) {
            const size_t got = std::fread(buffer, 1, 10, f);
            check(got == 10 && std::string(buffer, 10) == "definitely",
                "the foreign file's content is untouched");
            std::fclose(f);
        }
    }
```
Test sinks (`RecordingSink`, `TruncatingSink`, `FailingSyncSink`) and `fixedClock` have no analog; use the sketches in RESEARCH.md "Failure-injection sinks".

---

### `tapestry/kernel_tests/{value,codec,journal,kernel,readability}_test.cpp` (tests)

**Analog:** `tapestry/tests/DocumentTest.cpp` (test *content*), `tapestry/tests/WorldTest.cpp` 40-50 (id tests). The *runner* (`check()` + `g_failures` + `main`) is replaced by doctest; only the assertions and fixtures carry over.

**File header comment stating the invariant under test** (`DocumentTest.cpp` lines 1-8) — keep this convention at the top of each kernel test file:
```cpp
// Document format invariants.
//
// The .tapestry file is the only thing standing between an arranged workspace
// and losing it, so the property that matters is exact round-tripping: what
// loadDocument restores must be byte-for-byte the state saveDocument was
// given, including page bodies with newlines and backslashes, doubles at full
// precision, and minimized flags. The append-only history matters too — a
// save must never destroy the snapshots before it.
```

**Edge-case fixture values** (`DocumentTest.cpp` lines 46-70) — reuse these adversarial inputs for `value_test`/`codec_test` (backslash in title, multi-line body with blank line, tiny double, `.25`/`.125` fractions):
```cpp
DocumentState sampleState() {
    DocumentState state;
    state.title = "Plan: Q3 \\ north star";
    state.invertScroll = true;
    state.panX = -123.456789012345;
    state.panY = 987.654321;
    state.zoom = 0.000125; // beyond the interactive band on purpose
    return state;
}

World sampleWorld() {
    World world;
    world.addPage(PageKind::Conversation, "Kickoff",
        "line one\nline two\n\nwith a \\ backslash", {-560.0, -180.0, 440.0, 330.0});
    ...
```

**Round-trip test shape** (`DocumentTest.cpp` lines 105-126) -> `codec_test` "encode(decode(x)) == x" and `kernel_test` tracer slice:
```cpp
void roundTripsExactly() {
    const std::string path = scratchPath("roundtrip");
    const DocumentState saved = sampleState();
    const World savedWorld = sampleWorld();

    check(tapestry::saveDocument(path, saved, savedWorld), "saveDocument succeeds");

    DocumentState loaded;
    World loadedWorld;
    check(tapestry::loadDocument(path, loaded, loadedWorld), "loadDocument succeeds");
    check(statesEqual(saved, loaded), "title, camera, and settings round-trip exactly");
    check(worldsEqual(savedWorld, loadedWorld), "...");

    // Ids keep counting from where the loaded world left off.
    const auto nextId = loadedWorld.addPage(PageKind::Note, "new", "", {0, 0, 1, 1});
    check(nextId > savedWorld.pages().back().id,
        "loaded worlds hand out fresh ids above every restored one");

    std::remove(path.c_str());
}
```
Lines 120-123 are the TREE-02 "ids stable / new ids never collide after reopen" assertion — port verbatim in spirit.

**Append + count + newest-wins** (`DocumentTest.cpp` lines 139-171) -> `journal_test` "N commits -> commitCount()==N, reopen shows latest state".

**Id uniqueness/ordering** (`WorldTest.cpp` lines 40-50):
```cpp
void idsAreUniqueAndOrdered() {
    World world;
    const auto a = world.addPage(PageKind::Note, "a", "", {0, 0, 10, 10});
    const auto b = world.addPage(PageKind::Note, "b", "", {0, 0, 10, 10});
    const auto c = world.addPage(PageKind::File, "c", "", {0, 0, 10, 10});

    check(a != b && b != c && a != c, "page ids are unique");
    check(a < b && b < c, "page ids increase in creation order");
```

**Legacy runner — DO-NOT-COPY** (`DocumentTest.cpp` lines 23-30, 308-322): `int g_failures; void check(bool, const char*)` and hand-written `main()`. Replace with `TEST_CASE("suite: name")` + `CHECK`/`CHECK_MESSAGE`/`SUBCASE`, and `kernel_tests/main.cpp` = `#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN` + `#include <doctest.h>`. Suite naming convention proposed by RESEARCH.md: prefix test names with `value:`, `codec:`, `journal:`, `kernel:`, `readability:` and/or use `TEST_SUITE` so `-ts=journal` filters work.

---

### `tapestry/docs/tree/example.tree` and `tapestry/docs/tree/FORMAT.md` (fixture + docs)

**Analog:** `tapestry/core/Document.hpp` lines 21-53 — the only existing "format spec"; it lives as a header comment. Copy its structure (magic line, block header, body lines, `end`, then a "block body lines" table with one-line descriptions) into `FORMAT.md` as real Markdown:
```cpp
// The .tapestry file format, version 1. One file is one document, and it is
// its own history: a full baseline followed by deltas.
//
//   tapestry 1
//   snapshot <tick>     full state — written once, when the file is created
//   ...
//   end
//   delta <tick>        only what changed since the previous version
//   ...
//   end
//
// Block body lines:
//
//   title <text>                                  (when changed)
//   camera <panX> <panY> <zoom>                   (when changed)
//   ...
//   pbody <text, newlines escaped as \n>
```
No fixture files exist in the repo (`tapestry/assets` holds fonts only per CMake; `tapestry/docs` does not exist yet). `example.tree` is generated by the tracer slice with a fixed clock and then frozen; the byte-exact assertion pattern comes from `DocumentTest.cpp` lines 293-302 above.

---

## Shared Patterns

### Namespace, header and comment conventions
**Source:** `tapestry/core/World.hpp` lines 1-10, `tapestry/core/Types.hpp` lines 1-3, `tapestry/core/Document.cpp` lines 1-11
**Apply to:** every `kernel/**` and `kernel_tests/**` file
```cpp
#pragma once

#include "core/Page.hpp"      // project headers first, rooted at ${PROJECT_SOURCE_DIR}
#include "core/Stroke.hpp"

#include <cstdint>            // then standard headers, blank line separated
#include <string>
#include <vector>

namespace tapestry {
```
```cpp
#include "core/Document.hpp"  // .cpp: own header first

#include <algorithm>
...
namespace tapestry {
namespace {                   // file-local helpers in an anonymous namespace
...
} // namespace

// public functions

} // namespace tapestry
```
Conventions observed: 4-space indent, `m_` private members, `k` prefix for constants (`kMagic`, `kPageTitleBarHeight`), braces on same line, prose "why" comments above every type/function, `// namespace tapestry` closing comment. Kernel includes should be `"kernel/..."` and must never include `"core/..."` or `"render/..."` (RESEARCH.md Pitfall 7).

### Warning-clean under the shared flags
**Source:** `tapestry/CMakeLists.txt` lines 34-36 (`-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`)
**Apply to:** all kernel sources. Existing code shows the habits this requires: explicit `static_cast<unsigned long long>(page.id)` before `%llu` (`Document.cpp` 140), `static_cast<size_t>(consumed)` (line 346), `static_cast<std::size_t>(strokeCount)` (line 390). Vendored headers go in with `SYSTEM` to keep them out of the warning set (`third_party/CMakeLists.txt` 15-17, 29-36).

### Error handling: reject, never guess; outputs untouched on failure
**Source:** `tapestry/core/Document.cpp` lines 259-268, 418-423; `tapestry/core/Document.hpp` lines 62-65
**Apply to:** Decoder, Journal, Kernel
The prototype's stance — `return false` on any malformed line, "on failure the outputs are untouched" — carries over. Upgrade `bool` to a diagnostic struct carrying `{seq, byteOffset, reason}` (RESEARCH.md V7), and split "unknown header key" (preserve) from "unknown op verb" (refuse). The legacy `break; // stop at the first corrupt block; keep what came before` (line 449) must NOT be copied.

### ID assignment and restoration
**Source:** `tapestry/core/World.cpp` lines 8-18 (assign `m_nextId++` at create), 98-101 and 120-127 (max-plus-one on load)
**Apply to:** `kernel/World`, `kernel/Kernel` (assign at commit, write assigned id into the op), `kernel/tree/Decoder` (restore counters while applying)

### Test fixtures and scratch files
**Source:** `tapestry/tests/DocumentTest.cpp` lines 32-70, 128-137
**Apply to:** all `kernel_tests/*` via `support.hpp`

### Vendoring third-party code
**Source:** `tapestry/third_party/CMakeLists.txt` lines 1-17, 29-36
**Apply to:** `third_party/doctest`, `third_party/picosha2` — pinned tag/commit in a comment, license file kept alongside, `SYSTEM` include, byte-identical to upstream.

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tapestry/kernel/journal/Sink.hpp` | middleware (I/O seam) | file-I/O | No abstraction over the OS write path exists; prototype uses `std::ofstream` directly. Use RESEARCH.md Pattern 3 (`write(span)`, `sync()` = `fcntl(F_FULLFSYNC)`, `size()`), plus `flock` and directory fsync. |
| `tapestry/kernel/journal/Journal.cpp` — scan/classify half | service | file-I/O | No OK/TORN_TAIL/CORRUPT classification, byte-counted framing, digest verification or parent-chain check exists anywhere. Use RESEARCH.md Pattern 4. |
| `tapestry/kernel/journal/Journal.cpp` — `repair()` | service | file-I/O | No sidecar/truncate/fsync-ordering code exists. Use RESEARCH.md Pattern 3 repair sequence. |
| `tapestry/kernel/tree/Encoder.cpp` — digest + `<<TEXT` block selection | service | transform | No hashing (PicoSHA2 is new) and no delimited-block writer exist. Use RESEARCH.md "Encoder" example (`blockDelimiter`, `hash256_hex_string` over head+body). |
| `tapestry/kernel/Kernel.cpp` — `submit()` ordering | controller | request-response | Prototype mutates `World` first and saves later; the validate -> durable write -> apply order is new. Use RESEARCH.md Pattern 1. |
| `tapestry/kernel/Ops.hpp` (variant op set) | model | transform | Prototype has no command objects; ops are inline string keys. Use RESEARCH.md Pattern 2 verb list. |
| `tapestry/kernel/Time.hpp` — EDTF/RFC 3339 grammar | utility | validate | No date/time handling exists (only integer ticks). Use RESEARCH.md Pattern 7 formats. |
| `tapestry/kernel/Value.cpp` — `to_chars`/`strtod_l` | utility | transform | Prototype uses `%.17g`/`sscanf`, which is the anti-pattern. Use RESEARCH.md "Numbers" example verbatim. |
| `tapestry/kernel_tests/main.cpp` | test runner | — | No test framework in repo. `#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN` + `#include <doctest.h>`. |
| `tapestry/kernel_tests/journal_test.cpp` — truncation/bit-flip sweeps, sink-order assertions | test | file-I/O | No failure-injection tests exist. Use RESEARCH.md "Failure-injection sinks" sketches. |
| `tapestry/kernel_tests/readability_test.cpp` — golden byte compare + grep needles | test | file-I/O | No golden fixtures exist. Use RESEARCH.md "Readability golden test" sketch and `TAPESTRY_FIXTURE_DIR`. |
| `tapestry/third_party/doctest/*`, `tapestry/third_party/picosha2/*` (contents) | vendored | — | Fetched from upstream per RESEARCH.md "Installation" curl commands; only the CMake wrapping has an analog. |

---

## Metadata

**Analog search scope:** `tapestry/core/`, `tapestry/tests/`, `tapestry/CMakeLists.txt`, `tapestry/third_party/CMakeLists.txt`, `tapestry/.gitignore` (the entire C++/CMake surface of the repo; `tapestry/app/` and `tapestry/render/` skipped as out-of-scope renderer code that the kernel must not resemble).
**Files scanned:** 11 (Document.cpp/.hpp, World.cpp/.hpp, Types.hpp, Page.hpp, DocumentTest.cpp, WorldTest.cpp head, CMakeLists.txt, third_party/CMakeLists.txt, .gitignore) — all git-tracked, all read once.
**Pattern extraction date:** 2026-09-08
**Caveat for planner:** The prototype is a *style and shape* analog only. Five of its behaviours are explicitly named anti-patterns in RESEARCH.md (`%.17g`, `\n` escaping, `std::ofstream` writes, refuse-on-unknown-key, stop-at-first-corrupt-block); each is marked DO-NOT-COPY above where the surrounding shape is otherwise worth reusing.
