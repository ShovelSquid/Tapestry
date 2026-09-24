# Hands, Face & Voice Input

Workstream for camera- and microphone-driven input to Tapestry:

- **Hand tracking**: pointing, pinching, grabbing and dragging nodes; pan/zoom gestures.
- **Eye / face tracking**: gaze as a cursor or focus hint; head movement for camera nudges.
- **Voice input**: dictation into notes and spoken commands.

Status: raw capture + visualization playground, plus local recording
(2026-09-24, branch `ws/hands-face-voice-gesture-capture`). Scope, requirements
and toolkit still not decided — this is deliberately upstream of that: prove out
how accurate camera/mic capture can be before designing what it drives.

## Playground

`index.html` is a standalone page, no build step:

- **Hands + face**: webcam feed through MediaPipe Tasks Vision (Hand Landmarker +
  Face Landmarker), landmarks drawn live over the video. No gesture recognition —
  just the raw tracked points, so you can judge tracking accuracy/jitter directly.
- **Voice**: mic input through the Web Audio API, drawn as a live waveform. No
  transcription — just the raw signal.
- **Save Recording**: records its own camera+mic stream (independent of the live
  views above) to a local `.webm` file plus a `.json` sidecar, written directly to
  a folder you pick via the File System Access API — no server, nothing leaves the
  device. `MediaRecorder` chunks are streamed to disk every second rather than
  buffered in memory, so long sessions don't grow unbounded RAM use. This is spike
  012 (`synced-video-audio-capture`, see `.planning/spikes/MANIFEST.md`); the
  saved files are what spike 013's offline landmark extraction will run against —
  deliberately not the live-computed landmarks above, so a full-length,
  un-rushed pass can be re-run against the same footage as approaches change.

Run it:

```
npx serve .
```

then open the printed `localhost` URL (camera/mic access requires a secure
context — `localhost` qualifies, a plain `file://` open will not) and click the
two start buttons. Chrome/Edge are the most reliable for `delegate: "GPU"` in
MediaPipe Tasks Vision.

Open questions before planning (unchanged by this playground):
- Is this a Tapestry plugin that uses the public SDK, or a separate project like `data-drawing/`?
- Where does tracking run: in the Electron renderer (for example MediaPipe via WASM) or natively?
- Is voice recognition local only, or can it use a cloud service? The core must still work offline.
- Privacy: camera and mic frames stay on the device. Only the resulting intents become recorded commands.
- Whether hand, face and voice end up as one workstream or split into three separate branches.
