// The blob: a soft body of metaball particles held together by springs.
//
// Each particle is a sphere. A blob is a connected group of particles (connected by springs);
// its surface is the smooth union (polynomial smin) of its spheres. Different blobs meet with a
// hard min, so two blobs touching stay visibly two. Springs stretched past `breakRatio` snap,
// which is how a blob tears in two; particles that touch reconnect, which is how blobs merge.
//
// Pure data and math, no DOM or GPU, so it runs under node for tests.

export const MAX_PARTICLES = 64;

const golden = 0.618033988749895;

export function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function blobColor(id) {
  return hsl((0.93 + id * golden) % 1, 0.75, 0.6);
}

// Polynomial smooth min. Returns [distance, weight of b] for blending attributes.
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  const m = h * h * 0.5;
  const s = m * k * 0.5;
  return a < b ? [a - s, m] : [b - s, 1 - m];
}

export class Blob {
  constructor(opts = {}) {
    this.spacing = opts.spacing ?? 0.27; // rest distance between neighbours
    this.radius = opts.radius ?? 0.2; // sphere radius per particle
    this.k = opts.k ?? 0.22; // smin blend width
    this.breakRatio = opts.breakRatio ?? 2.0; // spring snaps past rest * this
    this.stiffness = 70;
    this.damping = 2.5;
    this.bounds = { x: 2.5, y: 1.6 }; // half extents of the play area at z = 0
    this.reset(opts.count ?? 1);
  }

  reset(count = 1) {
    const pts = [];
    const s = this.spacing;
    // FCC lattice (nearest neighbour = s) clipped to a squashed sphere.
    const a = s * Math.SQRT2;
    const R = [0.72, 0.72, 0.42];
    const n = 4;
    const offsets = [
      [0, 0, 0],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ];
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++)
        for (let k = -n; k <= n; k++)
          for (const o of offsets) {
            const p = [(i + o[0]) * a, (j + o[1]) * a, (k + o[2]) * a];
            const q = (p[0] / R[0]) ** 2 + (p[1] / R[1]) ** 2 + (p[2] / R[2]) ** 2;
            if (q <= 1) pts.push(p);
          }
    pts.sort((p, q) => p[0] ** 2 + p[1] ** 2 + p[2] ** 2 - (q[0] ** 2 + q[1] ** 2 + q[2] ** 2));
    const per = Math.floor(MAX_PARTICLES / count);
    const n0 = Math.min(pts.length, per);
    const all = [];
    for (let b = 0; b < count; b++) {
      const cx = count === 1 ? 0 : (b - (count - 1) / 2) * 1.7;
      for (let i = 0; i < n0; i++) all.push([pts[i][0] + cx, pts[i][1], pts[i][2]]);
    }

    this.n = all.length;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.blobId = new Int32Array(this.n);
    this.cluster = new Int32Array(this.n);
    this.pinned = new Uint8Array(this.n); // held by a cursor: moved kinematically
    this.target = new Float32Array(this.n * 3);
    all.forEach((p, i) => this.pos.set(p, i * 3));

