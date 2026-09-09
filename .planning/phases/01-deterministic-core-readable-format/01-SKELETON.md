# Walking Skeleton — Tapestry

**Phase:** 1
**Generated:** 2026-09-08

## Capability Proven End-to-End

A caller creates one node through `Kernel::submit`, the kernel appends that change as a committed record to a `.tree` journal on disk using the real durability primitives (single `write`, `F_FULLFSYNC`, `flock`), a fresh process reopens the file from disk and reads the same node back with the same identifier — proven by a doctest case and by a journal a person can read in a text editor.

There is no UI in this phase. The "interaction" is the kernel's public API exercised by tests and the readable file itself; the UI toolkit decision belongs to the Phase 2 feasibility gate and nothing here depends on it.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language / build | C++20 static library `tapestry_kernel` under `tapestry/kernel/`, CMake >= 3.24, linked only to `tapestry_settings` (`-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`) | Reuses the repo's verified toolchain and determinism flags; a separate target keeps the kernel free of glad/NanoVG/SDL so it builds offline with no display (RESEARCH Pitfall 7) |
| Render stack gating | `option(TAPESTRY_BUILD_RENDER ON)` wraps `FetchContent(glad)`, `third_party` (nanovg/stb), `tapestry_core`, the app and the three legacy tests | The legacy prototype stays buildable as the comparison baseline; the kernel-only configure must not need Python/Jinja2/network |
| Test runner | doctest v2.5.3 vendored (`third_party/doctest/`), `doctest_discover_tests` registers every `TEST_CASE` with CTest; suites `value`, `codec`, `journal`, `kernel`, `readability` | Single header, verified offline on this machine, per-case filtering (`-ts=`, `-tc=`) gives sub-second Nyquist sampling |
| Data layer (the "database") | Append-only `.tree` journal: `@tree 1 <bytes>` header record, then `@commit <seq> <bytes>` … `@end sha256:<64hex>` records; `key value` lines; multi-line text in `<<TEXT` … `TEXT` delimited blocks inside the byte-counted envelope; digest over the bytes as written; `parent` links each record to the previous digest | Readable by humans without escapes (TREE-01), framed unambiguously by byte count, tamper/torn detectable by digest + chain (TREE-03), no canonicalization needed because records are immutable byte spans (RESEARCH Pattern 2/5) |
| Durability | Buffer whole record → one `write` → `fcntl(F_FULLFSYNC)` (fallback `fsync`) → acknowledge → apply to memory; directory `fsync` on file creation; `flock(LOCK_EX\|LOCK_NB)` for single-writer | Apple documents that plain `fsync` is not media-durable; SQLite's atomic-commit assumptions (non-atomic sectors, reordering) drive the ordering (RESEARCH Pattern 3) |
| Recovery classification | `open()` scans every record; first failure at EOF with no later complete record → `TornTail{offset,bytes}`; failure elsewhere → `Corrupt{seq,offset,reason}`; valid prefix is loaded in both cases; `submit` refused until explicit `repair()` (sidecar `<file>.torn-<recordedAt>` then truncate) | No silent loss, no silent acceptance of partial writes, no automatic repair (TREE-03, RESEARCH Pattern 4) |
| Mutation model | Single-writer transaction kernel: `Kernel::submit(Proposal)` = validate every op against a scratch copy of the world → encode → durable write → apply → return `CommitResult`; a rejected or failed proposal changes nothing on disk or in memory | Sole mutation path that Phase 2 plugin proposals reuse unchanged (PLUG-06) |
| World model | Generic `Node{id,type,props}` / `Edge{id,from,to,label,props}` with typed values `text\|int\|real\|bool\|ref\|time`; `type` is an opaque namespaced string (e.g. `tapestry.notes/note@1`); no feature classes | Unknown plugin types load, display readable typed values, and survive save-as byte-identically (TREE-02); the kernel never needs plugin code |
| Identity | Kernel-assigned sequential `n<k>` / `e<k>` written into the committed op; counters restored from the maximum id seen; deleted ids never reused; Phase 3 branch-tag rule (`b2.n12`) documented in FORMAT.md now, implemented later | Readable, deterministic, replay never re-derives ids (RESEARCH Pattern 6, Open Question 3) |
| Time model | Three fields, three names, three places: `recorded` (RFC 3339 UTC seconds, commit header, audit only), `tick` (integer, commit header, changed only by `advance <n>`), `event` (EDTF L0/L1 or RFC 3339, a node property set by an op); corrections are new commits that keep the earlier value in an earlier record | A reader tells the three apart by name and location (TREE-04); `recorded` is never used for ordering (`seq`/`parent` order) |
| Branch ancestry | Every commit carries `branch main` and `parent sha256:<digest>` from day one | Phase 3 adds forks without a format break |
| Numbers | `std::to_chars` shortest round-trip for `real`; `std::from_chars` where available else `strtod_l` under a `"C"` locale handle; `nan`/`inf` rejected | Locale-proof and human-readable (`0.1`, not `0.10000000000000001`) — verified on Apple clang 14 / libc++ 15 |
| Hashing | SHA-256 via vendored PicoSHA2 with a known-answer test; integrity only (no HMAC/signature in v1, stated in FORMAT.md) | Never hand-roll crypto; KAT verified against CommonCrypto locally |
| Auth / access control | None — single local user; `flock` is the only exclusion; no accounts, no network | ASVS L1 V2/V3/V4 not applicable in Phase 1 (Phase 2 adds plugin capabilities) |
| Deployment target | Local headless build: `cmake -S tapestry -B tapestry/build-kernel -DTAPESTRY_BUILD_APP=OFF -DTAPESTRY_BUILD_RENDER=OFF && cmake --build tapestry/build-kernel -j 8 && ctest --test-dir tapestry/build-kernel --output-on-failure` | No server, no packaging in this phase; the full-stack run is the test suite plus the readable golden fixture |
| Directory layout | `tapestry/kernel/{Ids,Digest,Value,Time,Ops,Record,World,Kernel}.{hpp,cpp}`, `tapestry/kernel/tree/{Codec.hpp,Encoder.cpp,Decoder.cpp}`, `tapestry/kernel/journal/{Sink,Journal}.{hpp,cpp}`, `tapestry/kernel_tests/*.cpp`, `tapestry/docs/tree/{FORMAT.md,example.tree}`, `tapestry/third_party/{doctest,picosha2}/` | Mirrors RESEARCH "Recommended Project Structure"; includes are rooted at `${PROJECT_SOURCE_DIR}` (`"kernel/World.hpp"`), never `core/` or `render/` |

