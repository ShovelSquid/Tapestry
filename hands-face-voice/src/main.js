import { startHandsAndFace } from "./hands-face.js";
import { startVoiceWaveform } from "./voice.js";
import { startTranscription } from "./transcribe.js";
import { createScene3D } from "./scene3d.js";
import { chooseSaveFolder, startRecording } from "./record.js";

const statusEl = document.getElementById("status");
const errorBox = document.getElementById("errorBox");
const startCameraBtn = document.getElementById("startCamera");
const startMicBtn = document.getElementById("startMic");
const chooseFolderBtn = document.getElementById("chooseFolder");
const startRecordingBtn = document.getElementById("startRecording");
const stopRecordingBtn = document.getElementById("stopRecording");
const recordStatusEl = document.getElementById("recordStatus");

function showError(context, err) {
  console.error(context, err);
  errorBox.textContent = `${context}: ${err.message || err}`;
}

// Created once: a failed camera start re-enables the button, and a retry
// must not stack a second canvas and render loop into the panel.
let scene3D = null;

startCameraBtn.addEventListener("click", async () => {
  startCameraBtn.disabled = true;
  statusEl.textContent = "loading hand/face models...";
  try {
    scene3D ??= createScene3D(document.getElementById("scene3d"));
    await startHandsAndFace({
      video: document.getElementById("video"),
      canvas: document.getElementById("overlay"),
      metricsEl: document.getElementById("metrics"),
      onLandmarks: (landmarks) => scene3D.update(landmarks),
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let activeRecording = null;

chooseFolderBtn.addEventListener("click", async () => {
  try {
    const folderName = await chooseSaveFolder();
    recordStatusEl.textContent = `save folder: ${folderName}`;
    startRecordingBtn.disabled = false;
  } catch (err) {
    showError("Choose save folder", err);
  }
});

startRecordingBtn.addEventListener("click", async () => {
  startRecordingBtn.disabled = true;
  chooseFolderBtn.disabled = true;
  try {
    activeRecording = await startRecording({
      onStatus: ({ name, bytesWritten, recording, failed }) => {
        recordStatusEl.textContent = recording
          ? `recording ${name} — ${formatBytes(bytesWritten)}`
          : `saved ${name} — ${formatBytes(bytesWritten)}${failed ? " (cut short by an error)" : ""}`;
      },
      onError: (err) => showError("Recording", err),
    });
    stopRecordingBtn.disabled = false;
  } catch (err) {
    startRecordingBtn.disabled = false;
    chooseFolderBtn.disabled = false;
    showError("Recording", err);
  }
});

stopRecordingBtn.addEventListener("click", async () => {
  stopRecordingBtn.disabled = true;
  try {
    await activeRecording.stop();
  } catch (err) {
    showError("Recording", err);
  } finally {
    activeRecording = null;
    chooseFolderBtn.disabled = false;
    startRecordingBtn.disabled = false;
  }
});
