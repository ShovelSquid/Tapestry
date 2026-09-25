// SHOT_AFTER_RELOAD for wave 4. window.__POSE__ picks the state:
// - 'drag': select Source, press its blue dot and drag the live line out.
// - 'land': drag from Source and land on Right; captured mid-flash.
// - 'reopen': land Source → Right, record the new line's path, reload, and
//   compare (run with motion off: prefix the setup with window.__STILL__=1).
// - otherwise: rest (a connection and a knot, nothing selected).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const pose = sessionStorage.getItem('pose') || window.__POSE__ || 'rest'
  await wait(2500)
  const out = { pose }
  const lines = () => [...document.querySelectorAll('.tapestry-tree-frame-content .connection-line')]
  const paths = () => lines().map((g) => g.querySelector('path').getAttribute('d')).sort()
  if (pose === 'reopened') {
    const before = JSON.parse(sessionStorage.getItem('before') || '[]')
    const after = paths()
    out.lines = after.length
    out.same = JSON.stringify(before) === JSON.stringify(after)
    // The notes' drawn heights can settle differently before and after a
    // reload (the card's measured height), which moves every centre by the
    // same amount; the line itself must be the same shape, so compare each
    // path relative to its own first point.
    const rel = (d) => {
      const c = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
      return c.map(([x, y]) => (x - c[0][0]).toFixed(1) + ',' + (y - c[0][1]).toFixed(1)).join(' ')
    }
    out.sameShape = before.length === after.length && after.every((d, i) => rel(d) === rel(before[i]))
    out.shift = after.map((d, i) => Number(d.split(/[ ML]/)[2]) - Number(String(before[i]).split(/[ ML]/)[2]))
    out.knot = !!document.querySelector('.knot-node .ink-line')
    sessionStorage.clear()
    return JSON.stringify(out)
  }
  const cards = [...document.querySelectorAll('.tapestry-note-card--ink')]
  const find = (title) => cards.find((c) => c.querySelector('input')?.value === title)
  const center = (el) => {
    const b = el.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }
  const ev = (type, p, target) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, pointerId: 1 }))
  out.lines = lines().length
  out.knot = !!document.querySelector('.knot-node .ink-line')
  if (pose === 'rest') return JSON.stringify(out)

  const src = find('Source')
  const h = src.querySelector('.tapestry-note-drag-handle')
  const hp = { x: h.getBoundingClientRect().left + 30, y: center(h).y }
  src.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: hp.x, clientY: hp.y }))
  ev('pointerdown', hp, h)
  ev('pointerup', hp, document)
  h.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: hp.x, clientY: hp.y }))
  await wait(900)
  const dot = src.querySelector('.tapestry-corner-dot--connect')
  out.dot = !!dot
  if (!dot) return JSON.stringify(out)
  const canvas = document.querySelector('.tapestry-canvas')
  ev('pointerdown', center(dot), dot)
  const target = find('Right')
  const end = pose === 'drag' ? { x: center(target).x - 200, y: center(target).y - 120 } : center(target)
  for (let i = 1; i <= 8; i++) {
    const a = center(dot)
    ev('pointermove', { x: a.x + ((end.x - a.x) * i) / 8, y: a.y + ((end.y - a.y) * i) / 8 }, canvas)
    await wait(30)
  }
  out.live = !!document.querySelector('.connection-drag-dot')
  if (pose === 'drag') return JSON.stringify(out)
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: end.x, clientY: end.y }))
  await wait(50)
  const n0 = lines().length
  ev('pointerup', end, canvas)
  for (let i = 0; i < 40 && lines().length === n0; i++) await wait(10)
  out.linesAfter = lines().length
  out.flashing = !!document.querySelector('.connection-landed')
  if (pose === 'land') return JSON.stringify(out)
  // Deselect first: a selected note shows its provenance row and grows,
  // which moves its centre and so its lines.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const bg = { x: 20, y: window.innerHeight - 20 }
  ev('pointerdown', bg, canvas)
  ev('pointerup', bg, canvas)
  canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bg.x, clientY: bg.y }))
  await wait(1500)
  out.selected = document.querySelectorAll('.tapestry-note-card--selected').length
  sessionStorage.setItem('before', JSON.stringify(paths()))
  sessionStorage.setItem('pose', 'reopened')
  out.reload = true
  setTimeout(() => location.reload(), 50)
  return JSON.stringify(out)
})()
