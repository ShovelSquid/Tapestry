// Which way the palm faces, measured as precisely as MediaPipe allows. Pure math, runs in node.
//
// MediaPipe gives two views of the hand: 2D image landmarks (pixel-accurate) and 3D world
// landmarks whose depth is a learned guess (noisy). The palm outline (wrist + four knuckles)
// stays rigid even in a fist, and turning it foreshortens it in the image by cos(tilt). So the
// tilt comes from fitting the 2D outline against a template of the palm facing the camera.
//
// Two blind spots, both covered by the 3D guess: cos is flat near 0, so the 2D fit can't resolve
// small tilts (we blend toward 3D there), and an outline tilted one way looks like one tilted
// the other way (3D picks the side). The template comes from calibration; without one this
// falls back to the 3D guess alone. (Building a template from the 3D shape was tried: its noisy
// depth distorts the outline and made things worse than 3D alone.)
//
// On synthetic hands with 1px landmark noise and 8mm depth noise, calibrated, a 30-45 degree
// turn is good to ~1-2 degrees RMS per frame where 3D alone is ~8.
//
// Frame: x right and y down as in the image, z toward the camera. A palm facing the camera has
// normal (0, 0, 1); pitch > 0 tilts it up.

export const PALM = [0, 5, 9, 13, 17];
const DEG = 180 / Math.PI;

// Tilt where the 2D and 3D estimates get equal weight: below it 3D leads, above it 2D does.
const BLEND_SIN2 = Math.sin(12 / DEG) ** 2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// World landmarks in our frame (MediaPipe's z grows away from the camera).
const world3 = (world) => PALM.map((i) => [world[i].x, world[i].y, -world[i].z]);

// Palm normal from the 3D landmarks: the triangle fan from the wrist over the knuckles, summed,
// turned to face the camera.
export function normal3d(world) {
  const P = world3(world);
  let n = [0, 0, 0];
  for (let k = 1; k < P.length - 1; k++) {
    const c = cross(sub(P[k], P[0]), sub(P[k + 1], P[0]));
    n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
  }
  n = unit(n);
  return n[2] < 0 ? n.map((v) => -v) : n;
}

// Palm outline in pixels (so x and y share units).
export function shape2d(lm, width, height) {
  return PALM.map((i) => [lm[i].x * width, lm[i].y * height]);
}

// Centred and scaled to unit RMS radius, so templates compare across distance from the camera.
export function normalizeShape(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) (cx += p[0]), (cy += p[1]);
  cx /= pts.length;
  cy /= pts.length;
  let r = 0;
  for (const p of pts) r += (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
  r = Math.sqrt(r / pts.length) || 1;
  return pts.map((p) => [(p[0] - cx) / r, (p[1] - cy) / r]);
}

// Fit the outline as an affine image of the template. A tilted plane shrinks by cos(tilt) along
// one image direction (the tilt direction) and keeps its size across it, so the ratio of the
// fit's singular values is cos(tilt) and the short axis is the direction of the tilt.
export function tilt2d(pts, template) {
  const q = template;
  let cx = 0, cy = 0;
  for (const p of pts) (cx += p[0]), (cy += p[1]);
  cx /= pts.length;
  cy /= pts.length;
  let a = 0, b = 0, c = 0, d = 0; // sum p q^T
  let e = 0, f = 0, g = 0; // sum q q^T (symmetric: e f / f g)
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i][0] - cx, py = pts[i][1] - cy;
    const [qx, qy] = q[i];
    a += px * qx; b += px * qy; c += py * qx; d += py * qy;
    e += qx * qx; f += qx * qy; g += qy * qy;
  }
  const det = e * g - f * f || 1e-9;
  // A = (sum p q^T)(sum q q^T)^-1
  const A00 = (a * g - b * f) / det, A01 = (b * e - a * f) / det;
  const A10 = (c * g - d * f) / det, A11 = (d * e - c * f) / det;
  // Singular values from A A^T.
  const s00 = A00 * A00 + A01 * A01, s01 = A00 * A10 + A01 * A11, s11 = A10 * A10 + A11 * A11;
  const mean = (s00 + s11) / 2, dev = Math.hypot((s00 - s11) / 2, s01);
  const l1 = mean + dev, l2 = Math.max(mean - dev, 0);
  const phi = 0.5 * Math.atan2(2 * s01, s00 - s11); // long axis
  return { cos: Math.min(1, Math.sqrt(l2 / (l1 || 1e-9))), dir: [-Math.sin(phi), Math.cos(phi)] };
}

