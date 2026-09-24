// Raw microphone capture and waveform visualization.
// No transcription, no command recognition — the signal is drawn as-is.

export async function startVoiceWaveform({ canvas, onError }) {
  const ctx = canvas.getContext("2d");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const buffer = new Uint8Array(analyser.fftSize);
  let running = true;

  function draw() {
    if (!running) return;
    analyser.getByteTimeDomainData(buffer);

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#34d399";
    ctx.beginPath();

    const sliceWidth = canvas.width / buffer.length;
    let x = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] / 128.0; // 0..2, 1 == silence
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);

  return {
    stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      audioCtx.close();
    },
  };
}
