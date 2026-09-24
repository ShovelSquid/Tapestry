# Quick Task: Local Offline In-Browser Speech-to-Text - Research

**Researched:** 2026-09-24
**Domain:** Browser-based offline speech recognition (WASM/ONNX ML in a no-build static page)
**Confidence:** HIGH

## Summary

Use **Transformers.js (`@huggingface/transformers`) running `onnx-community/whisper-tiny.en`** via ONNX Runtime Web (WASM backend), loaded straight from the jsDelivr CDN as an ES module — no build step required. This replaces the cloud-dependent Web Speech API in `transcribe.js` with something that satisfies the spike manifest's "no upload to a cloud service" requirement `[VERIFIED: .planning/spikes/MANIFEST.md:51]`: *"Recordings and any derived landmark/label data stay local to the device — no upload to a cloud service — even though this research pipeline ... persists raw frames, not just derived intents (Kaelen, 2026-09-24; extends the workstream's original offline/privacy stance in `hands-face-voice/README.md`)"*.

Whisper is not a streaming model — it transcribes fixed audio buffers. The current `startTranscription({ onFinal, onInterim, onError })` interface `[VERIFIED: hands-face-voice/src/transcribe.js:8]` cannot be given true word-by-word `onInterim` results from this engine the way Web Speech API provides them. The new engine must instead segment continuous mic audio into short utterances using simple silence-based VAD (amplitude threshold on an AnalyserNode, which this codebase already builds elsewhere in `voice.js`), and call `onFinal` once per detected utterance. `onInterim` should either be dropped or repurposed to show "listening..." / "transcribing..." status text rather than partial words — the planner must set this expectation explicitly rather than assume parity with Web Speech API.

**Primary recommendation:** `@huggingface/transformers` (pin to `4.2.0`, not `@latest`/`4.3.0` — see Package Legitimacy Audit) + `onnx-community/whisper-tiny.en` (q8/int8 quantized, ~41 MB total), loaded via CDN ESM import, driven by a hand-rolled amplitude-based VAD segmenter feeding 16kHz Float32Array chunks into the ASR pipeline.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mic capture + PCM buffering | Browser / Client | — | Already the pattern in `voice.js` (getUserMedia + AudioContext); no server exists in this playground |
| Voice activity detection (utterance segmentation) | Browser / Client | — | Must run on the live audio stream in real time; no backend to delegate to |
| Speech-to-text inference (Whisper) | Browser / Client (WASM) | — | Runs entirely client-side via ONNX Runtime Web; explicitly required to avoid any server/cloud tier per the locked "no upload" constraint |
| Model weight delivery | CDN / Static | Browser / Client | Model files (`.onnx`) are static assets fetched once from the HF Hub CDN, then cached client-side (Cache API) for all subsequent loads |
| Transcript UI rendering | Browser / Client | — | `#transcriptFinal`/`#transcriptInterim` spans already exist in `index.html`; no change to this tier |

There is no API/backend or Database tier in this playground (`npx serve .` is a static file server with no application logic) — everything below the UI is client-side WASM inference.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@huggingface/transformers` | 4.2.0 (pinned; latest is 4.3.0) | Runs Whisper ONNX models in-browser via ONNX Runtime Web | The de facto standard for in-browser HF model inference; formerly `@xenova/transformers`, merged into the official HF org package in 2024; 2.3M weekly downloads `[VERIFIED: npm registry — package-legitimacy check]` |
| Model: `onnx-community/whisper-tiny.en` | ONNX export, q8/int8 quantized | English-only Whisper tiny (39M params) — smallest Whisper variant, English-only avoids the multilingual head's extra decoder complexity | Smallest model with acceptable accuracy on short command phrases; the task's own bias ("smallest/fastest model reliable for short phrases, not biggest for general accuracy") points directly at `tiny.en` over `base`/`small` `[ASSUMED — accuracy for short command phrases specifically was not benchmarked this session; see Assumptions Log]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required beyond the browser's native `AudioContext`/`AnalyserNode` | — | VAD/segmentation can be hand-rolled with an amplitude threshold, reusing the pattern already in `voice.js` | Sufficient for short, clearly-bounded command phrases in a quiet-ish dev/testing environment; do not reach for a dedicated VAD library (e.g. Silero VAD via `@ricky0123/vad-web`) unless amplitude-threshold VAD proves too noisy in practice — that is added CDN/build surface for a quick task |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Transformers.js + Whisper | `vosk-browser` (WASM Kaldi) | **Rejected.** Last published 2022-12-25 — effectively unmaintained for ~4 years `[VERIFIED: npm registry — package-legitimacy check, publishedAt 2022-12-25T21:30:13Z]`. Kaldi-based models are smaller/faster but accuracy on short spontaneous command phrases is generally weaker than Whisper's, and the project shows no recent activity to fix regressions. |
| Transformers.js + Whisper | `whisper.cpp` WASM build (`ggml-org/whisper.cpp` `examples/whisper.wasm`) | **Rejected for this task.** No ready-to-use ESM CDN package — must be built from source with Emscripten (`emcmake cmake .. && make -j && make publish-npm`) `[CITED: github.com/ggml-org/whisper.cpp examples/whisper.wasm README]`. Violates the hard constraint that the library must be loadable via a plain CDN `<script type="module">` import with zero build step, exactly like `three.js`/MediaPipe are loaded today. |
| `whisper-tiny.en` | `whisper-base.en` (74M params) | Larger, somewhat more accurate on noisy/varied speech, but ~2x model size and slower inference for marginal gain on short, clear command phrases — not worth it for this use case. |

