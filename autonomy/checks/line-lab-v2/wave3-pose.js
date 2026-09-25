// SHOT_AFTER_RELOAD for wave 3: edit "Formatting", select "some", press b in
// the pill, and read the body back from the kernel to see the bold was saved.
// With SHOT_POSE=settings in the page (set below by the caller), it selects
// "Settings" and flips it instead.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2500)
  const cards = [...document.querySelectorAll('.tapestry-note-card--ink')]
  const find = (title) => cards.find((c) => c.querySelector('input')?.value === title)
  const out = { cards: cards.length }
  const down = (el, o = {}) => {
    const b = el.getBoundingClientRect()
    const e = { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, ...o }
    el.dispatchEvent(new PointerEvent('pointerdown', e))
    document.dispatchEvent(new PointerEvent('pointerup', e))
    return e
  }
  if (window.__POSE__ === 'settings') {
    const card = find('Settings')
    const h = card.querySelector('.tapestry-note-drag-handle')
    const e = down(h, { clientX: h.getBoundingClientRect().left + 30 })
    h.dispatchEvent(new MouseEvent('click', e))
    await wait(900)
    const gear = card.querySelector('.tapestry-format-circle--settings')
    out.gear = !!gear
    if (gear) down(gear)
    await wait(600)
    out.face = !!card.querySelector('.tapestry-note-settings')
    return JSON.stringify(out)
  }
  const card = find('Formatting')
  const ed = card.querySelector('.tapestry-note-editor')
  ed.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await wait(900)
  const pm = card.querySelector('.ProseMirror')
  pm.focus()
  const text = pm.querySelector('p').firstChild
  const i = text.data.indexOf('some')
  const range = document.createRange()
  range.setStart(text, i)
  range.setEnd(text, i + 4)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  pm.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await wait(400)
  const pill = card.querySelector('.tapestry-format-pill')
  out.pill = pill ? [...pill.querySelectorAll('.tapestry-format-icon')].map((b) => b.textContent).join(' ') : null
  const bold = pill && pill.querySelector('[data-glyph="b"]')
  if (bold) down(bold)
  await wait(1500)
  const nodes = await window.tapestry.kernel.getNodes(localStorage.getItem('shotTree'))
  const n = nodes.find((x) => x.props.title && x.props.title.value === 'Formatting')
  out.savedBold = !!n && String(n.props.body.value).includes('"strong"')
  out.boldActive = !!card.querySelector('.tapestry-format-icon.active[data-glyph="b"]')
  return JSON.stringify(out)
})()
