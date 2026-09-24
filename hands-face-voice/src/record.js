// Save synced camera + microphone recordings to local disk for later,
// unhurried offline analysis (hand/face landmark extraction, spike 013).
// No live processing here — this captures the raw signal only, on its own
// getUserMedia stream, independent of the live-visualization pipeline in
// hands-face.js / voice.js.

let directoryHandle = null;

export async function chooseSaveFolder() {
  directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  return directoryHandle.name;
}

export function hasSaveFolder() {
  return directoryHandle !== null;
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

// One-shot override for the next recording's base name, set by a voice
// command ("save file to <name>") instead of the folder picker (which
// requires a real user gesture voice cannot supply). Consumed by the very
// next sessionBaseName() call, then reverts to the timestamp default.
let baseNameOverride = null;

function sanitizeBaseName(raw) {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
  return cleaned || null;
}

export function setRecordingBaseName(name) {
  baseNameOverride = sanitizeBaseName(name);
  return baseNameOverride;
}

function sessionBaseName() {
  if (baseNameOverride) {
    const name = baseNameOverride;
    baseNameOverride = null; // one-shot: consumed here, then reverts to timestamp default
    return name;
  }
  return `session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export async function startRecording({ onStatus, onError }) {
  if (!directoryHandle) {
    throw new Error("Choose a save folder before recording");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: true,
  });

  const baseName = sessionBaseName();
  const videoName = `${baseName}.webm`;
  const fileHandle = await directoryHandle.getFileHandle(videoName, {
    create: true,
  });
  const writable = await fileHandle.createWritable();

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined
  );

  const startedAt = new Date().toISOString();
  let bytesWritten = 0;
  // createWritable() is a single stream; concurrent write() calls on it
  // race and can interleave or throw, so every chunk is chained onto the
  // previous write rather than fired independently.
  let writeChain = Promise.resolve();

  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) return;
    bytesWritten += event.data.size;
    writeChain = writeChain.then(() => writable.write(event.data));
    onStatus?.({ name: videoName, bytesWritten, recording: true });
  };

  recorder.onerror = (event) => {
    onError?.(event.error ?? new Error("MediaRecorder error"));
  };

  recorder.start(1000); // 1s timeslices so writes land incrementally, not all at stop

  return {
    name: videoName,
    async stop() {
      await new Promise((resolve) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.stop();
      });
      stream.getTracks().forEach((t) => t.stop());
      await writeChain;
      await writable.close();

      const stoppedAt = new Date().toISOString();
      const sidecar = {
        video: videoName,
        mimeType: mimeType || "video/webm",
        startedAt,
        stoppedAt,
        bytesWritten,
      };
      const sidecarHandle = await directoryHandle.getFileHandle(
        `${baseName}.json`,
        { create: true }
      );
      const sidecarWritable = await sidecarHandle.createWritable();
      await sidecarWritable.write(JSON.stringify(sidecar, null, 2));
      await sidecarWritable.close();

      onStatus?.({ name: videoName, bytesWritten, recording: false });
      return sidecar;
    },
  };
}
