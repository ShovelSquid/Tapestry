# API Coverage — MediaPipe Tasks Vision PoseLandmarker

Full API Coverage by Default — Opt Out, Never Opt In. PoseLandmarker is an addition to the
already-integrated HandLandmarker/FaceLandmarker from `@mediapipe/tasks-vision@0.10.17`. Confirmed
against the package's shipped `vision.d.ts` (npm tarball for 0.10.17) rather than assumed from
memory.

| capability | decision | reason |
|---|---|---|
| pose landmark detection (33 body points, VIDEO mode) | INTEGRATE | core requirement — shared skeleton anchoring hands and face |
| pose world landmarks (metric, hip-centered) | OPT-OUT | normalized landmarks already serve the shared-frame goal (hands/face/pose all share one per-frame normalized image coordinate system); pose world landmarks are hip-centered and reconstructed independently of the hand/face world landmarks, so integrating them would reintroduce the exact no-shared-origin problem this task removes, for no anchoring benefit |
| segmentation mask output (`outputSegmentationMasks`) | OPT-OUT | not needed — no background/body segmentation use case in this live landmark playground |
| numPoses / multi-person tracking | OPT-OUT | not needed — single user at camera; `numPoses: 1` set explicitly (matches the file's existing style of stating `numHands`/`numFaces` explicitly even where it equals the default) to document the decision in code, not just here |

## Not applicable / no decision needed

- `PoseLandmarker.POSE_CONNECTIONS` (static `Connection[]` for `drawingUtils.drawConnectors`) —
  not an opt-in/opt-out capability, it is the drawing data used to satisfy the INTEGRATE row above,
  the same way `HandLandmarker.HAND_CONNECTIONS` and `FaceLandmarker.FACE_LANDMARKS_CONTOURS` are
  already used in `hands-face.js`/`scene3d.js`.
- `minPoseDetectionConfidence` / `minPosePresenceConfidence` / `minTrackingConfidence` — tunable
  thresholds, not capability toggles; left at their package defaults (0.5 each), matching the
  existing HandLandmarker/FaceLandmarker calls in this file, which also don't override them.
- `delegate: "GPU"` and `runningMode: "VIDEO"` — not new decisions, already the established
  pattern for both existing landmarkers in `hands-face.js`; PoseLandmarker follows the same
  convention for consistency, not as a fresh capability choice.
- `PoseLandmarker.POSE_LANDMARKS` index-name enum — does not exist in this package's shipped
  `vision.d.ts` (unlike the older `@mediapipe/pose` solutions API). The specific body-point indices
  needed for anchoring (nose = 0, shoulders = 11/12, wrists = 15/16) are hard-coded as named
  numeric constants in `scene3d.js`, the same style `HAND_OFFSETS_X`/`FACE_SCALE` already use for
  file-local magic numbers.
