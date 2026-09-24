/**
 * runner.js — the run loop: engine ticks in memory, kernel commits on a
 * cadence (mathspace_plan.md, "Commit granularity").
 *
 * One Runner per plugin. `start` rebuilds the image from kernel.getNodes(),
 * applies it to a fresh engine, and steps at `hz` on an interval. Every
 * `commitEvery` ticks, on pause, and on a single step, `flush` reads the
 * snapshot, diffs it against the before-image, and submits the changed
 * lanes as `setProperty` ops plus one `advance k`, so the .tree replays to
 * every committed state without the engine.
 *
 * Human edits during a run (plan, "Human edits during a run"): the SDK
 * has no change subscription, so before each commit the runner compares
 * status().lastGoodSeq with the seq of its own last commit. If the
 * journal moved without it, the engine's pending ticks are discarded and
 * the image is rebuilt, so a drag or a formula edit is never overwritten
 * by stale engine output.
 *
 * Rule nodes (RULE-07): every problem the image or the compile pass
 * records against a `mathspace/rule@1` node is written onto that node as
 * `mathspace.error text` in the next commit, and a node whose problems
 * are gone gets the property unset, so a broken rule is visible in the
 * inspector and in the .tree. Runtime skips (Engine.errors, what step()
 * could not evaluate or apply) are summed per rule over the ticks since
 * the last commit and folded into the same text as `step: skipped N
 * visits (Reason)`, so a rule that fails on some ticks of a commit is
 * still reported, and a rule that stops failing loses the text at the
 * next commit. The count changes the text, so a rule that keeps failing
 * rewrites its property on every commit; that is the record wanted.
 *
 * The snapshot and diff are taken synchronously before any await, so
 * ticks that land while a commit is in flight belong to the next one.
 * Timers and the kernel are injected: the tests drive tick() and flush()
 * by hand with a fake kernel, and no RangeError from image.js (which the
 * host would read as a plugin crash) can escape: buildImage catches them.
 */

const { Engine } = require('./engine')
const { ERROR_KEY, buildImage, diff, encodeBindField, engineSource, kernelName, nodeIdToU64, parseSnapshot, u64ToNodeId } = require('./image')

const ENGINE_SEED = 1n

