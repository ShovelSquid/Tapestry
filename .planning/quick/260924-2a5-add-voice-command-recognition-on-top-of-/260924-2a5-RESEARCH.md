# Quick Task: Voice Command Recognition on Top of Whisper Transcription - Research

**Researched:** 2026-09-24
**Domain:** In-browser NLP intent classification (transformers.js), integration with an already-planned Whisper ASR swap
**Confidence:** HIGH

<user_constraints>
## User Constraints (from task prompt — no CONTEXT.md exists for this quick task)

### Locked Decisions
- Swap `transcribe.js` from Web Speech API to the local offline Whisper engine already researched in `.planning/quick/260924-1yu-.../260924-1yu-RESEARCH.md` (sibling worktree `hands-face-voice`, ws/hands-face-voice-gesture-capture) — engine choice, version pin, VAD approach, and the `startTranscription({onFinal,onInterim,onError})` interface are locked; do not re-litigate.
- Fixed 5-command set: **start recording, stop recording, save file to \<name\>, start microphone, start landmarks**.
- On-device intent classifier with a confidence threshold gating direct execution vs. a clarification prompt.
- Wire commands to existing `main.js` button handlers, extracted into named functions.
- **Kaelen's decision:** "save file to \<name\>" sets a custom recording base name in `record.js` rather than invoking the folder picker — the picker requires a real user gesture that a voice command cannot supply.

### Claude's Discretion
- Which classification technique (zero-shot-classification vs. embedding similarity) to use.
- Exact confidence threshold value(s), example-phrase sets per command, and slot-extraction heuristic for the file name.
- Whether/how the intent classifier taps the transcript stream vs. opening its own audio path (research finding: it should not need its own audio path at all — see Architecture Patterns).

### Deferred Ideas (OUT OF SCOPE)
- Re-researching the Whisper ASR swap itself (locked by sibling research).
- Wake-word/always-listening design beyond what "start microphone" already implies (see Pitfall 4 — flagged as an open architectural contradiction, not solved here).
- Folder-picker automation via voice (explicitly rejected by Kaelen).
</user_constraints>

## Summary

The sibling research (`260924-1yu-RESEARCH.md`) locks in `@huggingface/transformers` pinned to `4.2.0`, loaded via CDN import map, running `onnx-community/whisper-tiny.en` for ASR with `startTranscription({onFinal, onInterim, onError})` calling `onFinal(text)` once per detected utterance (batch, not streaming — no word-by-word partials). This task's classifier sits **entirely on the text side** of that boundary: it takes the string passed to `onFinal` and maps it to one of 5 commands. It needs **no new microphone stream, no new `getUserMedia` call, and no new audio pipeline** — it is a second transformers.js pipeline running on CPU-cheap text input, wired into the same callback `main.js` already receives from `transcribe.js`.

Comparing the two candidate techniques: `zero-shot-classification` (`Xenova/mobilebert-uncased-mnli`, ~26MB q8) runs the NLI model **once per candidate label** — 5 forward passes per utterance for this 5-command set `[CITED: huggingface.co/docs/transformers.js/en/api/pipelines — ZeroShotClassificationPipeline: "For each candidate label ... runs the NLI model on the input text paired with this hypothesis"]`. `feature-extraction` embedding similarity (`Xenova/all-MiniLM-L6-v2`, ~23MB q8) needs exactly **one forward pass** per utterance (embed the transcript once; compare by cheap cosine similarity against a small set of precomputed reference-phrase embeddings, computed once at load time). Given this classifier runs alongside — not instead of — the Whisper ASR pipeline on every detected utterance, the 5x-fewer-inferences embedding approach is the better fit for keeping voice-command latency low in a browser CPU/WASM environment. **Recommend embedding similarity**, not zero-shot-classification.

