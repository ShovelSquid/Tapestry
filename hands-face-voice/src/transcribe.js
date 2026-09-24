// Local, fully offline speech-to-text via @huggingface/transformers running
// onnx-community/whisper-tiny.en entirely on-device (ONNX Runtime Web/WASM).
// No audio ever leaves the browser tab — replaces the old Web Speech API
// implementation, which streamed mic audio to Google's cloud recognition
// service in Chrome/Edge and conflicted with this workstream's locked
// local-only requirement (.planning/spikes/MANIFEST.md).
//
// Whisper is a batch/chunked model, not a streaming one, so this can't
// reproduce Web Speech API's live word-by-word interim results. Continuous
// mic audio is segmented into utterances with a simple silence-based VAD;
// onInterim carries only coarse status text ("loading...", "listening...",
// "transcribing..."), and onFinal fires once per completed utterance.

import { pipeline } from "@huggingface/transformers";

const SAMPLE_RATE = 16000; // Whisper's feature extractor expects 16kHz mono

// Starting points, not tuned constants — expect to adjust against a real
// mic/room.
const SILENCE_RMS_THRESHOLD = 0.02; // below this amplitude counts as silence
const SILENCE_HOLD_MS = 700; // continuous silence needed to end an utterance
const MIN_UTTERANCE_MS = 300; // shorter blips are discarded, not transcribed

// Lazily created once, reused for the module's whole lifetime — never
// re-instantiate per utterance, that reloads the ONNX session every time.
let asrPipelinePromise = null;
function getAsrPipeline() {
  if (!asrPipelinePromise) {
    asrPipelinePromise = pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny.en",
      { dtype: "q8" }
    );
  }
  return asrPipelinePromise;
}

export function startTranscription({ onFinal, onInterim, onError }) {
  let running = true;
  let audioCtx = null;
  let processor = null;
  let gainNode = null;
  let stream = null;

  onInterim("loading model (one-time ~41MB download, cached after)...");

  // Overlap the model load and the mic permission prompt instead of
  // serializing them.
  const pipelineReady = getAsrPipeline();
  const streamReady = navigator.mediaDevices.getUserMedia({ audio: true });

  Promise.all([pipelineReady, streamReady])
    .then(([, mediaStream]) => {
      if (!running) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = mediaStream;
      onInterim("");
      setupCapture();
    })
    .catch((err) => {
      onError(err instanceof Error ? err : new Error(String(err)));
    });

  function setupCapture() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE,
    });
    const source = audioCtx.createMediaStreamSource(stream);

    // ScriptProcessorNode is deprecated in favor of AudioWorkletNode, but it
    // needs no separate worklet module file — keeps this playground's
    // no-build-step, single-file pattern.
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    // onaudioprocess only fires reliably while connected to a destination;
    // route through a zero-gain node so the mic isn't audibly looped back.
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;

    source.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    let chunks = [];
    let inUtterance = false;
    let silenceStartedAt = null;

    processor.onaudioprocess = (event) => {
      if (!running) return;

      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      for (let i = 0; i < input.length; i++) sumSquares += input[i] * input[i];
      const rms = Math.sqrt(sumSquares / input.length);

      if (rms > SILENCE_RMS_THRESHOLD) {
        if (!inUtterance) {
          inUtterance = true;
          onInterim("listening...");
        }
        silenceStartedAt = null;
        chunks.push(new Float32Array(input)); // copy — the browser reuses `input`'s buffer
      } else if (inUtterance) {
        // Keep appending through brief silence to capture trailing
        // breath/consonants.
        chunks.push(new Float32Array(input));
        if (silenceStartedAt === null) silenceStartedAt = performance.now();
        else if (performance.now() - silenceStartedAt >= SILENCE_HOLD_MS) {
          inUtterance = false;
          silenceStartedAt = null;
          finalizeUtterance(chunks);
          chunks = [];
        }
      }
    };
  }

  async function finalizeUtterance(utteranceChunks) {
    const totalLength = utteranceChunks.reduce((n, c) => n + c.length, 0);
    const durationMs = (totalLength / SAMPLE_RATE) * 1000;
    if (durationMs < MIN_UTTERANCE_MS) return; // discard silently, too short to be speech

    const audio = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of utteranceChunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }

    if (!running) return;
    onInterim("transcribing...");
    try {
      const asr = await getAsrPipeline();
      const result = await asr(audio);
      if (!running) return; // stop() may have landed while inference was in flight
      onFinal(result.text.trim());
      onInterim("");
    } catch (err) {
      if (!running) return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    stop() {
      running = false;
      if (processor) processor.disconnect();
      if (gainNode) gainNode.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close();
    },
  };
}
