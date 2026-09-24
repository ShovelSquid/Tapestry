// 3D point-cloud view of the same landmarks drawn in the 2D overlay.
//
// Hands, face and pose are all drawn from MediaPipe's *normalized* landmarks
// (x, y in [0,1] relative to the image, z relative depth) rather than each
// model's independently-reconstructed metric world landmarks. Hand world
// landmarks are hand-centered and pose world landmarks are hip-centered, so
// mixing metric world landmarks across models would still have no shared
// origin. Normalized landmarks, by contrast, are computed in one shared
// per-frame coordinate system across all three models, so one shared
// transform places every point cloud in real relative position: hands appear
// where they actually are relative to the face, and the pose skeleton's
// wrists/shoulders/nose sit near the hand and face clouds they anchor,
// replacing the old fixed `HAND_OFFSETS_X` / `FACE_SCALE` spacing hack. This
// is a normalized-frame visual anchor, not a metric 3D fusion — it gives
// comparable relative x/y position and z depth ordering, not physically-scaled
// absolute distances.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  HandLandmarker,
  FaceLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";

const SCENE_SCALE = 0.6;
const HAND_COLORS = [0x22d3ee, 0xf97316];
const FACE_COLOR = 0xa78bfa;
const POSE_COLOR = 0x34d399;
// Dead-zone radius in raw normalized [0,1]-ish coordinate units (measured
// before normalizedTransform/SCENE_SCALE): frame-to-frame movement smaller
// than this is treated as detector noise and fully suppressed.
const JITTER_TOLERANCE = 0.004;
// EMA ease-per-frame weight (0-1, higher = snappier) applied to movement
// above JITTER_TOLERANCE. Both are un-tuned starting defaults for this live
// diagnostic playground, not researched values.
const SMOOTHING_FACTOR = 0.35;

const FACE_TESSELLATION_INDICES = [
  ...new Set(FaceLandmarker.FACE_LANDMARKS_TESSELATION.flatMap((c) => [c.start, c.end])),
];

function normalizedTransform(p) {
  return [(p.x - 0.5) * SCENE_SCALE, -(p.y - 0.5) * SCENE_SCALE, -p.z * SCENE_SCALE];
}

export function createScene3D(container) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 100);
  camera.position.set(0, 0.15, 0.9);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  const grid = new THREE.GridHelper(1, 10, 0x333333, 0x1f1f1f);
  grid.position.y = -0.25;
  scene.add(grid);

  let liveGroup = new THREE.Group();
  scene.add(liveGroup);

  // Smoothing state, persisted across update() calls for this scene instance.
  // Keyed "set:slot:index" (e.g. "hand:0:5") so each tracked point has its
  // own dead-zone/EMA history independent of every other point.
  const smoothedPoints = new Map();
  const prevSlotCounts = { hand: 0, face: 0, pose: 0 };

  // Purge stale smoothing state for slots that disappeared since last frame
  // (e.g. a hand left the camera view), so a reappearing slot renders at its
  // fresh detected position instead of easing in from stale history. Must
  // run once per set per update() call, before that set's points are
  // smoothed.
  function resetStaleSlots(set, currentCount) {
    const prevCount = prevSlotCounts[set];
    if (currentCount < prevCount) {
      for (const key of smoothedPoints.keys()) {
        const [keySet, keySlot] = key.split(":");
        if (keySet === set && Number(keySlot) >= currentCount) {
          smoothedPoints.delete(key);
        }
      }
    }
    prevSlotCounts[set] = currentCount;
  }

  // Dead-zone + EMA smoothing for a single point. Returns a plain {x,y,z}
  // object, same shape as a raw landmark, ready to pass into
  // normalizedTransform.
  function smoothPoint(set, slot, index, raw) {
    const key = `${set}:${slot}:${index}`;
    const prev = smoothedPoints.get(key);
    if (!prev) {
      const fresh = { x: raw.x, y: raw.y, z: raw.z };
      smoothedPoints.set(key, fresh);
      return fresh;
    }
    const dx = raw.x - prev.x;
    const dy = raw.y - prev.y;
    const dz = raw.z - prev.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < JITTER_TOLERANCE) {
      return prev;
    }
    prev.x += dx * SMOOTHING_FACTOR;
    prev.y += dy * SMOOTHING_FACTOR;
    prev.z += dz * SMOOTHING_FACTOR;
    return prev;
  }

  // Smooths every point in a slot's full landmarks array (not just a drawn
  // subset), since both point-cloud indices (e.g. FACE_TESSELLATION_INDICES)
  // and connector-line indices (e.g. FACE_LANDMARKS_CONTOURS start/end) index
  // into the full array.
  function smoothLandmarks(set, slot, landmarks) {
    return landmarks.map((p, index) => smoothPoint(set, slot, index, p));
  }

  function cloud(points, color) {
    const group = new THREE.Group();
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
    group.add(new THREE.Points(geom, new THREE.PointsMaterial({ color, size: 0.012 })));
    return group;
  }

  function lines(landmarks, connections, color, transform) {
    const positions = [];
    for (const { start, end } of connections) {
      positions.push(...transform(landmarks[start]), ...transform(landmarks[end]));
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
    return new THREE.LineSegments(geom, mat);
  }

  function update({ handsNormalized = [], faceLandmarksList = [], poseLandmarksList = [] }) {
    // Removing a group doesn't free its GPU buffers; without dispose() every
    // frame's geometries stay resident and WebGL memory grows unbounded.
    scene.remove(liveGroup);
    liveGroup.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    liveGroup = new THREE.Group();

    resetStaleSlots("hand", handsNormalized.length);
    resetStaleSlots("face", faceLandmarksList.length);
    resetStaleSlots("pose", poseLandmarksList.length);

    handsNormalized.forEach((landmarks, i) => {
      const smoothed = smoothLandmarks("hand", i, landmarks);
      const color = HAND_COLORS[i % HAND_COLORS.length];
      liveGroup.add(cloud(smoothed.map(normalizedTransform), color));
      liveGroup.add(lines(smoothed, HandLandmarker.HAND_CONNECTIONS, color, normalizedTransform));
    });

    faceLandmarksList.forEach((landmarks, slot) => {
      const smoothed = smoothLandmarks("face", slot, landmarks);
      const points = FACE_TESSELLATION_INDICES.map((i) => normalizedTransform(smoothed[i]));
      liveGroup.add(cloud(points, FACE_COLOR));
      liveGroup.add(
        lines(smoothed, FaceLandmarker.FACE_LANDMARKS_CONTOURS, FACE_COLOR, normalizedTransform)
      );
    });

    poseLandmarksList.forEach((landmarks, slot) => {
      const smoothed = smoothLandmarks("pose", slot, landmarks);
      liveGroup.add(cloud(smoothed.map(normalizedTransform), POSE_COLOR));
      liveGroup.add(
        lines(smoothed, PoseLandmarker.POSE_CONNECTIONS, POSE_COLOR, normalizedTransform)
      );
    });

    scene.add(liveGroup);
  }

  function render() {
    requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  }
  render();

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  return { update };
}
