import { describe, it, expect } from 'vitest'
import { orderLinesByDrive } from '../routeOrder'

// Tom's 2026-08-19 case: Steinbrenner (Tampa), Clover Park (Port St. Lucie),
// Roger Dean (Jupiter). PSL sits between Jupiter and Tampa, so any sane run
// has Clover Park in the middle — first-pitch order and anchor-first order
// both produced zig-zags through it.
const TAMPA = { lat: 27.9799, lng: -82.5067 }   // George M. Steinbrenner Field
const PSL = { lat: 27.3243, lng: -80.4062 }     // Clover Park
const JUPITER = { lat: 26.8905, lng: -80.1161 } // Roger Dean Chevrolet Stadium

function names(lines: Array<{ name: string }>): string[] {
  return lines.map((l) => l.name)
}

describe('orderLinesByDrive', () => {
  it('puts the geographically middle venue in the middle of a day, whatever the input order', () => {
    for (const input of [
      [
        { date: '2026-08-19', coords: TAMPA, name: 'Steinbrenner' },
        { date: '2026-08-19', coords: PSL, name: 'Clover' },
        { date: '2026-08-19', coords: JUPITER, name: 'RogerDean' },
      ],
      [
        { date: '2026-08-19', coords: JUPITER, name: 'RogerDean' },
        { date: '2026-08-19', coords: TAMPA, name: 'Steinbrenner' },
        { date: '2026-08-19', coords: PSL, name: 'Clover' },
      ],
    ]) {
      const ordered = names(orderLinesByDrive(input))
      expect(ordered[1]).toBe('Clover')
    }
  })

  it('chains the next day from where the previous day ended', () => {
    // Day 1 is Jupiter-only; day 2 has all three parks. Day 2 must start
    // from the park nearest Jupiter (PSL) and end in Tampa — never
    // PSL -> Jupiter -> Tampa (backtracking) or Tampa-first (crossing the
    // state twice, the anchor-first bug from Tom's screenshot).
    const ordered = names(orderLinesByDrive([
      { date: '2026-08-20', coords: PSL, name: 'Clover' },
      { date: '2026-08-20', coords: JUPITER, name: 'RogerDean' },
      { date: '2026-08-20', coords: TAMPA, name: 'Steinbrenner' },
      { date: '2026-08-19', coords: JUPITER, name: 'RogerDean' },
    ]))
    expect(ordered).toEqual(['RogerDean', 'RogerDean', 'Clover', 'Steinbrenner'])
  })

  it('keeps same-venue lines in their given (time) order', () => {
    const ordered = orderLinesByDrive([
      { date: '2026-08-19', coords: PSL, name: 'Clover', time: '18:10' },
      { date: '2026-08-19', coords: PSL, name: 'Clover', time: '13:05' },
    ])
    expect(ordered.map((l) => l.time)).toEqual(['18:10', '13:05'])
  })
})
