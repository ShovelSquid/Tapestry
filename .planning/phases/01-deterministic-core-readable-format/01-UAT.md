---
status: testing
phase: 01-deterministic-core-readable-format
source: [01-VERIFICATION.md]
started: 2026-09-09T08:27:32Z
updated: 2026-09-09T08:27:32Z
---

## Current Test

number: 1
name: Cold read of tapestry/docs/tree/example.tree (TREE-01 / Success Criterion 1)
expected: |
  Open tapestry/docs/tree/example.tree in a plain text editor WITHOUT reading FORMAT.md first and answer:
  (1) Who is the note about and what does its body say?
  (2) Which record connects the note to the person and with what label?
  (3) When did the dinner happen according to the latest value, and can you find the earlier corrected value?
  (4) Which lines tell you when each change was written down, versus when the event happened, versus which simulation tick it applies at?
  (5) Which branch is this history on and how does each record point to its predecessor?
  Then skim FORMAT.md and confirm nothing contradicts what you read.
  Expected: (1) Sam; "Met Sam at dinner. / Loves architecture and weird bird memes." (2) @commit 3, "create-edge e1 n1 n2 mentions", by actor "plugin example.people". (3) 2026-09-06 (commit 4, "corrected dinner date"); the earlier 2026-09-07 is still in commit 1. (4) "recorded <stamp>" = when written down; "set n1 event time <date>" = when it happened; "tick <n>" = simulation tick (0 through commit 5, 3 at commit 6 after "advance 3"). (5) "branch main"; each "parent sha256:" equals the previous record's "@end sha256:". A question that cannot be answered from the file alone is a TREE-01 gap.
awaiting: user response

## Tests

### 1. Cold read of tapestry/docs/tree/example.tree (TREE-01 / Success Criterion 1)
expected: All five questions above are answerable from the file alone, and FORMAT.md does not contradict the reading.
result: [pending]

### 2. Prohibition sign-off (Plan 02, TREE-01): actors are never conflated
expected: No code path writes a commit without a validated actor line (Encoder.cpp actor line always emitted; Kernel/World validate actor kind and id); the three actor kinds human / plugin / system are distinct in the fixture. Verifier's non-authoritative verdict: NOT VIOLATED.
result: [pending]

### 3. Prohibition sign-off (Plan 03, TREE-02): unknown data is never silently dropped, rewritten, reordered or normalized
expected: Unknown x- lines and unknown node types survive open and save-as byte-identically; an unknown verb yields Corrupt with the verb named and only the verified prefix loaded. Verifier's non-authoritative verdict: NOT VIOLATED.
result: [pending]

### 4. Prohibition sign-off (Plan 04, TREE-03): no ack before flush, no silent repair
expected: Write precedes sync precedes acknowledge (Journal.cpp append); open never shortens a file; repair is explicit and writes a synced sidecar before truncating. Verifier's non-authoritative verdict: NOT VIOLATED.
result: [pending]

### 5. Prohibition sign-off (Plan 05, TREE-01): no meaning stored in a form requiring Tapestry, a binary decoder, compression or encryption
expected: Every value in example.tree is readable as text (2139 bytes of LF-terminated UTF-8, 0 CR/TAB/NUL, 0 escaped-newline sequences); binary attachments are not embedded. Verifier's non-authoritative verdict: NOT VIOLATED.
result: [pending]

### 6. Prohibition sign-off (Plan 05, TREE-04): wall clock never substitutes for event time; corrections never erase earlier values
expected: A correction is a new commit; the earlier value stays in its earlier record under its own recorded stamp; event time is an ordinary typed property set only by an op, never derived from the clock. Verifier's non-authoritative verdict: NOT VIOLATED.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
