// Raw hand + face landmark capture and visualization via MediaPipe Tasks Vision.
// No gesture recognition, no command mapping — landmarks are drawn as-is.

import {
  HandLandmarker,
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";

const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export async function startHandsAndFace({ video, canvas, metricsEl, onLandmarks, onError }) {
  const ctx = canvas.getContext("2d");
  const drawingUtils = new DrawingUtils(ctx);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
  });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm"
  );

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  });

  const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
  });

  let lastFrameTime = performance.now();
  let running = true;

  function frame() {
    if (!running) return;
    const now = performance.now();
    const fps = Math.round(1000 / (now - lastFrameTime));
    lastFrameTime = now;

    const handResult = handLandmarker.detectForVideo(video, now);
    const faceResult = faceLandmarker.detectForVideo(video, now);

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const landmarks of handResult.landmarks ?? []) {
      drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
        color: "#22d3ee",
        lineWidth: 2,
      });
      drawingUtils.drawLandmarks(landmarks, { color: "#f97316", radius: 2 });
    }

    for (const landmarks of faceResult.faceLandmarks ?? []) {
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        { color: "#4b5563", lineWidth: 0.5 }
      );
      drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_CONTOURS,
        { color: "#a78bfa", lineWidth: 1 }
      );
    }
    ctx.restore();

    metricsEl.textContent = `hands: ${handResult.landmarks?.length ?? 0}    faces: ${
      faceResult.faceLandmarks?.length ?? 0
    }    fps: ${fps}`;

    onLandmarks?.({
      handsWorld: handResult.worldLandmarks ?? [],
      faceLandmarksList: faceResult.faceLandmarks ?? [],
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      handLandmarker.close();
      faceLandmarker.close();
    },
  };
}
