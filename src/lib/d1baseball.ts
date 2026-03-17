import { D1_BASEBALL_SLUGS } from '../data/d1baseballSlugs'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { resolveNcaaName } from '../data/aliases'
import type { Coordinates } from '../types/roster'
import { fetchWithTimeout } from './fetchWithTimeout'

// CORS proxies with fallback — if the primary goes down, try alternatives
export interface CorsProxy {
  url: string
  // How to extract HTML from the response
  extract: (res: Response) => Promise<string>
}

export const CORS_PROXIES: CorsProxy[] = [
  {
    // Own Vercel serverless proxy — most reliable, no third-party dependency
    url: '/api/cors-proxy?url=',
    extract: async (res) => {
      const data = await res.json()
      return data.contents as string
    },
  },
  {
    url: 'https://api.allorigins.win/get?url=',
    extract: async (res) => {
      const data = await res.json()
      return data.contents as string
    },
  },
  {
    url: 'https://corsproxy.io/?url=',
    extract: async (res) => res.text(),
  },
  {
    url: 'https://api.codetabs.com/v1/proxy?quest=',
    extract: async (res) => res.text(),
  },
]

const CACHE_KEY = 'sv-travel-d1baseball-cache'
const CACHE_TTL = 10 * 60 * 60 * 1000 // 10 hours

export interface D1Game {
  date: string // ISO date YYYY-MM-DD
  isHome: boolean
  opponent: string
  opponentSlug: string
  venueName: string
  venueCity: string
}

export interface D1Schedule {
  school: string
  slug: string
  games: D1Game[]
  fetchedAt: number
}

// Cached schedules in localStorage
function getCache(): Record<string, D1Schedule> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setCache(cache: Record<string, D1Schedule>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded — prune entries older than 48 hours and retry
    const cutoff = Date.now() - 48 * 60 * 60 * 1000
    for (const key of Object.keys(cache)) {
      if (cache[key]!.fetchedAt < cutoff) delete cache[key]
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
      console.warn('localStorage quota exceeded for d1baseball cache — continuing without caching')
    }
  }
}

// Parse the D1Baseball schedule HTML into structured game data
function parseScheduleHtml(html: string): D1Game[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const games: D1Game[] = []

  const rows = doc.querySelectorAll('table tbody tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    // Date: extract from link href like /scores/?date=20260213
    const dateLink = cells[0]?.querySelector('a')
    if (!dateLink) continue
    const href = dateLink.getAttribute('href') ?? ''
    const dateMatch = href.match(/date=(\d{4})(\d{2})(\d{2})/)
    if (!dateMatch) continue
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`

    // Home/Away: "vs" = home, "@" = away
    const locText = cells[1]?.textContent?.trim() ?? ''
    const isHome = locText === 'vs'

    // Opponent name and slug
    const teamName = cells[2]?.querySelector('.team-name')?.textContent?.trim() ?? ''
    const teamLink = cells[2]?.querySelector('a.team-logo-name')?.getAttribute('href') ?? ''
    const slugMatch = teamLink.match(/\/team\/([^/]+)\//)
    const opponentSlug = slugMatch ? slugMatch[1]! : ''

    // Venue: last td
    const venueText = cells[cells.length - 1]?.textContent?.trim() ?? ''
    // Venue format: "City, State, Venue Name" or just "Venue Name"
    const venueParts = venueText.split(',').map((s) => s.trim())
    const venueName = venueParts.length >= 3 ? venueParts.slice(2).join(', ') : venueText
    const venueCity = venueParts.length >= 2 ? `${venueParts[0]}, ${venueParts[1]}` : ''

    if (date && teamName) {
      games.push({
        date,
        isHome,
        opponent: teamName,
        opponentSlug,
        venueName,
        venueCity,
      })
    }
  }

  // Validate: if we got non-trivial HTML but zero games, the parser may be broken
  if (games.length === 0) {
    const hasTable = doc.querySelector('table tbody tr') !== null
    if (hasTable) {
      console.warn('D1Baseball parser returned 0 games but found table rows — HTML structure may have changed')
    }
  }

  return games
}

// Fetch URL through CORS proxies with fallback
export async function fetchWithCorsProxy(targetUrl: string): Promise<string> {
  const errors: string[] = []

  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetchWithTimeout(`${proxy.url}${encodeURIComponent(targetUrl)}`, { timeoutMs: 20000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await proxy.extract(res)
      if (!html) throw new Error('Empty response')
      return html
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${proxy.url.split('/')[2]}: ${msg}`)
    }
  }

  throw new Error(`All CORS proxies failed: ${errors.join('; ')}`)
}

// Slug discovery: attempt to find a D1Baseball slug automatically
const DISCOVERED_SLUGS_KEY = 'sv-travel-d1-discovered-slugs'

function getDiscoveredSlugs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISCOVERED_SLUGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveDiscoveredSlug(schoolName: string, slug: string) {
  try {
    const cache = getDiscoveredSlugs()
    cache[schoolName] = slug
    localStorage.setItem(DISCOVERED_SLUGS_KEY, JSON.stringify(cache))
  } catch {
    // Ignore localStorage errors
  }
}

export async function discoverD1Slug(schoolName: string): Promise<string | null> {
  try {
    // Check localStorage cache first
    const cached = getDiscoveredSlugs()[schoolName]
    if (cached) return cached

    // Build slug guess: lowercase, spaces→hyphens, strip special chars
    const slugGuess = schoolName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!slugGuess) return null

    const url = `https://d1baseball.com/team/${slugGuess}/schedule/`
    const html = await fetchWithCorsProxy(url)

    // Validate: check if the HTML contains a schedule table
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const hasScheduleTable = doc.querySelector('table tbody tr') !== null

    if (hasScheduleTable) {
      saveDiscoveredSlug(schoolName, slugGuess)
      return slugGuess
    }

    return null
  } catch {
    return null
  }
}

