// Hands as cursors: MediaPipe hand landmarks -> a smoothed screen point per hand, plus whether
// the hand is closed (a fist grabs, an open hand lets go).
//
// Aiming adds two things together. Turning: with the defaults the right hand facing the camera
// sits at the right edge and turning it sweeps to the left edge (the left hand mirrors it), and
// tilting moves it up and down. Moving: shifting the hand around pans the cursor on top. Either
// can be turned off by setting its sensitivity to 0. How the palm's direction is measured, and
// what calibration records, is in aim.js.
//
// Or the head aims (aim.source = "head"): where the nose points is the cursor, from the face
// model's head pose matrix, and a fist on either hand grabs.
//
// Or both (aim.source = "fused", see fusion.js): each hand moves its cursor relatively, and the
// cursor is kept on a leash around where the head points.
//
// Or hand pointing (aim.source = "point"): the same, but each hand's leash is around where that
// hand points: a ray from the palm centre along the way the (rigid) palm faces. Moving the hand
// shifts the ray and turning it swings it; palm travel does the fine aiming. No head needed, and
// two hands point independently.
//
// Every source ends in the same physics
// (dead zone sized to the input's jitter, then a damped spring), so nothing is 1:1 with
// MediaPipe's raw numbers.
//
// Same MediaPipe Tasks Vision build as ws/hands-face-voice, hands only.

import { HandLandmarker, FaceLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";
import { PALM, palmPose, aimFractions, captureRest, mirrorCalibration, Calibrator, UNCALIBRATED } from "./aim.js";
import { OneEuro, FusedPointer, Spring2, Steady, rayPoint } from "./fusion.js";

const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Openness = mean fingertip-to-wrist distance over palm length (wrist to middle knuckle).
// Open hand reads ~1.9, a fist ~0.9. Two thresholds so it doesn't flicker at the boundary.
export const CLOSE_BELOW = 1.25;
export const OPEN_ABOVE = 1.5;

// While the fingers are partway curled (closing into a grab or opening to let go) the hand
// shifts, so the cursor holds still, for at most FREEZE_MAX_MS. Afterwards it catches up over
// CATCH_UP_MS instead of jumping.
const CURLING = [CLOSE_BELOW - 0.1, OPEN_ABOVE + 0.2];
const FREEZE_MAX_MS = 350;
const CATCH_UP_MS = 150;

// Grabbing picks at where the cursor was this long ago, in case the freeze started late.
const GRAB_REWIND_MS = 120;

const RECENTER_MS = 500; // a recenter averages the pose over this long

const STORE = "blob-hands.calibration";

// Palm centre (0..1 across the image, mirrored) of the hand.
function palmCentre(lm) {
  let px = 0, py = 0;
  for (const i of PALM) (px += lm[i].x), (py += lm[i].y);
  return { px: 1 - px / PALM.length, py: py / PALM.length };
}

const TIPS = [8, 12, 16, 20];

function openness(lm) {
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y, lm[a].z - lm[b].z);
  const palm = d(0, 9) || 1e-6;
  return TIPS.reduce((s, t) => s + d(t, 0), 0) / TIPS.length / palm;
}

// Head yaw and pitch (degrees) from the face model's transformation matrix: where the face's
// forward axis points. Turning toward your left and looking up are positive. The matrix's layout
// (row or column major) is read off where the translation sits: the face is tens of centimetres
// in front of the camera, so that's the one big number.
function headAngles(m) {
  const d = m.data;
  const colMajor = Math.abs(d[14]) > Math.abs(d[11]);
  const R = (r, c) => (colMajor ? d[c * 4 + r] : d[r * 4 + c]);
  const fx = R(0, 2), fy = R(1, 2), fz = R(2, 2);
  const deg = 180 / Math.PI;
  return { yaw: Math.atan2(fx, fz) * deg, pitch: Math.atan2(fy, fz) * deg };
}

function loadCalibrations() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
}

