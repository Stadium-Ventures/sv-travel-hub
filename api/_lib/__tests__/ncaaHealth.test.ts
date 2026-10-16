import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkNcaaSchedules, sheetGameCount } from '../ncaaHealth'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', 'ncaa', name), 'utf8')
const page = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } })

/** Every school's site answers with the same page. */
const sitesServe = (body: string) => async (url: string) => (url.endsWith('/robots.txt') ? page('', 404) : page(body))

describe('checkNcaaSchedules', () => {
  it('is silent outside the college season and fall ball', async () => {
    const findings = await checkNcaaSchedules(new Date('2026-07-15T12:00:00Z'), { schools: ['Texas'], fetchFn: sitesServe('') })
    expect(findings).toEqual([])
  })

  it('is silent when the schedules read fine', async () => {
    const findings = await checkNcaaSchedules(new Date('2026-10-16T12:00:00Z'), {
      schools: ['Texas'],
      fetchFn: sitesServe(fixture('sidearm-text-2027.html')),
    })
    expect(findings).toEqual([])
  })

  it('in the fall, flags a page it cannot read but not an unpublished season', async () => {
    const broken = await checkNcaaSchedules(new Date('2026-10-16T12:00:00Z'), {
      schools: ['Texas'],
      fetchFn: sitesServe(fixture('unreadable-skeleton.html')),
    })
    expect(broken).toHaveLength(1)
    expect(broken[0]!.what).toContain('Texas')
    expect(broken[0]!.code).toBe(true)

    const unpublished = await checkNcaaSchedules(new Date('2026-10-16T12:00:00Z'), {
      schools: ['Texas'],
      fetchFn: sitesServe(fixture('sidearm-grid-2026.html')),
    })
    expect(unpublished).toEqual([])
  })

  it('in the spring, flags no games and schools with no source the sheet does not cover', async () => {
    const now = new Date('2027-03-10T12:00:00Z')
    const findings = await checkNcaaSchedules(now, {
      schools: ['Texas', 'Notre Dame'],
      fetchFn: sitesServe(fixture('sidearm-grid-2026.html')), // only last season's games
    })
    const text = findings.map((f) => f.what).join(' | ')
    expect(text).toContain('No 2027 games found for Texas')
    expect(text).toContain('Notre Dame')

    const covered = await checkNcaaSchedules(now, {
      schools: ['Notre Dame'],
      fetchFn: sitesServe(''),
      sheetCsvText: 'Client,Team,Level,Date,Location\nTest Player,Notre Dame,NCAA,3/14/27,"South Bend, IN"\n',
    })
    expect(covered).toEqual([])
  })
})

describe('sheetGameCount', () => {
  it('counts distinct NCAA game dates for a school, reading quoted cells', () => {
    const csv = [
      'Client,Team,Level,Date,Location,Opponent',
      'A,Ohio St.,NCAA,3/3/27,"Columbus, OH",Xavier',
      'B,Ohio St.,NCAA,3/3/27,"Columbus, OH",Xavier',
      'A,Ohio St.,NCAA,3/4/27,"Columbus, OH",Butler',
      'A,Ohio St.,NCAA,3/4/26,"Columbus, OH",Butler',
      'A,Ohio St.,HS,3/5/27,"Columbus, OH",Butler',
    ].join('\n')
    expect(sheetGameCount(csv, 'Ohio State', '2026-08-01', '2027-07-31')).toBe(2)
  })
})