**Primary recommendation:** `@huggingface/transformers@4.2.0` (already pinned by sibling research — no new npm package) running `pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" })`. Precompute embeddings for 3-5 example phrasings per command at classifier init; for each `onFinal` transcript, embed it once, cosine-compare against every reference embedding, take the max score per command; execute directly above a confidence threshold, otherwise prompt for clarification. Slot extraction for "save file to \<name\>" is a plain string heuristic (substring-after-trigger-phrase), not a second ML step.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ASR (Whisper transcription) | Browser / Client (WASM) | — | Locked by sibling research; unchanged by this task |
| Intent classification (text → 1-of-5 command) | Browser / Client (WASM) | — | Runs on `onFinal` transcript text; a second transformers.js pipeline, same tier as ASR, no server exists in this playground |
| Confidence gating (execute vs. clarify) | Browser / Client | — | Pure JS comparison against a threshold constant; no inference needed beyond the classifier's own score |
| Slot extraction (file name from "save file to X") | Browser / Client | — | Plain string manipulation on the already-classified utterance; not a model concern |
| Command dispatch to button handlers | Browser / Client | — | Calls the same named functions `main.js`'s click listeners call — single source of truth for "what each command does" |
| Reference-phrase embeddings (5 commands' example set) | Browser / Client (computed once at load) | — | Computed once when the classifier pipeline loads, cached in memory for the session; not persisted, not a build-time asset |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@huggingface/transformers` | `4.2.0` (pinned — reuses sibling research's exact pin, no new npm package) | Runs the `feature-extraction` pipeline for sentence embeddings, same package already loading Whisper | Already vetted in `260924-1yu-RESEARCH.md`'s Package Legitimacy Audit `[VERIFIED: npm registry — package-legitimacy check, 2,329,177/wk downloads, github.com/huggingface/transformers.js]`; do not add a second inference library when one already covers both tasks |
| Model: `Xenova/all-MiniLM-L6-v2` | ONNX export, q8 quantized (`model_quantized.onnx`, 22,972,370 bytes ≈ 21.9 MiB) | 384-dim sentence embedding model for computing utterance similarity to reference command phrasings | Standard, widely-used compact sentence-transformer for in-browser semantic similarity; 3,212,168 downloads on the Hub `[VERIFIED: huggingface.co/api/models/Xenova/all-MiniLM-L6-v2 — downloads and per-file byte sizes fetched directly, 2026-09-24]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None — cosine similarity is ~10 lines of vanilla JS (dot product / (norm·norm)) | — | Compares the live utterance embedding against precomputed reference embeddings | Do not pull in a vector-math library for a 5-label, single-utterance-at-a-time comparison; this is not a search-index-scale problem |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Embedding similarity (`feature-extraction`) | `zero-shot-classification` with `Xenova/mobilebert-uncased-mnli` | **Rejected as primary.** Runs the NLI model once per candidate label — 5 forward passes per utterance for this label set `[CITED: huggingface.co/docs/transformers.js/en/api/pipelines]` — vs. embedding similarity's 1 forward pass. Model is comparably sized (q8 ≈ 25.2 MiB, 26,437,902 bytes int8 `[VERIFIED: huggingface.co/api/models/Xenova/mobilebert-uncased-mnli — per-file byte sizes fetched directly, 2026-09-24]`, and less-downloaded: 15,972/wk vs. 3.2M/wk for all-MiniLM-L6-v2) so there is no size advantage to offset the 5x latency cost. Zero-shot's built-in softmax-normalized scores (sum to 1 across labels when `multi_label: false`) are a genuinely more "calibrated" confidence signal than raw cosine similarity — worth reconsidering only if embedding-similarity confidence proves too noisy in practice (see Assumptions Log A2). |
| Precomputed example-phrase embeddings | A trained few-shot classifier head | **Rejected.** No training step exists or is warranted for 5 fixed, well-known commands; hand-writing 3-5 example phrasings per command and embedding them once at load time is the appropriately-scoped solution, not a model-training exercise. |
| String-heuristic slot extraction for "save file to \<name\>" | A `token-classification`/NER pipeline to extract the name span | **Rejected.** NER pipelines are built for open-domain named-entity spans (person, org, location); a spoken file name after a fixed trigger phrase ("save file to", "save file as", "name the file") is not an entity-recognition problem — it is "everything after the matched trigger substring." Adding a third ML pipeline for this is unjustified complexity. `[ASSUMED — reasoned from the phrase's fixed grammar, not benchmarked against transformers.js's token-classification pipeline this session]` |

**Installation:** No new npm install or CDN entry beyond what the sibling research already adds — reuse the same import map entry:
```html
<script type="importmap">
{
  "imports": {
    "@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0"
  }
}
</script>
```
```js
// src/commands.js (new file)
import { pipeline } from "@huggingface/transformers";

