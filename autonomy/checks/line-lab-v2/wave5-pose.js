// SHOT_AFTER_RELOAD for wave 5. Zooms out with Ctrl+wheel notches from
// 100% towards 8%, and at every step records each note's form (the card,
// or data-form on its collapsed element) and whether a form change had
// both forms on screen at once (the crossfade: no pop). Then zooms back in
// to window.__ZOOM__ (default 0.2), selects "Seeds" if it is a circle, and
// returns the log. With window.__DBL__ it then double-clicks "Beds".
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2000)
  const out = {}
  const content = () => document.querySelector('.tapestry-tree-frame-content')
  const zoomNow = () => {
    const frame = document.querySelector('.tapestry-tree-frame')
    return frame ? frame.getBoundingClientRect().width / frame.offsetWidth : null
  }
  const titleOf = (el) => el.querySelector('input')?.value
  const forms = () => {
    const f = {}
    for (const c of document.querySelectorAll('.tapestry-note-card--ink')) {
      if (!c.classList.contains('tap-form-fade-out')) f[titleOf(c)] = 'note'
    }
    for (const c of document.querySelectorAll('.tapestry-collapsed')) {
      if (c.classList.contains('tap-form-fade-out')) continue
      const label = c.querySelector('[aria-label]').getAttribute('aria-label').replace(' (zoom in to see)', '')
      f[label] = c.dataset.form
    }
    return f
  }
  let knownZoom = 1
  const measure = () => {
    const z = zoomNow()
    if (z) knownZoom = z
    return knownZoom
  }
  const vp = document.querySelector('.tapestry-canvas-container') || document.querySelector('.tapestry-canvas')
  const wheel = (dy) => {
    const cx = window.innerWidth / 2 - 200, cy = window.innerHeight / 2 - 100
    const target = document.elementFromPoint(cx, cy) || vp
    target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: dy, clientX: cx, clientY: cy }))
  }
  const sizeOf = {}
  for (const c of document.querySelectorAll('.tapestry-note-card--ink')) sizeOf[titleOf(c)] = c.offsetWidth
  out.widths = sizeOf
  const log = []
  let last = forms()
  let overlaps = 0, changes = 0
  const zs = []
  for (let i = 0; i < 80 && measure() > 0.105; i++) {
    wheel(40)
    // Sample mid-glide for the overlap, then let it settle.
    for (let k = 0; k < 6; k++) {
      await wait(40)
      const both = document.querySelectorAll('.tap-form-fade-out').length > 0 && document.querySelectorAll('.tap-form-fade-in').length > 0
      if (both) overlaps++
    }
    await wait(200)
    zs.push(Math.round(measure() * 100))
    const now = forms()
    for (const [title, form] of Object.entries(now)) {
      if (last[title] && last[title] !== form) {
        changes++
        log.push(`${title}: ${last[title]} → ${form} at ${Math.round(measure() * 100)}% (${Math.round(sizeOf[title] * measure())} px)`)
      }
    }
    last = now
  }
  // Zooming out only, each note's forms must run note → circle → dot.
  const rank = { note: 0, circle: 1, dot: 2 }
  out.monotonic = log.every((l) => { const m = l.match(/: (\w+) → (\w+)/); return rank[m[2]] > rank[m[1]] })
  out.zs = zs.join(',')
  out.minZoom = Math.round(measure() * 100) / 100
  out.changes = changes
  out.overlapSamples = overlaps
  out.log = log
  out.atMin = last
  const target = window.__ZOOM__ || 0.2
  for (let i = 0; i < 80 && measure() < target; i++) {
    wheel(-15)
    await wait(260)
  }
  out.zoom = Math.round(measure() * 100) / 100
  out.forms = forms()
  const seeds = [...document.querySelectorAll('.tapestry-collapsed--circle .tapestry-collapsed-hit')].find((h) => h.getAttribute('aria-label').startsWith('Seeds'))
  if (seeds) seeds.click()
  await wait(900)
  out.selectedCircle = !!document.querySelector('.tapestry-collapsed--selected')
  if (window.__DBL__) {
    // Double-click the "Beds" circle: the camera zooms in until it is a note.
    const beds = [...document.querySelectorAll('.tapestry-collapsed--circle .tapestry-collapsed-hit')].find((h) => h.getAttribute('aria-label').startsWith('Beds'))
    const before = measure()
    beds.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wait(1500)
    out.dblZoom = [Math.round(before * 100), Math.round(measure() * 100)]
    out.bedsAfterDbl = forms().Beds
  }
  return JSON.stringify(out)
})()