**Installation (no npm install — CDN-only, matching the existing importmap pattern):**
```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/",
    "@huggingface/transformers": "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0"
  }
}
</script>
```
```js
// src/transcribe.js
import { pipeline } from "@huggingface/transformers";
```

**Version verification:** `npm view @huggingface/transformers version` → `4.3.0` (latest), published 2026-09-16 `[VERIFIED: npm registry]`. Full version/publish history confirms `4.2.0` published 2026-04-22 — see Package Legitimacy Audit for why 4.2.0 is the recommended pin over `@latest`.

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----------------------|-----------|--------------|---------|-------------|
| `@huggingface/transformers` | npm | `4.3.0` published 2026-09-16 (8 days old at research time) | 2,329,177/wk | `github.com/huggingface/transformers.js` | **SUS** (reason: `too-new` — flags the most recent version's publish recency, not the package's overall maturity) | Flagged — keep, but pin to `4.2.0` (published 2026-04-22, ~5 months old) instead of `@latest`/`4.3.0` to clear the recency flag while staying on a current major version. Planner must add `checkpoint:human-verify` before the first install per protocol, even though downloads/repo signals are strongly legitimate. |
| `vosk-browser` | npm | `0.0.8` published 2022-12-25 | 15,995/wk | `github.com/ccoreilly/vosk-browser` | OK (by the gate's rules) | Not used — rejected on maintenance-recency grounds during comparison, not on legitimacy grounds (see Alternatives Considered). |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `@huggingface/transformers` — flagged solely because its newest published version (4.3.0, 8 days old) trips the gate's "too-new" heuristic; the package itself has 2.3M weekly downloads and a verified official GitHub org (`huggingface`). Recommend pinning the CDN URL to `4.2.0` and gating the first install behind `checkpoint:human-verify`.

## Architecture Patterns

### System Architecture Diagram
```
[Microphone] --getUserMedia--> [AudioContext @16kHz]
                                      |
                              [AnalyserNode / AudioWorklet]
                                      |
                         amplitude > threshold? ---no---> (keep buffering silence, discard)
                                      | yes
                         [accumulate Float32Array chunk]
                                      |
                    silence held for N ms (utterance end)?
                                      | yes
                         [pipeline('automatic-speech-recognition')]
                         (ONNX Runtime Web, WASM, in-browser)
                                      |
                              onFinal(text) --------> #transcriptFinal span
                                      |
                         (model weights cached in
                          browser Cache Storage after
                          first CDN download)
```
A reader can trace one command phrase end-to-end: mic -> AudioContext resampled to 16kHz -> VAD buffers the speech segment -> silence triggers a one-shot Whisper inference call -> `onFinal` fires -> UI updates. There is no `onInterim` mid-utterance signal in this pipeline (see Common Pitfalls).

### Recommended Project Structure
No new folders needed — this is a same-file replacement:
```
hands-face-voice/src/
├── transcribe.js   # REPLACE internals; keep exported startTranscription({onFinal, onInterim, onError}) shape
├── voice.js        # UNCHANGED reference pattern for AudioContext/AnalyserNode capture
└── main.js         # UNCHANGED — already wires startTranscription() to #transcriptFinal/#transcriptInterim
```

### Pattern 1: CDN ESM pipeline load + reuse across calls
**What:** Load the ASR pipeline once (async, cached by `pipeline()` internally) and reuse it for every subsequent utterance rather than re-instantiating per chunk.
**When to use:** Always — re-creating the pipeline reloads/reinitializes the ONNX session and is far slower than reusing one instance for the session's lifetime.
**Example:**
```js
// Source: https://huggingface.co/docs/transformers.js (CDN usage + ASR pipeline pattern)
import { pipeline } from "@huggingface/transformers";

let asrPipelinePromise = null;
function getAsrPipeline() {
  if (!asrPipelinePromise) {
    asrPipelinePromise = pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny.en",
      { dtype: "q8" } // quantized weights — smaller download, faster inference
    );
  }
  return asrPipelinePromise;
}
```

### Pattern 2: 16kHz capture via AudioContext sampleRate option
**What:** Request the AudioContext at 16000 Hz directly so the browser resamples mic input for you — Whisper's ONNX models expect 16kHz mono `Float32Array` input.
**When to use:** Any time raw mic PCM is fed to Whisper/transformers.js; do not feed the default 44.1/48kHz `AnalyserNode` buffer directly to the model.
**Example:**
```js
// Source: pattern verified via WebSearch against multiple transformers.js browser-mic tutorials (MEDIUM confidence — no single official "vanilla JS mic + Whisper" doc page was found this session)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
const source = audioCtx.createMediaStreamSource(stream);
// ... route through an AnalyserNode (amplitude/VAD) and an AudioWorkletNode or
// ScriptProcessorNode (deprecated but simplest) to accumulate Float32Array samples
```

### Anti-Patterns to Avoid
- **Re-instantiating `pipeline()` per utterance:** reloads the ONNX session every time; keep one long-lived pipeline instance for the whole recording session.
- **Feeding 44.1kHz/48kHz audio straight into the ASR pipeline:** Whisper's feature extractor expects 16kHz; skipping the resample step silently distorts frequency content and tanks accuracy.
- **Expecting word-level `onInterim` streaming:** this is a batch/chunked model, not a streaming recognizer; do not build UI or downstream logic (the future voice-command detection) that assumes continuously-updating interim text mid-phrase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ONNX model loading, tokenization, WASM session management | A custom ONNX Runtime Web wrapper | `@huggingface/transformers`'s `pipeline()` API | Handles model download/caching, tokenizer, feature extraction (mel spectrogram), and decoding correctly; this is exactly the deceptively-complex glue code the library exists to remove |
| Precise, general-purpose voice activity detection | A hand-tuned VAD from scratch beyond simple amplitude thresholding | Amplitude-threshold VAD is acceptable for THIS task (short, deliberate command phrases in a dev/test setting); if it proves unreliable later, reach for an established VAD model (e.g. Silero VAD) rather than iterating hand-tuned heuristics indefinitely | Full robustness (background noise, multiple speakers, etc.) is out of scope for this quick task — flagged as a follow-up risk, not solved here |

**Key insight:** The hard problem here isn't "run Whisper in a browser" — Transformers.js has solved that. The hard problem this task introduces is segmentation (turning a continuous mic stream into discrete utterances for a batch model), which has no off-the-shelf drop-in for this codebase's simplicity level; a minimal amplitude-VAD is the appropriate scope, not a library.

## Common Pitfalls

### Pitfall 1: Assuming `onInterim` will behave like Web Speech API
**What goes wrong:** Planner/executor builds UI or future command-detection logic assuming words appear incrementally as the user speaks.
**Why it happens:** The existing interface (`onFinal`/`onInterim`) and existing UI (`#transcriptInterim` italic span) were both designed around Web Speech API's true streaming behavior.
**How to avoid:** Explicitly redefine `onInterim` for the new engine as a coarse status signal (e.g., "listening…" while VAD detects speech, cleared when `onFinal` fires) rather than partial transcript text. Document this in code comments and in the caveat text (see Code Examples for the caveat replacement).
**Warning signs:** Any plan task that says "stream partial words to `onInterim`" for the local engine should be flagged/rejected.

### Pitfall 2: Missing COOP/COEP headers silently degrading (not breaking) performance
**What goes wrong:** Assuming ONNX Runtime Web either requires special server headers or is unaffected by them.
**Why it happens:** ONNX Runtime Web's WASM backend can use multi-threading via `SharedArrayBuffer`, which browsers only expose under cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`).
**How to avoid:** Confirmed via direct test — `npx serve .` (this project's exact dev command) does **not** send these headers by default `[VERIFIED: local curl test against npx serve, 2026-09-24 — response headers were Content-Type, Vary, Date, Connection, Keep-Alive, Transfer-Encoding only; no Cross-Origin-Opener-Policy or Cross-Origin-Embedder-Policy present]`. This means ONNX Runtime Web will fall back to **single-threaded WASM** automatically — it still works, just slower than a multi-threaded build would be. No code changes are required for correctness; this only affects inference latency. If `serve.json` were later added to set these headers, it would speed up inference, but that is optional, not required.
**Warning signs:** Noticeably slow (multi-second) transcription for a 2-3 word phrase would be the symptom to watch for if this degrades further than expected.

### Pitfall 3: Model re-downloading every page load
**What goes wrong:** ~41MB of ONNX weights re-fetched from the CDN on every reload, wasting bandwidth and adding load latency.
**Why it happens:** Assuming a static file server doesn't support the caching transformers.js relies on.
**How to avoid:** Transformers.js uses the browser's Cache Storage API by default (`env.useBrowserCache = true` is the default) `[CITED: huggingface/skills repo, skills/transformers-js/references/CACHE.md]` — this works transparently with any static HTTP server, including `npx serve .`, since caching happens client-side after the initial fetch. No server configuration is needed for caching to work; just don't set `env.useBrowserCache = false`.
**Warning signs:** DevTools Network tab showing the `.onnx` files re-downloading on every page load instead of returning from cache (`(from disk cache)`/`(from ServiceWorker)` style indicators) would indicate caching was disabled or misconfigured.

### Pitfall 4: Two independent mic streams
**What goes wrong:** `voice.js` already calls `getUserMedia({ audio: true })` and owns its own `AudioContext` for the waveform; a naive new implementation in `transcribe.js` that also calls `getUserMedia` independently opens a second mic stream.
**Why it happens:** The current Web Speech API implementation doesn't need `getUserMedia` at all (the browser's speech engine manages mic access internally) `[VERIFIED: hands-face-voice/src/transcribe.js:8-49 — no getUserMedia call anywhere in the file]`, so this concern doesn't exist today but will appear the moment `transcribe.js` needs raw PCM.
**How to avoid:** Flag as a design question for planning: either (a) let `transcribe.js` open its own independent `getUserMedia`/`AudioContext` (simplest, two mic streams is generally harmless in Chrome/Edge but is wasteful and could hit permission-prompt duplication), or (b) refactor so `main.js` opens one shared mic stream and passes it to both `voice.js` and the new `transcribe.js`. This is an integration decision for the planner, not resolved by this research.

## Code Examples

### Replacement caveat text for `index.html`
The current text (`[VERIFIED: hands-face-voice/index.html:117]`, quoted verbatim: *"Transcription uses the browser's built-in speech recognition. In Chrome this sends audio to Google's speech service — not on-device. See README's privacy question."*) should become something communicating: (1) transcription now runs fully on-device via a local Whisper model, (2) nothing is sent over the network after the model files are cached, (3) it transcribes in short chunks rather than live word-by-word, so there will be a brief pause after each phrase before text appears. Exact wording is a planning/copy decision, not fixed by this research.

### Swappable engine behind the existing interface
```js
// src/transcribe.js — interface shape preserved from the Web Speech API version
// Source: existing file at hands-face-voice/src/transcribe.js:8 (interface signature verified this session)
export function startTranscription({ onFinal, onInterim, onError }) {
  // ... VAD loop calls onInterim("listening...") / onInterim("") for status only,
  // and onFinal(text) once per completed utterance from the Whisper pipeline.
  return { stop() { /* tear down AudioContext + mic stream */ } };
}
```
The `{ stop() }` return shape and the three-callback signature can be preserved exactly `[VERIFIED: hands-face-voice/src/transcribe.js:8, hands-face-voice/src/transcribe.js:51-56]` — no changes needed in `main.js`'s call site.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Browser WASM + Web Audio API support | ONNX Runtime Web, mic capture | ✓ (Chrome/Edge, per README's existing guidance) | — | — |
| `npx serve .` COOP/COEP headers (for multi-threaded WASM) | Faster inference via `SharedArrayBuffer` | ✗ — confirmed absent by direct test | — | Automatic graceful fallback to single-threaded WASM; no functional breakage, only slower inference |
| Network access (first load only) | Initial ~41MB model download from HF Hub CDN | Required once | — | None — first run needs network; all subsequent runs work fully offline from Cache Storage |

