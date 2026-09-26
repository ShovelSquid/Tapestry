// Wave 1 frame check: 200 notes drawn with <InkLine>, 3 of them selected
// (blue takeover + wave), inside a CSS-scaled plane like the canvas.
// Built by run.sh into bench.js; measured by shot.cjs in Electron.
import { createElement as h, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InkLine } from '../../../../app/src/renderer/look/InkLine'
import { inkShape, noteOutlinePts, nearestT } from '../../../../app/src/renderer/look/ink'

const N = 200, W = 240, H = 150
const notes = Array.from({ length: N }, (_, i) => {
  const shape = inkShape(noteOutlinePts(W, H, i + 1), true, i + 1, { step: 2, cornerRadius: 16 })
  return { i, shape, x: (i % 20) * (W + 30), y: Math.floor(i / 20) * (H + 30), fromT: nearestT(shape, W / 2, 0) }
})

function App() {
  const [sel, setSel] = useState(false)
  useEffect(() => { const t = setTimeout(() => setSel(true), 300); return () => clearTimeout(t) }, [])
  return h('div', { id: 'plane', style: { transform: `scale(${Number(new URLSearchParams(location.search).get("zoom") ?? 0.5)})`, transformOrigin: '0 0', position: 'absolute', left: 20, top: 20 } },
    notes.map((n) => h('div', { key: n.i, className: 'card', style: { left: n.x, top: n.y, width: W, height: H } },
      h('div', { className: 'title' }, 'Note ' + (n.i + 1)),
      h(InkLine, { shape: n.shape, seed: n.i + 1, takeover: { on: sel && n.i < 3, fromT: n.fromT } }))))
}
createRoot(document.getElementById('root')!).render(h(App))

// Frame intervals from 1 s to 4 s after load.
const gaps: number[] = []
let last = 0
const start = performance.now()
function tick(now: number) {
  if (now - start > 1000) { if (last) gaps.push(now - last); last = now }
  if (now - start < 4000) requestAnimationFrame(tick)
  else {
    gaps.sort((a, b) => a - b)
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    ;(window as any).RESULT = { frames: gaps.length, fps: +(1000 / avg).toFixed(1), p95ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(2), maxms: +gaps[gaps.length - 1].toFixed(2) }
  }
}
requestAnimationFrame(tick)
