// Live speech-to-text via a fully on-device Whisper model (no cloud dependency).
//
// Runs @huggingface/transformers' automatic-speech-recognition pipeline
// (onnx-community/whisper-tiny.en, q8-quantized) entirely in-browser via
// ONNX Runtime Web (WASM). Nothing is sent over the network once the model
// files are cached in Cache Storage (first load only, ~41MB).
//
// Whisper transcribes complete audio buffers, not a live word stream, so
// this file segments continuous mic input into discrete utterances with a
// simple amplitude-threshold VAD (same AnalyserNode read pattern already
// used in voice.js) rather than relying on any built-in streaming support.
// onInterim is repurposed as a coarse "listening..." status signal, not
// partial transcript text — this engine has no word-by-word output.

import { pipeline } from "@huggingface/transformers";

// Tunable VAD constants — illustrative starting points that need real-mic
// tuning, not empirically measured values. Adjust if utterances cut off
// too early (raise SILENCE_DURATION_MS) or never trigger (lower
// SILENCE_RMS_THRESHOLD).
const SILENCE_RMS_THRESHOLD = 0.02; // 0..1-scale RMS amplitude below which audio counts as silence
const SILENCE_DURATION_MS = 800; // how long silence must persist before an utterance is considered ended

// Module-level memoized pipeline promise — created once and reused for
// every utterance in every startTranscription() call for the page's
// lifetime; never re-instantiate per utterance (reloading the ONNX session
// per call would be far slower).
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
  let stream = null;
  let audioCtx = null;
  let processor = null;
  let analyser = null;
  let source = null;

  let speaking = false;
  let silenceStartedAt = null;
  let chunks = [];
  let flushing = false;

  async function flushUtterance() {
    if (chunks.length === 0 || flushing) return;
    flushing = true;

    let totalLength = 0;
    for (const chunk of chunks) totalLength += chunk.length;
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    chunks = [];
    speaking = false;
    silenceStartedAt = null;

    try {
      const asr = await getAsrPipeline();
      const result = await asr(samples);
      const text = (result?.text ?? "").trim();
      if (text) onFinal(text);
    } catch (err) {
      onError?.(err);
    } finally {
      onInterim?.("");
      flushing = false;
    }
  }

  (async () => {
    try {
      // Independent getUserMedia stream — deliberately not shared with
      // voice.js's waveform stream (a second mic stream is harmless in
      // Chrome/Edge; sharing would require refactoring main.js's wiring,
      // which is out of scope here).
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 16kHz so the browser resamples mic input for Whisper's expected
      // 16kHz mono input — never feed the default 44.1/48kHz buffer
      // straight to the model.
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      source = audioCtx.createMediaStreamSource(stream);

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      // ScriptProcessorNode (deprecated but simplest, no separate
      // AudioWorklet module file needed) accumulates raw PCM chunks while
      // speech is detected. It must be connected to a destination for
      // onaudioprocess to fire in Chrome; since we never write to its
      // output buffer, no audio is actually played back.
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioCtx.destination);

      const timeDomainBuffer = new Uint8Array(analyser.fftSize);

      processor.onaudioprocess = (event) => {
        if (!running) return;

        analyser.getByteTimeDomainData(timeDomainBuffer);
        let sumSquares = 0;
        for (let i = 0; i < timeDomainBuffer.length; i++) {
          const v = timeDomainBuffer[i] / 128.0 - 1.0;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / timeDomainBuffer.length);
        const isSpeech = rms > SILENCE_RMS_THRESHOLD;

        if (isSpeech) {
          if (!speaking) {
            speaking = true;
            onInterim?.("listening...");
          }
          silenceStartedAt = null;
          chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        } else if (speaking) {
          if (silenceStartedAt === null) {
            silenceStartedAt = performance.now();
          } else if (
            performance.now() - silenceStartedAt >=
            SILENCE_DURATION_MS
          ) {
            flushUtterance();
          }
        }
      };
    } catch (err) {
      onError?.(err);
    }
  })();

  return {
    stop() {
      running = false;
      if (processor) {
        processor.disconnect();
        processor.onaudioprocess = null;
      }
      if (analyser) analyser.disconnect();
      if (source) source.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close();
    },
  };
}
