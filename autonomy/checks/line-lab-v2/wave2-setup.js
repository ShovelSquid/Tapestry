// SHOT_SCRIPT for wave 2: a scratch tree with three notes, one selected and
// one hovered. Run through app-shot.cjs (which swaps in the scratch path).
(async () => {
  const t = window.tapestry
  const { suggested } = await t.settings.getUserName()
  const named = await t.settings.setUserName(suggested || 'shot')
  if (!named.ok) throw new Error('name: ' + JSON.stringify(named))
  const r = await t.trees.create('__SCRATCH__/space/shot.tree', 'Shot')
  if (!r.ok) throw new Error('create: ' + JSON.stringify(r))
  const doc = (s) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: s }] }] })
  const note = (x, y, title, body, w) => ({
    op: 'createNode', type: 'tapestry.notes/note@1',
    props: {
      'position.x': { type: 'real', value: x }, 'position.y': { type: 'real', value: y },
      title: { type: 'text', value: title }, body: { type: 'text', value: doc(body) },
      ...(w ? { width: { type: 'real', value: w } } : {}),
    },
  })
  await t.kernel.submit(r.treeId, 'notes', [
    note(80, 80, 'Orbit rules', 'Heavier nodes pull lighter ones toward the centre knot.', 300),
    note(460, 80, 'Selected', 'Blue has replaced the pencil.', 260),
    note(80, 340, 'Hovered', 'The bloom came in where the pointer entered.', 280),
  ])
  location.reload()
})()
