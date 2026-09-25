// SHOT_AFTER_RELOAD for wave 6 (run after wave2-setup.js). Checks, with
// synthetic pointer events:
// - particles: a drag of "Hovered" with a start, a sharp turn and a drop
//   throws specks (counted as <line>s in its .tap-move-particles);
// - rifling: the cursor moving just left of "Orbit rules" nudges the card
//   (style.translate) and it settles back once the cursor stops;
// - text bob: the cursor moving inside "Selected" shifts its text a hair;
// - all off (the Motion panel's "All off"): the same moves give no specks,
//   no nudge, and no animation frames at all over the whole sequence.
// Then turns everything back on, opens the panel and drags again, so the
// capture shows the panel and specks in flight.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2000)
  const out = {}
  const cards = () => [...document.querySelectorAll('.tapestry-note-card--ink')]
  const find = (title) => cards().find((c) => c.querySelector('input')?.value === title)
  const ev = (type, p, target, buttons = 0) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons, pointerId: 1 }))
  const specks = (card) => card.querySelectorAll('.tap-move-particles line').length

  let rafCalls = 0
  const realRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => { rafCalls++; return realRaf(cb) }

  const drag = async (title, maxSpecksRef) => {
    const card = find(title)
    const handle = card.querySelector('.tapestry-note-drag-handle')
    const b = handle.getBoundingClientRect()
    let p = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    ev('pointerdown', p, handle, 1)
    let most = 0
    const step = async (dx, dy, n) => {
      for (let i = 0; i < n; i++) {
        p = { x: p.x + dx, y: p.y + dy }
        ev('pointermove', p, document, 1)
        await wait(16)
        most = Math.max(most, specks(card))
      }
    }
    await step(14, 0, 12) // start: a change from zero
    await step(0, 14, 12) // sharp turn
    ev('pointerup', p, document)
    for (let i = 0; i < 20; i++) {
      await wait(16)
      most = Math.max(most, specks(card))
    }
    await wait(600)
    return { most, after: specks(find(title)) }
  }

  const rifle = async () => {
    const card = find('Orbit rules')
    const r = card.getBoundingClientRect()
    let most = 0
    for (let i = 0; i < 15; i++) {
      ev('pointermove', { x: r.left - 30, y: r.top + 10 + i * 4 }, document)
      await wait(16)
      const t = card.style.translate
      if (t) most = Math.max(most, Math.abs(parseFloat(t)))
    }
    await wait(900)
    return { mostPx: Number(most.toFixed(2)), settled: card.style.translate === '' }
  }

  const textBob = async () => {
    const card = find('Selected')
    const r = card.getBoundingClientRect()
    const text = card.querySelector('.tapestry-note-editor')
    let most = 0
    for (let i = 0; i < 15; i++) {
      ev('pointermove', { x: r.left + r.width / 2, y: r.top + 12 + i }, document)
      await wait(16)
      const t = (text.style.translate || '0 0').split(' ').map(parseFloat)
      most = Math.max(most, Math.hypot(t[0] || 0, t[1] || 0))
    }
    await wait(900)
    return { mostPx: Number(most.toFixed(2)), settled: text.style.translate === '' }
  }

  out.on = { particles: await drag('Hovered'), rifle: await rifle(), textBob: await textBob() }

  const button = document.querySelector('.tap-motion-button')
  button.click()
  await wait(100)
  const panel = document.querySelector('.tap-motion-panel')
  out.panelRows = panel.querySelectorAll('.tap-motion-row').length
  out.sliders = panel.querySelectorAll('input[type=range]').length
  panel.querySelector('.tap-motion-panel-head button').click()
  await wait(200)
  out.glyphOff = document.querySelector('.tap-motion-glyph path').getAttribute('d')
  out.swellVar = getComputedStyle(document.documentElement).getPropertyValue('--tap-motion-swell').trim()
  button.click() // close
  await wait(400)
  rafCalls = 0
  out.off = { particles: await drag('Hovered'), rifle: await rifle(), textBob: await textBob() }
  out.off.rafCalls = rafCalls

  // All back on, panel open, a drag with specks in the air for the capture.
  button.click()
  await wait(100)
  document.querySelector('.tap-motion-panel-head button').click()
  await wait(100)
  out.glyphOn = document.querySelector('.tap-motion-glyph path').getAttribute('d')
  const card = find('Orbit rules')
  const handle = card.querySelector('.tapestry-note-drag-handle')
  const b = handle.getBoundingClientRect()
  let p = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  ev('pointerdown', p, handle, 1)
  for (let i = 0; i < 10; i++) { p = { x: p.x + 16, y: p.y + 4 }; ev('pointermove', p, document, 1); await wait(16) }
  for (let i = 0; i < 4; i++) { p = { x: p.x, y: p.y + 18 }; ev('pointermove', p, document, 1); await wait(16) }
  out.captureSpecks = specks(card)
  return JSON.stringify(out)
})()
