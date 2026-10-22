# Phase 02 Deferred Items

Out-of-scope issues found during execution. Not fixed by the plan that found them.

## Found during 02-04

- **vault_host tests write the real vault choice.** `apps/canvas/src/vault_host.rs` `remember_root` saves to `ide::state_dir()/vault.json`, and a worker test that switches roots runs it with the real state folder. Every `cargo test -p tapestry-canvas-app` run points the user's `~/.local/state/tapestry/vault.json` at a deleted temp folder (`tapestry-switch-source-…`), so the app opens on "Couldn't open this folder". Fix: give `VaultHost` an injectable state location, or skip `remember_root` under `cfg(test)`. The file belongs to 02-01's vault host; 02-04 does not own it. Logged for Kaelen as `.context/HUMAN-QUESTIONS.md` #17.
- **Pre-existing dead-code warnings in vault_host.rs.** `Command::Rescan` and `VaultHost::request_rescan` are never used (bin build). Not caused by 02-04.
- **No file-level test for vault selection restore.** `remembered_root`/`remember_root` in vault_host.rs have no round-trip test (and adding one needs the state-dir injection above). 02-04's shell-state tests cover the explorer, files place, and editors in `shell.json`.
