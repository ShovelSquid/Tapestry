// On-device voice-command intent classification.
//
// Embeds each completed Whisper transcript (see transcribe.js's onFinal)
// once via a feature-extraction pipeline and cosine-compares it against
// precomputed reference embeddings for 5 fixed commands, choosing the
// closest match above a confidence threshold. This is deliberately NOT a
// zero-shot-classification pipeline: that would run one forward pass per
// candidate label (5x the inference cost per utterance) for the same
// 5-command set. This module opens no microphone stream of its own — its
// only input is text already produced by transcribe.js's onFinal callback.

import { pipeline } from "@huggingface/transformers";

// "start microphone" stays in this label set for classifier symmetry even
// though it is structurally unreachable via voice in practice: the
// microphone must already be running (via the button click that starts
// transcription) before any spoken command — including this one — can be
// heard at all. This is documented, intentional behavior, not a bug.
const COMMAND_EXAMPLES = {
  startRecording: ["start recording", "begin recording", "record now"],
  stopRecording: ["stop recording", "end recording", "stop"],
  saveFileTo: [
    "save file to",
    "save the file as",
    "name the file",
    "call the file",
  ],
  startMicrophone: ["start microphone", "turn on the mic", "start the mic"],
  startLandmarks: [
    "start camera",
    "start landmarks",
    "turn on hand tracking",
    "start hands and face",
  ],
};

// Illustrative starting point (see 260924-2a5-RESEARCH.md Assumptions Log
// A2) — cosine similarity is not a calibrated probability, so this cutoff
// needs empirical tuning against real mic input, not a derived constant.
// Tune here if commands misfire (raise) or are never confident (lower).
const CONFIDENCE_THRESHOLD = 0.65;

// Module-level memoized pipeline promise — loaded once, reused for every
// utterance's classification for the page's lifetime.
let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: "q8",
    });
  }
  return embedderPromise;
}

// Fire-and-forget hook so main.js can start this model's download in
// parallel with transcribe.js's ASR model instead of waiting for the first
// spoken command to trigger it.
export function preloadClassifier() {
  return getEmbedder();
}

// Embeds every example phrase for every command exactly once per session
// and caches the result — never re-embed the fixed reference phrases per
// utterance, that would waste a forward pass reproducing values that never
// change during the session.
let referenceEmbeddingsPromise = null;
function getReferenceEmbeddings() {
  if (!referenceEmbeddingsPromise) {
    referenceEmbeddingsPromise = (async () => {
      const embed = await getEmbedder();
      const out = {};
      for (const [command, phrases] of Object.entries(COMMAND_EXAMPLES)) {
        out[command] = await Promise.all(
          phrases.map((phrase) => embed(phrase, { pooling: "mean", normalize: true }))
        );
      }
      return out;
    })();
  }
  return referenceEmbeddingsPromise;
}

// Plain dot-product-over-norms cosine similarity — no vector-math library.
// This is a fixed, tiny (5 commands x 3-5 phrases) comparison set re-run
// per utterance, not a search-index-scale problem.
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Only ever called once classifyIntent has already decided the command is
// saveFileTo above threshold — plain string manipulation on text already
// in hand, not a model call. Finds the first matching trigger phrase and
// returns everything after it, trimmed.
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

export async function classifyIntent(text) {
  const embed = await getEmbedder();
  const refs = await getReferenceEmbeddings();
  const [utteranceEmbedding] = await embed(text, {
    pooling: "mean",
    normalize: true,
  });

  let best = { command: null, score: -Infinity };
  for (const [command, embeddings] of Object.entries(refs)) {
    for (const ref of embeddings) {
      const score = cosineSimilarity(utteranceEmbedding.data, ref[0].data);
      if (score > best.score) best = { command, score };
    }
  }

  const slot =
    best.command === "saveFileTo"
      ? extractSlotAfterTrigger(text, COMMAND_EXAMPLES.saveFileTo)
      : undefined;

  return {
    command: best.command,
    score: best.score,
    confident: best.score >= CONFIDENCE_THRESHOLD,
    slot,
  };
}

export { COMMAND_EXAMPLES };
