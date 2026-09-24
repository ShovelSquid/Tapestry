// Spike 002a — thread letters as SDF text with troika-three-text.
//
// One troika Text per keystroke, all batched into a single BatchedText draw
// call. troika is built for runs of text, so this also tests whether it copes
// with tens of thousands of one-letter texts at arbitrary positions.
import * as THREE from 'three'
import { BatchedText, Text, preloadFont } from 'troika-three-text'
import { startSpike } from '../002-shared/scene.js'

startSpike({
  variant: '002a-glyphs-sdf',
  label: 'Spike 002a — troika-three-text (SDF, BatchedText)',
  async createGlyphLayer({ scene, fontUrl, fontSize, speed, lift, printable }) {
    await new Promise((resolve) => preloadFont({ font: fontUrl, characters: printable }, resolve))

    let batch = null
    let texts = []
    let origin = 0
    let theta = Math.PI

    function reset() {
      if (batch) {
        scene.remove(batch)
        batch.dispose()
        for (const text of texts) text.dispose()
      }
      batch = new BatchedText()
      scene.add(batch)
      texts = []
    }

    function makeText(t, code) {
      const text = new Text()
      text.text = String.fromCharCode(code)
      text.font = fontUrl
      text.fontSize = fontSize
      text.anchorX = 'center'
      text.anchorY = 'bottom-baseline'
      text.color = 0xf2f4ff
      text.position.set(0, lift, -(t - origin) * speed)
      text.rotation.y = theta
      text.updateMatrixWorld(true) // members aren't in the scene graph
      batch.add(text)
      texts.push(text)
      return text
    }

    reset()
    return {
      async build(keys, tOrigin) {
        reset()
        origin = tOrigin
        const synced = []
        for (let i = 0; i < keys.length; i += 2) {
          const text = makeText(keys[i], keys[i + 1])
          synced.push(new Promise((resolve) => text.sync(resolve)))
        }
        await Promise.all(synced)
      },
      add(t, code) {
        makeText(t, code).sync()
      },
      setOrientation(next) {
        theta = next
        for (const text of texts) {
          text.rotation.y = next
          text.updateMatrixWorld(true)
        }
      },
      stats() {
        return { glyphs: texts.length }
      },
    }
  },
})
