// Live speech-to-text via the browser's built-in Web Speech API.
//
// Caveat: in Chrome/Edge this is NOT on-device — audio is streamed to the
// vendor's cloud recognition service. That conflicts with the "core must
// still work offline" open question in README.md; using it here to see
// transcription accuracy fast, not as an architecture decision.

export function startTranscription({ onFinal, onInterim, onError }) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error(
      "SpeechRecognition not supported in this browser (try Chrome or Edge)"
    );
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let running = true;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        onFinal(result[0].transcript);
      } else {
        interim += result[0].transcript;
      }
    }
    onInterim(interim);
  };

  recognition.onerror = (event) => {
    // "no-speech" fires constantly during normal pauses — not a real error.
    if (event.error !== "no-speech") {
      onError(new Error(`speech recognition error: ${event.error}`));
    }
  };

  // Chrome ends recognition after a pause; restart it while the user hasn't stopped.
  recognition.onend = () => {
    if (running) recognition.start();
  };

  recognition.start();

  return {
    stop() {
      running = false;
      recognition.stop();
    },
  };
}
