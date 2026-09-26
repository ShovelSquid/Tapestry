// SHOT_SCRIPT for wave 3: a scratch tree with three notes (pill, settings,
// plain). Stores the tree id for the pose script. Run through app-shot.cjs (which swaps in the scratch path).
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
    note(80, 80, 'Formatting', 'Select some text and the f opens into the pill.', 320),
    note(480, 80, 'Settings', 'The settings button flips the note.', 280),
    note(80, 340, 'Resting', 'A note that is not selected shows no buttons.', 280),
  ])
  localStorage.setItem('shotTree', r.treeId)
  location.reload()
})()
