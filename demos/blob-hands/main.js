import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Blob, MAX_PARTICLES, sphereDirs, surfaceSplats } from "./blob.js";

const blob = new Blob();
window.blob = blob; // for poking at from the console

// ---------------------------------------------------------------- scene

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
camera.position.set(0, 0, 6);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x302040, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-3, 4, 4);
scene.add(sun);

// Particle state every shader shares: position + radius, colour + cluster id.
const uniforms = {
  uP: { value: Array.from({ length: MAX_PARTICLES }, () => new THREE.Vector4()) },
  uC: { value: Array.from({ length: MAX_PARTICLES }, () => new THREE.Vector4()) },
  uN: { value: 0 },
  uK: { value: blob.k },
  uTime: { value: 0 },
  uInvVP: { value: new THREE.Matrix4() },
  uBoxMin: { value: new THREE.Vector3() },
  uBoxMax: { value: new THREE.Vector3() },
  uSize: { value: 0.07 },
  uPx: { value: 0.001 }, // angular size of a pixel, for the ray-marcher's edge antialiasing
};

const GLSL_COMMON = /* glsl */ `
  uniform vec4 uP[${MAX_PARTICLES}];
  uniform vec4 uC[${MAX_PARTICLES}];
  uniform int uN;
  uniform float uK;

  // smin within a blob (particles arrive grouped by cluster), hard min between blobs.
  float mapD(vec3 p) {
    float best = 1e9, cur = 1e9, cid = -1.0;
    for (int i = 0; i < ${MAX_PARTICLES}; i++) {
      if (i >= uN) break;
      if (uC[i].w != cid) { best = min(best, cur); cur = 1e9; cid = uC[i].w; }
      float d = length(p - uP[i].xyz) - uP[i].w;
      float h = max(uK - abs(cur - d), 0.0) / uK;
      cur = min(cur, d) - h * h * uK * 0.25;
    }
    return min(best, cur);
  }

  vec3 mapCol(vec3 p) {
    float best = 1e9, cur = 1e9, cid = -1.0;
    vec3 bc = vec3(0.0), cc = vec3(0.0);
    for (int i = 0; i < ${MAX_PARTICLES}; i++) {
      if (i >= uN) break;
      if (uC[i].w != cid) { if (cur < best) { best = cur; bc = cc; } cur = 1e9; cid = uC[i].w; }
      float d = length(p - uP[i].xyz) - uP[i].w;
      float h = max(uK - abs(cur - d), 0.0) / uK;
      float m = h * h * 0.5;
      cc = mix(cc, uC[i].rgb, cur < d ? m : 1.0 - m);
      cur = min(cur, d) - h * h * uK * 0.25;
    }
    if (cur < best) bc = cc;
    return pow(bc, vec3(2.2));
  }

`;

const GLSL_SHADE = /* glsl */ `
  const vec3 LIGHT = normalize(vec3(-0.5, 0.8, 0.7));

  // Gummy candy: wrapped diffuse, tight highlight, rim, and a glow where it's thin.
  vec3 shade(vec3 base, vec3 n, vec3 V, float thin) {
    vec3 H = normalize(LIGHT + V);
    float wrap = clamp((dot(n, LIGHT) + 0.5) / 1.5, 0.0, 1.0);
    float nh = max(dot(n, H), 0.0);
    float spec = pow(nh, 90.0) * 1.4 + pow(nh, 14.0) * 0.12;
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    return base * (0.16 + 0.84 * wrap) + base * base * thin * 0.6 + spec + mix(base, vec3(1.0), 0.5) * fres * 0.45;
  }
`;

