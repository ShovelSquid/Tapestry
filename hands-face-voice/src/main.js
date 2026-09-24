import { startHandsAndFace } from "./hands-face.js";
import { startVoiceWaveform } from "./voice.js";
import { startTranscription } from "./transcribe.js";

const statusEl = document.getElementById("status");
const errorBox = document.getElementById("errorBox");
const startCameraBtn = document.getElementById("startCamera");
const startMicBtn = document.getElementById("startMic");

function showError(context, err) {
  console.error(context, err);
  errorBox.textContent = `${context}: ${err.message || err}`;
}

startCameraBtn.addEventListener("click", async () => {
  startCameraBtn.disabled = true;
  statusEl.textContent = "loading hand/face models...";
  try {
    await startHandsAndFace({
      video: document.getElementById("video"),
      canvas: document.getElementById("overlay"),
      metricsEl: document.getElementById("metrics"),
    });
    statusEl.textContent = "camera running";
  } catch (err) {
    startCameraBtn.disabled = false;
    statusEl.textContent = "camera failed";
    showError("Camera/tracking", err);
  }
});

startMicBtn.addEventListener("click", async () => {
  startMicBtn.disabled = true;
  statusEl.textContent = "requesting microphone...";
  try {
    await startVoiceWaveform({
      canvas: document.getElementById("waveform"),
    });
    statusEl.textContent = "microphone running";
  } catch (err) {
    startMicBtn.disabled = false;
    statusEl.textContent = "microphone failed";
    showError("Microphone", err);
    return;
  }

  const finalEl = document.getElementById("transcriptFinal");
  const interimEl = document.getElementById("transcriptInterim");
  try {
    startTranscription({
      onFinal: (text) => {
        finalEl.textContent += text + " ";
      },
      onInterim: (text) => {
        interimEl.textContent = text;
      },
      onError: (err) => showError("Transcription", err),
    });
  } catch (err) {
    showError("Transcription", err);
  }
});
