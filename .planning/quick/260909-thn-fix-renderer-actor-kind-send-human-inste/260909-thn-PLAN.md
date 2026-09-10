---
phase: quick-260909-thn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/src/renderer/App.tsx
autonomous: true
quick_id: 260909-thn

estimate:
  tokens: 12000
  raw_tokens: 12000
  tasks: 1
  confidence: low

must_haves:
  truths:
    - "Creating a note in the running Electron app produces a kernel commit and a live node instead of the error `Kernel rejected: user local`"
    - "Every renderer-originated commit is journaled with actor kind `human` and actor id `local`"
    - "Main-process plugin-host commits still use actor kind `system` (unchanged)"
  artifacts:
    - path: app/src/renderer/App.tsx
      provides: "Seven kernel.submit call sites whose first argument is the literal 'human'"
      contains: "'human',"
  key_links:
    - from: app/src/renderer/App.tsx
      to: app/src/preload/index.ts
      via: "window.tapestry.kernel.submit(actorKind, actorId, message, ops) -> ipcRenderer.invoke('kernel:submit', ...)"
      pattern: "kernel\\.submit\\("
    - from: app/src/main/kernel-bridge.ts
      to: tapestry/kernel/Ops.hpp
      via: "native addon submit -> Kernel::submit -> isValidActorKind (accepts only human | plugin | system)"
      pattern: "isValidActorKind"
---

<objective>
Fix the renderer so notes can be created: every `window.tapestry.kernel.submit(...)` call in
`app/src/renderer/App.tsx` currently passes an actor kind the C++ kernel does not recognise, so the
native addon throws `Kernel rejected: user local` on every commit. Replace that first argument
with the literal `'human'` at all seven call sites. The actor id `'local'` is a valid token and stays.

Purpose: The Phase 02 feasibility gate (editable note plugin, spatial interaction) is blocked because
no renderer commit can reach the journal. The diagnosis is already established and reproduced
headlessly; this plan is the surgical fix only.

Output: `app/src/renderer/App.tsx` with seven `'human'` actor-kind arguments and zero rejected ones;
web typecheck still clean.

Scope check (single source: the quick-task description):
- Description item "send 'human' instead of 'user' to kernel submit" -> Task 1. COVERED.
- Optional Task 2 (type note if an actor-kind union exists) -> CHECKED AND SKIPPED. No `ActorKind`
  union exists: `sdk/src/index.ts:147`, `app/src/renderer/global.d.ts:10`,
  `app/src/preload/index.ts:25` and `app/src/main/kernel-bridge.ts:149` all declare
  `actorKind: string`. Tightening that type across SDK + preload + bridge is a separate, wider change
  and is out of scope for this quick fix (recorded as a follow-up observation, not a task).
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@app/src/renderer/App.tsx
@tapestry/kernel/Ops.hpp
</context>

<tasks>