// Ground: a dotted backdrop behind the blobs that catches a soft shadow.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      varying vec3 vW;
      void main() {
        float cur = 1e9;
        for (int i = 0; i < ${MAX_PARTICLES}; i++) {
          if (i >= uN) break;
          vec3 c = uP[i].xyz;
          vec2 sp = c.xy + vec2(0.28, -0.36) * (c.z - vW.z);
          float d = length(vW.xy - sp) - uP[i].w * 1.15;
          float h = max(0.3 - abs(cur - d), 0.0) / 0.3;
          cur = min(cur, d) - h * h * 0.075;
        }
        float sh = (1.0 - smoothstep(-0.2, 0.35, cur)) * 0.5;
        vec2 g = fract(vW.xy * 4.0) - 0.5;
        float dots = smoothstep(0.05, 0.025, length(g)) * 0.13 * (1.0 - sh);
        float a = sh + dots;
        gl_FragColor = vec4(vec3(0.7, 0.75, 1.0) * dots / max(a, 1e-4), a);
      }`,
  })
);
ground.position.z = -0.9;
ground.renderOrder = -1;
scene.add(ground);

// Mode 1: ray-march the SDF directly, one full-screen quad.
const sdfQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${GLSL_SHADE}
      uniform mat4 uInvVP;
      uniform vec3 uBoxMin, uBoxMax;
      uniform float uPx;
      varying vec2 vNdc;

      vec3 calcNormal(vec3 p) {
        const vec2 e = vec2(1.0, -1.0) * 0.0015;
        return normalize(e.xyy * mapD(p + e.xyy) + e.yyx * mapD(p + e.yyx) + e.yxy * mapD(p + e.yxy) + e.xxx * mapD(p + e.xxx));
      }

      void main() {
        vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
        vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
        vec3 ro = cameraPosition;
        vec3 rd = normalize(b.xyz / b.w - a.xyz / a.w);
        // Only march inside the blobs' bounding box.
        vec3 inv = 1.0 / rd;
        vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
        vec3 tn = min(t0, t1), tf = max(t0, t1);
        float tin = max(max(tn.x, tn.y), tn.z), tout = min(min(tf.x, tf.y), tf.z);
        if (tin > tout || tout < 0.0) discard;
        float t = max(tin, 0.0);
        bool hit = false;
        float closest = 1e9, tClosest = t; // nearest miss, in pixels-ish (distance over depth)
        for (int s = 0; s < 96; s++) {
          float d = mapD(ro + rd * t);
          if (d < 0.0006 * t) { hit = true; break; }
          if (d / t < closest) { closest = d / t; tClosest = t; }
          t += d;
          if (t > tout) break;
        }
        // A ray that just grazed the surface gets partial coverage: soft, antialiased edges.
        float alpha = hit ? 1.0 : 1.0 - closest / (1.5 * uPx);
        if (alpha <= 0.0) discard;
        if (!hit) t = tClosest;
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);
        float thin = 1.0 - clamp(-mapD(p - n * 0.14) / 0.14, 0.0, 1.0);
        float ao = clamp(0.5 + 0.5 * mapD(p + n * 0.12) / 0.12, 0.0, 1.0);
        gl_FragColor = vec4(shade(mapCol(p), n, -rd, thin) * mix(0.55, 1.0, ao), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sdfQuad.frustumCulled = false;
sdfQuad.renderOrder = 1;
scene.add(sdfQuad);

// Mode 2: gaussian splats. Samples on the surface, each an oriented disc with gaussian falloff.
const DIRS = sphereDirs(80);
const MAX_SPLATS = MAX_PARTICLES * DIRS.length;
const splatData = {
  pos: new Float32Array(MAX_SPLATS * 3),
  normal: new Float32Array(MAX_SPLATS * 3),
  color: new Float32Array(MAX_SPLATS * 3),
};
const splatGeo = new THREE.InstancedBufferGeometry();
{
  const quad = new THREE.PlaneGeometry(2, 2);
  splatGeo.index = quad.index;
  splatGeo.setAttribute("position", quad.getAttribute("position"));
  splatGeo.setAttribute("iPos", new THREE.InstancedBufferAttribute(splatData.pos, 3).setUsage(THREE.DynamicDrawUsage));
  splatGeo.setAttribute("iNormal", new THREE.InstancedBufferAttribute(splatData.normal, 3).setUsage(THREE.DynamicDrawUsage));
  splatGeo.setAttribute("iColor", new THREE.InstancedBufferAttribute(splatData.color, 3).setUsage(THREE.DynamicDrawUsage));
  const seed = new Float32Array(MAX_SPLATS).map(() => Math.random());
  splatGeo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seed, 1));
}
const splats = new THREE.Mesh(
  splatGeo,
  new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      ${GLSL_SHADE}
      uniform float uSize;
      attribute vec3 iPos, iNormal, iColor;
      attribute float iSeed;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vec3 n = normalize(iNormal);
        vec3 tg = normalize(cross(abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
        vec3 bt = cross(n, tg);
        float s = uSize * (0.7 + 0.6 * iSeed);
        vec3 wp = iPos + n * 0.004 + (tg * position.x + bt * position.y) * s * 2.5;
        vec3 V = normalize(cameraPosition - iPos);
        float facing = dot(n, V);
        vCol = shade(pow(iColor, vec3(2.2)), n, V, 0.0);
        vAlpha = smoothstep(-0.05, 0.3, facing); // back-facing splats fade out
        vUv = position.xy * 2.5; // in sigmas
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        float a = min(1.0, exp(-0.5 * dot(vUv, vUv)) * 1.15) * vAlpha;
        if (a < 0.015) discard;
        gl_FragColor = vec4(vCol, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
splats.frustumCulled = false;
scene.add(splats);

// Mode 3: a real triangle mesh from surface nets (built in a worker), with its vertices
// wobbling procedurally along their normals.
function wobble(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float w = sin(position.x * 9.0 + uTime * 2.1) * sin(position.y * 8.0 - uTime * 1.7) * sin(position.z * 10.0 + uTime * 1.3);
       transformed += normal * w * 0.022;`
    );
  };
  return material;
}
let meshGeo = new THREE.BufferGeometry();
const mesh = new THREE.Mesh(
  meshGeo,
  wobble(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4 }))
);
const wire = new THREE.Mesh(
  meshGeo,
  wobble(new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }))
);
mesh.frustumCulled = wire.frustumCulled = false;
scene.add(mesh, wire);

