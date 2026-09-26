// SHOT_AFTER_RELOAD for wave 7 (entering a note), after wave5-setup.js.
// Zooms out with Ctrl+wheel until "Beds" is a circle, double-clicks the
// circle, and samples every animation frame of the flight in: Beds' card
// width on screen, whether any form crossfade is on screen for it, the
// circle's presence, and the frame times. Then Escape flies back out and is
// sampled the same way. Returns the summary.
// window.__MODE__ = 'mid' double-clicks and returns at once, so a short
// SHOT_SETTLE_MS captures the note mid-flight; 'in' returns once entered.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const frame = () => new Promise((r) => requestAnimationFrame(r))
  await wait(2000)
  const out = {}
  const zoomNow = () => {
    const f = document.querySelector('.tapestry-tree-frame')
    return f ? f.getBoundingClientRect().width / f.offsetWidth : 1
  }
  const vp = document.querySelector('.tapestry-canvas-container') || document.querySelector('.tapestry-canvas')
  const wheel = (dy) => {
    const cx = window.innerWidth / 2 - 200, cy = window.innerHeight / 2 - 100
    const t = document.elementFromPoint(cx, cy) || vp
    t.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: dy, clientX: cx, clientY: cy }))
  }
  const bedsCircle = () =>
    [...document.querySelectorAll('.tapestry-collapsed--circle .tapestry-collapsed-hit')].find((h) =>
      h.getAttribute('aria-label').startsWith('Beds'))
  const bedsCard = () =>
    [...document.querySelectorAll('.tapestry-note-card--ink')].find((c) => c.querySelector('input')?.value === 'Beds')
  for (let i = 0; i < 80 && !bedsCircle(); i++) {
    wheel(40)
    await wait(260)
  }
  for (let i = 0; i < 20 && document.querySelector('.tap-form-fade-in, .tap-form-fade-out'); i++) await wait(100)
  out.startZoom = Math.round(zoomNow() * 1000) / 1000
  const circle = bedsCircle()
  if (!circle) return JSON.stringify({ error: 'no Beds circle', zoom: zoomNow() })
  out.circleW = Math.round(circle.getBoundingClientRect().width * 10) / 10

  // Sample frames until the camera stops, or maxMs.
  const sample = async (maxMs) => {
    const s = []
    const t0 = performance.now()
    let last = t0
    let still = 0
    let lastZ = zoomNow()
    while (performance.now() - t0 < maxMs) {
      const now = await frame()
      const card = bedsCard()
      const z = zoomNow()
      s.push({
        sc: card ? card.style.scale + '/' + card.offsetWidth : '',
        z,
        dt: now - last,
        w: card ? card.getBoundingClientRect().width : null,
        circle: !!bedsCircle(),
        anyFade: document.querySelectorAll('.tap-form-fade-in, .tap-form-fade-out').length > 0,
        fade: !!(card && card.className.includes('tap-form-fade')) ||
          [...document.querySelectorAll('.tapestry-collapsed.tap-form-fade-in, .tapestry-collapsed.tap-form-fade-out')]
            .some((c) => c.querySelector('[aria-label]').getAttribute('aria-label').startsWith('Beds')),
      })
      last = now
      still = Math.abs(z - lastZ) < 1e-5 ? still + 1 : 0
      lastZ = z
      if (still > 20) break
    }
    return s
  }
  const summarize = (s, dir) => {
    const ws = s.map((x) => x.w).filter((w) => w !== null)
    const dts = s.slice(1).map((x) => x.dt).sort((a, b) => a - b)
    let monotonic = true
    for (let i = 1; i < ws.length; i++) {
      if (dir > 0 ? ws[i] < ws[i - 1] - 0.5 : ws[i] > ws[i - 1] + 0.5) monotonic = false
    }
    return {
      frames: s.length,
      firstW: ws.length ? Math.round(ws[0] * 10) / 10 : null,
      lastW: ws.length ? Math.round(ws[ws.length - 1] * 10) / 10 : null,
      monotonic,
      fadeFrames: s.filter((x) => x.fade).length,
      anyFadeFrames: s.filter((x) => x.anyFade).length,
      bothFrames: s.filter((x) => x.circle && x.w !== null).length,
      medianDtMs: Math.round(dts[Math.floor(dts.length / 2)] * 10) / 10,
      p95DtMs: Math.round(dts[Math.floor(dts.length * 0.95)] * 10) / 10,
      over25ms: dts.filter((d) => d > 25).length,
      ...(window.__TRACE__ ? { trace: s.map((x) => `${x.z.toFixed(3)}:${x.w === null ? '-' : x.w.toFixed(1)}${x.circle ? 'c' : ''}${window.__TRACE__ > 1 ? '[' + x.sc + ']' : ''}`).join(' ') } : {}),
    }
  }

  circle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  if (window.__MODE__ === 'mid') return 'mid'
  const inS = await sample(3000)
  out.enter = summarize(inS, +1)
  out.enteredZoom = Math.round(zoomNow() * 100) / 100
  out.enteredCardW = Math.round(bedsCard().getBoundingClientRect().width)
  out.viewportW = window.innerWidth
  if (window.__MODE__ === 'in') return JSON.stringify(out)

  document.activeElement?.blur?.()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const outS = await sample(3000)
  out.leave = summarize(outS, -1)
  await wait(400)
  out.leftZoom = Math.round(zoomNow() * 1000) / 1000
  out.bedsIsCircleAgain = !!bedsCircle() && !bedsCard()
  return JSON.stringify(out)
})()
