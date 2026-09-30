// The story world behind the bridge: the real kernel (through the Tapestry
// addon) plus a live mirror of its nodes and edges, indexed both ways, so a
// context packet walks out from the speaker and never scans the world
// (spikes 012 and 013b). The kernel stays the only writer; the mirror only
// ever changes by replaying the ops a commit accepted.

'use strict'

const TYPES = {
  character: 'perihelion.story/character@1',
  fact: 'perihelion.story/fact@1',
  opinion: 'perihelion.story/opinion@1',
  sample: 'perihelion.story/sample@1',
  utterance: 'perihelion.story/utterance@1',
}
const LIMITS = { facts: 6, samples: 4, recentLines: 3 }

const num = (id) => Number(id.slice(1))
const txt = (v) => ({ type: 'text', value: v })
const real = (v) => ({ type: 'real', value: v })
const prop = (props, key, fallback = '') => (props[key] ? props[key].value : fallback)

class Mind {
  constructor(addon, path) {
    this.path = path
    this.k = addon.open(path)
    this.reload()
  }

  // Rebuilds the mirror from the kernel. Called once on open; /api/check
  // calls it on a scratch copy to prove the live mirror never drifted.
  reload() {
    this.nodes = new Map()
    this.edges = new Map()
    this.out = new Map()
    this.in = new Map()
    for (const n of this.k.getNodes()) this.nodes.set(n.id, { id: n.id, type: n.type, props: n.props })
    for (const e of this.k.getEdges()) this.addEdge({ id: e.id, from: e.from, to: e.to, label: e.label, props: e.props })
  }

  addEdge(e) {
    this.edges.set(e.id, e)
    const push = (map, key) => (map.get(key) || map.set(key, []).get(key)).push(e)
    push(this.out, `${e.from}|${e.label}`)
    push(this.in, `${e.to}|${e.label}`)
  }

  outEdges(from, label) { return this.out.get(`${from}|${label}`) || [] }
  inEdges(to, label) { return this.in.get(`${to}|${label}`) || [] }
  between(from, label, to) { return this.outEdges(from, label).find((e) => e.to === to) }
  status() { return this.k.status() }