const angles = (n) => ({ yaw: Math.atan2(-n[0], n[2]) * DEG, pitch: Math.atan2(-n[1], n[2]) * DEG });

// Palm direction relative to a reference pose `ref` = { template, yaw0, pitch0 }: the outline
// and 3D angles of the forward pose (all optional). Returns yaw and pitch in degrees, plus the
// raw pieces calibration needs.
export function palmPose(lm, world, width, height, ref = {}) {
  const n3 = normal3d(world);
  const a3 = angles(n3);
  const rel3 = { yaw: a3.yaw - (ref.yaw0 ?? 0), pitch: a3.pitch - (ref.pitch0 ?? 0) };
  const shape = normalizeShape(shape2d(lm, width, height));
  if (!ref.template) return { ...rel3, weight2d: 0, raw3d: a3, shape };
  const { cos, dir } = tilt2d(shape, ref.template);
  const s = Math.sqrt(1 - cos * cos);
  // The 2D fit can't tell which side the palm tilted to; take the side the 3D guess is on.
  let nx = s * dir[0], ny = s * dir[1];
  if (nx * -Math.sin(rel3.yaw / DEG) + ny * -Math.sin(rel3.pitch / DEG) < 0) (nx = -nx), (ny = -ny);
  const a2 = angles([nx, ny, cos]);
  const w = (s * s) / (s * s + BLEND_SIN2);
  return {
    yaw: w * a2.yaw + (1 - w) * rel3.yaw,
    pitch: w * a2.pitch + (1 - w) * rel3.pitch,
    weight2d: w,
    raw3d: a3,
    shape,
  };
}

// ---------------------------------------------------------------- calibration and mapping

// What a hand's calibration records. These defaults stand in until one is done: no template
// (3D only), 45 degrees of turn sweeps the screen, 12.5 degrees of tilt reaches top or bottom.
export const UNCALIBRATED = {
  template: null,
  yaw0: 0,
  pitch0: 0,
  turnRest: 0, // |yaw| that reads at rest: noise folds positive, so "facing forward" isn't 0
  turnMax: 45, // |yaw| at the far end of the sweep
  pitchRest: 0,
  pitchAtTurn: 0, // pitch that creeps in at the far end of the sweep (perspective, wrist)
  pitchUp: 12.5,
  pitchDown: 12.5,
  flipY: false, // "up" read as negative pitch during calibration
};

// The same calibration for the other hand: the outline mirrors, the ranges carry over.
export function mirrorCalibration(cal) {
  return { ...cal, template: cal.template?.map(([x, y]) => [-x, y]), yaw0: -cal.yaw0 };
}

// Pose -> how far along each axis, in calibrated units: tx 0 at rest .. 1 at the end of the
// sweep, ty -1 (bottom) .. 1 (top).
export function aimFractions(pose, cal) {
  const tx = Math.max(0, Math.abs(pose.yaw) - cal.turnRest) / Math.max(1, cal.turnMax - cal.turnRest);
  let p = pose.pitch - cal.pitchRest - cal.pitchAtTurn * Math.min(tx, 1.5);
  if (cal.flipY) p = -p;
  return { tx, ty: p >= 0 ? p / cal.pitchUp : p / cal.pitchDown };
}