const worker = new Worker(new URL("./mesh-worker.js", import.meta.url), { type: "module" });
let workerBusy = false;
worker.onmessage = ({ data }) => {
  workerBusy = false;
  const c = data.colors;
  for (let i = 0; i < c.length; i++) c[i] = Math.pow(c[i], 2.2); // vertex colours are linear
  // A fresh geometry each time: three caches the wireframe index per geometry, and it would go
  // stale if we swapped buffers on the old one.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  meshGeo.dispose();
  meshGeo = mesh.geometry = wire.geometry = geo;
};
worker.onerror = (e) => console.error("mesh worker:", e.message);
function requestMesh() {
  if (workerBusy) return;
  workerBusy = true;
  const { n, pos, col, order, cluster, k, radius } = blob;
  worker.postMessage({ n, pos, col, order, cluster, k, radius, cell: 0.06 });
}

// ---------------------------------------------------------------- modes and settings

const MODES = ["sdf", "splat", "mesh"];
let mode = "sdf";
let showWire = true;
let quality = 1; // render scale for the ray-marcher, adapts to frame time
const dpr = Math.min(window.devicePixelRatio || 1, 2);

function setMode(m) {
  mode = m;
  sdfQuad.visible = m === "sdf";
  splats.visible = m === "splat";
  mesh.visible = m === "mesh";
  wire.visible = m === "mesh" && showWire;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  document.getElementById("wire").disabled = m !== "mesh";
  resize();
}

document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
const wireBtn = document.getElementById("wire");
wireBtn.addEventListener("click", () => {
  showWire = !showWire;
  wireBtn.classList.toggle("on", showWire);
  setMode(mode);
});

const settings = { grab: 0.34 };
function slider(id, apply) {
  const el = document.getElementById(id);
  const out = document.querySelector(`output[for=${id}]`);
  const update = () => {
    apply(+el.value);
    out.textContent = (+el.value).toFixed(2);
  };
  el.addEventListener("input", update);
  update();
}
slider("sticky", (v) => (blob.breakRatio = v));
slider("grabsize", (v) => (settings.grab = v));
slider("goo", (v) => (blob.k = uniforms.uK.value = v));

