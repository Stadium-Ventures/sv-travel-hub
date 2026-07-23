import { describe, it, expect } from 'vitest'
import { findColumn } from '../csv'

describe('findColumn', () => {
  it('prefers the exact "Org" header over a prefix-matching "Org Temp"', () => {
    // Real incident 2026-07-23: the sheet grew an empty "Org Temp" column
    // BEFORE "Org"; prefix matching grabbed it first and every org parsed
    // blank (dead NCAA resolution + zero pro assignments on fresh loads).
    const row = { 'Player Name': 'Caleb Daniel', 'Org Temp': '', 'Org': 'Georgia Tech', 'Amateur Org': '' }
    expect(findColumn(row, ['Org', 'Organization', 'Team', 'School'])).toBe('Georgia Tech')
  })

  it('still ignores an exact match whose value is empty', () => {
    const row = { 'Org': '', 'Team': 'Somerset Patriots' }
    expect(findColumn(row, ['Org', 'Organization', 'Team', 'School'])).toBe('Somerset Patriots')
  })

  it('keeps prefix matching for suffixed headers like "State (High School)"', () => {
    const row = { 'State (High School)': 'GA' }
    expect(findColumn(row, ['State', 'Home State'])).toBe('GA')
  })

  it('does not let "Amateur Org" match the Org candidates', () => {
    const row = { 'Amateur Org': 'Texas', 'Org': 'New York Mets' }
    expect(findColumn(row, ['Org', 'Organization', 'Team', 'School'])).toBe('New York Mets')
  })
})
