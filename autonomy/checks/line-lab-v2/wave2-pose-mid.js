// Second pass after reload: select note 2, hover note 3.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2500)
  const cards = [...document.querySelectorAll('.tapestry-note-card--ink')]
  const find = (title) => cards.find((c) => c.querySelector('input')?.value === title)
  const sel = find('Selected')
  const hov = find('Hovered')
  const out = { cards: cards.length }
  if (sel) {
    const h = sel.querySelector('.tapestry-note-drag-handle')
    const b = h.getBoundingClientRect()
    const o = { bubbles: true, clientX: b.left + 30, clientY: b.top + 4, button: 0 }
    h.dispatchEvent(new PointerEvent('pointerdown', o))
    document.dispatchEvent(new PointerEvent('pointerup', o))
    h.dispatchEvent(new MouseEvent('click', o))
  }
  if (hov) {
    const b = hov.getBoundingClientRect()
    hov.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: b.left + 2, clientY: b.top + b.height / 2, relatedTarget: document.body }))
  }
  await wait(1000)
  const red = document.querySelector('.tapestry-corner-dot--delete')
  if (red) { red.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body })); out.red = true }
  // Select the first note now, so the capture lands mid-grow.
  const first = cards.find((c) => c.querySelector('input')?.value === 'Orbit rules')
  if (first) {
    const h = first.querySelector('.tapestry-note-drag-handle')
    const b = h.getBoundingClientRect()
    const o = { bubbles: true, clientX: b.left + 60, clientY: b.top + 4, button: 0 }
    h.dispatchEvent(new PointerEvent('pointerdown', o))
    document.dispatchEvent(new PointerEvent('pointerup', o))
    h.dispatchEvent(new MouseEvent('click', o))
  }
  return JSON.stringify(out)
})()

