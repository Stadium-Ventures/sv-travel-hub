import { describe, it, expect } from 'vitest'
import { parseScheduleCsv } from '../scheduleCsv'

const HEADER = 'Team,Level,Date,Time (Local time),Ballpark,Opponent,Location'

const VALID_CSV = [
  HEADER,
  'IMG,HS,3/10/26,6:00 PM,IMG,Sarasota,"Bradenton, FL"',
  'IMG,HS,3/12/26,7:00 PM,Sarasota HS,@ Sarasota,"Sarasota, FL"',
  'SCF,JUCO,3/11/26,TBD,SCF Ballpark,State College of Florida Foe,"Bradenton, FL"',
  'Mystery Prep,HS,3/15/26,6:00 PM,Somewhere Field,Foo,"Nowhere, FL"',
].join('\n')

describe('parseScheduleCsv', () => {
  it('throws when the body is HTML (auth/interstitial page)', () => {
    expect(() => parseScheduleCsv('<!DOCTYPE html><html><body>Sign in</body></html>'))
      .toThrow(/HTML/)
  })

  it('throws when required headers are missing', () => {
    expect(() => parseScheduleCsv('Foo,Bar\n1,2'))
      .toThrow(/missing required column\(s\): Team, Level, Date/)
  })

  it('parses a valid fixture (HS + JUCO) and reports unmapped teams', () => {
    const result = parseScheduleCsv(VALID_CSV)

    expect(result.hsRowCount).toBe(4)
    expect(result.unmappedTeams).toEqual(['Mystery Prep'])
    expect(result.schedules.size).toBe(2)

    const img = result.schedules.get('IMG|FL')
    expect(img).toBeDefined()
    expect(img!.games).toHaveLength(2)
    // Home game at the IMG ballpark, DST-Eastern local time converted to UTC
    expect(img!.games[0]).toMatchObject({
      date: '2026-03-10',
      isHome: true,
      opponent: 'Sarasota',
      time: '2026-03-10T22:00:00+00:00',
    })
    // "@" opponent prefix → away, prefix stripped
    expect(img!.games[1]).toMatchObject({ date: '2026-03-12', isHome: false, opponent: 'Sarasota' })

    const scf = result.schedules.get('SCF|FL')
    expect(scf).toBeDefined()
    expect(scf!.games[0]).toMatchObject({
      date: '2026-03-11',
      time: null, // TBD time
      isHome: true, // ballpark contains the team name → home
    })
  })
})
