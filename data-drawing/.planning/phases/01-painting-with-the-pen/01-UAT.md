---
status: testing
phase: 01-painting-with-the-pen
source: [01-VERIFICATION.md]
started: 2026-09-24T22:36:41Z
updated: 2026-09-24T22:36:41Z
---

## Current Test

number: 1
name: REVIEW item 1 step 1: open Data Drawing in Tapestry and copy the panel line 'backend=... adapter=...'
expected: |
  backend=webgpu or backend=webgl2 is reported, and the stage renders either way
awaiting: user response

## Tests

### 1. REVIEW item 1 step 1: open Data Drawing in Tapestry and copy the panel line 'backend=... adapter=...'
expected: backend=webgpu or backend=webgl2 is reported, and the stage renders either way
result: [pending]

### 2. REVIEW item 1 steps 2-5: pen feel. ink S-curve, lead S-curve, rust and clay one stroke each, ink feather-to-full pressure
expected: ink follows closely; lead visibly lags, its spring stretches and it cuts corners; rust and clay lag in between, each in its own colour; disc size grows with pressure
result: [pending]

### 3. REVIEW item 1 step 6: draw a lead stroke across an earlier ink stroke
expected: The later stroke is drawn on top
result: [pending]

### 4. REVIEW item 1 step 7: select ink, set mass 8, Save as new version, paint, compare with earlier v1 strokes
expected: The select shows 'v5 ink m=8'; v5 lags more than v1; earlier v1 strokes are unchanged
result: [pending]

### 5. REVIEW item 1 step 8: click Verify replay in Tapestry after painting
expected: replay: MATCH (tick N, nodes M)
result: [pending]

### 6. REVIEW item 1 steps 9-10: pen latency on both transports, and 20 open/close cycles inside Tapestry
expected: Four latency numbers recorded; still painting on the 20th open with no 'Too many active WebGL contexts'
result: [pending]

### 7. Pen re-measurement (01-06 open item): attach a pen tablet to this Mac and run the PenMeasure overlay (M key) inside Tapestry, then update PEN_FACTS
expected: pointerType 'pen', pressure range and distinct count, tilt presence and sign, twist, eraser buttons (32 assumed) measured. DEFAULT_SETTINGS.allowMouse then becomes false (pen-only by default, as CANV-02 and SC2 intend)
result: [pending]

### 8. Review the 9 flagged prohibitions (table 'Prohibitions' in the report): 4 judgment-tier with a non-authoritative LLM verdict, and 5 test-tier with no wired enforcing test
expected: Each is accepted as holding, or a test is added (e.g. extend forbidden_tokens.cmake to scan for chrono/clock/time( in the sim and float/<random> in sim tests)
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
