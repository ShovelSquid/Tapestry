// Hands as cursors: MediaPipe hand landmarks -> a smoothed screen point per hand, plus whether
// the hand is closed (a fist grabs, an open hand lets go).
//
// Same MediaPipe Tasks Vision build as ws/hands-face-voice, hands only.

import { HandLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";

const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Openness = mean fingertip-to-wrist distance over palm length (wrist to middle knuckle).
// Open hand reads ~1.9, a fist ~0.9. Two thresholds so it doesn't flicker at the boundary.
export const CLOSE_BELOW = 1.25;
export const OPEN_ABOVE = 1.5;

// The middle of the camera image maps to the whole screen, so you don't have to reach the edges.
const REACH = 0.7;

const TIPS = [8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];

// One Euro filter: smooth when still, responsive when moving fast.
class OneEuro {
  constructor(minCutoff = 1.2, beta = 8, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 });
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += (dx - this.dx) * this.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (x - this.x) * this.alpha(cutoff, dt);
    return this.x;
  }
}

function openness(lm) {
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, lm[a].z - lm[b].z);
  const palm = d(0, 9) || 1e-6;
  return TIPS.reduce((s, t) => s + d(t, 0), 0) / TIPS.length / palm;
}

// Starts the camera and tracking. Calls onHands([{ id, x, y, closed, openness }]) every frame,
// with x, y in 0..1 screen space (mirrored, like a mirror). Returns { stop }.
export async function startHands({ video, canvas, onHands, onStatus }) {
  onStatus?.("asking for the camera…");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  onStatus?.("loading hand model…");
  let landmarker;
  try {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm");
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    throw err;
  }
  onStatus?.("tracking");

  const ctx = canvas.getContext("2d");
  const draw = new DrawingUtils(ctx);
  const tracks = new Map(); // handedness -> { fx, fy, closed, lastSeen }
  let lastVideoTime = -1;
  let raf = 0;
  let stopped = false;

  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);
    const t = now / 1000;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const out = [];
    (result.landmarks ?? []).forEach((lm, h) => {
      const id = result.handednesses?.[h]?.[0]?.categoryName ?? `hand${h}`;
      let tr = tracks.get(id);
      if (!tr) tracks.set(id, (tr = { fx: new OneEuro(), fy: new OneEuro(), closed: false }));
      tr.lastSeen = now;

      const open = openness(lm);
      if (tr.closed && open > OPEN_ABOVE) tr.closed = false;
      else if (!tr.closed && open < CLOSE_BELOW) tr.closed = true;

      // The palm centre stays put when the fingers curl, unlike a fingertip.
      let px = 0, py = 0;
      for (const i of PALM) (px += lm[i].x), (py += lm[i].y);
      px /= PALM.length;
      py /= PALM.length;
      const sx = Math.min(1, Math.max(0, (1 - px - 0.5) / REACH + 0.5));
      const sy = Math.min(1, Math.max(0, (py - 0.5) / REACH + 0.5));
      out.push({ id, x: tr.fx.filter(sx, t), y: tr.fy.filter(sy, t), closed: tr.closed, openness: open });

      const color = tr.closed ? "#ff5c8a" : "#7ee0ff";
      draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 });
      draw.drawLandmarks(lm, { color: "#ffffff", radius: 2 });
    });
    // Forget a hand after it's been gone a moment (that also lets go of what it held).
    for (const [id, tr] of tracks) if (now - tr.lastSeen > 400) tracks.delete(id);
    onHands(out);
  };
  loop();

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      landmarker.close();
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
