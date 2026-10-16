import { describe, it, expect } from 'vitest'
import { proSeasonWindow, proSeasonYear, restOfSeasonEnd, isAflSeason } from '../season'

// Local noon, so the calendar day is the same in every timezone the tests run in.
const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 12)
}

describe('proSeasonWindow', () => {
  it('spans spring training through the AFL championship', () => {
    expect(proSeasonWindow(day('2026-06-15'))).toEqual({ start: '2026-02-15', end: '2026-11-30' })
  })

  it('stays on the current season through the AFL championship (Nov 15)', () => {
    expect(proSeasonWindow(day('2026-10-16'))).toEqual({ start: '2026-02-15', end: '2026-11-30' })
    expect(proSeasonWindow(day('2026-11-15'))).toEqual({ start: '2026-02-15', end: '2026-11-30' })
  })

  it('rolls to next season the day after the AFL championship', () => {
    expect(proSeasonWindow(day('2026-11-16'))).toEqual({ start: '2027-02-15', end: '2027-11-30' })
    expect(proSeasonWindow(day('2026-12-31'))).toEqual({ start: '2027-02-15', end: '2027-11-30' })
  })

  it('keeps the new season after New Year and through Opening Day', () => {
    expect(proSeasonWindow(day('2027-01-02'))).toEqual({ start: '2027-02-15', end: '2027-11-30' })
    expect(proSeasonWindow(day('2027-03-30'))).toEqual({ start: '2027-02-15', end: '2027-11-30' })
  })

  it('starts early enough to include late-February camp games', () => {
    // 2027 big-league spring training games begin Feb 19.
    expect(proSeasonWindow(day('2027-01-02')).start <= '2027-02-19').toBe(true)
  })
})

describe('proSeasonYear', () => {
  it('flips on Nov 16', () => {
    expect(proSeasonYear(day('2026-11-15'))).toBe(2026)
    expect(proSeasonYear(day('2026-11-16'))).toBe(2027)
    expect(proSeasonYear(day('2027-01-02'))).toBe(2027)
  })
})

describe('restOfSeasonEnd', () => {
  it('matches the fetch window end on every key date', () => {
    for (const d of ['2026-10-16', '2026-11-15', '2026-11-16', '2026-12-31', '2027-01-02', '2027-03-30']) {
      expect(restOfSeasonEnd(day(d))).toBe(proSeasonWindow(day(d)).end)
    }
  })

  it('is this year while the season is still running', () => {
    expect(restOfSeasonEnd(day('2026-09-18'))).toBe('2026-11-30')
    expect(restOfSeasonEnd(day('2026-11-15'))).toBe('2026-11-30')
  })

  it('rolls to next year once the AFL is over', () => {
    expect(restOfSeasonEnd(day('2026-11-16'))).toBe('2027-11-30')
    expect(restOfSeasonEnd(day('2026-12-05'))).toBe('2027-11-30')
  })

  it('never ends before today, so the default range is never empty', () => {
    for (const d of ['2026-10-16', '2026-11-15', '2026-11-16', '2026-12-31', '2027-01-02', '2027-03-30']) {
      expect(restOfSeasonEnd(day(d)) >= d).toBe(true)
    }
  })
})

describe('isAflSeason', () => {
  it('is true Sep through Nov only', () => {
    expect(isAflSeason(new Date('2026-08-31T12:00:00Z'))).toBe(false)
    expect(isAflSeason(new Date('2026-09-01T12:00:00Z'))).toBe(true)
    expect(isAflSeason(new Date('2026-11-15T12:00:00Z'))).toBe(true)
    expect(isAflSeason(new Date('2026-12-01T12:00:00Z'))).toBe(false)
  })
})
