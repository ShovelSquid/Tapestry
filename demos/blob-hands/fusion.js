// Turning noisy tracking into a cursor that feels intentional. Pure math, runs in node.
//
// Two layers:
//
// 1. Fusion (FusedPointer). Each input does what it's good at. The hand moves the cursor
//    relatively: palm travel is the most precise thing MediaPipe measures, and hand angle can
//    add reach. The head (or, without a face, the hand's own absolute aim) holds the cursor on a
//    soft leash: inside the leash radius the hand has full control, past it the cursor is
//    reeled back. So you look roughly, and the hand does the fine work.
//
// 2. Physics (Deadband, Spring2). Every input first passes through an adaptive dead zone that
//    measures its own jitter and ignores movement smaller than that, so a still hand gives a
//    dead-still cursor (and relative motion doesn't drift by summing noise). Then the cursor
//    chases its target on a critically damped spring: smooth, never overshooting.

// One Euro filter: smooth when still, responsive when moving fast.
export class OneEuro {
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

// 2D dead zone that sizes itself to the input's noise. The held point stays put until the input
// moves further than `k` times its typical frame-to-frame jitter, then follows, trailing by that
// much. Jitter is learnt only from small steps, so real motion doesn't inflate it.
export class Deadband {
  constructor({ k = 2.5, min = 0.0005, max = 0.03, scale = 1 } = {}) {
    Object.assign(this, { k, min, max, scale });
    this.held = null;
    this.last = null;
    this.jitter = min;
  }
  get radius() {
    return Math.min(this.max, Math.max(this.min, this.k * this.jitter)) * this.scale;
  }
  update(x, y) {
    if (!this.held) {
      this.held = [x, y];
      this.last = [x, y];
      return this.held;
    }
    const step = Math.hypot(x - this.last[0], y - this.last[1]);
    this.last = [x, y];
    if (step < 3 * this.jitter + this.min) this.jitter += (step - this.jitter) * 0.03;
    const dx = x - this.held[0], dy = y - this.held[1];
    const d = Math.hypot(dx, dy), r = this.radius;
    if (d > r) {
      const f = 1 - r / d;
      this.held = [this.held[0] + dx * f, this.held[1] + dy * f];
    }
    return this.held;
  }
  reset() {
    this.held = null;
  }
}

// Critically damped spring in 2D: chases the target smoothly and settles without overshoot.
// `hz` is roughly how quickly it catches up (higher = snappier).
export class Spring2 {
  constructor(hz = 9) {
    this.hz = hz;
    this.pos = null;
    this.vel = [0, 0];
  }
  update(tx, ty, dt) {
    if (!this.pos) {
      this.pos = [tx, ty];
      return this.pos;
    }
    const w = 2 * Math.PI * this.hz;
    const n = Math.max(1, Math.ceil(dt * 480));
    const h = dt / n;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 2; c++) {
        const t = c ? ty : tx;
        this.vel[c] += (w * w * (t - this.pos[c]) - 2 * w * this.vel[c]) * h;
        this.pos[c] += this.vel[c] * h;
      }
    return this.pos;
  }
}

// Slow hand motion moves the cursor less than 1:1, fast motion more: precision when aiming,
// reach when sweeping. speed is in screens per second.
function acceleration(speed, { slow = 0.55, fast = 1.6, from = 0.08, to = 1.0 } = {}) {
  const t = Math.min(1, Math.max(0, (speed - from) / (to - from)));
  return slow + (fast - slow) * t * t * (3 - 2 * t);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// One hand's fused cursor target (feed the result to a Spring2).
export class FusedPointer {
  constructor() {
    this.target = null;
    this.palm = new Deadband({ max: 0.01 });
    // Hand angle is far noisier than palm position (tens of pixels per frame against one or
    // two), and summing its frame-to-frame changes random-walks. So it's smoothed hard first,
    // and only its slow, deliberate changes add reach.
    this.angleSmooth = [new OneEuro(0.3, 1.5), new OneEuro(0.3, 1.5)];
    this.angle = new Deadband({ max: 0.08 });
    this.time = 0;
    this.lastPalm = null;
    this.lastAngle = null;
  }

  // f: {
  //   dt, palm: [x, y] palm position (image fraction, mirrored),
  //   angle: [x, y] | null  where hand angle alone would aim (screen fraction),
  //   anchor: [x, y] | null where the cursor should stay near (head aim, or the hand's
  //                         absolute aim), radius: its leash, in screens,
  //   hold: true while the fingers curl (motion then is the grab, not aiming),
  //   pan: screens per image width of palm travel (number, or [x, y]),
  //   angleWeight: 0..1 share of angle motion }
  update(f) {
    if (!this.target) this.target = [...(f.anchor ?? f.angle ?? [0.5, 0.5])];
    this.time += f.dt;
    const palm = this.palm.update(f.palm[0], f.palm[1]);
    const angle = f.angle
      ? this.angle.update(this.angleSmooth[0].filter(f.angle[0], this.time), this.angleSmooth[1].filter(f.angle[1], this.time))
      : null;
    if (!f.hold && this.lastPalm) {
      const [gx, gy] = Array.isArray(f.pan) ? f.pan : [f.pan, f.pan];
      const dx = (palm[0] - this.lastPalm[0]) * gx, dy = (palm[1] - this.lastPalm[1]) * gy;
      const g = acceleration(Math.hypot(dx, dy) / Math.max(f.dt, 1e-3));
      this.target[0] += dx * g;
      this.target[1] += dy * g;
      if (angle && this.lastAngle) {
        this.target[0] += (angle[0] - this.lastAngle[0]) * f.angleWeight;
        this.target[1] += (angle[1] - this.lastAngle[1]) * f.angleWeight;
      }
    }
    this.lastPalm = [...palm];
    this.lastAngle = angle && [...angle];
    if (f.anchor) {
      const ex = this.target[0] - f.anchor[0], ey = this.target[1] - f.anchor[1];
      const d = Math.hypot(ex, ey);
      if (d > f.radius) {
        const pull = ((d - f.radius) / d) * Math.min(1, f.dt * 6);
        this.target[0] -= ex * pull;
        this.target[1] -= ey * pull;
      }
    }
    this.target = [clamp01(this.target[0]), clamp01(this.target[1])];
    return this.target;
  }
}

// The physics layer on its own, for sources that already give an absolute aim (hands, head):
// dead zone, then spring.
export class Steady {
  constructor({ hz = 9, steadiness = 1 } = {}) {
    this.band = new Deadband({ max: 0.02, scale: steadiness });
    this.spring = new Spring2(hz);
  }
  update(x, y, dt) {
    const [hx, hy] = this.band.update(x, y);
    return this.spring.update(hx, hy, dt);
  }
}