**Missing dependencies with no fallback:** none blocking — the one hard requirement (network for first-time model download) is expected and matches how the existing MediaPipe Tasks Vision models are already loaded in this same playground.
**Missing dependencies with fallback:** COOP/COEP headers absent from `npx serve .` — falls back to single-threaded WASM automatically, no code change required.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `whisper-tiny.en` will be "reliably accurate" specifically on short command phrases like "start recording"/"this is a fist gesture"/"stop" | Summary, Standard Stack | If tiny.en's accuracy is too poor on these specific phrases, the planner may need to fall back to `whisper-base.en` (larger, slower) — this was not benchmarked this session, only reasoned about from general Whisper model-size/accuracy tradeoffs |
| A2 | Amplitude-threshold VAD (no dedicated VAD model) will segment utterances cleanly enough for this use case | Don't Hand-Roll, Architecture Patterns | If background noise or soft speech onset causes false starts/cuts, transcription quality degrades; may need a dedicated VAD library in a follow-up task |
| A3 | The exact 16kHz-AudioContext + AudioWorklet/ScriptProcessor capture pattern shown in Code Examples is correct as written | Architecture Patterns Pattern 2 | This pattern was reconstructed from multiple third-party tutorial sources via WebSearch, not from a single official transformers.js "vanilla browser mic" doc page — flagged MEDIUM confidence, not HIGH; the planner should verify against the official transformers.js repo's browser examples (e.g. `transformers.js/examples/`) during planning, not just this research |

