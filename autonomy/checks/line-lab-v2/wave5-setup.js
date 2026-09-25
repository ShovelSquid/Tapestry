// SHOT_SETUP for wave 5: a scratch tree with a container note holding two
// notes (a wide one and a narrow one far to the right, so the container is
// wide), a top-level note, and a connection. At ~20% zoom that is every
// form at once: the container still a note, the wide child and the
// top-level note circles, the narrow child a dot. Run through app-shot.cjs.
(async () => {
  const t = window.tapestry
  const { suggested } = await t.settings.getUserName()
  const named = await t.settings.setUserName(suggested || 'shot')
  if (!named.ok) throw new Error('name: ' + JSON.stringify(named))
  const r = await t.trees.create('__SCRATCH__/space/shot.tree', 'Shot')
  if (!r.ok) throw new Error('create: ' + JSON.stringify(r))
  const doc = (s) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] })
  const P = (x, y) => ({ 'position.x': { type: 'real', value: x }, 'position.y': { type: 'real', value: y } })
  const note = (x, y, w, title, body, inside) => ({
    op: 'createNode', type: 'tapestry.notes/note@1',
    props: {
      ...P(x, y), title: { type: 'text', value: title }, body: { type: 'text', value: doc(body) },
      width: { type: 'real', value: w }, ...(inside ? { inside: { type: 'ref', value: inside } } : {}),
    },
  })
  await t.kernel.submit(r.treeId, 'notes', [
    note(60, 60, 400, 'Garden', 'Holds two notes.'),
    note(60, 520, 260, 'Seeds', 'A top-level note.'),
  ])
  const byTitle = async () => {
    const nodes = await t.kernel.getNodes(r.treeId)
    return Object.fromEntries(nodes.filter((n) => n.props.title).map((n) => [n.props.title.value, n.id]))
  }
  let ids = await byTitle()
  await t.kernel.submit(r.treeId, 'nested', [
    note(24, 80, 260, 'Beds', 'Nested, wide.', ids.Garden),
    note(560, 80, 120, 'Tap', 'Nested, narrow.', ids.Garden),
  ])
  ids = await byTitle()
  await t.kernel.submit(r.treeId, 'edges', [{ op: 'createEdge', from: ids.Seeds, to: ids.Garden, label: 'link' }])
  localStorage.setItem('shotTree', r.treeId)
  location.reload()
})()