    this.springs = new Map(); // key a*MAX+b (a<b) -> rest length
    this.formSprings(1.15);
    this.nextBlobId = 0;
    this.blobId.fill(-1);
    this.updateClusters();
    for (let i = 0; i < this.n; i++) this.col.set(blobColor(this.blobId[i]), i * 3);
  }

  key(a, b) {
    return a < b ? a * MAX_PARTICLES + b : b * MAX_PARTICLES + a;
  }

  dist(a, b) {
    const p = this.pos;
    const dx = p[a * 3] - p[b * 3],
      dy = p[a * 3 + 1] - p[b * 3 + 1],
      dz = p[a * 3 + 2] - p[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Connect touching particles that aren't connected yet.
  formSprings(reach) {
    const s = this.spacing;
    for (let a = 0; a < this.n; a++)
      for (let b = a + 1; b < this.n; b++) {
        const key = this.key(a, b);
        if (this.springs.has(key)) continue;
        if (this.dist(a, b) < s * reach) this.springs.set(key, s);
      }
  }

  // Connected components over springs, with stable blob ids: each component keeps the id most
  // of its particles had, and when a blob splits the bigger piece keeps it.
  updateClusters() {
    const n = this.n;
    const parent = new Int32Array(n).map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (const key of this.springs.keys()) {
      const a = Math.floor(key / MAX_PARTICLES),
        b = key % MAX_PARTICLES;
      const ra = find(a),
        rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    const comps = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(i);
    }
    const list = [...comps.values()].sort((a, b) => b.length - a.length);
    const claimed = new Set();
    list.forEach((members, ci) => {
      const votes = new Map();
      for (const i of members) if (this.blobId[i] >= 0) votes.set(this.blobId[i], (votes.get(this.blobId[i]) ?? 0) + 1);
      let id = -1,
        best = 0;
      for (const [v, c] of votes) if (!claimed.has(v) && c > best) (id = v), (best = c);
      if (id < 0) id = this.nextBlobId++;
      claimed.add(id);
      for (const i of members) {
        this.blobId[i] = id;
        this.cluster[i] = ci;
      }
    });
    this.clusterCount = list.length;
    // Particle order grouped by cluster, for the per-blob smin in the SDF.
    this.order = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.cluster[a] - this.cluster[b]);
    this.pack();
  }

  step(dt) {
    const { n, pos, vel, pinned, target } = this;
    const f = new Float32Array(n * 3);
    const s = this.spacing;
    let broke = false;

    for (const [key, rest] of this.springs) {
      const a = Math.floor(key / MAX_PARTICLES),
        b = key % MAX_PARTICLES;
      const dx = pos[b * 3] - pos[a * 3],
        dy = pos[b * 3 + 1] - pos[a * 3 + 1],
        dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      if (len > rest * this.breakRatio) {
        this.springs.delete(key);
        broke = true;
        continue;
      }
      const ux = dx / len,
        uy = dy / len,
        uz = dz / len;
      const rv = (vel[b * 3] - vel[a * 3]) * ux + (vel[b * 3 + 1] - vel[a * 3 + 1]) * uy + (vel[b * 3 + 2] - vel[a * 3 + 2]) * uz;
      const mag = this.stiffness * (len - rest) + this.damping * rv;
      f[a * 3] += ux * mag;
      f[a * 3 + 1] += uy * mag;
      f[a * 3 + 2] += uz * mag;
      f[b * 3] -= ux * mag;
      f[b * 3 + 1] -= uy * mag;
      f[b * 3 + 2] -= uz * mag;
    }

    // Short-range repulsion keeps volume; it acts across blobs too, so they bump.
    const rr = s * 0.92;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const dx = pos[b * 3] - pos[a * 3],
          dy = pos[b * 3 + 1] - pos[a * 3 + 1],
          dz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const mag = 120 * (rr - d);
        f[a * 3] -= (dx / d) * mag;
        f[a * 3 + 1] -= (dy / d) * mag;
        f[a * 3 + 2] -= (dz / d) * mag;
        f[b * 3] += (dx / d) * mag;
        f[b * 3 + 1] += (dy / d) * mag;
        f[b * 3 + 2] += (dz / d) * mag;
      }

    const drag = Math.exp(-1.8 * dt);
    const { x: bx, y: by } = this.bounds;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (pinned[i]) {
        // Follow the cursor closely; velocity is what we moved, so letting go throws it.
        const t = Math.min(1, dt * 25);
        for (let c = 0; c < 3; c++) {
          const np = pos[o + c] + (target[o + c] - pos[o + c]) * t;
          vel[o + c] = (np - pos[o + c]) / dt;
          pos[o + c] = np;
        }
        continue;
      }
      f[o + 2] -= 6 * pos[o + 2]; // stay near the z = 0 plane
      for (let c = 0; c < 3; c++) {
        vel[o + c] = (vel[o + c] + f[o + c] * dt) * drag;
        pos[o + c] += vel[o + c] * dt;
      }
      // Soft walls at the edge of the screen.
      if (pos[o] > bx) (pos[o] = bx), (vel[o] *= -0.4);
      if (pos[o] < -bx) (pos[o] = -bx), (vel[o] *= -0.4);
      if (pos[o + 1] > by) (pos[o + 1] = by), (vel[o + 1] *= -0.4);
      if (pos[o + 1] < -by) (pos[o + 1] = -by), (vel[o + 1] *= -0.4);
    }

    const before = this.springs.size;
    this.formSprings(1.02);
    if (broke || this.springs.size !== before) this.updateClusters();

    this.pack();

    // Ease each particle's colour toward its blob's colour.
    const e = Math.min(1, dt * 4);
    for (let i = 0; i < n; i++) {
      const c = blobColor(this.blobId[i]);
      for (let j = 0; j < 3; j++) this.col[i * 3 + j] += (c[j] - this.col[i * 3 + j]) * e;
    }
  }

  // Particle positions packed in cluster order (x, y, z, cluster), for the SDF's inner loop.
  pack() {
    const { n, pos, order, cluster } = this;
    if (!this.packed || this.packed.length !== n * 4) this.packed = new Float32Array(n * 4);
    const p = this.packed;
    for (let j = 0; j < n; j++) {
      const i = order[j];
      p[j * 4] = pos[i * 3];
      p[j * 4 + 1] = pos[i * 3 + 1];
      p[j * 4 + 2] = pos[i * 3 + 2];
      p[j * 4 + 3] = cluster[i];
    }
  }

  // Signed distance to the surface: smin within a blob, hard min between blobs.
  sdf(x, y, z) {
    const p = this.packed, n4 = this.n * 4, k = this.k, r = this.radius;
    let best = 1e9, cur = 1e9, cid = -1;
    for (let j = 0; j < n4; j += 4) {
      if (p[j + 3] !== cid) {
        if (cur < best) best = cur;
        cur = 1e9;
        cid = p[j + 3];
      }
      const dx = x - p[j], dy = y - p[j + 1], dz = z - p[j + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      const h = Math.max(k - Math.abs(cur - d), 0) / k;
      cur = Math.min(cur, d) - h * h * k * 0.25;
    }
    return Math.min(best, cur);
  }

  // Distance, outward normal and colour in one pass. The polynomial smin's derivative weights
  // b by h/2, so the gradient blends exactly; colour blends by the smoother h^2/2.
  eval(x, y, z, g, c) {
    const { pos, order, cluster, k, radius, col } = this;
    let best = 1e9, cur = 1e9, cid = -1;
    let bgx = 0, bgy = 0, bgz = 0, gx = 0, gy = 0, gz = 0;
    let br = 0, bg = 0, bb = 0, cr = 0, cg = 0, cb = 0;
    for (let j = 0; j < order.length; j++) {
      const i = order[j];
      if (cluster[i] !== cid) {
        if (cur < best) (best = cur), (bgx = gx), (bgy = gy), (bgz = gz), (br = cr), (bg = cg), (bb = cb);
        cur = 1e9;
        cid = cluster[i];
      }
      const dx = x - pos[i * 3], dy = y - pos[i * 3 + 1], dz = z - pos[i * 3 + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const d = len - radius;
      const h = Math.max(k - Math.abs(cur - d), 0) / k;
      const wg = cur < d ? h * 0.5 : 1 - h * 0.5; // weight of the new sphere in the gradient
      const wc = cur < d ? h * h * 0.5 : 1 - h * h * 0.5; // and in the colour
      gx += (dx / len - gx) * wg;
      gy += (dy / len - gy) * wg;
      gz += (dz / len - gz) * wg;
      cr += (col[i * 3] - cr) * wc;
      cg += (col[i * 3 + 1] - cg) * wc;
      cb += (col[i * 3 + 2] - cb) * wc;
      cur = Math.min(cur, d) - h * h * k * 0.25;
    }
    if (cur < best) (best = cur), (bgx = gx), (bgy = gy), (bgz = gz), (br = cr), (bg = cg), (bb = cb);
    const l = Math.hypot(bgx, bgy, bgz) || 1;
    if (g) (g[0] = bgx / l), (g[1] = bgy / l), (g[2] = bgz / l);
    if (c) (c[0] = br), (c[1] = bg), (c[2] = bb);
    return best;
  }

  bbox(pad) {
    const min = [1e9, 1e9, 1e9],
      max = [-1e9, -1e9, -1e9];
    for (let i = 0; i < this.n; i++)
      for (let c = 0; c < 3; c++) {
        const v = this.pos[i * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    const p = this.radius + pad;
    return { min: min.map((v) => v - p), max: max.map((v) => v + p) };
  }

  // Particles a cursor at (x, y) on the z = 0 plane would pick up.
  pick(x, y, reach, exclude) {
    const near = [];
    let nearest = -1,
      nd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (exclude?.has(i)) continue;
      const d = Math.hypot(this.pos[i * 3] - x, this.pos[i * 3 + 1] - y);
      if (d < reach) near.push(i);
      if (d < nd) (nd = d), (nearest = i);
    }
    if (near.length) return near;
    // Missed by a little: grab around the closest particle instead.
    if (nearest < 0 || nd > reach + this.radius * 1.5) return [];
    const cx = this.pos[nearest * 3],
      cy = this.pos[nearest * 3 + 1];
    return this.pick(cx, cy, reach, exclude);
  }
}

// Surface nets over the blob's SDF. Returns positions, normals and colours per vertex and a
// triangle index list.
export function surfaceNets(blob, cell = 0.06) {
  const { min, max } = blob.bbox(blob.k * 0.3 + cell * 2); // smin bulges by at most k/4
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  // Narrow band: the SDF is 1-Lipschitz, so a brick whose centre is further from the surface
  // than its half diagonal can't contain any of it. Fill those with the centre value (only the
  // sign matters there) and evaluate the rest point by point.
  const B = 2;
  const reach = Math.sqrt(3) * (B / 2) * cell + cell;
  for (let bz = 0; bz < nz; bz += B)
    for (let by = 0; by < ny; by += B)
      for (let bx = 0; bx < nx; bx += B) {
        const ex = Math.min(bx + B, nx), ey = Math.min(by + B, ny), ez = Math.min(bz + B, nz);
        const dc = blob.sdf(min[0] + (bx + ex - 1) * 0.5 * cell, min[1] + (by + ey - 1) * 0.5 * cell, min[2] + (bz + ez - 1) * 0.5 * cell);
        const far = Math.abs(dc) > reach;
        for (let z = bz; z < ez; z++)
          for (let y = by; y < ey; y++)
            for (let x = bx; x < ex; x++)
              field[x + nx * (y + ny * z)] = far ? dc : blob.sdf(min[0] + x * cell, min[1] + y * cell, min[2] + z * cell);
      }

  const at = (x, y, z) => field[x + nx * (y + ny * z)];
  const cells = (nx - 1) * (ny - 1) * (nz - 1);
  const vert = new Int32Array(cells).fill(-1);
  const cellIdx = (x, y, z) => x + (nx - 1) * (y + (ny - 1) * z);
  const positions = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float32Array(8);
  for (let z = 0; z < nz - 1; z++)
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = at(x + corners[c][0], y + corners[c][1], z + corners[c][2]);
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          const A = corners[a], B = corners[b];
          sx += A[0] + (B[0] - A[0]) * t;
          sy += A[1] + (B[1] - A[1]) * t;
          sz += A[2] + (B[2] - A[2]) * t;
          cnt++;
        }
        vert[cellIdx(x, y, z)] = positions.length / 3;
        positions.push(min[0] + (x + sx / cnt) * cell, min[1] + (y + sy / cnt) * cell, min[2] + (z + sz / cnt) * cell);
      }

  // One quad per grid edge that crosses the surface, joining the four cells around it.
  const indices = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        const inside = at(x, y, z) < 0;
        if (inside !== at(x + 1, y, z) < 0)
          quad(vert[cellIdx(x, y, z)], vert[cellIdx(x, y - 1, z)], vert[cellIdx(x, y - 1, z - 1)], vert[cellIdx(x, y, z - 1)], !inside);
        if (inside !== at(x, y + 1, z) < 0)
          quad(vert[cellIdx(x, y, z)], vert[cellIdx(x, y, z - 1)], vert[cellIdx(x - 1, y, z - 1)], vert[cellIdx(x - 1, y, z)], !inside);
        if (inside !== at(x, y, z + 1) < 0)
          quad(vert[cellIdx(x, y, z)], vert[cellIdx(x - 1, y, z)], vert[cellIdx(x - 1, y - 1, z)], vert[cellIdx(x, y - 1, z)], !inside);
      }

  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const g = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    blob.eval(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], g, c);
    normals.set(g, i * 3);
    colors.set(c, i * 3);
  }
  return { positions: new Float32Array(positions), normals, colors, indices: new Uint32Array(indices) };
}

// Fibonacci directions on the unit sphere.
export function sphereDirs(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
}

// Gaussian surface splats: seed points on each particle's sphere, pull them onto the blended
// surface with a few Newton steps, keep the ones that land on it.
export function surfaceSplats(blob, dirs, out) {
  const { pos, radius } = blob;
  const g = [0, 0, 0], c = [0, 0, 0];
  let m = 0;
  for (let i = 0; i < blob.n; i++)
    for (const d of dirs) {
      let x = pos[i * 3] + d[0] * radius,
        y = pos[i * 3 + 1] + d[1] * radius,
        z = pos[i * 3 + 2] + d[2] * radius;
      let s = blob.eval(x, y, z, g);
      if (s < -0.1) continue; // seed buried deep inside the blob
      for (let it = 0; it < 3; it++) {
        x -= g[0] * s;
        y -= g[1] * s;
        z -= g[2] * s;
        s = blob.eval(x, y, z, g, c);
      }
      if (Math.abs(s) > 0.01) continue;
      out.pos[m * 3] = x;
      out.pos[m * 3 + 1] = y;
      out.pos[m * 3 + 2] = z;
      out.normal.set(g, m * 3);
      out.color.set(c, m * 3);
      m++;
    }
  return m;
}