// Fetch schedule for a single school
export async function fetchD1Schedule(
  canonicalName: string,
): Promise<D1Schedule | null> {
  let slug: string | undefined = D1_BASEBALL_SLUGS[canonicalName]
  if (!slug) {
    const discovered = await discoverD1Slug(canonicalName)
    if (!discovered) return null
    slug = discovered
  }

  // Check cache
  const cache = getCache()
  const cached = cache[canonicalName]
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached
  }

  const url = `https://d1baseball.com/team/${slug}/schedule/`

  try {
    const html = await fetchWithCorsProxy(url)
    const games = parseScheduleHtml(html)
    const schedule: D1Schedule = {
      school: canonicalName,
      slug,
      games,
      fetchedAt: Date.now(),
    }

    // Cache result
    cache[canonicalName] = schedule
    setCache(cache)

    return schedule
  } catch (err) {
    console.warn(`Failed to fetch D1Baseball schedule for ${canonicalName}:`, err)
    return null
  }
}

export interface D1FetchResult {
  schedules: Map<string, D1Schedule>
  failedSchools: string[]
}

// Fetch schedules for all NCAA players' schools
export async function fetchAllD1Schedules(
  schoolNames: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<D1FetchResult> {
  const unique = [...new Set(schoolNames)]
  const schedules = new Map<string, D1Schedule>()
  const failedSchools: string[] = []

  // Fetch 2 at a time — reduced to prevent Page Unresponsive
  const concurrency = 2
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((name) => fetchD1Schedule(name)))
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) schedules.set(batch[j]!, results[j]!)
      else failedSchools.push(batch[j]!)
    }
    onProgress?.(Math.min(i + concurrency, unique.length), unique.length)
    // Yield to browser event loop between batches to prevent "Page Unresponsive"
    if (i + concurrency < unique.length) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { schedules, failedSchools }
}

// Resolve venue coordinates for an away game opponent
// First checks if opponent is a known NCAA school with coordinates,
// then falls back to null (would need geocoding)
export function resolveOpponentVenue(
  opponentName: string,
  opponentSlug: string,
): { name: string; coords: Coordinates } | null {
  // Try to match opponent to a known NCAA school
  const canonical = resolveNcaaName(opponentName)
  if (canonical && NCAA_VENUES[canonical]) {
    const v = NCAA_VENUES[canonical]!
    return { name: v.venueName, coords: v.coords }
  }

  // Try slug-based matching: convert slug to potential name forms
  const slugName = opponentSlug.replace(/-/g, ' ')
  const canonical2 = resolveNcaaName(slugName)
  if (canonical2 && NCAA_VENUES[canonical2]) {
    const v = NCAA_VENUES[canonical2]!
    return { name: v.venueName, coords: v.coords }
  }

  // Check dynamically discovered venue cache
  const cached = getDiscoveredVenueCache()[opponentName.toLowerCase().trim()]
  if (cached) {
    return { name: cached.name, coords: cached.coords }
  }

  return null
}

// --- Dynamic venue discovery for unknown NCAA opponents ---
const VENUE_CACHE_KEY = 'sv-travel-ncaa-venue-cache'

interface CachedVenue { name: string; coords: Coordinates }

function getDiscoveredVenueCache(): Record<string, CachedVenue> {
  try {
    const raw = localStorage.getItem(VENUE_CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveDiscoveredVenue(opponentName: string, venue: CachedVenue) {
  try {
    const cache = getDiscoveredVenueCache()
    cache[opponentName.toLowerCase().trim()] = venue
    localStorage.setItem(VENUE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore localStorage errors
  }
}

// Geocode a venue using Nominatim based on venue name/city from D1Baseball
async function geocodeNcaaVenue(
  venueName: string,
  venueCity: string,
  opponentName: string,
): Promise<{ name: string; coords: Coordinates } | null> {
  // Check cache first
  const cached = getDiscoveredVenueCache()[opponentName.toLowerCase().trim()]
  if (cached) return cached

  const queries: string[] = []
  if (venueName && venueCity) {
    queries.push(`${venueName}, ${venueCity}`)
  }
  if (opponentName) {
    queries.push(`${opponentName} baseball field`)
    queries.push(`${opponentName} university baseball`)
  }

  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        q,
        format: 'json',
        limit: '1',
        countrycodes: 'us',
      })
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures internal tool)' },
      })
      if (res.status === 429) continue
      if (!res.ok) continue
      const results = await res.json()
      if (results.length > 0) {
        const coords: Coordinates = {
          lat: parseFloat(results[0].lat),
          lng: parseFloat(results[0].lon),
        }
        // Validate continental US
        if (coords.lat >= 24.5 && coords.lat <= 49.5 && coords.lng >= -125.0 && coords.lng <= -66.5) {
          const venue = { name: venueName || `${opponentName} Field`, coords }
          saveDiscoveredVenue(opponentName, venue)
          return venue
        }
      }
    } catch {
      continue
    }
  }

  return null
}

// Async version of resolveOpponentVenue that attempts geocoding for unknown opponents
export async function resolveOpponentVenueAsync(
  opponentName: string,
  opponentSlug: string,
  venueName: string,
  venueCity: string,
): Promise<{ name: string; coords: Coordinates } | null> {
  // Try sync resolution first (fast path)
  const syncResult = resolveOpponentVenue(opponentName, opponentSlug)
  if (syncResult) return syncResult

  // Try geocoding using D1Baseball venue data
  return geocodeNcaaVenue(venueName, venueCity, opponentName)
}