## Stack Touched in Phase 1

- [x] Project scaffold — `tapestry_kernel` + `tapestry_kernel_tests` targets, vendored doctest/PicoSHA2, render stack gated, `build-kernel/` git-ignored (Plan 01)
- [x] Entry point ("routing") — `Kernel::create` / `Kernel::open` / `Kernel::submit` / `Kernel::world()` / `Kernel::status()` as the single public mutation and query surface (Plan 02)
- [x] Persistence — one real durable write (`@tree` header + `@commit` record through `PosixSink`) AND one real read (`open` scans, verifies digests/chain, rebuilds `World`) (Plan 02)
- [x] Interaction — no UI; the doctest tracer case plus a human-readable journal on disk stand in for it (Plan 02), with a frozen golden fixture and cold-read check at the end (Plan 05)
- [x] Local full-stack run — the documented configure/build/ctest command above, plus `tapestry_kernel_tests -ts=<suite>` quick runs

## Out of Scope (Deferred to Later Slices)

- Branch creation, fork-of records, branch-tagged ids, history navigation, snapshots, replay compatibility envelope (Phase 3)
- Plugin host, manifest, SDK, host protocol (JSON is fine there — it is not the `.tree` format), plugin capabilities (Phase 2)
- Any UI, renderer, SDL/NanoVG changes, Electron/Qt decision (Phase 2 gate)
- Importing hand-edited `.tree` files as a new branch (a digest mismatch is reported `Corrupt` with an offset in Phase 1; Open Question 5)
- Group commit / batching of `F_FULLFSYNC`, `real2` vector value type (positions are two `real` properties), SQLite indexes, encryption or signatures of the journal
- Migration of legacy `.tapestry` files (REQUIREMENTS.md Out of Scope)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: a plugin submits a `Proposal` through the versioned public API and its unknown node type is inspectable through the readable fallback
- Phase 3: `fork-of` records, branch-tagged ids, history cursor, snapshots verified equal to replay
- Phase 4: bundled note/drawing/property plugins whose content is ordinary typed properties in `.tree`
- Phase 5: `advance <n>` drives a fixed-step rule engine whose outputs are recorded ops
- Phase 6: companion outcomes materialized as recorded `plugin`-actor commits, never re-queried on replay
- Phase 7: profile memory and attention observations as readable, branch-scoped records