<task type="auto">
  <name>Task 1: Send actor kind 'human' from every renderer kernel.submit call</name>
  <files>app/src/renderer/App.tsx</files>
  <read_first>
    - app/src/renderer/App.tsx lines 200-210 (first submit site: shows the four-argument shape `kernel.submit(kind, id, message, ops)`; the other six sites are identical in shape)
    - tapestry/kernel/Ops.hpp lines 103-107 (`isValidActorKind`: the kernel accepts exactly `human`, `plugin`, `system`)
    - app/src/main/plugin-host.ts lines 832-837 (main-process pattern: `submit('system', 'tapestry', ...)` — correct, do not touch)
  </read_first>
  <action>
    In `app/src/renderer/App.tsx` there are exactly seven calls to `window.tapestry.kernel.submit(`
    (call lines 202, 245, 292, 331, 392, 460, 540). On the line directly beneath each call — lines
    203, 246, 293, 332, 393, 461, 541 — the first argument is a single-quoted four-letter actor kind
    that the kernel rejects (only `human`, `plugin`, `system` pass `isValidActorKind`). Change that
    first argument on each of the seven lines to the literal `'human'`, keeping the trailing comma
    and indentation unchanged.

    Constraints:
    - Only the FIRST argument of `kernel.submit` changes. The second argument `'local'` is a valid
      token and MUST stay `'local'`; the message and ops arguments are untouched.
    - Do not modify any other file. The main-process plugin host already submits with `'system'`
      and is correct; the preload, kernel-bridge and native addon need no change.
    - Do not add a comment explaining the change at the call sites — the kernel's own
      `isValidActorKind` doc line is the source of truth and a call-site comment would just drift.
    - Do not widen scope into typing the actor kind as a union (no `ActorKind` type exists today;
      see the objective's scope check).

    A safe mechanical approach: a single `sed -i ''` over App.tsx whose pattern anchors on
    start-of-line, optional spaces, the quoted rejected kind, a comma, end-of-line — that shape
    occurs only on those seven lines. Confirm with `grep -n "'human',"` that exactly seven lines
    changed and that each sits directly under a `kernel.submit(` line, then run the verify command.

    Commit as: fix(quick-260909-thn): send actor kind human from renderer kernel.submit
  </action>
  <verify>
    <automated>cd app && npx tsc --noEmit -p tsconfig.web.json && cd .. && test "$(grep -v '^[[:space:]]*//' app/src/renderer/App.tsx | grep -c "'user',")" = 0 && grep -q "^ *'human',$" app/src/renderer/App.tsx && ! grep -A1 "kernel\.submit($" app/src/renderer/App.tsx | grep -v "kernel\.submit($" | grep -v '^--$' | grep -vq "^ *'human',$"</automated>
    <human-check>Run `npm --prefix app run dev`, create or open a world, and create a note. Expected: the note appears as a live node with no `Kernel rejected` error in the renderer or main-process console, and the newest @commit record in the world's `.tree` file names the actor as human local.</human-check>
  </verify>
  <done>
    - `cd app && npx tsc --noEmit -p tsconfig.web.json` exits 0 (baseline already clean; must stay clean)
    - Non-comment lines of App.tsx contain zero occurrences of the rejected actor-kind literal followed by a comma
    - Every line directly beneath a `kernel.submit(` call in App.tsx is `'human',` (`grep -n "^ *'human',$"` reads lines 203, 246, 293, 332, 393, 461, 541), and each site still passes `'local'` as the second argument
    - No file other than app/src/renderer/App.tsx is modified in the commit
    - Human check (end-of-phase): creating a note in the app produces a live node and a journaled commit
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer -> main (IPC `kernel:submit`) | Renderer-supplied `actorKind`/`actorId` strings cross the contextBridge into the main process and are forwarded to the native kernel |
| main -> native kernel | `Kernel::submit` validates actor kind via `isValidActorKind` and text via `isToken`/`isValidText` before any bytes reach the journal |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-q260909thn-01 | Spoofing | app/src/main/kernel-bridge.ts `kernel:submit` handler | low | accept | The renderer may already assert any of the three valid kinds (`human`/`plugin`/`system`) because the IPC surface takes a free string; this fix only corrects the value the trusted first-party renderer sends. Restricting which kinds a renderer may claim (e.g. main-process pinning of renderer commits to `human`) is a design change for the plugin-host/IPC hardening work, not this quick fix. Kernel-side `isValidActorKind` remains the enforced gate. |
| T-q260909thn-02 | Tampering | tapestry/kernel/Ops.hpp `isValidActorKind` | low | accept | Unchanged: the kernel still rejects any kind outside the closed set, so a wrong value can never be journaled; this fix does not loosen validation. |
| T-q260909thn-SC | Tampering | npm/pip/cargo installs | low | accept | No packages are installed by this plan (single-file literal edit); package legitimacy gate not applicable. |
</threat_model>

<verification>
- Automated: web typecheck clean; zero rejected literals on non-comment lines; the line under every `kernel.submit(` is `'human',` (read the seven hits with `grep -n`).
- Diff scope: `git diff --stat` for the fix commit touches only `app/src/renderer/App.tsx` with 7 insertions / 7 deletions.
- End-of-phase human check: a note created in the Electron app becomes a live node and a journaled commit whose actor is human local.
</verification>

<success_criteria>
- All seven `window.tapestry.kernel.submit` call sites in App.tsx pass `'human'` as the actor kind and `'local'` as the actor id.
- `cd app && npx tsc --noEmit -p tsconfig.web.json` exits 0.
- Notes can be created from the renderer (no `Kernel rejected: user local`), unblocking the Phase 02 feasibility gate.
- Main-process `'system'` commits are untouched.
</success_criteria>

<output>
Create `.planning/quick/260909-thn-fix-renderer-actor-kind-send-human-inste/260909-thn-SUMMARY.md` when done (with `status: complete` in its frontmatter).
</output>
