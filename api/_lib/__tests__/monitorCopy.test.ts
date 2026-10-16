import { describe, it, expect } from 'vitest'
import * as copy from '../monitorCopy'
import { coverageFindings, type CoverageIssue } from '../coverageCheck'
import { heartbeatAccessFinding } from '../heartbeatAuth'
import type { Finding } from '../monitorTypes'

// Every finding the monitor can post, built with sample arguments (invented
// names only), checked against the plain-English contract.

function everyFinding(): Finding[] {
  const out: Finding[] = [
    copy.wiringTest(),
    copy.monitorCrashed(),
    copy.checkDidNotFinish({ name: 'coverage', label: 'client coverage' }, 'timeout'),
    copy.checkDidNotFinish({ name: 'coverage', label: 'client coverage' }, 'error'),
    ...Object.values(copy.recap).map((fn) => fn()),
    copy.roster.sourceMistyped(),
    copy.roster.sheetLinkMissing(),
    copy.roster.registryKeyMissing(),
    copy.roster.registryRefused('rejected'),
    copy.roster.registryRefused('not-allowed'),
    copy.roster.registryDown(),
    copy.roster.tooShort(3),
    copy.roster.sheetUnreadable(),
    copy.sources.hsSheetUnreadable(),
    copy.sources.eventsSheetUnreadable(),
    copy.sources.heartbeatDown(),
    copy.sources.heartbeatPartlyDown(['visit counts']),
    copy.sources.mlbDown(),
    copy.weekly.ncaaSchoolsUnmatched([{ school: 'Sample State', names: ['Test Player One'] }]),
    copy.weekly.hsSeasonNotEntered(2027, '2026-05-02'),
    copy.weekly.hsStillLastSeason(2027, ''),
    copy.weekly.summerSheetNotConnected(),
    copy.weekly.summerSheetUnreadable(),
    copy.weekly.summerMisspelled(['"Test Plyr One" (roster: Test Player One)']),
    copy.weekly.summerNoPlacements(12),
    copy.weekly.summerUnplaced(['Test Player One', 'Test Player Two']),
    copy.weekly.summerNoFeedMissing(['Test Player One (Sample Club, Sample League)'], 'ok', 2026),
    copy.weekly.summerNoFeedMissing(['Test Player One (Sample Club, Sample League)'], 'not-connected', 2026),
    copy.weekly.summerNoFeedMissing(['Test Player One (Sample Club, Sample League)'], 'unreadable', 2026),
    copy.weekly.summerTeamUnmatched(['Test Player One ("Sample Club", Sample League)']),
    copy.weekly.summerLeaguesBlind(['Sample League'], 2026),
    copy.weekly.aflNoClubs(2026),
    copy.weekly.aflRostersEmpty(6),
    copy.weekly.springTrainingMissing(2027, ['New York Mets'], true),
    copy.weekly.springTrainingMissing(2027, ['New York Mets', 'Athletics'], false),
  ]
  const issues: CoverageIssue[] = [
    { kind: 'unmapped-venue', key: 'v', client: 'Test Player One', venueId: 1, venue: 'Sample Field', place: 'Sampletown, FL', games: 1 },
    { kind: 'org-mismatch', key: 'o', client: 'Test Player Two', rosterOrg: 'New York Yankees', mlbOrg: 'New York Mets' },
    { kind: 'unknown-id', key: 'u', client: 'Test Player Three' },
    { kind: 'no-id-no-match', key: 'n', client: 'Test Player Four', org: 'New York Mets', orgKnown: true },
    { kind: 'no-id-no-match', key: 'n2', client: 'Test Player Five', org: '', orgKnown: false },
    { kind: 'afl-no-id', key: 'a', client: 'Test Player Six', club: 'Sample Fall Club', mlbId: 900006 },
    { kind: 'afl-no-id', key: 'a2', client: 'Test Player Seven', club: 'Sample Fall Club', mlbId: 900007 },
    { kind: 'lookup-failed', key: 'lookup-failed' },
  ]
  out.push(...coverageFindings(issues))
  const env = 'https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables'
  for (const probe of [{ status: 401, svAuth: null }, { status: 403, svAuth: null }, { status: 200, svAuth: 'would-401: x' }]) {
    for (const tokenSet of [true, false]) {
      const x = heartbeatAccessFinding(probe, { tokenSet, weekly: true, envUrl: env })
      if (x) out.push(x)
    }
  }
  return out
}

