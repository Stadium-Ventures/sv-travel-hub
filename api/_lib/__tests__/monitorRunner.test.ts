import { describe, it, expect, vi } from 'vitest'
import { runChecksWithRecheck, type RunnerOptions } from '../monitorRunner'
import { coverageFindings, runCoverageCheck } from '../coverageCheck'
import type { CheckContext, Finding, MonitorCheck } from '../monitorTypes'
import type { RosterClient } from '../monitorTypes'

function finding(key: string, over: Partial<Finding> = {}): Finding {
  return { key, severity: 'warning', code: false, title: key, what: 'w', how: 'h', todo: 't', ...over }
}

function ctx(confirmKeys: Set<string> | null): CheckContext {
  return {
    now: new Date('2026-07-01T13:00:00Z'),
    force: false,
    weekly: false,
    recapPaused: true,
    roster: async () => ({ ok: true, csv: '', clients: [] }),
    fetchJson: async () => { throw new Error('unused') },
    confirmKeys,
  }
}

function options(over: Partial<RunnerOptions> = {}): RunnerOptions & { sleep: ReturnType<typeof vi.fn> } {
  const sleep = vi.fn(async () => {})
  return { makeContext: ctx, pauseMs: 15_000, checkTimeoutMs: 1_000, sleep, ...over } as RunnerOptions & { sleep: ReturnType<typeof vi.fn> }
}

/** A check whose findings change per pass. */
function sequenced(name: string, perPass: Finding[][]): MonitorCheck & { runs: number } {
  const check = {
    name,
    label: name,
    runs: 0,
    run: async () => perPass[check.runs++] ?? [],
  }
  return check
}

describe('runChecksWithRecheck', () => {
  it('posts a total outage on first sight, with no pause and no second run', async () => {
    const outage = sequenced('mlb', [[finding('source:mlb')]])
    const opts = options()
    const { findings, stats } = await runChecksWithRecheck([outage], opts)
    expect(findings.map((f) => f.key)).toEqual(['source:mlb'])
    expect(opts.sleep).not.toHaveBeenCalled()
    expect(outage.runs).toBe(1)
    expect(stats).toMatchObject({ partialSeen: 0, rechecked: 0 })
  })

  it('drops a partial finding that is gone after the pause (a one-off blip)', async () => {
    const blip = sequenced('heartbeat', [[finding('source:heartbeat-partial', { partial: true })], []])
    const opts = options()
    const { findings, stats } = await runChecksWithRecheck([blip], opts)
    expect(findings).toEqual([])
    expect(opts.sleep).toHaveBeenCalledWith(15_000)
    expect(blip.runs).toBe(2)
    expect(stats).toMatchObject({ partialSeen: 1, partialConfirmed: 0, rechecked: 1 })
  })

  it('posts a partial finding that is still there, with the second pass wording', async () => {
    const steady = sequenced('summer', [
      [finding('weekly:summer-blind', { partial: true, what: 'first' })],
      [finding('weekly:summer-blind', { partial: true, what: 'second' })],
    ])
    const { findings, stats } = await runChecksWithRecheck([steady], options())
    expect(findings.map((f) => f.what)).toEqual(['second'])
    expect(stats.partialConfirmed).toBe(1)
  })

  it('never posts a partial finding first seen on the second pass', async () => {
    const late = sequenced('x', [[finding('a', { partial: true })], [finding('a', { partial: true }), finding('b', { partial: true })]])
    const { findings } = await runChecksWithRecheck([late], options())
    expect(findings.map((f) => f.key)).toEqual(['a'])
  })

  it('re-runs only the checks that raised a partial finding, and keeps their outage findings from pass 1', async () => {
    const mixed = sequenced('mixed', [[finding('outage'), finding('part', { partial: true })], [finding('part', { partial: true })]])
    const quiet = sequenced('quiet', [[]])
    const { findings } = await runChecksWithRecheck([mixed, quiet], options())
    expect(findings.map((f) => f.key).sort()).toEqual(['outage', 'part'])
    expect(quiet.runs).toBe(1)
    expect(mixed.runs).toBe(2)
  })

  it('hands the first pass keys to the second pass context', async () => {
    const seen: Array<Set<string> | null> = []
    const check: MonitorCheck = {
      name: 'c',
      label: 'c',
      run: async (c) => {
        seen.push(c.confirmKeys)
        return [finding('coverage:venue', { partial: true, issueKeys: ['venue:1:a'] })]
      },
    }
    await runChecksWithRecheck([check], options())
    expect(seen[0]).toBeNull()
    expect([...seen[1]!].sort()).toEqual(['coverage:venue', 'venue:1:a'])
  })

  it('a check that times out twice posts a "didn\'t finish" finding; once is forgiven', async () => {
    const hang = (): MonitorCheck & { runs: number } => {
      const c = { name: 'slow', label: 'client coverage', runs: 0, run: () => { c.runs++; return new Promise<Finding[]>(() => {}) } }
      return c
    }
    const twice = await runChecksWithRecheck([hang()], options({ checkTimeoutMs: 5 }))
    expect(twice.findings.map((f) => f.key)).toEqual(['timeout:slow'])
    expect(twice.findings[0]!.title).toBe("The client coverage check didn't finish")
    expect(twice.stats.timedOut).toBe(1)

    let n = 0
    const once: MonitorCheck = { name: 'slow', label: 'x', run: () => (n++ === 0 ? new Promise<Finding[]>(() => {}) : Promise.resolve([])) }
    const r = await runChecksWithRecheck([once], options({ checkTimeoutMs: 5 }))
    expect(r.findings).toEqual([])
    expect(r.stats.timedOut).toBe(0)
  })

  it('a check that throws twice posts an error finding and logs it (never to Slack)', async () => {
    const logError = vi.fn()
    const broken: MonitorCheck = { name: 'boom', label: 'Heartbeat', run: async () => { throw new Error('kaput') } }
    const { findings, stats } = await runChecksWithRecheck([broken], options({ logError }))
    expect(findings.map((f) => f.key)).toEqual(['error:boom'])
    expect(findings[0]!.what).not.toContain('kaput')
    expect(logError).toHaveBeenCalledTimes(2)
    expect(stats.errored).toBe(1)
  })

  it('one-pass mode (dry runs) reports partial findings straight away', async () => {
    const blip = sequenced('heartbeat', [[finding('p', { partial: true })], []])
    const opts = options({ recheck: false })
    const { findings } = await runChecksWithRecheck([blip], opts)
    expect(findings.map((f) => f.key)).toEqual(['p'])
    expect(blip.runs).toBe(1)
    expect(opts.sleep).not.toHaveBeenCalled()
  })

  it('lists critical findings first', async () => {
    const c = sequenced('c', [[finding('w1'), finding('c1', { severity: 'critical' })]])
    const { findings } = await runChecksWithRecheck([c], options())
    expect(findings.map((f) => f.key)).toEqual(['c1', 'w1'])
  })
})

