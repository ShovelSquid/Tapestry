// SHOT_SCRIPT for wave 4: a scratch tree with four notes, one plain
// connection (Source → Target) and one knot between Left and Right. Stores
// the tree id for the pose script. Run through app-shot.cjs.
(async () => {
  const t = window.tapestry
  const { suggested } = await t.settings.getUserName()
  const named = await t.settings.setUserName(suggested || 'shot')
  if (!named.ok) throw new Error('name: ' + JSON.stringify(named))
  const r = await t.trees.create('__SCRATCH__/space/shot.tree', 'Shot')
  if (!r.ok) throw new Error('create: ' + JSON.stringify(r))
  const doc = (s) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] })
  const P = (x, y) => ({ 'position.x': { type: 'real', value: x }, 'position.y': { type: 'real', value: y } })
  const note = (x, y, title, body) => ({
    op: 'createNode', type: 'tapestry.notes/note@1',
    props: { ...P(x, y), title: { type: 'text', value: title }, body: { type: 'text', value: doc(body) }, width: { type: 'real', value: 260 } },
  })
  await t.kernel.submit(r.treeId, 'notes', [
    note(60, 60, 'Source', 'Drag from the blue dot.'),
    note(560, 110, 'Target', 'Connected with a blue ink line.'),
    note(60, 380, 'Left', 'A knot sits on this connection.'),
    note(620, 430, 'Right', 'Knots are small notes.'),
  ])
  const byTitle = async () => {
    const nodes = await t.kernel.getNodes(r.treeId)
    return Object.fromEntries(nodes.filter((n) => n.props.title).map((n) => [n.props.title.value, n.id]))
  }
  let ids = await byTitle()
  await t.kernel.submit(r.treeId, 'knot', [
    { op: 'createNode', type: 'tapestry.notes/knot@1', props: { ...P(0, 0), body: { type: 'text', value: doc('because') } } },
  ])
  const nodes = await t.kernel.getNodes(r.treeId)
  const knot = nodes.find((n) => n.type === 'tapestry.notes/knot@1')
  await t.kernel.submit(r.treeId, 'edges', [
    { op: 'createEdge', from: ids.Source, to: ids.Target, label: 'link' },
    { op: 'createEdge', from: ids.Left, to: knot.id, label: 'knot-tie' },
    { op: 'createEdge', from: knot.id, to: ids.Right, label: 'knot-tie' },
  ])
  // Motion off unless the pose wants it, so paths compare across a reload.
  if (window.__STILL__) {
    const off = { on: false, strength: 0 }
    localStorage.setItem('tapestry.motion.v1', JSON.stringify({ selectionWave: off, selectionGrow: off, hoverBloom: off, bob: off }))
  }
  localStorage.setItem('shotTree', r.treeId)
  location.reload()
})()
