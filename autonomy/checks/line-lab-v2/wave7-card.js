// SHOT_AFTER_RELOAD for wave 7, after wave5-setup.js: double-click the
// "Seeds" card at 100% (a real mousedown, then dblclick, as a pointer would)
// and check the camera enters it; then Escape flies back to 100%.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2000)
  const zoomNow = () => {
    const f = document.querySelector('.tapestry-tree-frame')
    return Math.round((f.getBoundingClientRect().width / f.offsetWidth) * 100) / 100
  }
  const card = [...document.querySelectorAll('.tapestry-note-card--ink')].find((c) => c.querySelector('input')?.value === 'Seeds')
  const body = card.querySelector('.tapestry-note-editor')
  const out = { before: zoomNow() }
  body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 1 }))
  body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
  await wait(2500)
  out.entered = zoomNow()
  out.notes = document.querySelectorAll('.tapestry-note-card--ink').length
  document.activeElement?.blur?.()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(2500)
  out.left = zoomNow()
  return JSON.stringify(out)
})()