let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  }
  return embedderPromise;
}
```

**Version verification:** `npm view @huggingface/transformers version` → `4.3.0` (latest) `[VERIFIED: npm registry, 2026-09-24]` — confirms the sibling research's pin (`4.2.0`) is still the second-most-recent minor and still resolvable from the CDN; no change to that pin is needed for this task. The `feature-extraction` pipeline task has existed in transformers.js since its earliest releases (predates the `4.x` line) — no version-specific feature gate applies.

## Package Legitimacy Audit

No new npm package is introduced by this task — it reuses `@huggingface/transformers@4.2.0`, already audited (verdict: **SUS** — flagged solely for the newest published version's recency, not the package itself; disposition: kept, pinned to `4.2.0`, gated behind `checkpoint:human-verify`) in `260924-1yu-RESEARCH.md`. That audit and its checkpoint requirement carry forward unchanged; do not re-run it.

This task does add one new **model repo** reference (not an npm package, so outside the npm/PyPI/crates legitimacy gate, but audited here on the same evidentiary basis the sibling research used for `onnx-community/whisper-tiny.en`):

| Model repo | Registry | Downloads | Last Modified | Verdict | Disposition |
|------------|----------|-----------|----------------|---------|-------------|
| `Xenova/all-MiniLM-L6-v2` | Hugging Face Hub | 3,212,168 | 2025-07-22 | OK (by the same download/maturity heuristics the sibling gate applied) | Approved `[VERIFIED: huggingface.co/api/models/Xenova/all-MiniLM-L6-v2 — fetched directly, 2026-09-24]` |
| `Xenova/mobilebert-uncased-mnli` (rejected alternative, not used) | Hugging Face Hub | 15,972 | 2025-07-11 | OK | Not used — rejected on latency grounds, not legitimacy (see Alternatives Considered) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none new — `@huggingface/transformers` itself is already flagged and dispositioned in the sibling research; the planner does not need a second `checkpoint:human-verify` for the same package.

## Architecture Patterns

### System Architecture Diagram
```
[transcribe.js: startTranscription()]
        |
        | onFinal(text)  <-- fires once per completed Whisper utterance
        v
[main.js: handleTranscriptFinal(text)]
        |
        +--> append text to #transcriptFinal  (existing behavior, unchanged)
        |
        v
[commands.js: classifyIntent(text)]
        |
   embed(text) via feature-extraction pipeline  (1 forward pass)
        |
   cosine-compare vs 5 precomputed command-phrase embedding sets
        |
   pick best command + its confidence score
        |
        +---- score >= threshold ----> dispatch to the matching named
        |                              handler already used by the button
        |                              (handleStartCamera / handleStartMic /
        |                               handleStartRecording / handleStopRecording /
        |                               setRecordingBaseName(slot))
        |
        +---- score < threshold  ----> show "did you mean: <top command>?"
                                        clarification prompt (no execution)
```
A reader can trace one spoken command end-to-end: Whisper's `onFinal` text → embed once → compare to 5 reference sets → threshold gate → either call the exact same function the button's `click` listener calls, or surface a clarification. No new audio stream appears anywhere in this diagram.

### Recommended Project Structure
```
hands-face-voice/src/
├── transcribe.js   # Whisper swap per sibling research — UNCHANGED by this task
├── voice.js        # UNCHANGED
├── record.js       # ADD: setRecordingBaseName(name) export; sessionBaseName() consults an override
├── commands.js     # NEW: classifyIntent(text) -> {command, confidence, slot?}; owns the embedder + reference phrases
└── main.js         # REFACTOR: extract each click-listener body into a named async function;
                     # wire transcribe.js's onFinal to also call classifyIntent() and dispatch
```

### Pattern 1: Reuse one embedder instance; precompute reference embeddings once
**What:** Load the `feature-extraction` pipeline once (module-level memoized promise, same pattern as sibling research's ASR pipeline), and embed each command's example phrases exactly once at that same load time — not per utterance.
**When to use:** Always. Re-embedding the fixed reference phrases on every spoken utterance wastes 5 forward passes reproducing embeddings that never change during the session.
**Example:**
```js
// src/commands.js
import { pipeline } from "@huggingface/transformers";

