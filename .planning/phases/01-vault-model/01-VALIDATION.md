---
phase: "1"
slug: "vault-model"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-22"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust built-in) |
| **Config file** | crates/vault/Cargo.toml |
| **Quick run command** | `cargo test -p tapestry-vault -q` |
| **Full suite command** | `cargo test -p tapestry-vault -p tapestry-canvas -p tapestry-canvas-app -q` |
| **Estimated runtime** | ~5-10 seconds warm (the live FSEvents watcher tests take ~2-3 s) |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p tapestry-vault -q`
- **After every plan wave:** Run `cargo test -p tapestry-vault -p tapestry-canvas -p tapestry-canvas-app -q` (from plan 02 on, also `cargo build -p tapestry-canvas-app`)
- **Before `/gsd-verify-work`:** Full suite must be green, plus the plan 05 `vault-check` gate (`modified: 0` on a temp copy of the fixture vault)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | VAULT-03, VAULT-04 (tracer also seeds VAULT-02/05/06) | T-1-01, T-1-04, T-1-05 | Rel paths with `..`, absolute, dot-folder or non-`.md` rejected; write is temp + fsync + rename | integration (tracer) | `cargo test -p tapestry-vault --test tracer` and `cargo test -p tapestry-vault --lib time::` | ❌ W0 (task creates crate + test) | ⬜ pending |
| 1-01-02 | 01 | 1 | VAULT-04, VAULT-03 | T-1-02, T-1-03 | Unparseable frontmatter never rewritten; 64 KB frontmatter cap before YAML parse; post-splice re-parse guard | unit (literals) + integration | `cargo test -p tapestry-vault --test frontmatter` | ❌ W0 (task writes test first) | ⬜ pending |
| 1-02-01 | 02 | 2 | LINK-01 | T-1-08, T-1-09 | Links in code/comments/frontmatter not indexed; line-bounded scan | unit | `cargo test -p tapestry-vault --test links` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | LINK-02 | T-1-07 | Anchors only in Obsidian-documented positions; refused kinds typed | unit | `cargo test -p tapestry-vault --test blocks` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 2 | LINK-03 (text level) | T-1-06, T-1-10 | Descriptions validated, never rewritten beyond whitespace; round trip; app still builds | unit + build | `cargo test -p tapestry-vault --test links`; `cargo build -p tapestry-canvas-app`; `cargo test -p tapestry-canvas-app -q` | ✅ app / ❌ W0 vault | ⬜ pending |
| 1-03-01 | 03 | 3 | VAULT-02 | T-1-11, T-1-12, T-1-13 | Symlinks never followed; scan has no write calls and changes zero bytes/mtimes; entry and size caps | integration | `cargo test -p tapestry-vault --test scan` and `cargo test -p tapestry-vault --lib layout::` | ❌ W0 (fixtures + common created here) | ⬜ pending |
| 1-03-02 | 03 | 3 | VAULT-03 | T-1-15 | Computed placement never written (snapshot equality) | unit + integration | `cargo test -p tapestry-vault --test index` and `cargo test -p tapestry-vault --lib layout::` | ❌ W0 | ⬜ pending |
| 1-03-03 | 03 | 3 | LINK-04 | T-1-14 | Duplicate basenames surface as Ambiguous; `..` escaping root is Unresolved | integration | `cargo test -p tapestry-vault --test index` | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 4 | VAULT-06 (writer), VAULT-05 | T-1-16, T-1-18, T-1-19, T-1-20 | Symlinked note/parent refused; perms kept (0600); exact-pattern temp cleanup; torn journal tail tolerated | integration | `cargo test -p tapestry-vault --test store` | ❌ W0 | ⬜ pending |
| 1-04-02 | 04 | 4 | VAULT-05, LINK-02, LINK-03 | T-1-17, T-1-21, T-1-22 | Stale `base_hash` gives Conflict; invalid description writes nothing anywhere; one journal line per event | integration | `cargo test -p tapestry-vault --test store` | ❌ W0 | ⬜ pending |
| 1-05-01 | 05 | 5 | VAULT-06 (watcher) | T-1-23, T-1-24, T-1-25, T-1-26 | Own writes never classified External; NoCache debouncer; dot/temp paths dropped | integration (live FSEvents) + unit | `cargo test -p tapestry-vault --test watch` and `cargo test -p tapestry-vault --lib watch::` | ❌ W0 | ⬜ pending |
| 1-05-02 | 05 | 5 | LINK-05 | T-1-27 | Independent regex+YAML grammar check of every Store-written file; vault-check read-only (exit 1 on any change) | integration + CLI | `cargo test -p tapestry-vault --test grammar`; vault-check over `target/tmp/vault-check-gate`; `cargo test -p tapestry-vault -p tapestry-canvas -p tapestry-canvas-app -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The crate does not exist yet, so every test file is created by the task that needs it (each `tdd="true"` task writes its tests first and runs them red). No separate Wave 0 plan is required.

- [ ] `crates/vault/Cargo.toml`, `crates/vault/src/lib.rs` — created by plan 01 Task 1 (tracer); the workspace `crates/*` glob picks the crate up
- [ ] `crates/vault/tests/common/mod.rs` — created by plan 01 Task 1 (`temp_dir`, `FIXED_MS`, `fixed_clock`, `no_temp_files`), extended by plan 03 Task 1 (`temp_vault`, `snapshot`, `add_test_time_entries`) and plan 04 Task 1 (`ScriptedIds`)
- [ ] `crates/vault/tests/fixtures/obsidian-sample/` — created by plan 03 Task 1 (12 LF files incl. `.obsidian/`, duplicate `Notes.md`, folder note, invalid YAML, two byte copies of committed `world/notes`)
- [x] Framework install — none needed (`cargo test`, built in)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Files written by the app open cleanly in real Obsidian (properties, block refs, aliases, table link, list continuation anchor, `created` display) | LINK-05 | Needs the Obsidian app and human eyes; non-blocking (HUMAN-QUESTIONS #5) | Run `cargo test -p tapestry-vault --test grammar -- --nocapture`, open the printed `.../target/tmp/obsidian-check` folder as a vault in Obsidian, follow the checklist plan 05 appends to `.context/HUMAN-QUESTIONS.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no MISSING sentinels in any plan)
- [x] No watch-mode flags
- [ ] Feedback latency < 10s (confirm after plan 05; live watcher test is the slowest)
- [ ] `nyquist_compliant: true` set in frontmatter (set by validate-phase)

**Approval:** {pending / approved YYYY-MM-DD}

> Planner fills the Per-Task Verification Map from 01-RESEARCH.md § Validation Architecture. Manual-only: real-Obsidian open check (HUMAN-QUESTIONS #5), non-blocking.
