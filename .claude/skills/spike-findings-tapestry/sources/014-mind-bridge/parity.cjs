// Parity: the bridge's JS packet must equal spike 013b's C++ packet for every
// speaker, listener and topic, both on the seeded story and after the bridge
// itself has written to it (a line, an event, an opinion shift), and the
// live mirror must equal a fresh reload from the kernel.
//
//   TAPESTRY_ADDON=… STORY_COMPARE=… node parity.cjs

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { Mind } = require('./mind.cjs')
const { addonPath } = require('./paths.cjs')

const { TapestryAddon } = require(addonPath())
const storyCompare = process.env.STORY_COMPARE
if (!storyCompare) throw new Error('set STORY_COMPARE to the story_compare binary from spike 013')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'))
const file = path.join(work, 'story.tree')
fs.copyFileSync(path.join(__dirname, 'examples/story.tree'), file)

const speakers = ['Rook', 'Kade', 'Ines', 'Oda']
const listeners = ['stranger', 'npc.rook', 'pilot.kade', 'npc.ines', 'npc.oda', 'player']
const topics = ['', 'parts', 'cells', 'ridge', 'depot']

function compareAll(mind, label) {
  let checked = 0
  let bad = 0
  for (const s of speakers) {
    for (const l of listeners) {
      for (const t of topics) {
        const cpp = JSON.parse(execFileSync(storyCompare, ['packet', file, s, l, ...(t ? [t] : [])]))
        const js = mind.context(s, l, t)
        checked++
        if (JSON.stringify(cpp) !== JSON.stringify(js)) {
          if (++bad <= 2) console.log(`MISMATCH ${s} -> ${l} [${t}]\n cpp ${JSON.stringify(cpp)}\n js  ${JSON.stringify(js)}`)
        }
      }
    }
  }
  console.log(`${label}: ${checked} packets, ${bad} mismatched`)
  return bad
}

const mind = new Mind(TapestryAddon, file)
let bad = compareAll(mind, 'seeded story')

// The bridge writes: a line, an event two NPCs witness, and a shift in
// Rook's opinion that cites it.
mind.say('Rook', 'player', 'Depot convoy is late. Again.', mind.lastGameTime() + 60)
const seen = mind.observe({
  text: 'The depot convoy was ambushed at the pass; Vesper drove it off',
  about: ['Vesper'],
  witnesses: [{ name: 'Rook', confidence: 0.9, source: 'witnessed' }, { name: 'Kade', confidence: 0.7, source: 'told by Rook' }],
})
const factId = seen.nodeIds[0]
const hard = mind.mindOf('Rook').opinions.find((o) => o.text === 'Vesper is hard on machines')
mind.shift({ opinion: hard.id, stance: -0.2, because: factId })
mind.close() // the C++ side reads the file from disk

const reopened = new Mind(TapestryAddon, file)
bad += compareAll(reopened, 'after bridge writes')
reopened.close()

// Same writes again, without closing: is the live mirror still the kernel?
const live = new Mind(TapestryAddon, file)
live.say('Kade', 'player', 'Next round is yours.', live.lastGameTime() + 60)
live.observe({ text: 'Ines found two extra cells behind the depot crates', about: [], witnesses: [{ name: 'Ines' }] })
const mirrorOk = live.verifyMirror(TapestryAddon, work).same
console.log(`live mirror equals a fresh reload after writes: ${mirrorOk}`)
live.close()

fs.rmSync(work, { recursive: true, force: true })
process.exit(bad === 0 && mirrorOk ? 0 : 1)
