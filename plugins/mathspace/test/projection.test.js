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

  it('shows one 4D space through two axis-pair views at once, every note in both', async () => {
    const mod = await loadModule()
    const at4 = (x, y, z, w) => ({ space: ref('n1'), 'position.x': real(x), 'position.y': real(y), 'position.z': real(z), 'position.w': real(w) })
    const nodes = [
      { id: 'n1', type: 'mathspace/space@1', props: { dim: { type: 'int', value: 4 } } },
      { id: 'n2', type: NOTE, props: at4(1, 2, 3, 4) },
      { id: 'n3', type: NOTE, props: at4(-5, 0.5, 0, 7) },
      { id: 'n4', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.x, self.position.y]') } },
      { id: 'n5', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.z, self.position.w]') } },
    ]
    const { engine, image } = buildWorld(nodes, mod)
    try {
      expect(image.problems).toEqual([])
      const out = projectAll(engine, image)
      expect(out.views).toEqual([{ id: 'n4' }, { id: 'n5' }])
      expect(out.points).toEqual([
        { id: 'n2', byView: { n4: [1, 2], n5: [3, 4] } },
        { id: 'n3', byView: { n4: [-5, 0.5], n5: [0, 7] } },
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

describe('projectAll through a space embed', () => {
  it('a view of an embedded space reads self.embed; a bad embed fails every view of the space', async () => {
    const mod = await loadModule()
    const sphere = text('[sin(self.position.x) * cos(self.position.y), sin(self.position.x) * sin(self.position.y), cos(self.position.x)]')
    const nodes = [
      { id: 'n1', type: 'mathspace/space@1', props: { dim: { type: 'int', value: 2 }, 'embed.expr': sphere } },
      // The pole and a point on the equator at phi = pi / 2 (as close as a real gets).
      { id: 'n2', type: NOTE, props: { space: ref('n1'), 'position.x': real(0), 'position.y': real(0) } },
      { id: 'n3', type: NOTE, props: { space: ref('n1'), 'position.x': real(1.5707963267341256), 'position.y': real(1.5707963267341256) } },
      // Looking down z, and from the side.
      { id: 'n4', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[100 * self.embed.x, 100 * self.embed.y]') } },
      { id: 'n5', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[100 * self.embed.x, 100 * self.embed.z]') } },
      // Chart coordinates still work in the same space.
      { id: 'n6', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.x, self.position.y]') } },
      // A space whose embed is not a map into 3-space: every view of it fails.
      { id: 'n7', type: 'mathspace/space@1', props: { dim: { type: 'int', value: 2 }, 'embed.expr': text('[self.position.x, self.position.y]') } },
      { id: 'n8', type: NOTE, props: { space: ref('n7'), 'position.x': real(1), 'position.y': real(2) } },
      { id: 'n9', type: VIEW, props: { space: ref('n7'), 'project.expr': text('[self.position.x, self.position.y]') } },
    ]
    const { engine, image } = buildWorld(nodes, mod)
    try {
      expect(image.problems).toEqual([])
      expect(image.bindings.map((b) => `${b.node} ${b.name}`)).toEqual(['n1 embed', 'n4 project', 'n5 project', 'n6 project', 'n7 embed', 'n9 project'])
      const out = projectAll(engine, image)
      expect(out.views).toEqual([{ id: 'n4' }, { id: 'n5' }, { id: 'n6' }, { id: 'n9', error: 'world:BadDim' }])
      const round = (p) => (p === null ? null : p.map((v) => Math.round(v * 1000) / 1000))
      const byId = Object.fromEntries(out.points.map((p) => [p.id, Object.fromEntries(Object.entries(p.byView).map(([v, q]) => [v, round(q)]))]))
      expect(byId.n2).toEqual({ n4: [0, 0], n5: [0, 100], n6: [0, 0] })
      expect(byId.n3).toEqual({ n4: [0, 100], n5: [0, 0], n6: [1.571, 1.571] })
      expect(byId.n8).toEqual({ n4: null, n5: null, n6: null })
    } finally {
      engine.destroy()
    }
  })
})
