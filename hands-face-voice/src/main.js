import { startHandsAndFace } from "./hands-face.js";
import { startVoiceWaveform } from "./voice.js";
import { startTranscription } from "./transcribe.js";
import { createScene3D } from "./scene3d.js";
import { chooseSaveFolder, startRecording, setRecordingBaseName } from "./record.js";
import { classifyIntent, preloadClassifier, COMMAND_EXAMPLES } from "./commands.js";

const statusEl = document.getElementById("status");
const errorBox = document.getElementById("errorBox");
const startCameraBtn = document.getElementById("startCamera");
const startMicBtn = document.getElementById("startMic");
const chooseFolderBtn = document.getElementById("chooseFolder");
const startRecordingBtn = document.getElementById("startRecording");
const stopRecordingBtn = document.getElementById("stopRecording");
const recordStatusEl = document.getElementById("recordStatus");
const voiceCommandStatusEl = document.getElementById("voiceCommandStatus");

function showError(context, err) {
  console.error(context, err);
  errorBox.textContent = `${context}: ${err.message || err}`;
}

async function handleStartCamera() {
  startCameraBtn.disabled = true;
  statusEl.textContent = "loading hand/face models...";
  try {
    const scene3D = createScene3D(document.getElementById("scene3d"));
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
}
startCameraBtn.addEventListener("click", handleStartCamera);

async function handleStartMic() {
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
        handleVoiceCommand(text).catch((err) => showError("Voice command", err));
      },
      onInterim: (text) => {
        interimEl.textContent = text;
      },
      onError: (err) => showError("Transcription", err),
    });
  } catch (err) {
    showError("Transcription", err);
  }

  // Start downloading the classifier's embedding model in parallel with the
  // ASR model instead of waiting for the first spoken command to trigger
  // it. Swallow its own errors — real classifyIntent error handling
  // happens on first spoken command via handleVoiceCommand's own catch.
  preloadClassifier().catch(() => {});
}
startMicBtn.addEventListener("click", handleStartMic);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let activeRecording = null;

async function handleChooseFolder() {
  try {
    const folderName = await chooseSaveFolder();
    recordStatusEl.textContent = `save folder: ${folderName}`;
    startRecordingBtn.disabled = false;
  } catch (err) {
    showError("Choose save folder", err);
  }
}
chooseFolderBtn.addEventListener("click", handleChooseFolder);

async function handleStartRecording() {
  startRecordingBtn.disabled = true;
  chooseFolderBtn.disabled = true;
  try {
    activeRecording = await startRecording({
      onStatus: ({ name, bytesWritten, recording }) => {
        recordStatusEl.textContent = recording
          ? `recording ${name} — ${formatBytes(bytesWritten)}`
          : `saved ${name} — ${formatBytes(bytesWritten)}`;
      },
      onError: (err) => showError("Recording", err),
    });
    stopRecordingBtn.disabled = false;
  } catch (err) {
    startRecordingBtn.disabled = false;
    chooseFolderBtn.disabled = false;
    showError("Recording", err);
  }
}
startRecordingBtn.addEventListener("click", handleStartRecording);

async function handleStopRecording() {
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
}
stopRecordingBtn.addEventListener("click", handleStopRecording);

// Voice-command dispatch: maps a classified command to the exact same
// function its button's click listener calls. "startMicrophone" maps to
// handleStartMic for label-set symmetry, but is structurally unreachable
// via voice — see commands.js's COMMAND_EXAMPLES comment.
const COMMAND_HANDLERS = {
  startRecording: handleStartRecording,
  stopRecording: handleStopRecording,
  startLandmarks: handleStartCamera,
  startMicrophone: handleStartMic,
};

async function handleVoiceCommand(text) {
  const { command, confident, slot } = await classifyIntent(text);

  if (!confident) {
    const example = command ? COMMAND_EXAMPLES[command][0] : "one of the known commands";
    voiceCommandStatusEl.textContent = `did you mean: "${example}"?`;
    return;
  }

  if (command === "saveFileTo") {
    const accepted = setRecordingBaseName(slot ?? "");
    voiceCommandStatusEl.textContent = accepted
      ? `next recording will be named "${accepted}"`
      : "could not extract a valid file name; next recording uses the default name";
    return;
  }

  voiceCommandStatusEl.textContent = `executing: ${command}`;
  COMMAND_HANDLERS[command]?.();
}