  // Does the live mirror still equal the kernel? The addon only opens
  // read-write, and the journal lock allows one writer per file (spike 014),
  // so the check reloads a byte copy; the kernel syncs every commit, so a
  // copy is always a complete journal.
  verifyMirror(addon, scratchDir) {
    const fs = require('fs')
    const path = require('path')
    const copy = path.join(scratchDir, `mirror-check-${process.pid}.tree`)
    fs.copyFileSync(this.path, copy)
    const fresh = new Mind(addon, copy)
    // Canonical form: the kernel returns properties in key order, the mirror
    // in the order ops set them.
    const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object'
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x)
    const dump = (m) => JSON.stringify(canon({
      nodes: [...m.nodes.values()].sort((a, b) => num(a.id) - num(b.id)),
      edges: [...m.edges.values()].sort((a, b) => num(a.id) - num(b.id)),
    }))
    const same = dump(this) === dump(fresh)
    const counts = { nodes: fresh.nodes.size, edges: fresh.edges.size }
    fresh.close()
    fs.rmSync(copy, { force: true })
    return { same, ...counts }
  }

  // Ops for one commit, with the ids the kernel will assign predicted from
  // getNextIds() so an edge can point at a node created in the same commit.
  batch() {
    const next = this.k.getNextIds()
    let n = num(next.node)
    const ops = []
    return {
      ops,
      node: (type, props) => { ops.push({ op: 'createNode', type, props }); return `n${n++}` },
      edge: (from, to, label, props = {}) => ops.push({ op: 'createEdge', from, to, label, props }),
      set: (target, key, value) => ops.push({ op: 'setProperty', target, key, ...value }),
    }
  }

  // The only write path: the kernel commits, then the mirror replays exactly
  // the ops it accepted, with the ids it returned.
  commit(actorKind, actorId, message, batch) {
    const predicted = batch.ops.filter((op) => op.op === 'createNode').length
    const next = num(this.k.getNextIds().node)
    const result = this.k.submit(actorKind, actorId, message, batch.ops)
    let ni = 0
    let ei = 0
    for (const op of batch.ops) {
      if (op.op === 'createNode') {
        const id = result.nodeIds[ni++]
        if (id !== `n${next + ni - 1}`) throw new Error(`kernel assigned ${id}, bridge predicted n${next + ni - 1}`)
        this.nodes.set(id, { id, type: op.type, props: { ...op.props } })
      } else if (op.op === 'createEdge') {
        this.addEdge({ id: result.edgeIds[ei++], from: op.from, to: op.to, label: op.label, props: { ...op.props } })
      } else if (op.op === 'setProperty') {
        const target = this.nodes.get(op.target) || this.edges.get(op.target)
        target.props[op.key] = { type: op.type, value: op.value }
      }
    }
    if (ni !== predicted) throw new Error('mirror out of step with commit')
    return result
  }

  character(who, except) {
    const needle = String(who).toLowerCase()
    for (const n of this.nodes.values()) {
      if (n.type !== TYPES.character || n.id === except) continue
      if (prop(n.props, 'entity').toLowerCase() === needle || prop(n.props, 'name').toLowerCase() === needle) return n
    }
    return null
  }

  cast() {
    return [...this.nodes.values()].filter((n) => n.type === TYPES.character).map((n) => ({
      id: n.id, name: prop(n.props, 'name'), entity: prop(n.props, 'entity'), role: prop(n.props, 'role'),
      npc: prop(n.props, 'npc', false),
    }))
  }

  // Spike 013b's assembleFor, ported: the same walk, order and limits, so the
  // packet is identical to the C++ one (checked by parity.cjs).
  context(speaker, listener, topic = '') {
    const me = this.character(speaker)
    if (!me) return null
    const who = this.character(listener, me.id)
    const needle = topic.toLowerCase()
    const byNode = (edges, end) => [...edges].sort((a, b) => num(a[end]) - num(b[end]))
    const packet = {
      npc: prop(me.props, 'name'), role: prop(me.props, 'role'), voice: prop(me.props, 'voice'),
      listener: who ? prop(who.props, 'name') : listener, listener_known: Boolean(who),
      opinions_of_listener: [], facts_about_listener: [], topic_facts: [], voice_samples: [], recent_lines_to_listener: [],
    }
    if (who) {
      for (const held of byNode(this.outEdges(me.id, 'holds'), 'to')) {
        if (!this.between(held.to, 'about', who.id)) continue
        const o = this.nodes.get(held.to)
        const item = { text: prop(o.props, 'text'), stance: prop(o.props, 'stance', 0) }
        const because = this.outEdges(held.to, 'because').map((e) => prop(this.nodes.get(e.to).props, 'text'))
        if (because.length) item.because = because
        packet.opinions_of_listener.push(item)
      }
    }
    for (const belief of byNode(this.outEdges(me.id, 'believes'), 'to')) {
      const f = this.nodes.get(belief.to)
      const item = { text: prop(f.props, 'text'), confidence: prop(belief.props, 'confidence', 1) }
      if (who && this.between(belief.to, 'about', who.id)) packet.facts_about_listener.push(item)
      else if (needle && item.text.toLowerCase().includes(needle)) packet.topic_facts.push(item)
    }
    for (const s of byNode(this.inEdges(me.id, 'sample-of'), 'from')) {
      packet.voice_samples.push(prop(this.nodes.get(s.from).props, 'line'))
    }
    const lines = []
    if (who) {
      for (const spoke of byNode(this.outEdges(me.id, 'spoke'), 'to')) {
        if (!this.between(spoke.to, 'said-to', who.id)) continue
        const u = this.nodes.get(spoke.to)
        lines.push([prop(u.props, 'game_time', 0), prop(u.props, 'line')])
      }
    }
    // Array.prototype.sort is stable, matching std::stable_sort.
    packet.opinions_of_listener.sort((a, b) => Math.abs(b.stance) - Math.abs(a.stance))
    packet.facts_about_listener.sort((a, b) => b.confidence - a.confidence)
    packet.topic_facts.sort((a, b) => b.confidence - a.confidence)
    packet.facts_about_listener = packet.facts_about_listener.slice(0, LIMITS.facts)
    packet.topic_facts = packet.topic_facts.slice(0, LIMITS.facts)
    packet.voice_samples = packet.voice_samples.slice(0, LIMITS.samples)
    lines.sort((a, b) => a[0] - b[0])
    packet.recent_lines_to_listener = lines.slice(-LIMITS.recentLines).map((l) => l[1])
    return packet
  }

  // Everything one character holds, for the page's mind panel.
  mindOf(name) {
    const me = this.character(name)
    if (!me) return null
    const nameOf = (id) => prop(this.nodes.get(id).props, 'name')
    return {
      name: prop(me.props, 'name'),
      beliefs: this.outEdges(me.id, 'believes').map((b) => {
        const f = this.nodes.get(b.to)
        return {
          fact: f.id, text: prop(f.props, 'text'), canon: prop(f.props, 'canon', true),
          confidence: prop(b.props, 'confidence', 1), source: prop(b.props, 'source'),
          about: this.outEdges(f.id, 'about').map((e) => nameOf(e.to)),
        }
      }),
      opinions: this.outEdges(me.id, 'holds').map((h) => {
        const o = this.nodes.get(h.to)
        return {
          id: o.id, text: prop(o.props, 'text'), stance: prop(o.props, 'stance', 0),
          about: this.outEdges(o.id, 'about').map((e) => nameOf(e.to)),
          because: this.outEdges(o.id, 'because').map((e) => prop(this.nodes.get(e.to).props, 'text')),
        }
      }),
      lines: this.outEdges(me.id, 'spoke').length,
    }
  }

  lastGameTime() {
    let t = 0
    for (const n of this.nodes.values()) if (n.type === TYPES.utterance) t = Math.max(t, prop(n.props, 'game_time', 0))
    return t
  }

  say(speaker, listener, line, gameTime) {
    const me = this.character(speaker)
    const who = this.character(listener, me && me.id)
    if (!me || !who) throw new Error('unknown speaker or listener')
    const b = this.batch()
    const u = b.node(TYPES.utterance, { line: txt(line), game_time: { type: 'int', value: gameTime } })
    b.edge(me.id, u, 'spoke')
    b.edge(u, who.id, 'said-to')
    return this.commit('plugin', 'perihelion.speaker', `said to ${prop(who.props, 'name')}`, b)
  }

  // A game event: a new fact, what it's about, and who witnessed it.
  observe({ text, canon = true, about = [], witnesses = [] }) {
    const b = this.batch()
    const f = b.node(TYPES.fact, { text: txt(text), canon: { type: 'bool', value: Boolean(canon) } })
    for (const name of about) b.edge(f, this.character(name).id, 'about')
    for (const w of witnesses) {
      b.edge(this.character(w.name).id, f, 'believes',
        { confidence: real(Number(w.confidence ?? 1)), source: txt(w.source || 'witnessed') })
    }
    return this.commit('plugin', 'perihelion.world', 'observed', b)
  }

  // The mind-sim's hand, until a model does it: move a held opinion's stance,
  // optionally recording the fact that moved it.
  shift({ opinion, stance, because }) {
    const b = this.batch()
    b.set(opinion, 'stance', real(Number(stance)))
    if (because && !this.between(opinion, 'because', because)) b.edge(opinion, because, 'because')
    return this.commit('plugin', 'perihelion.mind', 'opinion shifts', b)
  }

  close() { this.k.close() }
}

module.exports = { Mind, TYPES }
