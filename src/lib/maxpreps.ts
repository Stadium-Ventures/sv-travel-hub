import { MAXPREPS_SLUGS } from '../data/maxprepsSlugs'
import { fetchWithCorsProxy } from './d1baseball'

const CACHE_KEY = 'sv-travel-maxpreps-cache'
const CACHE_TTL = 10 * 60 * 60 * 1000 // 10 hours

export interface MaxPrepsGame {
  date: string      // ISO date YYYY-MM-DD
  time: string | null // ISO time or null
  isHome: boolean
  opponent: string
  gameUrl: string | null
}

export interface MaxPrepsSchedule {
  school: string     // org|state key
  slug: string
  teamName: string   // Full name from MaxPreps (e.g. "Hebron Hawks")
  games: MaxPrepsGame[]
  fetchedAt: number
}

// Cached schedules in localStorage
function getCache(): Record<string, MaxPrepsSchedule> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setCache(cache: Record<string, MaxPrepsSchedule>) {
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
      console.warn('localStorage quota exceeded for maxpreps cache — continuing without caching')
    }
  }
}

// Resolve an org|state key to a MaxPreps slug (case-insensitive)
export function resolveMaxPrepsSlug(org: string, state: string): string | null {
  const key = `${org}|${state}`
  // Direct match
  if (MAXPREPS_SLUGS[key]) return MAXPREPS_SLUGS[key]!
  // Case-insensitive fallback
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(MAXPREPS_SLUGS)) {
    if (k.toLowerCase() === lower) return v
  }
  return null
}

// Parse MaxPreps HTML to extract JSON-LD SportsEvent data
export function parseMaxPrepsHtml(html: string, schoolName: string): { teamName: string; games: MaxPrepsGame[] } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const games: MaxPrepsGame[] = []
  let teamName = schoolName

  // Find JSON-LD script tags
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? '')
      // Look for ProfilePage with SportsTeam and events
      if (data['@type'] === 'ProfilePage' && data.mainEntity) {
        const entity = data.mainEntity
        if (entity['@type'] === 'SportsTeam') {
          teamName = entity.name ?? teamName
          const events = entity.event ?? []
          for (const event of events) {
            if (event['@type'] !== 'SportsEvent') continue

            const startDate = event.startDate
            if (!startDate) continue

            // Parse date — MaxPreps uses ISO 8601 (e.g., "2026-03-10T16:00:00-05:00")
            const dateMatch = startDate.match(/^(\d{4}-\d{2}-\d{2})/)
            if (!dateMatch) continue
            const date = dateMatch[1]!

            // Extract time if present
            const timeMatch = startDate.match(/T(\d{2}:\d{2}:\d{2})/)
            const time = timeMatch ? startDate : null

            // Determine home/away by matching homeTeam name against our school name
            const homeTeamName = event.homeTeam?.name ?? ''
            const awayTeamName = event.awayTeam?.name ?? ''

            // Fuzzy match — MaxPreps uses full names like "Hebron Hawks" vs our "Hebron"
            const schoolLower = schoolName.toLowerCase()
            const teamNameLower = teamName.toLowerCase()
            const homeLower = homeTeamName.toLowerCase()

            const isHome = homeLower.includes(schoolLower) || homeLower.includes(teamNameLower) ||
              schoolLower.includes(homeLower.split(' ')[0] ?? '')

            const opponent = isHome ? awayTeamName : homeTeamName
            const gameUrl = event.url ?? null

            games.push({ date, time, isHome, opponent, gameUrl })
          }
        }
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }

  // Validate: if we parsed the page but got no events, warn
  if (games.length === 0 && scripts.length > 0) {
    console.warn('MaxPreps parser returned 0 games but found JSON-LD scripts — structure may have changed')
  }

  return { teamName, games }
}

// Slug discovery: attempt to find a MaxPreps slug automatically
const DISCOVERED_SLUGS_KEY = 'sv-travel-maxpreps-discovered-slugs'

function getDiscoveredSlugs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISCOVERED_SLUGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveDiscoveredSlug(key: string, slug: string) {
  try {
    const cache = getDiscoveredSlugs()
    cache[key] = slug
    localStorage.setItem(DISCOVERED_SLUGS_KEY, JSON.stringify(cache))
  } catch {
    // Ignore localStorage errors
  }
}

export async function discoverMaxPrepsSlug(org: string, state: string): Promise<string | null> {
  try {
    const key = `${org}|${state}`

    // Check localStorage cache first
    const cached = getDiscoveredSlugs()[key]
    if (cached) return cached

    // Build slug guess: lowercase, spaces→hyphens, strip special chars
    const orgSlug = org
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const stateAbbr = state.toLowerCase()

    if (!orgSlug || !stateAbbr) return null

    const slug = `high-schools/${orgSlug}-(${stateAbbr})`
    const url = `https://www.maxpreps.com/${slug}/baseball/schedule/`
    const html = await fetchWithCorsProxy(url)

    // Validate: check if the HTML contains JSON-LD data
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const hasJsonLd = doc.querySelector('script[type="application/ld+json"]') !== null

    if (hasJsonLd) {
      saveDiscoveredSlug(key, slug)
      return slug
    }

    return null
  } catch {
    return null
  }
}

// Fetch schedule for a single school by org|state key
export async function fetchMaxPrepsSchedule(
  orgStateKey: string,
): Promise<MaxPrepsSchedule | null> {
  const [org, state] = orgStateKey.split('|')
  if (!org || !state) return null

  let slug = resolveMaxPrepsSlug(org, state)
  if (!slug) {
    slug = await discoverMaxPrepsSlug(org, state)
    if (!slug) return null
  }

  // Check cache
  const cache = getCache()
  const cached = cache[orgStateKey]
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached
  }

  const url = `https://www.maxpreps.com/${slug}/baseball/schedule/`

  try {
    const html = await fetchWithCorsProxy(url)
    const { teamName, games } = parseMaxPrepsHtml(html, org)
    const schedule: MaxPrepsSchedule = {
      school: orgStateKey,
      slug,
      teamName,
      games,
      fetchedAt: Date.now(),
    }

    // Cache result
    cache[orgStateKey] = schedule
    setCache(cache)

    return schedule
  } catch (err) {
    console.warn(`Failed to fetch MaxPreps schedule for ${orgStateKey}:`, err)
    return null
  }
}

export interface MaxPrepsFetchResult {
  schedules: Map<string, MaxPrepsSchedule>
  failedSchools: string[]
}

// Fetch schedules for multiple schools with concurrency
export async function fetchAllMaxPrepsSchedules(
  keys: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<MaxPrepsFetchResult> {
  const unique = [...new Set(keys)]
  const schedules = new Map<string, MaxPrepsSchedule>()
  const failedSchools: string[] = []

  // Fetch 3 at a time — same pattern as D1Baseball
  const concurrency = 3
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((key) => fetchMaxPrepsSchedule(key)))
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
