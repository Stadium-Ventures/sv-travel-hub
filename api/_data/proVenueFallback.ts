// Map locations for U.S. venues the MLB Stats API returns with no
// coordinates. Without these, mlbGameToEvent dropped every game played there:
// ~300 complex-league (ACL/FCL) games in 2026 plus every home game at three
// minor-league parks (CarMax Park, Nymeo Field, Wilson Ballpark), with only a
// Data health line to show for it (found 2026-10-16).
//
// Complex fields ("Camelback Ranch Complex (LAD)") use the main stadium's
// location, which the API does publish; they sit on the same grounds. The rest
// were geocoded from the venue address. Dominican complexes and winter-league
// parks are left out on purpose: the hub is a driving app.
//
// Lives in api/_data so the health monitor can import it. App code goes
// through src/data/proVenueFallback.ts. Pure data, no imports.

export interface VenueFallbackInput {
  venueId?: number
  venueName?: string
  city?: string
}

interface FallbackVenue {
  name: string
  lat: number
  lng: number
}

const BY_ID: Record<number, FallbackVenue> = {
  // Arizona complexes (ACL) and the fall league's Tucson date
  6118: { name: 'Camelback Ranch Complex (LAD)', lat: 33.51434, lng: -112.29612 },
  6127: { name: 'Camelback Ranch Complex (CWS)', lat: 33.51434, lng: -112.29612 },
  6120: { name: 'Goodyear Ballpark Complex (CLE)', lat: 33.42892, lng: -112.39027 },
  6129: { name: 'Goodyear Ballpark Complex (CIN)', lat: 33.42892, lng: -112.39027 },
  6119: { name: 'Peoria Stadium Complex (SD)', lat: 33.63187, lng: -112.23359 },
  6128: { name: 'Peoria Stadium Complex (SEA)', lat: 33.63187, lng: -112.23359 },
  6117: { name: 'Salt River Fields Complex (AZ)', lat: 33.54523, lng: -111.88552 },
  6126: { name: 'Salt River Fields Complex (COL)', lat: 33.54523, lng: -111.88552 },
  6125: { name: 'Surprise Stadium Complex (KC)', lat: 33.62762, lng: -112.37849 },
  6116: { name: 'Surprise Stadium Complex (TEX)', lat: 33.62762, lng: -112.37849 },
  6115: { name: 'Sloan Park Complex', lat: 33.43081, lng: -111.882 },
  6114: { name: 'Tempe Diablo Stadium Complex', lat: 33.40092, lng: -111.9707 },
  2770: { name: 'Lew Wolff Training Complex', lat: 33.42843, lng: -111.82841 },
  2501: { name: 'Kino Veterans Memorial Stadium', lat: 32.17678, lng: -110.93331 },

  // Florida complexes (FCL)
  6083: { name: 'Roger Dean Stadium Complex (MIA)', lat: 26.890957, lng: -80.116365 },
  6124: { name: 'Roger Dean Stadium Complex (STL)', lat: 26.890957, lng: -80.116365 },
  6022: { name: 'CACTI Park of the Palm Beaches Complex (WSH)', lat: 26.75475, lng: -80.11316 },
  6084: { name: 'CACTI Park of the Palm Beaches Complex (HOU)', lat: 26.75475, lng: -80.11316 },
  2849: { name: 'St. Lucie Sports Complex', lat: 27.32493, lng: -80.40689 },
  2519: { name: 'Lee Health Sports Complex Fields', lat: 26.537803, lng: -81.841973 },
  6085: { name: 'JetBlue Park Complex', lat: 26.55092, lng: -81.76225 },
  6082: { name: 'Charlotte Sports Park Complex', lat: 26.99888, lng: -82.18212 },
  6086: { name: 'CoolToday Park Complex', lat: 27.04422, lng: -82.23593 },
  2864: { name: 'Yankee Complex', lat: 27.97997, lng: -82.50702 },
  2743: { name: 'Carpenter Complex', lat: 27.97159, lng: -82.731714 },
  4569: { name: 'Bobby Mattick Complex', lat: 28.03046, lng: -82.75697 },
  2829: { name: 'Pirate City Complex', lat: 27.48437, lng: -82.53035 },
  2855: { name: 'Tigertown Complex', lat: 28.07564, lng: -81.94969 },
  2517: { name: 'Holman Stadium', lat: 27.6445, lng: -80.42668 },

  // Minor-league parks with no coordinates in the API (2026)
  7257: { name: 'CarMax Park', lat: 37.56931, lng: -77.46474 },
  2782: { name: 'Nymeo Field', lat: 39.4016, lng: -77.41421 },
  7254: { name: 'Wilson Ballpark', lat: 35.72116, lng: -77.9143 },
}

/** "Camelback Ranch Complex (LAD)" and "Camelback Ranch" both become
 *  "camelback ranch", so a complex the API re-ids next season still lands. */
export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([a-z]{2,3}\)\s*$/, '')
    .replace(/\s+(training complex|complex fields|complex|fields)$/, '')
    .trim()
}

/** Name matching is only safe for complex-style names. A plain park name can
 *  repeat across leagues (there is a Holman Stadium in Nashua, NH, too). */
function isComplexName(name: string): boolean {
  return normalizeVenueName(name) !== name.toLowerCase().trim()
}

const BY_NAME = new Map<string, FallbackVenue>()
for (const v of Object.values(BY_ID)) {
  if (!isComplexName(v.name)) continue
  const key = normalizeVenueName(v.name)
  if (!BY_NAME.has(key)) BY_NAME.set(key, v)
}

/** Location for a venue the MLB API left without coordinates, or null when
 *  we don't know it (the caller still drops the game and reports it). */
export function fallbackVenueCoords(input: VenueFallbackInput): { lat: number; lng: number } | null {
  const byId = input.venueId != null ? BY_ID[input.venueId] : undefined
  const byName = !byId && input.venueName && isComplexName(input.venueName)
    ? BY_NAME.get(normalizeVenueName(input.venueName))
    : undefined
  const hit = byId ?? byName
  return hit ? { lat: hit.lat, lng: hit.lng } : null
}
