---
phase: "01"
slug: "deterministic-core-readable-format"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-09"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| upstream → repo | Vendored third-party headers (doctest v2.5.3, PicoSHA2 161cb3fc) cross into the build | Source code, pinned tag/commit |
| `.tree` bytes → decoder | Untrusted journal bytes on disk are parsed by the strict block-line decoder | User content, digests, byte counts |
| process locale → codec | Host processes may call setlocale; numeric text must not depend on it | Real/int text forms |
| kernel → filesystem | Journal open/append/repair/saveAs create, lock, sync and truncate files at caller-supplied paths | Journal bytes, sidecars |
| plugin data → core | Unknown node types and `x-` extension lines pass through the core uninterpreted | Plugin-owned readable data |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-1-SC | Tampering | vendored third_party/doctest, third_party/picosha2 | high | mitigate | Pinned tag (doctest v2.5.3) and PicoSHA2 commit 161cb3fc recorded in the CMakeLists.txt banner; licenses vendored; SHA-256 KAT passes; no package-manager installs (01-01 SUMMARY) | closed |
| T-1-01 | Tampering | kernel/tree/Decoder.cpp, Journal.cpp scan | high | mitigate | Byte-counted envelope + per-record SHA-256 + parent chain + seq/tick checks; first failure classified TornTail vs Corrupt; exhaustive truncation (17,569 asserts) and bit-flip (9,147 asserts) sweeps never accept a partial or damaged record (01-VERIFICATION SC3) | closed |
| T-1-02 | Denial of service | kernel/tree/Decoder.cpp limits | medium | mitigate | kMaxRecordBytes (64 MiB) refused from the head line before any allocation; kMaxLineBytes (1 MiB) per line; block scan bounded by the counted body; LimitExceeded diagnostic (01-02/01-03 SUMMARY) | closed |
| T-1-03 | Tampering | kernel/journal/Sink.cpp flock | high | mitigate | flock(LOCK_EX\|LOCK_NB) held for the sink's life; `journal: a second opener is locked out` passes (Sink.cpp 125-131) | closed |
| T-1-04 | Tampering | kernel/tree/Decoder.cpp UTF-8/NUL validation | medium | mitigate | Every body line and block validated as UTF-8 with NUL rejected → InvalidUtf8 at the offending line; inline values escape control bytes (01-03 SUMMARY; Decoder.cpp 227) | closed |
| T-1-05 | Spoofing | kernel/tree/Encoder.cpp framing / block delimiter | medium | mitigate | Framing by byte count makes embedded `@end`/`@commit` text inert; block delimiter escalates (TEXT, TEXT1, …) until unique, tested with a body line equal to TEXT (01-03 SUMMARY) | closed |
| T-1-06 | Tampering | Journal.cpp repair sidecar naming | low | mitigate | Sidecar path = journal path + `.torn-` + clock stamp, never derived from file content; CreateNew refuses to overwrite an existing sidecar (01-04 SUMMARY) | closed |
| T-1-07 | Repudiation | Sink.cpp sync / Journal.cpp append / Kernel.cpp submit | high | mitigate | write → F_FULLFSYNC → acknowledge; world applied only after sync; failed sync rejects and marks the journal torn; repair orders sidecar write → sidecar sync → truncate → full sync (Kernel.cpp 148-153, Journal.cpp 252-268, 305-370) | closed |
| T-1-10 | Elevation of privilege | kernel/journal/Sink.cpp open | low | mitigate | O_NOFOLLOW\|O_CLOEXEC on every open so symlinked paths are not followed and fds do not leak to children (Sink.cpp) | closed |
| T-1-11 | Tampering | kernel/Value.cpp parseReal/parseValue | medium | mitigate | Grammar-first locale-independent parse (from_chars / strtod_l with a C locale); NaN/Inf/trailing garbage rejected; `value: reals are locale-proof` passes under de_DE.UTF-8 | closed |
| T-1-13 | Tampering | tapestry/CMakeLists.txt render gate | low | mitigate | tapestry_kernel links only tapestry_settings; kernel-only build has no _deps directory and zero nvg/glad symbols (verifier rebuilt from scratch) | closed |
| T-1-14 | Tampering | kernel/World.cpp id assignment | medium | mitigate | Ids assigned only in prepare; explicit ids must equal the next counter (IdOutOfOrder); tombstones prevent reuse; `kernel: ids are stable across reopen and never reused after delete` passes | closed |
| T-1-17 | Repudiation | fixture regeneration (TAPESTRY_REGEN_FIXTURE) | low | mitigate | Regeneration only when the env var is explicitly set; default run compares and fails on drift; fixture is git-tracked (01-05 SUMMARY) | closed |
| T-1-18 | Tampering | Journal.cpp saveAs (new surface flagged by 01-04) | low | mitigate | openPosixSink(CreateNew): O_CREAT\|O_EXCL never overwrites, O_NOFOLLOW, flock for the write, directory fsync; copies exactly the verified prefix (Journal.cpp 372-382) | closed |
| T-1-12 | Denial of service | kernel/Value.cpp unquoteText, Time.cpp isValidEventTime | low | accept | Inputs are single lines bounded by the 1 MiB decoder line limit; parsers are linear-time whitelist grammars | closed (accepted) |
| T-1-15 | Information disclosure | `x-` extension lines re-emitted verbatim | low | accept | Plugin-owned readable data by design; the kernel neither interprets nor filters them; plugin secrets are a Phase 2 capability concern (FORMAT.md) | closed (accepted) |
| T-1-16 | Denial of service | Journal.cpp repair | low | accept | Repair copies at most one torn tail (bounded by kMaxRecordBytes) once per explicit call; no automatic retry loop | closed (accepted) |
| T-1-08 | Information disclosure | plaintext `.tree`, `.torn-*` and fixture files | low | accept | Local single-user files; readability without the app is the product requirement; the fixture holds invented example data; encryption is out of v1 (FORMAT.md) | closed (accepted) |
| T-1-09 | Tampering | `.tree` digest chain authenticity | medium | accept | v1 digests are integrity-only (accidental damage, casual edits), not forgery-proof; no HMAC/signature in scope; FORMAT.md "Integrity, not authenticity" states this explicitly | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-1-01 | T-1-12 | Single-line inputs bounded by the decoder's 1 MiB line limit; linear-time whitelist parsers | Plan 01-01 threat model (planner), applied 01-01 | 2026-09-09 |
| R-1-02 | T-1-15 | Extension lines are plugin-owned readable data by design; filtering them would violate TREE-02 | Plan 01-03 threat model, applied 01-03 | 2026-09-09 |
| R-1-03 | T-1-16 | One bounded tail copy per explicit repair call | Plan 01-04 threat model, applied 01-04 | 2026-09-09 |
| R-1-04 | T-1-08 | Plaintext readability is the core product value; encryption out of v1, stated in FORMAT.md | Plans 01-04/01-05 threat models, applied 01-05 | 2026-09-09 |
| R-1-05 | T-1-09 | Integrity-only digests; authenticity explicitly disclaimed in FORMAT.md | Plan 01-05 threat model, applied 01-05 | 2026-09-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-09 | 19 | 19 | 0 | gsd-secure-phase (orchestrator, L1 short-circuit: register authored at plan time, all dispositions evidenced in SUMMARY.md and 01-VERIFICATION.md) |

Notes: 01-REVIEW.md (code review, status issues_found) records two critical correctness findings — CR-01 (decoder rejects inline text with consecutive spaces) and CR-02 (submit does not enforce kMaxLineBytes/kMaxRecordBytes on the write side) — that make the kernel write records its own reader refuses. They affect availability of a user's own journal, not the trust boundaries above, and are tracked for fixing via the code-review flow rather than as open threats here.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-09
