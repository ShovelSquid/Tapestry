// Hands as cursors: MediaPipe hand landmarks -> a smoothed screen point per hand, plus whether
// the hand is closed (a fist grabs, an open hand lets go).
//
// Aiming adds two things together. Turning: with the defaults the right hand facing the camera
// sits at the right edge and turned 45 degrees reaches the left edge (the left hand mirrors it),
// and tilting moves it up and down. Moving: shifting the hand around pans the cursor on top.
// Either can be turned off by setting its sensitivity to 0.
//
// Same MediaPipe Tasks Vision build as ws/hands-face-voice, hands only.

import { HandLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";

const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Openness = mean fingertip-to-wrist distance over palm length (wrist to middle knuckle).
// Open hand reads ~1.9, a fist ~0.9. Two thresholds so it doesn't flicker at the boundary.
export const CLOSE_BELOW = 1.25;
export const OPEN_ABOVE = 1.5;

// Palm centre (0..1 across the image, mirrored) of the hand.
function palmCentre(lm) {
  let px = 0, py = 0;
  for (const i of PALM) (px += lm[i].x), (py += lm[i].y);
  return { px: 1 - px / PALM.length, py: py / PALM.length };
}

// Grabbing picks at where the cursor was this long ago: curling into a fist nudges the aim, and
// the grab should land on what you were pointing at, not where the fist drifted to.
const GRAB_REWIND_MS = 120;

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

// Palm facing direction, from the 3D world landmarks: the normal of the triangle wrist, index
// knuckle, pinky knuckle (none of which move when the fingers curl). Returns yaw and pitch in
// degrees, 0/0 when the palm faces the camera; + yaw is toward the screen's right (mirrored),
// + pitch is up.
function palmAngles(w) {
  const a = [w[5].x - w[0].x, w[5].y - w[0].y, w[5].z - w[0].z];
  const b = [w[17].x - w[0].x, w[17].y - w[0].y, w[17].z - w[0].z];
  let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Left and right hands wind opposite ways; take whichever side faces the camera (-z).
  if (n[2] > 0) n = n.map((v) => -v);
  const deg = 180 / Math.PI;
  return { yaw: Math.atan2(-n[0], -n[2]) * deg, pitch: Math.atan2(-n[1], -n[2]) * deg };
}

function openness(lm) {
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, lm[a].z - lm[b].z);
  const palm = d(0, 9) || 1e-6;
  return TIPS.reduce((s, t) => s + d(t, 0), 0) / TIPS.length / palm;
}

// Starts the camera and tracking. Calls onHands([{ id, x, y, pickX, pickY, closed, openness,
// yaw, pitch }]) every frame, with x, y in 0..1 screen space (mirrored, like a mirror); pickX/Y
// is where a grab that starts this frame should land. `aim` is read live:
// { startX, startY: where the right hand's cursor sits facing forward (left hand: 1 - startX),
//   sensX, sensY: screens per 45 degrees of turn / tilt,
//   panX, panY: screens per camera image the hand moves,
//   mirrorX: swap which way each hand sweeps, mirrorY: flip tilt }.
// Returns { stop, recenter }: recenter makes each visible hand's current pose "facing forward"
// and its current spot the pan origin.
export async function startHands({ video, canvas, onHands, onStatus, aim }) {
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
  // handedness -> { fx, fy, closed, lastSeen, trail, raw, origin }. `origin` is the pose that
  // counts as facing forward with the hand at rest: { yaw, pitch, px, py }.
  const tracks = new Map();
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
      const label = result.handednesses?.[h]?.[0]?.categoryName;
      const id = label ?? `hand${h}`;
      let tr = tracks.get(id);
      if (!tr) {
        tr = { fx: new OneEuro(), fy: new OneEuro(), closed: false, trail: [] };
        tr.origin = { yaw: 0, pitch: 0, px: 0.5, py: 0.5 };
        tracks.set(id, tr);
      }
      tr.lastSeen = now;

      const open = openness(lm);
      const wasClosed = tr.closed;
      if (tr.closed && open > OPEN_ABOVE) tr.closed = false;
      else if (!tr.closed && open < CLOSE_BELOW) tr.closed = true;

      const world = result.worldLandmarks?.[h];
      const ang = world ? palmAngles(world) : null;
      // The palm centre stays put when the fingers curl, unlike a fingertip.
      const { px, py } = palmCentre(lm);
      // Pan is relative to where the hand showed up, so its resting spot doesn't skew the aim.
      if (!tr.raw) Object.assign(tr.origin, { px, py });
      tr.raw = { yaw: ang?.yaw ?? 0, pitch: ang?.pitch ?? 0, px, py };
      const o = tr.origin;
      const asRight = (id !== "Left") !== !!aim?.mirrorX;
      const startX = asRight ? aim?.startX ?? 1 : 1 - (aim?.startX ?? 1);
      // Turning: how far the hand has turned from facing forward, either way, in screens.
      let turnX = 0, turnY = 0;
      if (ang) {
        turnX = (Math.abs(ang.yaw - o.yaw) / 45) * (aim?.sensX ?? 1) * (asRight ? -1 : 1);
        turnY = -((ang.pitch - o.pitch) / 45) * (aim?.sensY ?? 1.8) * (aim?.mirrorY ? -1 : 1);
      }
      // Moving: how far the palm has travelled across the image since it showed up, in screens.
      const panX = (px - o.px) * (aim?.panX ?? 1.8);
      const panY = (py - o.py) * (aim?.panY ?? 1.8);
      const sx = startX + turnX + panX;
      const sy = (aim?.startY ?? 0.5) + turnY + panY;
      const x = tr.fx.filter(Math.min(1, Math.max(0, sx)), t);
      const y = tr.fy.filter(Math.min(1, Math.max(0, sy)), t);

      tr.trail.push({ now, x, y });
      while (tr.trail.length > 2 && now - tr.trail[1].now > GRAB_REWIND_MS) tr.trail.shift();
      const back = tr.closed && !wasClosed ? tr.trail[0] : { x, y };
      out.push({ id, x, y, pickX: back.x, pickY: back.y, closed: tr.closed, openness: open, turnX, turnY, panX, panY });

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
    recenter() {
      for (const tr of tracks.values()) if (tr.raw) tr.origin = { ...tr.raw };
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      landmarker.close();
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