const COMMAND_EXAMPLES = {
  startRecording: ["start recording", "begin recording", "record now"],
  stopRecording: ["stop recording", "end recording", "stop"],
  saveFileTo: ["save file to", "save the file as", "name the file", "call the file"],
  startMicrophone: ["start microphone", "turn on the mic", "start the mic"],
  startLandmarks: ["start camera", "start landmarks", "turn on hand tracking", "start hands and face"],
};

let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  }
  return embedderPromise;
}

let referenceEmbeddingsPromise = null;
async function getReferenceEmbeddings() {
  if (!referenceEmbeddingsPromise) {
    const embed = await getEmbedder();
    referenceEmbeddingsPromise = (async () => {
      const out = {};
      for (const [command, phrases] of Object.entries(COMMAND_EXAMPLES)) {
        out[command] = await Promise.all(
          phrases.map((p) => embed(p, { pooling: "mean", normalize: true }))
        );
      }
      return out;
    })();
  }
  return referenceEmbeddingsPromise;
}
```
*Source: `pooling`/`normalize` options and the mean-pooled sentence-embedding pattern are the standard transformers.js `feature-extraction` usage documented across the Hub's model cards for sentence-transformer ONNX exports `[CITED: huggingface.co model-card conventions for Xenova/all-MiniLM-L6-v2 and general transformers.js feature-extraction usage — MEDIUM confidence, not a single official vanilla-JS doc page]`.*

### Pattern 2: Cosine similarity gate, not a second model call
**What:** Compare the live utterance's embedding to every precomputed reference embedding via cosine similarity; take the max per command; the overall winner's score is the "confidence."
**When to use:** Every `onFinal` transcript once the mic/transcription pipeline is running.
**Example:**
```js
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const CONFIDENCE_THRESHOLD = 0.65; // tunable — see Assumptions Log A2

