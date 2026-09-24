/**
 * projectAll against the real engine: a 3D space seen through two views at
 * once, a view that compiles but is not a map to the plane, a view with a
 * parse problem, and a note in another space.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { loadModule } from './engine-cjs.js'

const require = createRequire(import.meta.url)
const { buildWorld } = require('../world.js')
const { projectAll } = require('../projection.js')

const ref = (value) => ({ type: 'ref', value })
const real = (value) => ({ type: 'real', value })
const text = (value) => ({ type: 'text', value })
const NOTE = 'tapestry.notes/note@1'
const VIEW = 'mathspace/view@1'

function at3(x, y, z, extra = {}) {
  return { 'position.x': real(x), 'position.y': real(y), 'position.z': real(z), ...extra }
}

describe('projectAll', () => {
  it('places every note in every working view and names what a view cannot do', async () => {
    const mod = await loadModule()
    const nodes = [
      { id: 'n1', type: 'mathspace/space@1', props: { dim: { type: 'int', value: 3 } } },
      { id: 'n2', type: NOTE, props: { space: ref('n1'), ...at3(4, 6, 0) } },
      { id: 'n3', type: NOTE, props: { space: ref('n1'), ...at3(1, 2, 2) } },
      // Top-down orthographic and a perspective with the camera at z = -2.
      { id: 'n4', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.x, self.position.y]') } },
      { id: 'n5', type: VIEW, props: { space: ref('n1'), ...at3(0, 0, -2), 'project.expr': text('[self.position.x, self.position.y] / (self.position.z + 2)') } },
      // Compiles, but is dim 1.
      { id: 'n6', type: VIEW, props: { space: ref('n1'), 'project.expr': text('self.position.z') } },
      // Does not parse.
      { id: 'n7', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.x,') } },
      // No project.expr at all.
      { id: 'n8', type: VIEW, props: { space: ref('n1') } },
      // A note in the implicit 2D space: outside every view above.
      { id: 'n9', type: NOTE, props: { 'position.x': real(3), 'position.y': real(3) } },
      // A rule is never a point.
      { id: 'n10', type: 'mathspace/rule@1', props: { space: ref('n1'), 'force.expr': text('[0, 0, 1]') } },
    ]
    const { engine, image } = buildWorld(nodes, mod)
    try {
      expect(image.notes).toEqual(['n2', 'n3', 'n9'])
      expect(image.views).toEqual(['n4', 'n5', 'n6', 'n7', 'n8'])
      const out = projectAll(engine, image)
      expect(out.views.map((v) => v.id)).toEqual(['n4', 'n5', 'n6', 'n7', 'n8'])
      expect(out.views[0]).toEqual({ id: 'n4' })
      expect(out.views[1]).toEqual({ id: 'n5' })
      expect(out.views[2]).toEqual({ id: 'n6', error: 'world:BadDim' })
      expect(out.views[3].error).toMatch(/^parse:/)
      expect(out.views[4]).toEqual({ id: 'n8', error: 'world:NoSuchField' })
      expect(out.points).toEqual([
        { id: 'n2', byView: { n4: [4, 6], n5: [2, 3] } },
        { id: 'n3', byView: { n4: [1, 2], n5: [0.25, 0.5] } },
        { id: 'n9', byView: { n4: null, n5: null } },
      ])
    } finally {
      engine.destroy()
    }
  })

  it('is empty when there is nothing to project', async () => {
    const mod = await loadModule()
    const { engine, image } = buildWorld([], mod)
    try {
      expect(projectAll(engine, image)).toEqual({ views: [], points: [] })
    } finally {
      engine.destroy()
    }
  })
})
