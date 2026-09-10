---
status: investigating
trigger: "UAT Phase 02, Test 1."
created: 2026-09-10T04:55:35Z
updated: 2026-09-10T04:58:19Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: `NoteCard.serializeDoc` aliases the durable title to ProseMirror's first block on every edit, while the component renders that alias as a separate read-only element rather than making the title its own editable heading block.
test: Trace `NoteCard.onSave` through Canvas and App and verify that its derived `newTitle` is submitted directly to the kernel `title` property after edits.
expecting: The save handler writes both serialized `body` and the first-block-derived `title`, with no independent title editor or title-preserving path.
next_action: Read `App.tsx` and `Canvas.tsx` completely, then inspect the kernel submission operations around note creation and note saves.
bug_class: bohrbug
candidate_causes:
  - "code: NoteCard deliberately derives title from ProseMirror document block 0 and renders it read-only outside the editor"
  - "data/config: the note schema or creation payload might omit independent title state and force derivation as a fallback"
and_gate: "Pending App persistence trace; current evidence suggests no, because the NoteCard derivation alone can explain deterministic coupling."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: A note title is its own heading-formatted line and can be edited independently from the first line of body content.
actual: Titles display the first line written, and rewriting the first line rewrites the title, instead of the title being its own line with header formatting.
errors: None reported.
reproduction: Phase 02 UAT Test 1: create or open a note, write multiple lines, then rewrite the first line and observe the displayed title changing with it rather than editing an independent heading line.
started: Discovered during Phase 02 UAT.

## Eliminated
<!-- APPEND only - prevents re-investigating -->


## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-10T04:55:35Z
  checked: Phase 02 UAT Test 1 and gap G-02-1
  found: The accepted truth requires a note title to be its own heading-formatted editable line, independent of the first body line; the observed title instead tracks edits to the first line.
  implication: The investigation must distinguish missing title state/schema from an editor or rendering transform that aliases title to body content.

- timestamp: 2026-09-10T04:56:41Z
  checked: Phase 0 semantic recall and durable debug knowledge base fallback
  found: No MemPalace MCP tool or CLI is available, and `.planning/debug/knowledge-base.md` does not exist.
  implication: There is no prior known-pattern candidate; proceed from direct code and test evidence.

- timestamp: 2026-09-10T04:57:21Z
  checked: Repository inventory and broad title/ProseMirror search
  found: Phase 02's active UI is under `app/src/renderer`; `NoteCard.tsx` and `App.css` contain dedicated note title/editor identifiers, while the notes plugin declaration is under `plugins/tapestry-notes`.
  implication: Focus the execution trace on these source files and their bridge/state callers; exclude compiled `app/out` artifacts from causal evidence.

- timestamp: 2026-09-10T04:58:19Z
  checked: Spectrum-based fault localization eligibility
  found: No source test/spec files exist under `app`, so there is no failing-plus-passing per-test coverage spectrum from which to compute an Ochiai ranking.
  implication: SBFL is inapplicable; use deterministic working-backwards tracing and direct code inspection.

- timestamp: 2026-09-10T04:58:19Z
  checked: Complete `NoteCard.tsx` implementation
  found: `serializeDoc` serializes the entire ProseMirror document as `body`, then unconditionally extracts `title` from the text content of document child index 0; the 300 ms edit debounce calls `onSave(nodeId, newBody, newTitle)` with that pair.
  implication: Any user edit that changes the first ProseMirror block necessarily changes the title value passed to persistence.

- timestamp: 2026-09-10T04:58:19Z
  checked: `NoteCard.tsx` render and editor initialization
  found: The ProseMirror editor is initialized only from `body`; `title` is rendered separately as `<div className="tapestry-note-title">` with no contentEditable behavior, event handler, or inclusion as a heading node in the editor document.
  implication: The displayed title cannot be edited independently; it is a read-only duplicate of first-block text, while heading formatting is merely an optional command on whichever body block contains the cursor.

- timestamp: 2026-09-10T04:58:19Z
  checked: Complete first-party note plugin schema
  found: `plugins/tapestry-notes/index.js` declares separate durable `body: text` and `title: text` properties.
  implication: The data model does not inherently require title/body aliasing; the current leading cause is renderer synchronization logic, pending confirmation that App writes the derived title unchanged.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause:
fix: Diagnose-only mode; no fix applied.
verification:
files_changed: []