// Starts the camera and tracking. Calls onHands([{ id, x, y, pickX, pickY, closed, openness,
// turnX, turnY, panX, panY, calibrated, precise }]) every frame, with x, y in 0..1 screen space
// (mirrored, like a mirror); pickX/Y is where a grab that starts this frame should land.
// `aim` is read live:
// { startX, startY: where the right hand's cursor sits facing forward (left hand: 1 - startX),
//   sensX, sensY: multiples of the calibrated sweep / tilt (1 = calibrated edge to edge),
//   panX, panY: screens per camera image the hand moves,
//   mirrorX: swap which way each hand sweeps, mirrorY: flip tilt }.
//   source: "hands" | "head" | "fused", headRangeX, headRangeY: degrees of head turn from centre
//   to edge, leash: fused cursor's leash radius (screens), angleReach: 0..1 share of hand angle
//   in fused motion, steadiness: dead zone size multiplier,
//   reach: how far a turn swings the pointing ray (1 = 45 degrees per screen), pointLeash }.
// In head mode the list has one cursor ({ id: "Head", cursor: true, ... }, closed when any hand
// is a fist) and the hands come along with cursor: false, for display.
// onCalibrate({ hand, step, progress, error, done }) reports calibration; null when cancelled.
export async function startHands({ video, canvas, onHands, onStatus, onCalibrate, aim }) {
  onStatus?.("asking for the camera…");
  // More pixels on the hand means steadier landmarks, and 60fps halves the wait for each frame.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  });
  video.srcObject = stream;
  await video.play();
  const W = (canvas.width = video.videoWidth || 1280);
  const H = (canvas.height = video.videoHeight || 720);
  const fps = Math.round(stream.getVideoTracks()[0]?.getSettings().frameRate ?? 0);

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
  onStatus?.(`tracking · camera ${W}×${H}${fps ? ` @ ${fps}fps` : ""}`);

  const ctx = canvas.getContext("2d");
  const draw = new DrawingUtils(ctx);
  const saved = loadCalibrations(); // handedness -> calibration (see aim.js)
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {}
  };
  // A hand without its own calibration borrows the other hand's, mirrored.
  const calibrationFor = (id) => {
    const other = id === "Left" ? "Right" : "Left";
    return saved[id] ?? (saved[other] ? mirrorCalibration(saved[other]) : UNCALIBRATED);
  };

  // handedness -> { fx, fy, closed, lastSeen, trail, origin, cal, x, y, freeze, catchUp, recenter }
  // origin: the palm spot panning is measured from. cal: this session's calibration (a recenter
  // changes it without saving).
  const tracks = new Map();
  // The face model loads the first time head aiming is picked.
  let face = null, faceLoading = null;
  const head = { fx: new OneEuro(), fy: new OneEuro(), steady: new Steady(), zero: { yaw: 0, pitch: 0 }, recenter: null, raw: null, lastT: 0 };
  const ensureFace = () =>
    (faceLoading ??= (async () => {
      onStatus?.("loading face model…");
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm");
      face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
      onStatus?.(`tracking · camera ${W}×${H}${fps ? ` @ ${fps}fps` : ""} · head + hands`);
    })().catch((err) => {
      faceLoading = null;
      onStatus?.(`couldn't load the face model: ${err.message ?? err}`);
    }));
  let calib = null; // { hand, calibrator } while calibrating
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
    // Head first: in fused mode it's where the hands' cursors are leashed to.
    const useHead = aim?.source === "head" || aim?.source === "fused";
    let headAim = null, headEntry = null;
    if (useHead) {
      ensureFace();
      const res = face?.detectForVideo(video, now);
      const m = res?.facialTransformationMatrixes?.[0];
      if (m) {
        const a = (head.raw = headAngles(m));
        if (head.recenter) {
          head.recenter.samples.push(a);
          if (now >= head.recenter.until) {
            const n = head.recenter.samples.length;
            head.zero = {
              yaw: head.recenter.samples.reduce((s, v) => s + v.yaw, 0) / n,
              pitch: head.recenter.samples.reduce((s, v) => s + v.pitch, 0) / n,
            };
            head.recenter = null;
          }
        }
        // Your left is the screen's left (the view is a mirror), up is up.
        const yaw = (a.yaw - head.zero.yaw) * (aim.mirrorX ? -1 : 1);
        const pitch = (a.pitch - head.zero.pitch) * (aim.mirrorY ? -1 : 1);
        const hx = head.fx.filter(Math.min(1, Math.max(0, 0.5 - yaw / (aim.headRangeX ?? 18) / 2)), t);
        const hy = head.fy.filter(Math.min(1, Math.max(0, 0.5 - pitch / (aim.headRangeY ?? 12) / 2)), t);
        headAim = [hx, hy];
        const hdt = Math.min(0.1, Math.max(0.001, (now - (head.lastT || now - 16)) / 1000));
        head.lastT = now;
        head.steady.band.scale = aim.steadiness ?? 1;
        const [x, y] = head.steady.update(hx, hy, hdt);
        headEntry = { id: "Head", x, y, pickX: x, pickY: y, cursor: true, yaw, pitch };

        // Show it: a line from the nose tip the way the face points.
        const nose = res.faceLandmarks?.[0]?.[1];
        if (nose) {
          const r = Math.PI / 180;
          ctx.strokeStyle = "#ffd36e";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(nose.x * W, nose.y * H);
          ctx.lineTo(nose.x * W + Math.sin(a.yaw * r) * 120, nose.y * H - Math.sin(a.pitch * r) * 120);
          ctx.stroke();
          ctx.fillStyle = "#ffd36e";
          ctx.beginPath();
          ctx.arc(nose.x * W, nose.y * H, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const out = [];
    (result.landmarks ?? []).forEach((lm, h) => {
      const world = result.worldLandmarks?.[h];
      if (!world) return;
      const id = result.handednesses?.[h]?.[0]?.categoryName ?? `hand${h}`;
      const { px, py } = palmCentre(lm);
      let tr = tracks.get(id);
      if (!tr) {
        // Pan is relative to where the hand showed up, so its resting spot doesn't skew the aim.
        tr = {
          fx: new OneEuro(), fy: new OneEuro(), steady: new Steady(), fused: new FusedPointer(), spring: new Spring2(),
          // The pointing ray swings tens of pixels per frame with angle noise: smoothed hard, it
          // only says roughly where the hand points.
          ray: [new OneEuro(0.25, 0.5), new OneEuro(0.25, 0.5)],
          closed: false, trail: [], origin: { px, py }, cal: calibrationFor(id), lastT: now - 16,
        };
        tracks.set(id, tr);
      }
      tr.lastSeen = now;
      const dt = Math.min(0.1, Math.max(0.001, (now - tr.lastT) / 1000));
      tr.lastT = now;
      const frame = { lm, world, width: W, height: H, px, py };

      const open = openness(lm);
      const wasClosed = tr.closed;
      if (tr.closed && open > OPEN_ABOVE) tr.closed = false;
      else if (!tr.closed && open < CLOSE_BELOW) tr.closed = true;

      // Calibration follows the first hand that shows an open palm.
      if (calib && !calib.hand && open > OPEN_ABOVE) calib.hand = id;
      if (calib?.hand === id) {
        const state = calib.calibrator.feed(now, { ...frame, open: open > OPEN_ABOVE });
        onCalibrate?.({ hand: id, ...state });
        if (state.done) {
          saved[id] = { ...state.cal, calibrated: true };
          save();
          tr.cal = saved[id];
          tr.origin = { px: state.cal.px, py: state.cal.py };
          calib = null;
        }
      }
      if (tr.recenter) {
        tr.recenter.samples.push(frame);
        if (now >= tr.recenter.until) {
          tr.cal = captureRest(tr.recenter.samples, { ...tr.cal });
          tr.origin = { px: tr.cal.px, py: tr.cal.py };
          tr.recenter = null;
        }
      }

      const pose = palmPose(lm, world, W, H, tr.cal);
      const { tx, ty } = aimFractions(pose, tr.cal);
      const asRight = (id !== "Left") !== !!aim?.mirrorX;
      const startX = asRight ? aim?.startX ?? 1 : 1 - (aim?.startX ?? 1);
      const startY = aim?.startY ?? 0.5;
      // Turning: the calibrated sweep spans the screen, the calibrated tilt reaches top/bottom.
      const turnX = tx * (aim?.sensX ?? 1) * (asRight ? -1 : 1);
      const tilt = aim?.mirrorY ? -ty : ty;
      const turnY = -tilt * (tilt > 0 ? startY : 1 - startY) * (aim?.sensY ?? 1);
      // Moving: how far the palm has travelled across the image since it showed up, in screens.
      const panX = (px - tr.origin.px) * (aim?.panX ?? 1.8);
      const panY = (py - tr.origin.py) * (aim?.panY ?? 1.8);
      const absX = Math.min(1, Math.max(0, startX + turnX + panX));
      const absY = Math.min(1, Math.max(0, startY + turnY + panY));
      const curling = open > CURLING[0] && open < CURLING[1];
      const steadiness = aim?.steadiness ?? 1;
      let x, y, anchor = null, leashScale = 1;
      if (aim?.source === "point") {
        const ray = rayPoint(
          [px, py],
          { yaw: pose.yaw * (aim.mirrorX ? -1 : 1), pitch: pose.pitch * (aim.mirrorY ? -1 : 1) },
          { pan: [aim.panX ?? 1.8, aim.panY ?? 1.8], reach: aim.reach ?? 1.2 }
        );
        // Not clamped to the screen: pointing past the edge is still pointing, and palm travel
        // has to move this and the cursor alike, or the leash fights the hand at the edges.
        anchor = [tr.ray[0].filter(ray.point[0], t), tr.ray[1].filter(ray.point[1], t)];
      } else if (aim?.source === "fused") {
        anchor = headAim ?? [absX, absY];
        leashScale = headAim ? 1 : 1.6;
      }
      if (anchor) {
        // The hand moves the cursor; where it points (or the head) holds the leash.
        tr.fused.palm.scale = steadiness;
        const point = aim.source === "point";
        const target = tr.fused.update({
          dt,
          palm: [px, py],
          angle: point ? null : [startX + turnX, startY + turnY],
          anchor,
          radius: (point ? aim.pointLeash ?? 0.12 : aim.leash ?? 0.12) * leashScale,
          hold: curling, // fingers curling: that motion is the grab, not aiming
          pan: [aim.panX ?? 1.8, aim.panY ?? 1.8],
          // Turning as direct motion was tried for pointing: tens of pixels of jitter. It only
          // moves the leash.
          angleWeight: point ? 0 : aim.angleReach ?? 0,
        });
        [x, y] = tr.spring.update(target[0], target[1], dt);
      } else {
        x = tr.fx.filter(absX, t);
        y = tr.fy.filter(absY, t);

        // Hold still while the fingers curl, then catch up smoothly.
        if (curling && !tr.freeze) tr.freeze = { at: now, x: tr.x ?? x, y: tr.y ?? y };
        if (tr.freeze && !tr.freeze.over && (!curling || now - tr.freeze.at > FREEZE_MAX_MS)) {
          tr.catchUp = { at: now, dx: tr.freeze.x - x, dy: tr.freeze.y - y };
          tr.freeze.over = true;
        }
        if (!curling) tr.freeze = null;
        if (tr.freeze && !tr.freeze.over) (x = tr.freeze.x), (y = tr.freeze.y);
        else if (tr.catchUp) {
          const k = Math.max(0, 1 - (now - tr.catchUp.at) / CATCH_UP_MS);
          x += tr.catchUp.dx * k;
          y += tr.catchUp.dy * k;
          if (k === 0) tr.catchUp = null;
        }
        tr.steady.band.scale = steadiness;
        [x, y] = tr.steady.update(x, y, dt);
      }
      tr.x = x;
      tr.y = y;

      tr.trail.push({ now, x, y });
      while (tr.trail.length > 2 && now - tr.trail[1].now > GRAB_REWIND_MS) tr.trail.shift();
      const back = tr.closed && !wasClosed ? tr.trail[0] : { x, y };
      out.push({
        id, x, y, pickX: back.x, pickY: back.y, cursor: true,
        closed: tr.closed && !calib, // no grabbing mid-calibration
        openness: open, turnX, turnY, panX, panY,
        calibrated: !!tr.cal.calibrated, precise: pose.weight2d,
        anchor, leashScale,
        leash: aim?.source === "point" ? aim.pointLeash ?? 0.12 : aim?.leash ?? 0.12,
      });

      const color = tr.closed ? "#ff5c8a" : "#7ee0ff";
      draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 3 });
      draw.drawLandmarks(lm, { color: "#ffffff", radius: 2 });
    });
    // Forget a hand after it's been gone a moment (that also lets go of what it held).
    for (const [id, tr] of tracks) if (now - tr.lastSeen > 400) tracks.delete(id);
    if (aim?.source === "head") {
      for (const h of out) h.cursor = false;
      if (headEntry) out.unshift({ ...headEntry, closed: !calib && out.some((h) => h.closed) });
    }
    onHands(out);
  };
  loop();

  return {
    // Make each visible hand's current pose "facing forward" and its spot the pan origin.
    recenter() {
      const now = performance.now();
      for (const tr of tracks.values()) tr.recenter = { until: now + RECENTER_MS, samples: [] };
      if (aim?.source === "head") head.recenter = { until: now + RECENTER_MS, samples: [] };
    },
    calibrate() {
      calib = { hand: null, calibrator: new Calibrator() };
      onCalibrate?.({ hand: null, step: "rest", progress: 0, error: null, done: false });
    },
    cancelCalibration() {
      calib = null;
      onCalibrate?.(null);
    },
    forgetCalibration() {
      for (const k of Object.keys(saved)) delete saved[k];
      save();
      for (const [id, tr] of tracks) tr.cal = calibrationFor(id);
    },
    calibratedHands: () => Object.keys(saved),
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      landmarker.close();
      face?.close();
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