export async function classifyIntent(text) {
  const embed = await getEmbedder();
  const refs = await getReferenceEmbeddings();
  const [utteranceEmbedding] = await embed(text, { pooling: "mean", normalize: true });

  let best = { command: null, score: -Infinity };
  for (const [command, embeddings] of Object.entries(refs)) {
    for (const ref of embeddings) {
      const score = cosineSimilarity(utteranceEmbedding.data, ref[0].data);
      if (score > best.score) best = { command, score };
    }
  }

  const slot =
    best.command === "saveFileTo" ? extractSlotAfterTrigger(text, COMMAND_EXAMPLES.saveFileTo) : undefined;

  return { ...best, confident: best.score >= CONFIDENCE_THRESHOLD, slot };
}
```

### Pattern 3: Slot extraction is a string heuristic, not a model call
**What:** For `saveFileTo`, find whichever trigger phrase from `COMMAND_EXAMPLES.saveFileTo` appears in the lowercased transcript and take everything after it as the raw file-name slot; trim and sanitize before handing to `record.js`.
**When to use:** Only after `classifyIntent` has already decided the command is `saveFileTo` above threshold — never runs a model, only string ops on text already in hand.
**Example:**
```js
function extractSlotAfterTrigger(text, triggerPhrases) {
  const lower = text.toLowerCase();
  for (const phrase of triggerPhrases) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) {
      return text.slice(idx + phrase.length).trim();
    }
  }
  return "";
}
```

### Anti-Patterns to Avoid
- **Re-embedding the 5 commands' reference phrases on every utterance:** wastes 5 forward passes reproducing values that never change; precompute once (Pattern 1).
- **Opening a third `getUserMedia` stream for "always-on" command listening:** the classifier consumes text already produced by `transcribe.js`'s `onFinal` — it needs no audio access of its own. See Pitfall 3.
- **Treating cosine similarity as a calibrated probability:** unlike zero-shot's softmax-normalized scores, cosine similarity is not bounded to a probability distribution across the 5 commands; the threshold is an empirically-tuned cutoff, not a statistically principled cut point (see Assumptions Log A2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sentence embedding computation, ONNX session management | A custom embedding model loader | `@huggingface/transformers`'s `pipeline("feature-extraction", ...)` | Same reasoning as the sibling research's ASR recommendation — the library owns tokenization, model download/caching, and WASM session lifecycle |
| Vector comparison for 5 fixed labels | A vector database / ANN index (e.g. a WASM port of FAISS/HNSW) | Plain cosine similarity in a `for` loop over ≤ 20 reference vectors | This is a fixed, tiny (5-command × 3-5 phrases) comparison set re-run per utterance — an index structure solves a scale problem that does not exist here |

**Key insight:** The ML-heavy part of this task (running a real embedding model in-browser) is already solved by the same library the sibling research adopted for Whisper. The actual design work is architectural — routing text through one shared callback path, keeping slot extraction as cheap string logic, and picking a technique (embeddings) that keeps per-utterance latency to a single forward pass instead of five.

## Common Pitfalls

### Pitfall 1: Loading two transformers.js pipelines on the same page
**What goes wrong:** Assuming a second `pipeline()` call conflicts with, blocks, or must wait for the first (Whisper ASR) pipeline's ONNX Runtime Web session.
**Why it happens:** Both pipelines use ONNX Runtime Web under the hood; it's reasonable to wonder if only one WASM backend/session can be active per page.
**How to avoid:** Transformers.js supports multiple independent pipelines (different tasks and/or models) concurrently in the same page — each `pipeline()` call creates its own ONNX Runtime Web session; sessions do not share or conflict with each other. Load both pipelines with `await Promise.all([getAsrPipeline(), getEmbedder()])` at startup or lazily on first use — either way, the only real cost is additive: two model downloads and two resident WASM sessions in memory rather than one. `[ASSUMED — reasoned from transformers.js's documented pattern of multiple independent `pipeline()` instances coexisting (e.g. published multi-task browser demos combining ASR + text pipelines); not verified this session against an official "two pipelines on one page" doc page]`
**Warning signs:** If total page memory or the combined model download noticeably stalls startup, that is the additive cost showing up, not a conflict — the fix is lazy-loading the classifier pipeline only after the user first starts the mic, not troubleshooting a "session conflict."

### Pitfall 2: Combined model download/load time before commands work
**What goes wrong:** Whisper (`whisper-tiny.en` q8, ~41 MB per sibling research) plus the embedding model (`all-MiniLM-L6-v2` q8, ~21.9 MB `[VERIFIED: huggingface.co/api/models/Xenova/all-MiniLM-L6-v2, 2026-09-24]`) together are a first-load download of roughly **~63 MB**, all before "start microphone" produces its first transcribed command.
**Why it happens:** Both models are needed for the full voice-command pipeline to function (transcription, then classification), and neither can meaningfully run without the other once the feature is live.
**How to avoid:** Both are cached in browser Cache Storage after first load (same mechanism the sibling research verified for Whisper `[CITED: huggingface/skills repo, skills/transformers-js/references/CACHE.md]`), so this cost is paid once per browser profile, not per session. Consider starting the classifier's model load in parallel with the ASR model load (both kick off as soon as "start microphone" is clicked) rather than sequentially, to minimize wall-clock wait.
**Warning signs:** A long delay between clicking "Start microphone" and the first voice command being recognized, specifically on a cold cache (first-ever run).

### Pitfall 3: Assuming the classifier needs its own microphone stream
**What goes wrong:** Building `commands.js` to independently call `getUserMedia` and run its own VAD, duplicating the audio pipeline `transcribe.js` already owns — becoming the "third redundant mic stream" the task explicitly warns against.
**Why it happens:** It's easy to think of "voice command recognition" as its own audio-consuming feature rather than a downstream consumer of text `transcribe.js` already produces.
**How to avoid:** The classifier's only input is the string `transcribe.js` passes to `onFinal` — wire `main.js`'s existing `onFinal` callback to call `classifyIntent(text)` in addition to (not instead of) appending it to `#transcriptFinal`. No new stream, no new VAD, no new `AudioContext`. This resolves the open question from the sibling research about a third mic stream: there isn't one to avoid, because the classifier operates purely on text.
**Warning signs:** A code review finding `getUserMedia` called anywhere in `commands.js` is the signal this pitfall was hit.

### Pitfall 4: "Start microphone" is structurally unreachable by voice
**What goes wrong:** The fixed command set includes "start microphone," but voice commands can only be heard once `transcribe.js`'s pipeline is already running — which itself only starts when the user clicks the "Start microphone" button (`main.js`'s `startMicBtn` click handler starts both `voice.js`'s waveform and `transcribe.js`'s transcription together, per current wiring `[VERIFIED: hands-face-voice/src/main.js:40-70]`). A user cannot say "start microphone" to start the microphone, because nothing is listening for their voice until the microphone is already started.
**Why it happens:** This is the same class of problem as the folder-picker/user-gesture constraint Kaelen already resolved for "save file to \<name\>" — starting audio capture is gated behind a manual click, and no command-listening path exists before that click.
**How to avoid:** This is not solvable within this task's scope (it would require a second, always-on low-power listening mode that Kaelen has not asked for — see Deferred Ideas). Flag explicitly for the planner: either (a) keep "start microphone" in the fixed label set for symmetry/training balance but document it as unreachable via voice in practice (a `checkpoint:human-verify` UAT note, not a bug), or (b) confirm with Kaelen whether "start microphone" should instead be reachable only from a state where camera/landmarks are already running (still requires *some* audio path active, which doesn't exist independent of the mic button) — no camera-only audio path exists (`hands-face.js`'s `getUserMedia` call requests `video` only, no `audio` `[VERIFIED: hands-face-voice/src/hands-face.js:20-22]`). Recommend (a): document the limitation rather than build new architecture to solve it.
**Warning signs:** A UAT session where the tester tries saying "start microphone" before ever clicking any button and is confused why nothing happens.

### Pitfall 5: File-name slot may contain filesystem-invalid characters
**What goes wrong:** Whisper transcribes "save file to my cat's birthday" and the raw slot `"my cat's birthday"` (or any transcript containing `/`, `:`, leading/trailing spaces, or other characters invalid in a filename) is passed straight to `record.js`'s `getFileHandle`, which throws or silently produces an unexpected file name.
**Why it happens:** Speech transcripts are free text; the File System Access API's `getFileHandle` enforces OS-level filename validity (no `/`, no leading `.` in some contexts, etc.) that spoken phrases don't naturally respect.
**How to avoid:** Sanitize the extracted slot before use as a base name — lowercase, replace whitespace runs with `-`, strip characters outside `[a-z0-9-_]`, and fall back to the existing timestamp-based `sessionBaseName()` if sanitization leaves an empty string. `[ASSUMED — general filesystem-safe-name reasoning, not verified against a specific browser/OS combination this session]`
**Warning signs:** `startRecording()` throwing on `getFileHandle` immediately after a "save file to" voice command with an unusual phrase.

## Code Examples

### Extracting `main.js`'s anonymous click handlers into named functions
```js
// src/main.js — BEFORE (current, per hands-face-voice/src/main.js:21-38)
startCameraBtn.addEventListener("click", async () => { /* ... */ });

// AFTER — named function, reusable from both the button and voice dispatch
async function handleStartCamera() {
  startCameraBtn.disabled = true;
  statusEl.textContent = "loading hand/face models...";
  try {
    const scene3D = createScene3D(document.getElementById("scene3d"));
    await startHandsAndFace({ /* ...unchanged... */ });
    statusEl.textContent = "camera running";
  } catch (err) {
    startCameraBtn.disabled = false;
    statusEl.textContent = "camera failed";
    showError("Camera/tracking", err);
  }
}
startCameraBtn.addEventListener("click", handleStartCamera);
```
*Source: existing handler body verified at `hands-face-voice/src/main.js:21-38` — extraction preserves logic verbatim, only wraps it in a named declaration.*

### `record.js` — accepting a base-name override
```js
// src/record.js — ADD (existing sessionBaseName at hands-face-voice/src/record.js:27-29)
let baseNameOverride = null;

export function setRecordingBaseName(name) {
  baseNameOverride = sanitizeBaseName(name);
}

function sanitizeBaseName(raw) {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
  return cleaned || null;
}

function sessionBaseName() {
  if (baseNameOverride) {
    const name = baseNameOverride;
    baseNameOverride = null; // one-shot: consumed by the next recording, then reverts to timestamp
    return name;
  }
  return `session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}