export const CALIBRATION_STEPS = ["rest", "turn", "up", "down"];
const SETTLE_MS = 1000; // time to get into each pose before holding counts
const HOLD_MS = 800; // how long to hold still
const MAX_SHAPE_DRIFT = 0.05; // outline change (unit RMS radius) that counts as moving
const MAX_MOVE = 0.03; // palm travel (fraction of the image) that counts as moving
const MIN_TURN = 10; // degrees: a sweep smaller than this is probably a mistake
const MIN_TILT = 4;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Make a held pose the forward pose: its outline becomes the template, and what it reads at rest
// becomes zero. Calibration's first step, and the whole of a recenter. samples: frames
// ({ lm, world, width, height, px, py }) of the hand holding still.
export function captureRest(samples, cal) {
  const S = samples.map((s) => ({ ...s, shape: s.shape ?? normalizeShape(shape2d(s.lm, s.width, s.height)) }));
  cal.template = normalizeShape(S[0].shape.map((_, i) => [mean(S.map((s) => s.shape[i][0])), mean(S.map((s) => s.shape[i][1]))]));
  const raw = S.map((s) => palmPose(s.lm, s.world, s.width, s.height).raw3d);
  cal.yaw0 = mean(raw.map((r) => r.yaw));
  cal.pitch0 = mean(raw.map((r) => r.pitch));
  const ps = S.map((s) => palmPose(s.lm, s.world, s.width, s.height, cal));
  cal.turnRest = mean(ps.map((p) => Math.abs(p.yaw)));
  cal.pitchRest = mean(ps.map((p) => p.pitch));
  cal.px = mean(S.map((s) => s.px));
  cal.py = mean(S.map((s) => s.py));
  return cal;
}

// Walks one hand through the four poses. Feed it every frame of that hand; each pose is captured
// once the hand has held still in it for HOLD_MS (open palm, outline and position steady).
export class Calibrator {
  constructor() {
    this.step = 0;
    this.cal = { ...UNCALIBRATED };
    this.error = null;
    this.enter(null);
  }

  enter(now) {
    this.enteredAt = now;
    this.anchor = null;
    this.samples = [];
  }

  // frame: { lm, world, width, height, px, py, open (bool: palm open) }
  // Returns { step, progress 0..1, error, done, cal }.
  feed(now, f) {
    if (this.enteredAt === null) this.enteredAt = now;
    const shape = normalizeShape(shape2d(f.lm, f.width, f.height));
    const settled = now - this.enteredAt >= SETTLE_MS;
    const moved =
      !this.anchor ||
      Math.hypot(f.px - this.anchor.px, f.py - this.anchor.py) > MAX_MOVE ||
      Math.sqrt(mean(shape.map((p, i) => (p[0] - this.anchor.shape[i][0]) ** 2 + (p[1] - this.anchor.shape[i][1]) ** 2))) > MAX_SHAPE_DRIFT;
    if (!settled || !f.open || moved) {
      this.anchor = { now, px: f.px, py: f.py, shape };
      this.samples = [];
    }
    this.samples.push({ ...f, shape });
    const progress = settled && f.open ? Math.min(1, (now - this.anchor.now) / HOLD_MS) : 0;
    if (progress >= 1) this.capture(now);
    return { step: CALIBRATION_STEPS[this.step], progress, error: this.error, done: this.step >= CALIBRATION_STEPS.length, cal: this.cal };
  }

  capture(now) {
    const S = this.samples;
    const cal = this.cal;
    const poses = () => S.map((s) => palmPose(s.lm, s.world, s.width, s.height, cal));
    this.error = null;
    switch (CALIBRATION_STEPS[this.step]) {
      case "rest":
        captureRest(S, cal);
        break;
      case "turn": {
        const ps = poses();
        const turn = mean(ps.map((p) => Math.abs(p.yaw)));
        if (turn - cal.turnRest < MIN_TURN) return this.retry(now, "small-turn");
        cal.turnMax = turn;
        cal.pitchAtTurn = mean(ps.map((p) => p.pitch)) - cal.pitchRest;
        break;
      }
      case "up":
      case "down": {
        const up = CALIBRATION_STEPS[this.step] === "up";
        const tilt = mean(poses().map((p) => p.pitch - cal.pitchRest - cal.pitchAtTurn * Math.min(aimFractions(p, cal).tx, 1.5)));
        if (Math.abs(tilt) < MIN_TILT) return this.retry(now, "small-tilt");
        if (up) {
          cal.flipY = tilt < 0;
          cal.pitchUp = Math.abs(tilt);
        } else {
          if (tilt < 0 === cal.flipY) return this.retry(now, "same-way");
          cal.pitchDown = Math.abs(tilt);
        }
        break;
      }
    }
    this.step++;
    this.enter(now);
  }

  retry(now, why) {
    this.error = why;
    this.enter(now);
  }
}
