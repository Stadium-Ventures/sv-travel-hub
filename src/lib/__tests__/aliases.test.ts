import { describe, expect, it } from 'vitest'
import { NCAA_ALIASES, resolveNcaaName } from '../../data/aliases'
import { D1_BASEBALL_SLUGS } from '../../data/d1baseballSlugs'
import { NCAA_VENUES } from '../../data/ncaaVenues'

describe('NCAA school tables stay in sync', () => {
  // A school in NCAA_ALIASES but missing from the slug table gets its schedule
  // fetch skipped (or slug-guessed); missing from venues loses home-game pins.
  // Adding a school means touching all three — this catches the forgotten one.
  it('every alias-table school has a D1Baseball slug', () => {
    for (const school of Object.keys(NCAA_ALIASES)) {
      expect(D1_BASEBALL_SLUGS[school], `${school} missing from D1_BASEBALL_SLUGS`).toBeTruthy()
    }
  })

  it('every alias-table school has a home venue', () => {
    for (const school of Object.keys(NCAA_ALIASES)) {
      expect(NCAA_VENUES[school], `${school} missing from NCAA_VENUES`).toBeTruthy()
    }
  })

  it('every slug-table school resolves through the alias table', () => {
    for (const school of Object.keys(D1_BASEBALL_SLUGS)) {
      expect(resolveNcaaName(school), `${school} not resolvable via NCAA_ALIASES`).toBe(school)
    }
  })
})

describe('resolveNcaaName', () => {
  it('resolves the 2026 transfer destinations', () => {
    expect(resolveNcaaName('Tennessee')).toBe('Tennessee')
    expect(resolveNcaaName('University of Tennessee')).toBe('Tennessee')
    expect(resolveNcaaName('Hawaii')).toBe('Hawaii')
    expect(resolveNcaaName("Hawai'i")).toBe('Hawaii')
  })

  it('is case-insensitive and returns null for unknown schools', () => {
    expect(resolveNcaaName('tennessee')).toBe('Tennessee')
    expect(resolveNcaaName('Some Unknown School')).toBeNull()
  })
})