describe('plain-English contract for every finding', () => {
  const all = everyFinding()

  it('builds a good number of findings to check', () => {
    expect(all.length).toBeGreaterThan(45)
  })

  for (const x of all) {
    it(`${x.key}: what / how / todo / title are plain English`, () => {
      for (const [field, text] of Object.entries({ title: x.title, what: x.what, how: x.how, todo: x.todo })) {
        const where = `${x.key}.${field}: ${text}`
        expect(text.trim(), where).not.toBe('')
        expect(text, where).not.toMatch(/\bHTTP\b|\b[45]\d\d\b/) // status codes
        expect(text, where).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/) // SETTING_NAMES
        expect(text, where).not.toMatch(/`/) // code formatting
        expect(text, where).not.toMatch(/(^|[\s(])(api|src|scripts)\/|\.(ts|tsx|js|cjs|json)\b/) // file paths
        expect(text, where).not.toMatch(/[a-z][A-Z][a-z]+\(|\(\)/) // function names
        expect(text, where).not.toMatch(/threshold|floor is|fail-closed/i)
        expect(text, where).not.toMatch(/[–—…]|\.\.\./) // no long dashes or ellipses
      }
      expect(x.title.length, x.key).toBeLessThan(90)
    })
  }
})

describe('buildMessage', () => {
  const venue = coverageFindings([
    { kind: 'unmapped-venue', key: 'v1', client: 'Test Player One', venueId: 1, venue: 'Sample Field', place: 'Sampletown, FL', games: 2 },
    { kind: 'unmapped-venue', key: 'v2', client: 'Test Player Two', venueId: 1, venue: 'Sample Field', place: 'Sampletown, FL', games: 2 },
  ])[0]!

  const statusEmoji = (s: string) => (s.match(/🔴|🟡|🟢|⚠️|:red_circle:|:large_yellow_circle:|:warning:/g) ?? []).length

  it('a single finding reads like the example alert', () => {
    const msg = copy.buildMessage([venue])
    const lines = msg.split('\n')
    expect(lines[0]).toBe("🟡 *Travel Hub (sv-travel-hub): 2 clients have games the map can't place*  🛠️ Code change")
    expect(lines[1]).toMatch(/^\*What broke:\* Test Player One and Test Player Two have games/)
    expect(lines[2]).toMatch(/^\*How we know:\* This morning's coverage check found/)
    expect(lines[3]).toBe('*What to do:* Open sv-travel-hub in Claude Code and add the field to the venue fallback table.')
    expect(lines).toHaveLength(4)
    expect(statusEmoji(msg)).toBe(1)
  })

  it('several findings: one status emoji (red when anything is critical), critical first, code roll-up', () => {
    const msg = copy.buildMessage([venue, copy.sources.mlbDown(), copy.roster.registryDown()])
    expect(statusEmoji(msg)).toBe(1)
    expect(msg.startsWith('🔴 *Travel Hub (sv-travel-hub): 3 problems*')).toBe(true)
    expect(msg.indexOf("sv-registry didn't send the roster")).toBeLessThan(msg.indexOf('Pro games are missing'))
    expect(msg).toContain('👤 Manual')
    expect(msg.trim().endsWith('1 of 3 need a code change: open sv-travel-hub in Claude Code.')).toBe(true)
  })

  it('no code roll-up when nothing needs code', () => {
    const msg = copy.buildMessage([copy.sources.mlbDown(), copy.sources.heartbeatDown()])
    expect(msg).not.toContain('need a code change')
    expect(msg.endsWith('\n')).toBe(false)
  })
})
