import { describe, it, expect } from 'vitest'
import { proSeasonWindow, restOfSeasonEnd, isAflSeason } from '../season'

describe('proSeasonWindow', () => {
  it('spans spring training through the AFL championship', () => {
    expect(proSeasonWindow(new Date('2026-06-15T12:00:00Z'))).toEqual({ start: '2026-03-01', end: '2026-11-30' })
  })
})

describe('restOfSeasonEnd', () => {
  it('is this year while the season is still running', () => {
    expect(restOfSeasonEnd(new Date('2026-09-18T12:00:00Z'))).toBe('2026-11-30')
    expect(restOfSeasonEnd(new Date('2026-10-20T12:00:00Z'))).toBe('2026-11-30')
  })
  it('rolls to next year once the AFL is over', () => {
    expect(restOfSeasonEnd(new Date('2026-12-05T12:00:00Z'))).toBe('2027-11-30')
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
