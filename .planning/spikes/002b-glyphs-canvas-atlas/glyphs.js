// Spike 002b — thread letters from a canvas texture atlas, drawn as instanced
// quads with no text library.
//
// The atlas is 16 × 6 cells of 128 px with Verdana drawn by the browser. Every
// letter is one instance (position + character) in a single draw call.
import * as THREE from 'three'
import { startSpike } from '../002-shared/scene.js'

const CELL = 128
const COLS = 16
const ROWS = 6
const EM_PX = CELL * 0.62 // em height inside a cell
const DESCENT_PX = CELL * 0.26 // cell bottom sits this far below the baseline
const CAPACITY = 200000

async function makeAtlas(fontUrl, renderer) {
  const face = new FontFace('SpikeVerdana', `url(${fontUrl})`)
  await face.load()
  document.fonts.add(face)
  const canvas = document.createElement('canvas')
  canvas.width = CELL * COLS
  canvas.height = CELL * ROWS
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${EM_PX}px SpikeVerdana`
  for (let code = 32; code < 127; code++) {
    const i = code - 32
    ctx.fillText(String.fromCharCode(code), ((i % COLS) + 0.5) * CELL, (Math.floor(i / COLS) + 1) * CELL - DESCENT_PX)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return texture
}

startSpike({
  variant: '002b-glyphs-canvas-atlas',
  label: 'Spike 002b — canvas atlas + instanced quads (no text library)',
  async createGlyphLayer({ scene, renderer, fontUrl, fontSize, speed, lift }) {
    const quad = fontSize * (CELL / EM_PX) // world size of one cell
    const bottom = fontSize * (DESCENT_PX / EM_PX) - lift // cell bottom below the thread line

    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    const positions = new Float32Array(CAPACITY * 3)
    const chars = new Float32Array(CAPACITY)
    const aPos = new THREE.InstancedBufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    const aChar = new THREE.InstancedBufferAttribute(chars, 1).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aPos', aPos)
    geometry.setAttribute('aChar', aChar)
    geometry.instanceCount = 0

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: await makeAtlas(fontUrl, renderer) },
        uTheta: { value: Math.PI },
        uQuad: { value: quad },
        uBottom: { value: bottom },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPos;
        attribute float aChar;
        uniform float uTheta, uQuad, uBottom;
        varying vec2 vUv;
        void main() {
          vec3 right = vec3(cos(uTheta), 0.0, -sin(uTheta)); // same as rotation.y = uTheta
          vec3 p = aPos + right * position.x * uQuad + vec3(0.0, (position.y + 0.5) * uQuad - uBottom, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          float code = aChar - 32.0;
          float col = mod(code, ${COLS.toFixed(1)});
          float row = floor(code / ${COLS.toFixed(1)});
          vUv = vec2((col + position.x + 0.5) / ${COLS.toFixed(1)}, 1.0 - (row + 0.5 - position.y) / ${ROWS.toFixed(1)});
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        void main() {
          float a = texture2D(uAtlas, vUv).a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.95, 0.96, 1.0, a);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    scene.add(mesh)

    // three uploads only update ranges when any exist (spike 001 finding), so a
    // live range must not be added while a full upload is pending.
    let pendingFull = false
    mesh.onAfterRender = () => (pendingFull = false)

    let count = 0
    let origin = 0
    function write(t, code) {
      if (count >= CAPACITY) return false
      positions.set([0, 0, -(t - origin) * speed], count * 3)
      chars[count] = code
      count++
      geometry.instanceCount = count
      return true
    }

    return {
      async build(keys, tOrigin) {
        count = 0
        origin = tOrigin
        for (let i = 0; i < keys.length; i += 2) write(keys[i], keys[i + 1])
        for (const attr of [aPos, aChar]) {
          attr.clearUpdateRanges()
          attr.needsUpdate = true
        }
        pendingFull = true
      },
      add(t, code) {
        if (!write(t, code)) return
        for (const attr of [aPos, aChar]) {
          if (!pendingFull) attr.addUpdateRange((count - 1) * attr.itemSize, attr.itemSize)
          attr.needsUpdate = true
        }
      },
      setOrientation(theta) {
        material.uniforms.uTheta.value = theta
      },
      stats() {
        return { glyphs: count, gpuBufferMB: (count * 16) / 1048576 }
      },
    }
  },
})
