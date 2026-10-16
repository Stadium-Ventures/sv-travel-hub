import { describe, it, expect } from 'vitest'
import { fallbackVenueCoords, normalizeVenueName } from '../../data/proVenueFallback'
import { extractVenueCoords, type MLBGameRaw } from '../mlbApi'

function game(venue: MLBGameRaw['venue']): MLBGameRaw {
  return {
    gamePk: 1,
    gameDate: '2026-07-01T16:00:00Z',
    officialDate: '2026-07-01',
    teams: {
      away: { team: { id: 1, name: 'Away' } },
      home: { team: { id: 2, name: 'Home' } },
    },
    venue,
    status: { detailedState: 'Scheduled' },
  }
}

describe('fallbackVenueCoords', () => {
  it('places a complex field by venue id', () => {
    expect(fallbackVenueCoords({ venueId: 6118, venueName: 'Camelback Ranch Complex (LAD)' }))
      .toEqual({ lat: 33.51434, lng: -112.29612 })
  })

  it('places a complex field the API re-ids next season by its name', () => {
    expect(fallbackVenueCoords({ venueId: 99999, venueName: 'Goodyear Ballpark Complex (CIN)' }))
      .toEqual({ lat: 33.42892, lng: -112.39027 })
  })

  it('never name-matches a plain park name that repeats across leagues', () => {
    expect(fallbackVenueCoords({ venueName: 'Holman Stadium' })).toBeNull()
    expect(fallbackVenueCoords({ venueId: 2517, venueName: 'Holman Stadium' })).not.toBeNull()
  })

  it('returns null for an unknown venue', () => {
    expect(fallbackVenueCoords({ venueId: 6020, venueName: 'Academia De Béisbol Felipe Alou' })).toBeNull()
  })

  it('normalizes complex suffixes', () => {
    expect(normalizeVenueName('Peoria Stadium Complex (SEA)')).toBe('peoria stadium')
    expect(normalizeVenueName('Lew Wolff Training Complex')).toBe('lew wolff')
    expect(normalizeVenueName('Lee Health Sports Complex Fields')).toBe('lee health sports')
  })
})

describe('extractVenueCoords', () => {
  it('prefers the coordinates MLB publishes', () => {
    const g = game({ id: 6118, name: 'Camelback Ranch Complex (LAD)', location: { defaultCoordinates: { latitude: 1, longitude: 2 } } })
    expect(extractVenueCoords(g)).toEqual({ lat: 1, lng: 2 })
  })

  it('falls back to the table instead of dropping the game', () => {
    const g = game({ id: 7254, name: 'Wilson Ballpark', location: { city: 'Wilson' } })
    expect(extractVenueCoords(g)).toEqual({ lat: 35.72116, lng: -77.9143 })
  })
})
