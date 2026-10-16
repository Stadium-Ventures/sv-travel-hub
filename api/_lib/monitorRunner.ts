// Runs the health monitor's checks with stateless noise control.
//
// Pass 1 runs every check in parallel, each with its own time limit. Findings
// that describe a total outage (a source fully down, a missing setting) are
// kept as they are and post on first sight. Findings marked `partial` (some
// clients, one endpoint, one league) are only candidates: after a short pause
// the checks that raised them run again (pass 2) with a fresh cache, and a
// partial finding posts only if pass 2 raises it again. Item-level keys
// (`issueKeys`) are handed to pass 2 so a check can keep only the items it saw
// both times. There is no state between runs; the daily cron is the 24-hour
// cap, and there are no recovery messages.
//
// A check that runs past its time limit or throws becomes a partial "didn't
// finish" finding, so it is retried once too and posts only if it fails both
// times.
import { checkDidNotFinish } from './monitorCopy.js'
import type { CheckContext, Finding, MonitorCheck } from './monitorTypes.js'

export interface RunnerOptions<C extends CheckContext = CheckContext> {
  /** Build a fresh context per pass. confirmKeys is null on pass 1. */
  makeContext: (confirmKeys: Set<string> | null) => C
  /** Pause between the passes. */
  pauseMs: number
  /** Per-check time limit, per pass. */
  checkTimeoutMs: number
  sleep?: (ms: number) => Promise<void>
  /** false: one pass only, partial findings reported as they are (manual
   *  dry runs, which must answer the dead-man probe within a minute). */
  recheck?: boolean
  /** Where a check's error goes (never Slack). */
  logError?: (checkName: string, err: unknown) => void
}

export interface RunStats {
  checks: number
  rechecked: number
  partialSeen: number
  partialConfirmed: number
  timedOut: number
  errored: number
}

export interface RunResult {
  findings: Finding[]
  stats: RunStats
}

type Outcome = 'ok' | 'timeout' | 'error'

async function runOne<C extends CheckContext>(check: MonitorCheck<C>, ctx: C, opts: RunnerOptions<C>): Promise<{ findings: Finding[]; outcome: Outcome }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), opts.checkTimeoutMs) })
  try {
    const result = await Promise.race([check.run(ctx), timeout])
    if (result === 'timeout') return { findings: [checkDidNotFinish(check, 'timeout')], outcome: 'timeout' }
    return { findings: result, outcome: 'ok' }
  } catch (e) {
    opts.logError?.(check.name, e)
    return { findings: [checkDidNotFinish(check, 'error')], outcome: 'error' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runChecksWithRecheck<C extends CheckContext>(checks: Array<MonitorCheck<C>>, opts: RunnerOptions<C>): Promise<RunResult> {
  const sleep = opts.sleep ?? defaultSleep
  const stats: RunStats = { checks: checks.length, rechecked: 0, partialSeen: 0, partialConfirmed: 0, timedOut: 0, errored: 0 }

  const ctx1 = opts.makeContext(null)
  const pass1 = await Promise.all(checks.map(async (check) => ({ check, ...(await runOne(check, ctx1, opts)) })))

  const confirmed: Finding[] = []
  const partials: Finding[] = []
  const partialKeys = new Set<string>()
  const rerun: Array<MonitorCheck<C>> = []
  for (const r of pass1) {
    let hasPartial = false
    for (const x of r.findings) {
      if (x.partial) {
        hasPartial = true
        partials.push(x)
        stats.partialSeen++
        partialKeys.add(x.key)
        for (const k of x.issueKeys ?? []) partialKeys.add(k)
      } else {
        confirmed.push(x)
      }
    }
    if (hasPartial) rerun.push(r.check)
  }

  const lastOutcomes = new Map<string, Outcome>(pass1.map((r) => [r.check.name, r.outcome]))
  if (opts.recheck === false) {
    confirmed.push(...partials)
  } else if (rerun.length > 0) {
    stats.rechecked = rerun.length
    await sleep(opts.pauseMs)
    const ctx2 = opts.makeContext(partialKeys)
    const pass2 = await Promise.all(rerun.map(async (check) => ({ check, ...(await runOne(check, ctx2, opts)) })))
    for (const r of pass2) {
      lastOutcomes.set(r.check.name, r.outcome)
      for (const x of r.findings) {
        // Only what pass 1 also saw. A brand-new partial problem waits for
        // tomorrow's run; pass 2's non-partial findings were already counted.
        if (x.partial && partialKeys.has(x.key)) {
          confirmed.push(x)
          stats.partialConfirmed++
        }
      }
    }
  }
  for (const outcome of lastOutcomes.values()) {
    if (outcome === 'timeout') stats.timedOut++
    if (outcome === 'error') stats.errored++
  }

  // One finding per key (two checks never share one, but be safe), critical first.
  const seen = new Set<string>()
  const findings = confirmed.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
  return { findings, stats }
}
