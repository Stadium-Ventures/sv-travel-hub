import { describe, it, expect } from 'vitest'
import { checkHsSheetSeason, checkSpringTraining, isHsSeasonWindow, isSpringTurnWindow, springSeason, upcomingSeasonYear } from '../seasonTurnChecks'

// Invented players only.
const SHEET_LAST_SEASON = [
  'Player,Date,Level,Venue',
  'Test Player One,5/2/26,HS,Sample High School',
  'Test Player Two,2026-04-30,JUCO,Sample College Field',
  'Test Player Three,2026-03-01,Pro,Sample Park',
].join('\n')

const SHEET_NEW_SEASON = `${SHEET_LAST_SEASON}\nTest Player One,2/20/27,HS,Sample High School`

const d = (iso: string) => new Date(`${iso}T13:00:00Z`)

describe('season windows', () => {
  it('HS/JUCO runs Dec through May', () => {
    expect(isHsSeasonWindow(d('2026-12-01'))).toBe(true)
    expect(isHsSeasonWindow(d('2027-05-31'))).toBe(true)
    expect(isHsSeasonWindow(d('2027-06-01'))).toBe(false)
    expect(isHsSeasonWindow(d('2026-11-30'))).toBe(false)
  })
  it('spring training runs Nov 16 through Feb 15, looking at next spring', () => {
    expect(isSpringTurnWindow(d('2026-11-15'))).toBe(false)
    expect(isSpringTurnWindow(d('2026-11-16'))).toBe(true)
    expect(isSpringTurnWindow(d('2027-02-15'))).toBe(true)
    expect(isSpringTurnWindow(d('2027-02-16'))).toBe(false)
    expect(springSeason(d('2026-11-16'))).toBe(2027)
    expect(springSeason(d('2027-01-10'))).toBe(2027)
    expect(upcomingSeasonYear(d('2026-12-01'))).toBe(2027)
  })
})

describe('checkHsSheetSeason', () => {
  it('December with only last season: enter the new games', () => {
    const [f] = checkHsSheetSeason(SHEET_LAST_SEASON, d('2026-12-07'))
    expect(f!.title).toBe('No 2027 high school games yet')
    expect(f!.how).toContain('newest: May 2, 2026')
    expect(f!.todo).toMatch(/Enter the new season's games/)
  })

  it("after January 31 with only last season: point the hub at this year's tab", () => {
    const [f] = checkHsSheetSeason(SHEET_LAST_SEASON, d('2027-02-01'))
    expect(f!.title).toBe("Travel Hub is still reading last season's high school schedule")
    expect(f!.todo).toMatch(/^Point the hub at this year's schedule tab/)
    expect(f!.todo).toContain('publish the 2027 tab')
    expect(f!.code).toBe(false)
  })

  it('quiet once the new season is in, or when the sheet has no HS rows', () => {
    expect(checkHsSheetSeason(SHEET_NEW_SEASON, d('2027-02-01'))).toEqual([])
    expect(checkHsSheetSeason('Player,Date,Level\nTest Player Three,2026-03-01,Pro', d('2027-02-01'))).toEqual([])
  })
})

describe('checkSpringTraining', () => {
  const schedule = {
    dates: [
      { games: [{ teams: { home: { team: { id: 113 } }, away: { team: { id: 114 } } } }] },
      { games: [{ teams: { home: { team: { id: 147 } }, away: { team: { id: 113 } } } }] },
    ],
  }
  const names: Record<number, string> = { 113: 'Cincinnati Reds', 147: 'New York Yankees', 121: 'New York Mets' }
  const name = (id: number) => names[id] ?? String(id)

  it('flags a client organization with no spring games while others have them', async () => {
    let asked = ''
    const findings = await checkSpringTraining([147, 121, 113], name, d('2026-11-16'), async (url) => { asked = url; return schedule })
    expect(asked).toContain('gameType=S&startDate=2027-02-01&endDate=2027-04-15')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.what).toContain('New York Mets')
    expect(findings[0]!.what).not.toContain('Yankees')
    expect(findings[0]!.how).toContain("while other clubs' games are there")
    expect(findings[0]!.partial).toBe(true)
  })

  it('quiet when every client organization has games, or when MLB is unreachable', async () => {
    expect(await checkSpringTraining([147, 113], name, d('2026-12-01'), async () => schedule)).toEqual([])
    expect(await checkSpringTraining([147], name, d('2026-12-01'), async () => { throw new Error('down') })).toEqual([])
  })

  it('says so when MLB has no spring games at all', async () => {
    const [f] = await checkSpringTraining([147], name, d('2027-01-05'), async () => ({ dates: [] }))
    expect(f!.how).toContain('found none at all')
  })
})
