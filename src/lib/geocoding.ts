import type { Coordinates } from '../types/roster'
import { fetchWithTimeout } from './fetchWithTimeout'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const CACHE_KEY = 'sv-travel-geocode-cache'

function getCache(): Record<string, Coordinates> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setCache(cache: Record<string, Coordinates>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded — prune stale entries and retry
    // Geocode cache has no timestamps, so clear entirely on quota error
    try {
      localStorage.removeItem(CACHE_KEY)
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
      console.warn('localStorage quota exceeded for geocode cache — continuing without caching')
    }
  }
}

function cacheKey(schoolName: string, state: string): string {
  return `${schoolName.toLowerCase().trim()}|${state.toLowerCase().trim()}`
}

function isInContinentalUS(coords: Coordinates): boolean {
  return coords.lat >= 24.5 && coords.lat <= 49.5 && coords.lng >= -125.0 && coords.lng <= -66.5
}

// Geocode a single school venue
export async function geocodeVenue(
  schoolName: string,
  city: string,
  state: string,
): Promise<Coordinates | null> {
  const cache = getCache()
  const key = cacheKey(schoolName, state)
  if (cache[key]) return cache[key]!

  const queries = [
    `${schoolName} baseball field, ${city}, ${state}`,
    `${schoolName}, ${city}, ${state}`,
    `${schoolName} High School, ${state}`,
  ]

  for (const q of queries) {
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      countrycodes: 'us',
    })

    // Retry up to 2 times with backoff for rate limit errors
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchWithTimeout(`${NOMINATIM_BASE}?${params}`, {
          timeoutMs: 8000,
          headers: {
            'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures internal tool)',
          },
        })

        if (res.status === 429) {
          // Rate limited — back off and retry
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
          continue
        }

        if (!res.ok) break // Non-retryable HTTP error, try next query

        const results = await res.json()
        if (results.length > 0) {
          const coords: Coordinates = {
            lat: parseFloat(results[0].lat),
            lng: parseFloat(results[0].lon),
          }

          // Validate coordinates are in continental US
          if (!isInContinentalUS(coords)) {
            console.warn(`Geocoding for "${q}" returned non-US coordinates (${coords.lat}, ${coords.lng}) — skipping`)
            break // Try next query
          }

          cache[key] = coords
          setCache(cache)
          return coords
        }
        break // No results, try next query
      } catch {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        break // All retries exhausted, try next query
      }
    }
  }

  return null
}

// Batch geocode all HS venues with 1-second delay between requests
export async function geocodeAllHsVenues(
  schools: Array<{ schoolName: string; city: string; state: string }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, Coordinates>> {
  const results = new Map<string, Coordinates>()
  const unique = new Map<string, { schoolName: string; city: string; state: string }>()

  // Deduplicate
  for (const s of schools) {
    const key = cacheKey(s.schoolName, s.state)
    if (!unique.has(key)) unique.set(key, s)
  }

  const entries = [...unique.entries()]
  let completed = 0

  for (const [key, school] of entries) {
    const coords = await geocodeVenue(school.schoolName, school.city, school.state)
    if (coords) results.set(key, coords)

    completed++
    onProgress?.(completed, entries.length)

    // Rate limit: 1 req/sec for Nominatim
    if (completed < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }

  return results
}