```
*Source: existing `sessionBaseName()` verified verbatim at `hands-face-voice/src/record.js:27-29`, quoted: `return \`session-${new Date().toISOString().replace(/[:.]/g, "-")}\`;` — the override is additive, the timestamp fallback path is unchanged.*

## Runtime State Inventory

Not applicable — this is a greenfield feature addition (new classifier module, function extraction, one new exported setter), not a rename/refactor/migration of existing identifiers or stored data.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Multiple concurrent transformers.js `pipeline()` instances (ASR + feature-extraction) coexist without session conflicts, only additive memory/load cost | Common Pitfalls, Pitfall 1 | If pipelines do in fact contend for a shared WASM resource in some browser, both could slow down or one could fail to load; planner should smoke-test loading both pipelines together early rather than assuming it Just Works |
| A2 | Cosine similarity threshold of ~0.65 (illustrative, not tuned) will meaningfully separate "confident match" from "needs clarification" across the 5 commands and realistic Whisper transcription noise | Architecture Patterns Pattern 2, Code Examples | If real transcripts (with Whisper's occasional mis-transcriptions) cluster too close to or below threshold, either false clarifications (annoying) or false direct-executions (worse — wrong command runs) result; needs empirical tuning against real mic input during implementation, not fixed by this research |
| A3 | A one-shot "consume the base-name override on next recording, then revert to timestamp" semantic is the right behavior for `setRecordingBaseName` | Code Examples (`record.js`) | If Kaelen instead wants the override to persist across multiple recordings until explicitly changed, the one-shot reset is wrong and recordings after the first would silently revert to timestamps unexpectedly — flag for confirmation during planning/discuss-phase |
| A4 | Loading two transformers.js pipelines in parallel (`Promise.all`) rather than sequentially is safe and desirable | Pitfall 2 | If simultaneous model downloads cause resource contention (unlikely for plain HTTP fetches, but unverified), sequential loading with clear "loading X, then Y" status text would be a safer fallback |
| A5 | Simple string-heuristic slot extraction (substring after trigger phrase) is sufficient and there is no better-supported transformers.js pattern for this specific "capture everything after a fixed phrase" need | Alternatives Considered, Pattern 3 | If spoken trigger phrases vary more than the fixed example list captures (e.g. "call this file..." not in the list), extraction could silently return an empty or wrong slot; mitigated by keeping the trigger-phrase list broad and by Pitfall 5's sanitize-or-fallback behavior |

**If this table is empty:** N/A — see entries above; all require confirmation or empirical tuning before being treated as locked decisions.

## Open Questions

1. **Should "start microphone" remain in the voice-command label set given it's structurally unreachable by voice?**
   - What we know: The mic must already be running (via manual button click) for any voice command — including "start microphone" — to be heard at all (Pitfall 4).
   - What's unclear: Whether Kaelen wants this documented as a known limitation, removed from the label set, or addressed by a future always-on listening mode (out of scope here).
   - Recommendation: Keep it in the label set (for classifier symmetry / future-proofing) but document the limitation explicitly in code comments and flag it as a UAT note, not a bug.

2. **Base-name override lifetime: one-shot or persistent?**
   - What we know: `record.js` currently has no override mechanism at all; this research proposes one-shot consumption (Assumption A3).
   - What's unclear: Product intent for repeated recordings after one "save file to X" command.
   - Recommendation: Default to one-shot per A3; planner/discuss-phase should confirm with Kaelen if this surfaces as ambiguous during task breakdown.

3. **Confidence threshold and reference-phrase set need empirical tuning against a real mic, same as the sibling research's VAD threshold (its own Open Question 2).**
   - What we know: Cosine similarity is a real but uncalibrated signal; a fixed illustrative threshold (0.65) is a starting point, not a measured value.
   - What's unclear: Real Whisper-transcription-noise behavior against the chosen embedding model, which can only be measured at implementation time with a real mic.
   - Recommendation: Leave the threshold as a documented, tunable constant (matching the sibling research's approach to VAD constants); do not hardcode without a comment.

## Environment Availability

Not applicable beyond what the sibling research already covers (browser WASM + Web Audio API support, `npx serve .` COOP/COEP absence, network required for first-time model download) — this task adds no new environment dependency; it reuses the same `@huggingface/transformers` runtime already being loaded for Whisper.

## Validation Architecture

`.planning/config.json` has `workflow.nyquist_validation: true` `[VERIFIED: /Users/kaelencook/Tapestrees/voice-processing/.planning/config.json]`, but `hands-face-voice/` has no `package.json` and no test framework `[VERIFIED: hands-face-voice/ directory listing — index.html, README.md, src/ only, no package.json]`, consistent with the sibling research's finding for the same playground.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | none — manual verification playground |
| Config file | none |
| Quick run command | Load the page, click "Start microphone," speak each of the 5 commands, observe dispatch |
| Full suite command | Same manual pass, plus: speak an out-of-vocabulary phrase and confirm a clarification prompt (not a wrong-command execution) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| — | Say "start recording" while camera+mic running → recording starts | manual | — | ❌ Wave 0 (no test infra) |
| — | Say "save file to test session" → next recording's file is named `test-session.webm` (sanitized) | manual | — | ❌ Wave 0 |
| — | Say an ambiguous/unrelated phrase → clarification shown, no command executed | manual | — | ❌ Wave 0 |
| — | Whisper + classifier pipelines both load without console errors on "Start microphone" click | manual (DevTools console) | — | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Manual smoke test of the specific command just wired.
- **Per wave merge:** Full 5-command manual pass plus one out-of-vocabulary phrase.
- **Phase gate:** All 5 commands dispatch correctly and clarification fires appropriately before calling this done.

### Wave 0 Gaps
- No test framework exists in `hands-face-voice/` (no `package.json`) — same gap the sibling research identified. Given this is a static-file playground, adding a test framework is out of scope for this quick task; manual verification is the appropriate substitute, matching how the rest of this playground's features are verified.

## Security Domain

Not applicable — this is a local-only, offline, client-side static-file playground with no authentication, session, network API surface, or stored user data beyond local recordings the user already controls via the File System Access API (existing `record.js` behavior, unchanged in kind by this task). No new ASVS category is introduced by adding a second in-browser ML pipeline and a string-classification dispatch layer.

## Sources

### Primary (HIGH confidence)
- Direct file reads: `hands-face-voice/src/transcribe.js`, `main.js`, `voice.js`, `record.js`, `hands-face.js`, `index.html`
- `260924-1yu-RESEARCH.md` (sibling worktree, read in full) — locks the Whisper engine, version pin, and `startTranscription` interface this research builds on
- `npm view @huggingface/transformers version` — confirms `4.2.0` pin still valid against current registry state
- `huggingface.co/api/models/Xenova/all-MiniLM-L6-v2` and `.../Xenova/mobilebert-uncased-mnli` — direct API fetches for downloads, last-modified dates, and per-file ONNX byte sizes

### Secondary (MEDIUM confidence)
- `huggingface.co/docs/transformers.js/en/api/pipelines` — ZeroShotClassificationPipeline mechanism (once-per-label NLI scoring), fetched via WebFetch
- WebSearch results on transformers.js `feature-extraction` + cosine similarity patterns (MachineLearningMastery, Hugging Face skills repo) — confirms the pooling/normalize/cosine-similarity pattern is standard practice, not a single official "vanilla JS intent classifier" doc page

### Tertiary (LOW confidence)
- None specific to this task beyond what's flagged inline as `[ASSUMED]` in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — model existence, download counts, and exact ONNX file sizes directly verified against the Hugging Face Hub API; no new npm package introduced (reuses sibling's already-audited pin)
- Architecture: HIGH for "no new audio stream needed" (directly reasoned from verified file contents of `transcribe.js`/`main.js`/`hands-face.js`); MEDIUM for exact `feature-extraction` API usage pattern (pooling/normalize options), reconstructed from Hub conventions and secondary sources, not a single official code sample
- Pitfalls: HIGH for the "start microphone is unreachable by voice" structural finding (directly verified from existing click-handler wiring and camera's video-only stream); MEDIUM/ASSUMED for multi-pipeline coexistence and exact confidence threshold tuning, both flagged for implementation-time verification

**Research date:** 2026-09-24
**Valid until:** ~30 days (JS ML tooling and HF model download counts move fast; re-verify `Xenova/all-MiniLM-L6-v2` still resolves and `@huggingface/transformers` pin is still current before executing if used more than a few weeks after today)
