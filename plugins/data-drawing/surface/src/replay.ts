/**
 * replay.ts — the "Verify replay" orchestration (SIM-03; phase success
 * criterion 5, live half).
 *
 * verifyReplay asks the host to replay its own recorded session log from
 * tick zero into a fresh sim instance and to compare that instance with the
 * live one (SimDriver.replayFromZero: at every hash-ring boundary and at
 * the live tick). formatReplayLine renders the panel line. A DIFF is a bug
 * report, never a correction: nothing here writes to the live state, and
 * the caller must not either (01-08-PLAN prohibition).
 */
import { hexOf } from './ddsim-abi'
import { hashesEqual, type ReplayReport } from './sim-driver'
import type { SimHost } from './sim-host'

export type { ReplayReport } from './sim-driver'
export { hashesEqual } from './sim-driver'

export interface ReplayVerdict extends ReplayReport {
  match: boolean
}

export function verdictOf(report: ReplayReport): ReplayVerdict {
  const match = report.firstDiffTick === null && hashesEqual(report.liveHash, report.replayHash) && report.nodeCount === report.replayNodeCount
  return { ...report, match }
}

/** Replays the host's session log from zero and reports whether it reproduces the live state. */
export async function verifyReplay(host: Pick<SimHost, 'replayFromZero'>): Promise<ReplayVerdict> {
  return verdictOf(await host.replayFromZero())
}

/** `replay: MATCH (tick N, nodes M)` or `replay: DIFF at tick K`. */
export function formatReplayLine(report: ReplayReport): string {
  const v = verdictOf(report)
  if (v.match) return `replay: MATCH (tick ${v.liveTick}, nodes ${v.nodeCount})`
  return `replay: DIFF at tick ${v.firstDiffTick ?? v.liveTick}`
}

/** The long form for the console when a DIFF is found: both hashes and counts. */
export function describeReplay(report: ReplayReport): string {
  return `${formatReplayLine(report)} — live ${hexOf(report.liveHash)} (${report.nodeCount} nodes) vs replay ${hexOf(report.replayHash)} (${report.replayNodeCount} nodes)`
}
