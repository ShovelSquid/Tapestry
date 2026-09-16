// @ts-nocheck
// The WebGL thread layer, as a React component with a real cleanup contract.
//
// The renderer is created when the thread opens and destroyed when it closes,
// which is what the app will do (D-09) and what makes a context leak visible.
// React 18 StrictMode deliberately mounts, unmounts and remounts every
// component once in development — the app's own main.tsx wraps <App> in
// StrictMode — so this effect is double-invoked on purpose. That is the point:
// if the cleanup is wrong, `contexts.created` and `contexts.disposed` diverge.
import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from 'prosemirror-schema-basic'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { createAtlasGlyphLayer } from '../003-shared/glyph-layer.js'
import { createSdfRasterizer } from '../003-shared/sdf-rasterizer.js'
import { SPEED, FONT_SIZE, LIFT, FONT_URL, generateKeys, graphemes } from '../003-shared/scene.js'

/** GL lifecycle accounting — the leak test reads these.
 *  `forced` counts the context losses this code causes on purpose when a thread
 *  closes; `lost` counts only the unexpected ones, which is the number that
 *  means a leak (a browser allows a handful of live contexts, and the Nth open
 *  silently stops drawing once that is exceeded). */
export const contexts = { created: 0, disposed: 0, lost: 0, forced: 0 }

/** Set while a thread is live, so the scripted runner can drive it. */
export let threadApi = null

async function createThread(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  contexts.created++
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  renderer.setClearColor(0x000000, 0) // transparent: the app's canvas shows through
  const canvas = renderer.domElement
  let disposing = false
  canvas.addEventListener('webglcontextlost', () => (disposing ? contexts.forced++ : contexts.lost++))
  host.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20000)
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -100000), new THREE.Vector3(0, 0, 100000)]),
    new THREE.LineBasicMaterial({ color: 0x8b93a7 })
  )
  scene.add(axis)

  const { rasterize, counters } = await createSdfRasterizer({ fontUrl: FONT_URL })
  const layer = await createAtlasGlyphLayer({
    scene, renderer, fontSize: FONT_SIZE, speed: SPEED, lift: LIFT, rasterize,
    extraStats: () => ({ ...counters }),
  })

  const clock = { base: 0, startedAt: performance.now() }
  const now = () => clock.base + (performance.now() - clock.startedAt) / 1000
  const state = { load: 'none', origin: 0, buildMs: 0, letters: 0 }

  async function load(name) {
    const built = name === 'empty' ? { times: [], chars: [], end: 0 } : generateKeys(8, true)
    const started = performance.now()
    await layer.build(built, built.end)
    state.buildMs = performance.now() - started
    state.load = name
    state.origin = built.end
    clock.base = built.end
    clock.startedAt = performance.now()
  }

  const onResize = () => {
    renderer.setSize(innerWidth, innerHeight)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', onResize)

  return {
    load,
    now,
    state,
    stats: () => layer.stats(),
    addLetters(t, text) {
      const letters = graphemes(text)
      for (const g of letters) layer.add(t, g)
      state.letters += letters.length
      return letters.length
    },
    render() {
      const headZ = -(now() - state.origin) * SPEED
      camera.position.set(0.35, 0.28, headZ - 1.2)
      camera.lookAt(0, 0, headZ + 6)
      renderer.render(scene, camera)
    },
    dispose() {
      disposing = true
      removeEventListener('resize', onResize)
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
        for (const m of mats) {
          for (const v of Object.values(m.uniforms ?? {})) if (v && v.value && v.value.isTexture) v.value.dispose()
          m.dispose()
        }
      })
      renderer.dispose()
      // dispose() alone leaves the context alive until GC; a browser allows only
      // a handful at once, so an app that opens and closes threads must release
      // it explicitly or the Nth open renders nothing.
      renderer.forceContextLoss()
      canvas.remove()
      contexts.disposed++
    },
  }
}

export default function ThreadLayer({ load = '8h', onReady }: { load?: string; onReady?: () => void }) {
  const glHostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let thread = null
    let view = null
    let raf = 0
    let cancelled = false

    ;(async () => {
      const t = await createThread(glHostRef.current)
      // StrictMode may have already run cleanup before this resolved.
      if (cancelled) return t.dispose()
      thread = t
      await t.load(load)

      view = new EditorView(editorRef.current, {
        state: EditorState.create({
          schema,
          plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }), keymap(baseKeymap)],
        }),
        dispatchTransaction(tr) {
          view.updateState(view.state.apply(tr))
          if (!tr.docChanged) return
          let inserted = ''
          for (const step of tr.steps) {
            if (step.slice) step.slice.content.descendants((node) => void (node.isText && (inserted += node.text)))
          }
          if (inserted) thread.addLetters(thread.now(), inserted)
        },
      })

      threadApi = { thread, view, focus: () => view.focus() }
      onReady?.()

      const frame = () => {
        thread.render()
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      threadApi = null
      if (view) view.destroy()
      if (thread) thread.dispose()
    }
  }, [load])

  return (
    <>
      <div id="thread-gl" ref={glHostRef} />
      <div id="thread-scrim" />
      <div id="typer">
        <div id="editor" ref={editorRef} />
      </div>
    </>
  )
}