function reset(count) {
  for (const c of cursors.values()) c.held = [];
  blob.reset(count);
}
document.getElementById("reset").addEventListener("click", () => reset(1));
document.getElementById("two").addEventListener("click", () => reset(2));

addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key >= "1" && e.key <= "3") setMode(MODES[+e.key - 1]);
  if (e.key === "w") wireBtn.click();
  if (e.key === "r") reset(1);
  if (e.key === "t") reset(2);
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(mode === "sdf" ? dpr * quality : dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  blob.bounds = { x: hh * camera.aspect - 0.25, y: hh - 0.25 };
}
addEventListener("resize", resize);

// ---------------------------------------------------------------- cursors (hands, mouse, touch)

const cursors = new Map(); // id -> { x, y (px), closed, held: [{ i, off }], el, seen }
const cursorLayer = document.getElementById("cursors");
const ray = new THREE.Vector3();

function toWorld(px, py) {
  ray.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
  const t = -camera.position.z / ray.z;
  return [camera.position.x + ray.x * t, camera.position.y + ray.y * t];
}

function heldElsewhere(except) {
  const s = new Set();
  for (const c of cursors.values()) if (c !== except) for (const h of c.held) s.add(h.i);
  return s;
}

function release(c) {
  for (const h of c.held) blob.pinned[h.i] = 0;
  c.held = [];
}

// Feed one cursor's state. `visual` cursors (hands) get a ring drawn on screen.
function feed(id, px, py, closed, visual) {
  let c = cursors.get(id);
  if (!c) {
    c = { held: [], closed: false };
    if (visual) {
      c.el = document.createElement("div");
      c.el.className = "cursor";
      cursorLayer.append(c.el);
    }
    cursors.set(id, c);
  }
  c.x = px;
  c.y = py;
  c.seen = performance.now();
  const [wx, wy] = toWorld(px, py);
  if (closed && !c.closed) {
    for (const i of blob.pick(wx, wy, settings.grab, heldElsewhere(c))) {
      blob.pinned[i] = 1;
      c.held.push({ i, off: [blob.pos[i * 3] - wx, blob.pos[i * 3 + 1] - wy] });
    }
  } else if (!closed && c.closed) release(c);
  c.closed = closed;
  c.hot = !closed && blob.sdf(wx, wy, 0) < 0.12;
}

function dropCursor(id) {
  const c = cursors.get(id);
  if (!c) return;
  release(c);
  c.el?.remove();
  cursors.delete(id);
}

function applyCursors() {
  for (const c of cursors.values()) {
    const [wx, wy] = toWorld(c.x, c.y);
    for (const h of c.held) {
      blob.target[h.i * 3] = wx + h.off[0];
      blob.target[h.i * 3 + 1] = wy + h.off[1];
      blob.target[h.i * 3 + 2] = blob.pos[h.i * 3 + 2] * 0.9;
    }
    if (c.el) {
      c.el.style.transform = `translate(${c.x}px, ${c.y}px)`;
      c.el.classList.toggle("closed", c.closed);
      c.el.classList.toggle("hot", !!c.hot);
    }
  }
  const anyHeld = [...cursors.values()].some((c) => c.held.length);
  canvas.style.cursor = anyHeld ? "grabbing" : "grab";
}

// Mouse and touch: every pointer is its own cursor, so two fingers can pull a blob apart.
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  feed(`p${e.pointerId}`, e.clientX, e.clientY, true, false);
});
canvas.addEventListener("pointermove", (e) => {
  const c = cursors.get(`p${e.pointerId}`);
  feed(`p${e.pointerId}`, e.clientX, e.clientY, c?.closed ?? false, false);
});
const pointerUp = (e) => dropCursor(`p${e.pointerId}`);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
canvas.addEventListener("pointerleave", (e) => {
  if (!cursors.get(`p${e.pointerId}`)?.closed) dropCursor(`p${e.pointerId}`);
});

