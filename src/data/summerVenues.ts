// Coordinates for summer-league venues.
//
// The MLB Stats API exposes partner-league schedules (CCBL leagueId=565,
// MLBD leagueId=5536) but the venue records only carry city/state — no
// defaultCoordinates like MLB/MiLB venues do. We hardcode the well-known
// home fields so summer games get accurate pins on the map without an
// extra geocoding round trip.
//
// Keys are the venue NAME as returned by the MLB API (case-insensitive).
// Fallback path: city+state geocoding via Nominatim if venue is unknown
// (handled in summerStore).

import type { Coordinates } from '../types/roster'

export const SUMMER_VENUE_COORDS: Record<string, Coordinates> = {
  // CCBL — Cape Cod, MA
  'lowell park':              { lat: 41.6184, lng: -70.4385 }, // Cotuit
  'veterans field':           { lat: 41.6829, lng: -69.9601 }, // Chatham
  'stony brook field':        { lat: 41.7569, lng: -70.0763 }, // Brewster
  'red wilson field':         { lat: 41.7148, lng: -70.2272 }, // Yarmouth-Dennis (D-Y)
  'spillane field':           { lat: 41.7621, lng: -70.7196 }, // Wareham
  'mckeon park':              { lat: 41.6534, lng: -70.2782 }, // Hyannis
  'whitehouse field':         { lat: 41.6839, lng: -70.0744 }, // Harwich
  'guv fuller field':         { lat: 41.5510, lng: -70.6172 }, // Falmouth
  'doran park':               { lat: 41.7404, lng: -70.6055 }, // Bourne
  'eldredge park':            { lat: 41.7842, lng: -69.9869 }, // Orleans

  // MLB Draft League
  "historic bowman field":    { lat: 41.2360, lng: -77.0021 }, // Williamsport Crosscutters
  'bowman field':             { lat: 41.2360, lng: -77.0021 }, // alias
  'trenton thunder ballpark': { lat: 40.2068, lng: -74.7563 }, // Trenton
  'arm & hammer park':        { lat: 40.2068, lng: -74.7563 }, // alias
  'eastwood field':           { lat: 41.1817, lng: -80.7588 }, // Mahoning Valley
  'medlar field at lubrano park': { lat: 40.8003, lng: -77.8557 }, // State College Spikes
  'medlar field':             { lat: 40.8003, lng: -77.8557 }, // alias
  'monongalia county ballpark': { lat: 39.6418, lng: -79.9882 }, // WV Black Bears
  'ripken stadium':           { lat: 39.5189, lng: -76.1696 }, // Aberdeen
  'leidos field at ripken stadium': { lat: 39.5189, lng: -76.1696 }, // alias
}

export function lookupSummerVenueCoords(venueName: string): Coordinates | null {
  if (!venueName) return null
  const key = venueName.toLowerCase().trim()
  if (SUMMER_VENUE_COORDS[key]) return SUMMER_VENUE_COORDS[key]
  // Lenient match: try stripping common suffixes / prefixes
  const stripped = key.replace(/^the\s+/, '').replace(/\s+(ballpark|stadium|field|park)$/, '')
  for (const [k, v] of Object.entries(SUMMER_VENUE_COORDS)) {
    if (k.includes(stripped) || stripped.includes(k.replace(/\s+(ballpark|stadium|field|park)$/, ''))) {
      return v
    }
  }
  return null
}
