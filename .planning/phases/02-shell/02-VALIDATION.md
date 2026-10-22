---
phase: "02"
slug: "shell"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-22"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust built-in test harness / Cargo |
| **Config file** | workspace Cargo manifests |
| **Quick run command** | `cargo test -p tapestry-canvas-app --offline` |
| **Full suite command** | `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p tapestry-canvas-app --offline`
- **After every plan wave:** Run `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01 | 01 | 1 | VAULT-01 | — | Keep vault root independent of `--world`; preserve existing user data | unit + integration | `cargo test -p tapestry-canvas-app --offline vault_selection` | ❌ Wave 0 | ⬜ pending |
| 02-01 | 01 | 1 | SHELL-01 | — | Preserve Tab identities and default graph route | unit + build | `cargo test -p tapestry-canvas-app --offline shell` | ❌ Wave 0 | ⬜ pending |
| 02-02 | 02 | 2 | SHELL-02 | — | Explorer visibility, sizing, and floating transition work | screenshot/UI check | `TAPESTRY_SHOT=target/tmp/shell.png:3 cargo run -p tapestry-canvas-app --offline` | ❌ Manual | ⬜ pending |
| 02-02 | 02 | 2 | SHELL-03 | — | Palette filters tools/notes/folders/commands and opens with terminal focus | unit + UI | `cargo test -p tapestry-canvas-app --offline palette` | ❌ Wave 0 | ⬜ pending |
| 02-03 | 03 | 3 | SHELL-04 | — | Tool routing retains hidden view state and screenshot hook works | unit + smoke | `cargo test -p tapestry-canvas-app --offline tool_routing` | ❌ Wave 0 | ⬜ pending |
| 02-03 | 03 | 3 | SHELL-05 | — | Esc precedence and shell shortcut filtering protect PTY and scope simulation keys | unit | `cargo test -p tapestry-canvas-app --offline input_router` | ❌ Wave 0 | ⬜ pending |
| 02-02 | 02 | 2 | SHELL-06 | — | Explorer and palette selection map to the same navigation action | unit | `cargo test -p tapestry-canvas-app --offline navigation_action` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Add pure shell tests for input shortcut precedence and destination routing.
- [ ] Add vault-selection persistence/default/path-switch tests, including separation from `--world`.
- [ ] Add worker-level snapshot refresh and own-write classification coverage.
- [ ] Add UI check for explorer float/resize, terminal-focused Cmd-K, and screenshots from hosted tools.

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Explorer float/resize and terminal-focused Cmd-K | SHELL-02, SHELL-03, SHELL-05 | Native egui focus, drag, and overlay behavior needs a rendered app | Run app, resize/float explorer; focus terminal; press Cmd-K and verify PTY receives no shortcut text. |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
