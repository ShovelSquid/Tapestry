// 3D point-cloud view of the same landmarks drawn in the 2D overlay.
//
// Hands use MediaPipe's `worldLandmarks` — real metric 3D coordinates
// reconstructed per hand (origin at that hand's geometric center). Face uses
// the normalized image-space landmarks (x, y in [0,1], z relative depth) since
// Face Landmarker doesn't expose a metric world reconstruction the way Hand
// Landmarker does — so the face cloud is a fair depth impression, not a
// physically-scaled one. Because each hand's world landmarks are centered on
// that hand independently, the model gives no real relative position between
// two hands (or between a hand and the face); this view spaces them apart
// with fixed offsets purely so multiple clouds don't overlap, not because
// that's their true relative position in space.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HandLandmarker, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17";

const HAND_SCALE = 4; // meters -> scene units, sized for visibility
const HAND_OFFSETS_X = [-0.18, 0.18];
const HAND_COLORS = [0x22d3ee, 0xf97316];
const FACE_SCALE = 0.6;
const FACE_COLOR = 0xa78bfa;

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

  function update({ handsWorld = [], faceLandmarksList = [] }) {
    scene.remove(liveGroup);
    liveGroup = new THREE.Group();

    handsWorld.forEach((landmarks, i) => {
      const offsetX = HAND_OFFSETS_X[i % HAND_OFFSETS_X.length];
      const color = HAND_COLORS[i % HAND_COLORS.length];
      const transform = (p) => [
        p.x * HAND_SCALE + offsetX,
        -p.y * HAND_SCALE + 0.1,
        -p.z * HAND_SCALE,
      ];
      liveGroup.add(cloud(landmarks.map(transform), color));
      liveGroup.add(lines(landmarks, HandLandmarker.HAND_CONNECTIONS, color, transform));
    });

    faceLandmarksList.forEach((landmarks) => {
      const transform = (p) => [
        (p.x - 0.5) * FACE_SCALE,
        -(p.y - 0.5) * FACE_SCALE,
        -p.z * FACE_SCALE,
      ];
      const tessellationIndices = new Set(
        FaceLandmarker.FACE_LANDMARKS_TESSELATION.flatMap((c) => [c.start, c.end])
      );
      const points = [...tessellationIndices].map((i) => transform(landmarks[i]));
      liveGroup.add(cloud(points, FACE_COLOR));
      liveGroup.add(
        lines(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, FACE_COLOR, transform)
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
