# Hands, Face & Voice Input

Workstream for camera- and microphone-driven input to Tapestry:

- **Hand tracking**: pointing, pinching, grabbing and dragging nodes; pan/zoom gestures.
- **Eye / face tracking**: gaze as a cursor or focus hint; head movement for camera nudges.
- **Voice input**: dictation into notes and spoken commands.

Status: just set up (2026-09-23). No scope, requirements or toolkit decided yet.

Open questions before planning:
- Is this a Tapestry plugin that uses the public SDK, or a separate project like `data-drawing/`?
- Where does tracking run: in the Electron renderer (for example MediaPipe via WASM) or natively?
- Is voice recognition local only, or can it use a cloud service? The core must still work offline.
- Privacy: camera and mic frames stay on the device. Only the resulting intents become recorded commands.