## Open Questions

1. **Shared vs. independent microphone stream between `voice.js` and `transcribe.js`**
   - What we know: `voice.js` already opens its own `getUserMedia`/`AudioContext`; the current `transcribe.js` needs no mic access of its own since Web Speech API handles it internally.
   - What's unclear: Whether the new local engine should open a second independent stream (simpler, isolated) or share the existing `voice.js` stream (avoids a duplicate permission prompt / duplicate stream).
   - Recommendation: Planner should decide during task breakdown; independent stream is simpler to implement standalone and is architecturally safe (harmless duplication), so default to that unless the planner has a reason to refactor `main.js`'s wiring.

2. **Exact VAD silence/threshold tuning**
   - What we know: Amplitude-threshold VAD using the same `AnalyserNode.getByteTimeDomainData` pattern already in `voice.js` is the recommended minimal approach.
   - What's unclear: Concrete threshold values and silence-duration-to-trigger-cutoff numbers need empirical tuning against a real mic/room, which is an implementation-time task, not a research-time one.
   - Recommendation: Leave specific constants (e.g. silence threshold, min-silence-ms-to-end-utterance) as tunable, documented constants in code; do not hardcode without a comment explaining they may need adjustment.

## Validation Architecture

No `.planning/config.json` `workflow.nyquist_validation` override was checked for this quick task (out of scope for a lean quick-task research pass); the existing playground has no test framework (`hands-face-voice/` has no `package.json`, so no `npm test`) `[VERIFIED: hands-face-voice/ directory listing — no package.json present]`. Manual verification (load the page, speak a short phrase, confirm `#transcriptFinal` updates with reasonably accurate text and no network requests after first load) is the appropriate validation approach for this playground-style task, consistent with how the existing hands/face/voice features in this same file are verified.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view @huggingface/transformers`, `npm view vosk-browser`) — version, publish dates, repo URLs verified directly
- `gsd_run query package-legitimacy check` — verdicts for both candidate packages
- Local `curl` test of `npx serve .` response headers — confirmed absence of COOP/COEP
- Direct file reads of `hands-face-voice/src/transcribe.js`, `hands-face-voice/index.html`, `hands-face-voice/src/voice.js`, `hands-face-voice/README.md`, `.planning/spikes/MANIFEST.md`

### Secondary (MEDIUM confidence)
- huggingface.co/docs/transformers.js (CDN import pattern, ASR pipeline usage) — fetched via WebFetch
- github.com/huggingface/skills `transformers-js/references/CACHE.md` — browser Cache Storage caching behavior
- github.com/ggml-org/whisper.cpp `examples/whisper.wasm/README.md` — build-from-source requirement
- huggingface.co/onnx-community/whisper-tiny.en model file listing — quantized model sizes

### Tertiary (LOW confidence)
- Multiple third-party blog/tutorial posts (WebSearch only) on the exact 16kHz AudioContext + mic-to-Whisper capture pattern — no single official "vanilla JS + mic" transformers.js doc page was found this session; flagged as A3 in Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package existence, versions, and download counts directly verified against npm registry; whisper.cpp's build requirement directly cited from its own README
- Architecture: MEDIUM — integration pattern (VAD + chunked pipeline) is reasoned from Whisper's known batch-only nature plus this codebase's existing AnalyserNode pattern, not copy-pasted from a single verified official example
- Pitfalls: HIGH for COOP/COEP (directly tested) and caching (cited from official HF skills doc); MEDIUM for the exact mic-capture code pattern (tertiary sources only)

**Research date:** 2026-09-24
**Valid until:** ~30 days (JS ML tooling moves fast; re-verify `@huggingface/transformers` version pin before executing if this research is used more than a few weeks after today)
