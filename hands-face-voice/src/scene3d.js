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
    scene.remove(liveGroup);
    liveGroup = new THREE.Group();

    handsNormalized.forEach((landmarks, i) => {
      const color = HAND_COLORS[i % HAND_COLORS.length];
      liveGroup.add(cloud(landmarks.map(normalizedTransform), color));
      liveGroup.add(lines(landmarks, HandLandmarker.HAND_CONNECTIONS, color, normalizedTransform));
    });

    faceLandmarksList.forEach((landmarks) => {
      const contourIndices = new Set(
        FaceLandmarker.FACE_LANDMARKS_CONTOURS.flatMap((c) => [c.start, c.end])
      );
      const points = [...contourIndices].map((i) => normalizedTransform(landmarks[i]));
      liveGroup.add(cloud(points, FACE_COLOR));
      liveGroup.add(
        lines(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, FACE_COLOR, normalizedTransform)
      );
    });

    poseLandmarksList.forEach((landmarks) => {
      liveGroup.add(cloud(landmarks.map(normalizedTransform), POSE_COLOR));
      liveGroup.add(
        lines(landmarks, PoseLandmarker.POSE_CONNECTIONS, POSE_COLOR, normalizedTransform)
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