// Hands.
const startBtn = document.getElementById("start");
const status = document.getElementById("status");
const meters = document.getElementById("meters");
let hands = null;
startBtn.addEventListener("click", async () => {
  if (hands) {
    hands.stop();
    hands = null;
    for (const id of [...cursors.keys()]) if (id.startsWith("hand:")) dropCursor(id);
    startBtn.textContent = "Start hand tracking";
    status.textContent = "";
    document.body.classList.remove("tracking");
    return;
  }
  startBtn.disabled = true;
  try {
    const { startHands, CLOSE_BELOW, OPEN_ABOVE } = await import("./hands.js");
    hands = await startHands({
      video: document.getElementById("video"),
      canvas: document.getElementById("overlay"),
      onStatus: (s) => (status.textContent = s),
      onHands: (list) => {
        for (const h of list) feed(`hand:${h.id}`, h.x * innerWidth, h.y * innerHeight, h.closed, true);
        meters.innerHTML = list
          .map((h) => {
            const pct = Math.min(100, (h.openness / 2.2) * 100);
            return `<div class="meter ${h.closed ? "closed" : ""}"><span>${h.id}</span><i style="width:${pct}%"></i>
              <b style="left:${(CLOSE_BELOW / 2.2) * 100}%"></b><b style="left:${(OPEN_ABOVE / 2.2) * 100}%"></b></div>`;
          })
          .join("");
      },
    });
    startBtn.textContent = "Stop hand tracking";
    document.body.classList.add("tracking");
  } catch (err) {
    console.error(err);
    status.textContent = `couldn't start: ${err.message ?? err}`;
  } finally {
    startBtn.disabled = false;
  }
});

// ---------------------------------------------------------------- loop

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let frameMs = 16;
const hud = document.getElementById("stats");

function upload() {
  const p = blob.packed;
  for (let j = 0; j < blob.n; j++) {
    const i = blob.order[j];
    uniforms.uP.value[j].set(p[j * 4], p[j * 4 + 1], p[j * 4 + 2], blob.radius);
    uniforms.uC.value[j].set(blob.col[i * 3], blob.col[i * 3 + 1], blob.col[i * 3 + 2], p[j * 4 + 3]);
  }
  uniforms.uN.value = blob.n;
  const { min, max } = blob.bbox(blob.k * 0.3 + 0.02);
  uniforms.uBoxMin.value.fromArray(min);
  uniforms.uBoxMax.value.fromArray(max);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frameMs += (dt * 1000 - frameMs) * 0.05;
  uniforms.uTime.value = now / 1000;

  // A hand that has vanished for a moment lets go.
  for (const [id, c] of cursors) if (id.startsWith("hand:") && now - c.seen > 400) dropCursor(id);
  applyCursors();

  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps++ < 10) {
    blob.step(STEP);
    acc -= STEP;
  }
  acc = Math.min(acc, STEP);

  upload();
  if (mode === "splat") {
    const m = surfaceSplats(blob, DIRS, splatData);
    splatGeo.instanceCount = m;
    for (const name of ["iPos", "iNormal", "iColor"]) splatGeo.getAttribute(name).needsUpdate = true;
  } else if (mode === "mesh") requestMesh();

  // The ray-marcher is the expensive one: trade resolution for frame rate.
  if (mode === "sdf") {
    const q = frameMs > 22 ? quality * 0.9 : frameMs < 14 ? quality * 1.03 : quality;
    const nq = Math.min(1, Math.max(0.35, q));
    if (Math.abs(nq - quality) > 0.04) (quality = nq), resize();
  }

  camera.updateMatrixWorld();
  uniforms.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / renderer.domElement.height;
  uniforms.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  renderer.render(scene, camera);

  hud.textContent =
    `${blob.clusterCount} blob${blob.clusterCount === 1 ? "" : "s"} · ${blob.n} particles · ${blob.springs.size} springs` +
    (mode === "splat" ? ` · ${splatGeo.instanceCount} splats` : "") +
    (mode === "mesh" && meshGeo.index ? ` · ${meshGeo.index.count / 3} tris` : "") +
    ` · ${Math.round(1000 / frameMs)} fps`;
}

window.app = { renderer, scene, camera, setMode, reset, feed, dropCursor };
setMode("sdf");
requestAnimationFrame(frame);