describe('re-check with the coverage check and fixture MLB responses', () => {
  // Invented clients and venues. Pass 1 sees two unmapped fields; pass 2 sees
  // only one (the other was a blip in MLB's data), so only that one posts.
  const clients: RosterClient[] = [
    { name: 'Test Player One', mlbId: 900001, org: 'New York Yankees', affiliate: '', level: 'Pro', levelRaw: 'Pro', status: '', isCoach: false },
    { name: 'Test Player Two', mlbId: 900002, org: 'New York Yankees', affiliate: '', level: 'Pro', levelRaw: 'Pro', status: '', isCoach: false },
  ]
  const game = (teamId: number, venueId: number, coords: boolean) => ({
    teams: { home: { team: { id: teamId } }, away: { team: { id: 1 } } },
    venue: {
      id: venueId,
      name: `Sample Field ${venueId}`,
      location: { city: 'Sampletown', stateAbbrev: 'FL', country: 'USA', ...(coords ? { defaultCoordinates: { latitude: 1, longitude: 2 } } : {}) },
    },
  })

  function fixtureFetch(pass: () => number) {
    return async (url: string): Promise<unknown> => {
      if (url.includes('/teams?sportId=1&')) return { teams: [{ id: 147, name: 'New York Yankees', teamName: 'Yankees' }] }
      if (url.includes('/people?')) {
        return { people: [
          { id: 900001, currentTeam: { id: 587, name: 'Sample Club A', parentOrgId: 147 } },
          { id: 900002, currentTeam: { id: 588, name: 'Sample Club B', parentOrgId: 147 } },
        ] }
      }
      if (url.includes('/schedule?')) {
        return { dates: [{ games: pass() === 1
          ? [game(587, 99001, false), game(588, 99002, false)]
          : [game(587, 99001, false), game(588, 99002, true)] }] }
      }
      throw new Error(`no fixture for ${url}`)
    }
  }

  it('posts only the field that is still missing on the second pass', async () => {
    let pass = 0
    const check: MonitorCheck = {
      name: 'coverage',
      label: 'client coverage',
      run: async (c) => {
        let issues = await runCoverageCheck(clients, { now: c.now, fetchJson: c.fetchJson, venueFallback: () => null })
        if (c.confirmKeys) issues = issues.filter((i) => c.confirmKeys!.has(i.key))
        return coverageFindings(issues)
      },
    }
    const { findings } = await runChecksWithRecheck([check], {
      makeContext: (confirmKeys) => {
        pass++
        const current = pass
        return { ...ctx(confirmKeys), fetchJson: fixtureFetch(() => current) }
      },
      pauseMs: 0,
      checkTimeoutMs: 1_000,
      sleep: async () => {},
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.what).toContain('Test Player One')
    expect(findings[0]!.what).not.toContain('Test Player Two')
    expect(findings[0]!.issueKeys).toEqual(['venue:99001:test player one'])
  })
})
