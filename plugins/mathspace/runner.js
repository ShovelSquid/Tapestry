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
 * The snapshot and diff are taken synchronously before any await, so
 * ticks that land while a commit is in flight belong to the next one.
 * Timers and the kernel are injected: the tests drive tick() and flush()
 * by hand with a fake kernel, and no RangeError from image.js (which the
 * host would read as a plugin crash) can escape: buildImage catches them.
 */

const { Engine } = require('./engine')
const { buildImage, diff, parseSnapshot } = require('./image')

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
    this.timer = null
    this.flushing = null // the in-flight flush promise, if any
  }

  get running() { return this.timer !== null }

  /** Rebuild the engine image from the kernel. Discards pending ticks. */
  async rebuild() {
    const nodes = await this.kernel.getNodes()
    const status = await this.kernel.status()
    const image = buildImage(nodes)
    for (const p of image.problems) this.log(`skipping ${p.id} ${p.key}: ${p.reason}`)
    const mod = await this.loadModule()
    const engine = new Engine(mod, ENGINE_SEED)
    for (const action of image.actions) {
      const rc = engine.apply(action)
      if (rc !== 0) {
        engine.destroy()
        throw new Error(`engine rejected an image action with code ${rc}`)
      }
    }
    if (this.engine) this.engine.destroy()
    this.engine = engine
    this.image = image
    this.seq = status.lastGoodSeq
    this.pending = 0
    this.log(`image built: ${image.fields.size} notes at seq ${this.seq}`)
  }

  /** One engine tick. Triggers a commit every commitEvery ticks while running. */
  tick() {
    if (!this.engine) return
    this.engine.step()
    this.pending += 1
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
      const snapshot = parseSnapshot(this.engine.notes())
      const ops = diff(this.image.fields, snapshot, this.image.types)
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