class Runner {
  /**
   * @param {object} opts
   * @param {() => Promise<object>} opts.loadModule the Wasm module loader
   * @param {number} [opts.hz] steps per second while running
   * @param {number} [opts.commitEvery] ticks per commit while running
   * @param {(fn: () => void, ms: number) => unknown} [opts.setInterval]
   * @param {(t: unknown) => void} [opts.clearInterval]
   * @param {(msg: string) => void} [opts.log]
   */
  constructor(opts) {
    this.loadModule = opts.loadModule
    this.hz = opts.hz ?? 60
    this.commitEvery = opts.commitEvery ?? 60
    this.setIntervalFn = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms))
    this.clearIntervalFn = opts.clearInterval ?? ((t) => clearInterval(t))
    this.log = opts.log ?? ((msg) => console.log(`[mathspace] ${msg}`))
    this.kernel = null
    this.engine = null
    this.image = null
    this.seq = -1 // lastGoodSeq after our last commit or rebuild; -1 forces a rebuild
    this.pending = 0 // ticks stepped since the last commit
    this.skips = new Map() // rule node id -> {skipped, reason} summed since the last commit
    this.timer = null
    this.flushing = null // the in-flight flush promise, if any
  }

  get running() { return this.timer !== null }

  /** Rebuild the engine image from the kernel. Discards pending ticks. */
  async rebuild() {
    const nodes = await this.kernel.getNodes()
    const status = await this.kernel.status()
    const image = buildImage(nodes)
    const mod = await this.loadModule()
    const engine = new Engine(mod, ENGINE_SEED)
    for (const action of image.actions) {
      const rc = engine.apply(action)
      if (rc !== 0) {
        engine.destroy()
        throw new Error(`engine rejected an image action with code ${rc}`)
      }
    }
    // Second pass: every note and field exists now, so refs resolve.
    // A binding that fails is a problem on that node, never a rebuild
    // failure: the rest of the world still runs.
    for (const b of image.bindings) {
      const key = `${kernelName(b.name)}.expr`
      const src = engineSource(b.text)
      const r = engine.compile(b.id, src.text)
      if (r.error !== undefined) {
        image.problems.push({ id: b.node, key, reason: `${r.error} at ${src.back(r.where)}` })
        continue
      }
      const rc = engine.apply(encodeBindField(b.id, b.name, r.code))
      if (rc !== 0) image.problems.push({ id: b.node, key, reason: `bind rejected with code ${rc}` })
    }
    for (const p of image.problems) this.log(`skipping ${p.id} ${p.key}: ${p.reason}`)
    if (this.engine) this.engine.destroy()
    this.engine = engine
    this.image = image
    this.seq = status.lastGoodSeq
    this.pending = 0
    this.skips = new Map()
    this.log(`image built: ${image.fields.size} notes at seq ${this.seq}`)
  }

  /**
   * RULE-07: the `mathspace.error` ops a commit owes rule nodes, and the
   * text each rule should carry afterwards (null for none). A rule's text
   * is its problems as `key: reason` lines, plus a `step` line for the
   * runtime skips in `skips`, joined by `; ` in key order; only rules
   * whose text differs from what the kernel holds get an op.
   * @param {Map<string, {skipped: number, reason: string}>} skips
   */
  errorOps(skips = this.skips) {
    const wanted = new Map()
    const add = (id, line) => {
      if (!this.image.rules.has(id)) return
      if (!wanted.has(id)) wanted.set(id, [])
      wanted.get(id).push(line)
    }
    for (const p of this.image.problems) add(p.id, `${p.key}: ${p.reason}`)
    for (const [id, s] of skips) add(id, `step: skipped ${s.skipped} visit${s.skipped === 1 ? '' : 's'} (${s.reason})`)
    const ops = []
    const ids = [...this.image.rules.keys()].sort((a, b) => (nodeIdToU64(a) < nodeIdToU64(b) ? -1 : 1))
    for (const id of ids) {
      const text = wanted.has(id) ? wanted.get(id).sort().join('; ') : null
      wanted.set(id, text)
      if (text === this.image.rules.get(id)) continue
      ops.push(text === null
        ? { op: 'unsetProperty', target: id, key: ERROR_KEY }
        : { op: 'setProperty', target: id, key: ERROR_KEY, type: 'text', value: text })
    }
    return { ops, wanted }
  }

  /** One engine tick. Triggers a commit every commitEvery ticks while running. */
  tick() {
    if (!this.engine) return
    this.engine.step()
    this.pending += 1
    for (const e of this.engine.errors()) {
      const id = u64ToNodeId(e.id)
      const prior = this.skips.get(id)
      this.skips.set(id, { skipped: (prior ? prior.skipped : 0) + e.skipped, reason: e.reason })
    }
    if (this.running && this.pending >= this.commitEvery && !this.flushing) {
      this.flush().catch((err) => this.log(`commit failed: ${err.message}`))
    }
  }

  /**
   * Commit what has moved since the last commit. Serialized: a second call
   * while one is in flight waits for it and then runs.
   */
  flush() {
    const run = async () => {
      if (!this.engine || this.pending === 0) return null
      const ticks = this.pending
      this.pending = 0
      const skips = this.skips
      this.skips = new Map()
      const snapshot = parseSnapshot(this.engine.notes())
      const errors = this.errorOps(skips)
      const ops = [...errors.ops, ...diff(this.image.fields, snapshot, this.image.types, new Set(this.image.rules.keys()))]
      const status = await this.kernel.status()
      if (status.lastGoodSeq !== this.seq) {
        this.log(`journal moved to seq ${status.lastGoodSeq} without us; rebuilding, ${ticks} ticks dropped`)
        await this.rebuild()
        return null
      }
      let result
      try {
        result = await this.kernel.submit('plugin', 'mathspace', `advance ${ticks}`, [...ops, { op: 'advance', ticks }])
      } catch (err) {
        this.seq = -1 // the world may have changed under us; rebuild before the next commit
        throw err
      }
      this.seq = result.seq
      this.image.fields = snapshot
      this.image.rules = errors.wanted
      return result
    }
    // `flushing` is the settled-safe tracker (never rejects, so tick() and
    // a waiting test can await it); the returned promise carries the error.
    const prior = this.flushing ?? Promise.resolve()
    const p = prior.then(run)
    const tracked = p.catch(() => null).finally(() => { if (this.flushing === tracked) this.flushing = null })
    this.flushing = tracked
    return p
  }

  /** mathspace.run: build the image and step at hz. */
  async start(kernel) {
    this.kernel = kernel
    if (this.running) return
    await this.rebuild()
    this.timer = this.setIntervalFn(() => this.tick(), 1000 / this.hz)
    this.log(`running at ${this.hz} Hz, committing every ${this.commitEvery} ticks`)
  }

  /** mathspace.pause: stop stepping and commit what has moved. */
  async pause(kernel) {
    this.kernel = kernel
    if (!this.running) return
    this.clearIntervalFn(this.timer)
    this.timer = null
    await this.flush()
    this.log(`paused at seq ${this.seq}`)
  }

  /** mathspace.step: one tick and one commit. Ignored while running. */
  async stepOnce(kernel) {
    this.kernel = kernel
    if (this.running) return
    if (!this.engine || this.seq !== (await kernel.status()).lastGoodSeq) await this.rebuild()
    this.tick()
    await this.flush()
  }

  /** deactivate: drop the timer and the engine without committing. */
  dispose() {
    if (this.timer !== null) this.clearIntervalFn(this.timer)
    this.timer = null
    if (this.engine) this.engine.destroy()
    this.engine = null
    this.image = null
  }
}

module.exports = { Runner, ENGINE_SEED }
