import type { Coordinates } from '../types/roster'
import type { RosterPlayer } from '../types/roster'
import type { GameEvent, TripCandidate, TripPlan, PriorityResult, VisitConfidence, FlyInVisit, ScoreBreakdown, NearMiss, UnvisitablePlayer } from '../types/schedule'
import { TIER_VISIT_TARGETS } from '../types/roster'
import { isSpringTraining, getSpringTrainingSite } from '../data/springTraining'
import { resolveMLBTeamId, resolveNcaaName } from '../data/aliases'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { D1_BASEBALL_SLUGS } from '../data/d1baseballSlugs'
import { resolveMaxPrepsSlug } from './maxpreps'
import { VENUE_PROXIMITY } from '../data/venueProximity'

// Constants
const DEFAULT_HOME_BASE: Coordinates = { lat: 28.5383, lng: -81.3792 } // Orlando, FL
const HOME_BASE = DEFAULT_HOME_BASE // Legacy alias — prefer passing homeBase explicitly
const MAX_DRIVE_MINUTES = 240 // 4 hours one-way — a 4h drive beats a flight + hotel
const MAX_INTER_VENUE_MINUTES = 120 // max detour between stops on multi-venue trip
const MAX_TOTAL_DRIVE_MINUTES = 600 // 10h total round-trip driving cap for a 3-day trip
const MAX_ROAD_TRIPS = 8 // cap greedy selection — raised to surface more trip options
const ANCHOR_DAY = 2 // Tuesday (0=Sun, 2=Tue)

// Confidence multipliers: high-confidence games are worth more
const CONFIDENCE_MULTIPLIER: Record<string, number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
}

const TIER_WEIGHTS: Record<number, number> = {
  1: 5,
  2: 3,
  3: 1,
  4: 0,
}

// Haversine distance in km between two coordinates
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Estimate drive time in minutes from straight-line distance
// Uses a gradual detour factor that increases with distance:
//   <200km: 1.2x (local/regional, calibrated for Florida)
//   200-600km: linear ramp from 1.2x to 1.35x
//   >600km: 1.4x (cross-region, accounts for route indirection)
export function estimateDriveMinutes(a: Coordinates, b: Coordinates): number {
  const km = haversineKm(a, b)
  let detourFactor: number
  let avgSpeed: number
  if (km <= 200) {
    detourFactor = 1.2
    avgSpeed = 95
  } else if (km <= 600) {
    // Linear ramp: 1.2 at 200km → 1.35 at 600km
    const t = (km - 200) / 400
    detourFactor = 1.2 + t * 0.15
    avgSpeed = 95 - t * 5 // 95 → 90
  } else {
    detourFactor = 1.4
    avgSpeed = 88
  }
  return Math.round((km * detourFactor / avgSpeed) * 60)
}

// Estimate total travel time for a fly-in visit (hours)
// Includes: drive to airport (0.5h) + security/boarding (1.5h) + flight + deplane/rental (1h)
function estimateFlightHours(distanceKm: number): number {
  const flightHours = distanceKm / 800 // ~800 km/h avg commercial speed
  const overhead = 3 // airport + rental car on both ends
  return Math.round((flightHours + overhead) * 10) / 10
}

// Get ISO week number for venue-week deduplication
function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z')
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.floor((d.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
}

// Check if a date falls on Sunday (blackout)
function isSunday(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.getUTCDay() === 0
}

// Check if a date is allowed for travel (not Sunday)
export function isDateAllowed(dateStr: string): boolean {
  return !isSunday(dateStr)
}

// Get all dates in a range (inclusive)
function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = []
  const current = new Date(start + 'T12:00:00Z')
  const endDate = new Date(end + 'T12:00:00Z')

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]!)
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

// Get trip window around any anchor day (day before through 1 day after = 3 days max, excluding Sundays)
function getTripWindow(anchorDate: string): string[] {
  const anchor = new Date(anchorDate + 'T12:00:00Z')
  const dayBefore = new Date(anchor)
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
  const dayAfter = new Date(anchor)
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)

  return getDatesInRange(
    dayBefore.toISOString().split('T')[0]!,
    dayAfter.toISOString().split('T')[0]!,
  ).filter(isDateAllowed) // Exclude Sundays
}

// Urgency boost map: playerName → multiplier (from heartbeat data)
// Players with high visit urgency get a scoring boost so they appear in better trips
export type UrgencyMap = Map<string, number> // playerName → boost multiplier (1.0 = no boost)

// Score a trip candidate
export function scoreTripCandidate(
  playerNames: string[],
  playerMap: Map<string, RosterPlayer>,
  urgencyMap?: UrgencyMap,
): number {
  let score = 0
  for (const name of playerNames) {
    const player = playerMap.get(name)
    if (!player) continue
    const weight = TIER_WEIGHTS[player.tier] ?? 0
    const base = weight * player.visitsRemaining
    const urgencyBoost = urgencyMap?.get(name) ?? 1.0
    score += Math.round(base * urgencyBoost)
  }
  return score
}

// Check if a player's position indicates they are a pitcher
function isPitcher(player: RosterPlayer): boolean {
  const pos = player.position.toUpperCase()
  return pos.includes('P') || pos.includes('SP') || pos.includes('LHP') || pos.includes('RHP')
}

// Compute detailed score breakdown for a trip
function computeScoreBreakdown(
  playerNames: string[],
  playerMap: Map<string, RosterPlayer>,
  tuesdayBonus: boolean,
  urgencyMap?: UrgencyMap,
  games?: GameEvent[],
): ScoreBreakdown {
  let tier1Count = 0, tier1Points = 0
  let tier2Count = 0, tier2Points = 0
  let tier3Count = 0, tier3Points = 0
  let pitcherMatchBonus = 0

  // Compute best confidence level across all games for this trip
  const bestConfidence = games?.reduce<string>((best, g) => {
    const conf = g.confidence ?? 'high' // MLB API games have no confidence field → treat as high
    const rank = CONFIDENCE_MULTIPLIER[conf] ?? 0.5
    const bestRank = CONFIDENCE_MULTIPLIER[best] ?? 0.5
    return rank > bestRank ? conf : best
  }, 'low') ?? 'high'
  const confidenceMult = CONFIDENCE_MULTIPLIER[bestConfidence] ?? 1.0

  for (const name of playerNames) {
    const player = playerMap.get(name)
    if (!player) continue
    const weight = TIER_WEIGHTS[player.tier] ?? 0
    const base = weight * player.visitsRemaining
    const urgencyBoost = urgencyMap?.get(name) ?? 1.0

    // Pitcher match boost: if this player is a pitcher and appears as a probable starter
    const isPitcherMatch = games && isPitcher(player) && games.some(g =>
      g.probablePitcherNames?.some(pn =>
        pn.toLowerCase().includes(player.playerName.split(' ').pop()!.toLowerCase())
      )
    )
    const pitcherBoost = isPitcherMatch ? 1.5 : 1.0
    const pts = Math.round(base * urgencyBoost * pitcherBoost * confidenceMult)

    if (isPitcherMatch) {
      pitcherMatchBonus += Math.round(base * urgencyBoost * 0.5) // track the bonus portion
    }

    if (player.tier === 1) { tier1Count++; tier1Points += pts }
    else if (player.tier === 2) { tier2Count++; tier2Points += pts }
    else if (player.tier === 3) { tier3Count++; tier3Points += pts }
  }

  const rawScore = tier1Points + tier2Points + tier3Points
  // Tuesday bonus should NOT stack on top of pitcher match bonus —
  // if any tracked pitcher is a probable starter, the 1.5x pitcher boost takes priority
  const hasPitcherMatch = pitcherMatchBonus > 0
  const finalScore = (tuesdayBonus && !hasPitcherMatch) ? Math.round(rawScore * 1.2) : rawScore

  return {
    tier1Count, tier1Points,
    tier2Count, tier2Points,
    tier3Count, tier3Points,
    tuesdayBonus,
    pitcherMatchBonus,
    rawScore,
    finalScore,
  }
}

// Generate synthetic spring training visit opportunities for Pro players
// During ST, players are at their parent org's ST facility every day (except Sunday)
export function generateSpringTrainingEvents(
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  customMlbAliases?: Record<string, string>,
): GameEvent[] {
  const events: GameEvent[] = []
  const dates = getDatesInRange(startDate, endDate).filter(
    (d) => isSpringTraining(d) && isDateAllowed(d),
  )

  if (dates.length === 0) return events

  // Group Pro players by parent org
  const playersByOrg = new Map<number, string[]>()
  for (const p of players) {
    if (p.level !== 'Pro' || p.visitsRemaining <= 0) continue
    const orgId = resolveMLBTeamId(p.org, customMlbAliases)
    if (!orgId) continue
    const existing = playersByOrg.get(orgId)
    if (existing) existing.push(p.playerName)
    else playersByOrg.set(orgId, [p.playerName])
  }

  // Create events for each org's ST site on each valid date
  for (const [orgId, playerNames] of playersByOrg) {
    const site = getSpringTrainingSite(orgId)
    if (!site) continue

    for (const date of dates) {
      const d = new Date(date + 'T12:00:00Z')
      events.push({
        id: `st-${orgId}-${date}`,
        date,
        dayOfWeek: d.getUTCDay(),
        time: date + 'T13:00:00Z',
        homeTeam: site.venueName,
        awayTeam: 'Spring Training',
        isHome: true,
        venue: { name: site.venueName, coords: site.coords },
        source: 'mlb-api',
        playerNames,
        sourceUrl: 'https://www.mlb.com/schedule',
      })
    }
  }

  return events
}

// NCAA baseball season: mid-February through early June
const NCAA_SEASON_START = '02-14' // MM-DD
const NCAA_SEASON_END = '06-15'
// Typical NCAA home game days: Tuesday, Friday, Saturday
const NCAA_HOME_GAME_DAYS = [2, 5, 6] // 0=Sun, 2=Tue, 5=Fri, 6=Sat

function isNcaaSeason(dateStr: string): boolean {
  const mmdd = dateStr.slice(5)
  return mmdd >= NCAA_SEASON_START && mmdd <= NCAA_SEASON_END
}

// HS baseball season: mid-February through mid-May
const HS_SEASON_START = '02-14'
const HS_SEASON_END = '05-15'
// Typical HS home game days: Tuesday, Thursday
const HS_HOME_GAME_DAYS = [2, 4] // Tue, Thu

function isHsSeason(dateStr: string): boolean {
  const mmdd = dateStr.slice(5)
  return mmdd >= HS_SEASON_START && mmdd <= HS_SEASON_END
}

// Generate visit opportunities for NCAA players at their school venues
export function generateNcaaEvents(
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  customNcaaAliases?: Record<string, string>,
): GameEvent[] {
  const events: GameEvent[] = []
  const dates = getDatesInRange(startDate, endDate).filter(
    (d) => isNcaaSeason(d) && isDateAllowed(d),
  )

  if (dates.length === 0) return events

  // Group NCAA players by school
  const playersBySchool = new Map<string, { players: string[]; venue: typeof NCAA_VENUES[string] }>()
  for (const p of players) {
    if (p.level !== 'NCAA' || p.visitsRemaining <= 0) continue
    const canonical = resolveNcaaName(p.org, customNcaaAliases)
    if (!canonical) continue
    const venue = NCAA_VENUES[canonical]
    if (!venue) continue
    const existing = playersBySchool.get(canonical)
    if (existing) existing.players.push(p.playerName)
    else playersBySchool.set(canonical, { players: [p.playerName], venue })
  }

  for (const [school, { players: playerNames, venue }] of playersBySchool) {
    for (const date of dates) {
      const d = new Date(date + 'T12:00:00Z')
      const dow = d.getUTCDay()
      const isGameDay = NCAA_HOME_GAME_DAYS.includes(dow)

      // Determine confidence
      let confidence: VisitConfidence
      let confidenceNote: string
      if (isGameDay) {
        confidence = 'medium'
        confidenceNote = 'Typical home game day — player likely at campus'
      } else if (dow === 1 || dow === 3) {
        // Mon or Wed — could be travel day for away series
        confidence = 'low'
        confidenceNote = 'Non-game weekday — player may be traveling for away series'
      } else {
        confidence = 'low'
        confidenceNote = 'Non-game day — player assumed at campus but may be away'
      }

      // Link to D1Baseball schedule if slug exists, otherwise generic
      const slug = D1_BASEBALL_SLUGS[school]
      const sourceUrl = slug
        ? `https://d1baseball.com/team/${slug}/schedule/`
        : undefined

      events.push({
        id: `ncaa-${school.toLowerCase().replace(/\s+/g, '-')}-${date}`,
        date,
        dayOfWeek: dow,
        time: date + 'T14:00:00Z',
        homeTeam: school,
        awayTeam: isGameDay ? 'Home Game (estimated)' : 'No game scheduled',
        isHome: true,
        venue: { name: venue.venueName, coords: venue.coords },
        source: 'ncaa-lookup',
        playerNames,
        confidence,
        confidenceNote,
        sourceUrl,
      })
    }
  }

  return events
}

// Generate visit opportunities for HS players at their school
export function generateHsEvents(
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  hsVenues: Map<string, { name: string; coords: Coordinates }>,
): GameEvent[] {
  const events: GameEvent[] = []
  const dates = getDatesInRange(startDate, endDate).filter(
    (d) => isHsSeason(d) && isDateAllowed(d),
  )

  if (dates.length === 0) return events

  // Group HS players by school+state
  const playersBySchool = new Map<string, { players: string[]; venue: { name: string; coords: Coordinates } }>()
  for (const p of players) {
    if (p.level !== 'HS' || p.visitsRemaining <= 0) continue
    const key = `${p.org.toLowerCase().trim()}|${p.state.toLowerCase().trim()}`
    const venue = hsVenues.get(key)
    if (!venue) continue
    const existing = playersBySchool.get(key)
    if (existing) existing.players.push(p.playerName)
    else playersBySchool.set(key, { players: [p.playerName], venue })
  }

  for (const [key, { players: playerNames, venue }] of playersBySchool) {
    const schoolName = key.split('|')[0] ?? key
    const stateName = key.split('|')[1] ?? ''
    // Look up MaxPreps slug for verify link
    const mpSlug = resolveMaxPrepsSlug(schoolName, stateName)
    const sourceUrl = mpSlug
      ? `https://www.maxpreps.com/${mpSlug}/baseball/schedule/`
      : undefined

    for (const date of dates) {
      const d = new Date(date + 'T12:00:00Z')
      const dow = d.getUTCDay()
      const isGameDay = HS_HOME_GAME_DAYS.includes(dow)

      let confidence: VisitConfidence
      let confidenceNote: string
      if (isGameDay) {
        confidence = 'medium'
        confidenceNote = 'Typical home game day — player likely at school'
      } else if (dow >= 1 && dow <= 5) {
        confidence = 'low'
        confidenceNote = 'School day but no game — player at school, may travel next day for away game'
      } else {
        confidence = 'low'
        confidenceNote = 'Weekend non-game day — may not be at school'
      }

      events.push({
        id: `hs-${schoolName.replace(/\s+/g, '-')}-${date}`,
        date,
        dayOfWeek: dow,
        time: date + 'T15:30:00Z',
        homeTeam: schoolName,
        awayTeam: isGameDay ? 'Home Game (estimated)' : 'No game scheduled',
        isHome: true,
        venue: { name: venue.name, coords: venue.coords },
        source: 'hs-lookup',
        playerNames,
        confidence,
        confidenceNote,
        sourceUrl,
      })
    }
  }

  return events
}

export { NCAA_SEASON_START, NCAA_SEASON_END, HS_SEASON_START, HS_SEASON_END }
export { isNcaaSeason, isHsSeason }

// Deduplicate coordinates by rounding to 4 decimal places (~11m precision)
function coordKey(c: Coordinates): string {
  return `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
}

// Look up home-to-venue drive minutes from pre-computed data, fallback to Haversine
// Pre-computed homeMinutes in VENUE_PROXIMITY are relative to Orlando — only use when homeBase matches
function lookupHomeMinutes(coords: Coordinates, homeBase: Coordinates = DEFAULT_HOME_BASE): number {
  const isDefaultBase = Math.abs(homeBase.lat - DEFAULT_HOME_BASE.lat) < 0.01 && Math.abs(homeBase.lng - DEFAULT_HOME_BASE.lng) < 0.01
  if (isDefaultBase) {
    const key = coordKey(coords)
    const entry = VENUE_PROXIMITY[key]
    if (entry) return entry.homeMinutes
  }
  return estimateDriveMinutes(homeBase, coords)
}

// Check if two venues are within maxMinutes drive using pre-computed data
function lookupDriveMinutes(a: Coordinates, b: Coordinates): number {
  const keyA = coordKey(a)
  const entry = VENUE_PROXIMITY[keyA]
  if (entry) {
    const keyB = coordKey(b)
    const nearby = entry.nearby.find(n => n.key === keyB)
    if (nearby) return nearby.driveMinutes
  }
  // Fallback to runtime computation
  return estimateDriveMinutes(a, b)
}

// Get set of nearby venue keys for fast filtering
export function getNearbyVenueKeys(coords: Coordinates, maxMinutes: number): Set<string> | null {
  const key = coordKey(coords)
  const entry = VENUE_PROXIMITY[key]
  if (!entry) return null
  return new Set(entry.nearby.filter(n => n.driveMinutes <= maxMinutes).map(n => n.key))
}

// Main trip generation algorithm
export async function generateTrips(
  games: GameEvent[],
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  onProgress?: (step: string, detail?: string) => void,
  maxDriveMinutes: number = MAX_DRIVE_MINUTES,
  priorityPlayers: string[] = [],
  urgencyMap?: UrgencyMap,
  maxFlightHours: number = 4,
  playerTeamAssignments?: Record<string, { teamId: number; sportId: number; teamName: string }>,
  homeBase: Coordinates = DEFAULT_HOME_BASE,
): Promise<TripPlan> {
  onProgress?.('Preparing', 'Filtering eligible players...')

  // Build player lookup
  const playerMap = new Map<string, RosterPlayer>()
  for (const p of players) {
    playerMap.set(p.playerName, p)
  }

  // Track players skipped (only Tier 4 with 0 visits — everyone else is eligible)
  const skippedPlayers: Array<{ name: string; reason: string }> = []
  for (const p of players) {
    if (p.tier === 4 && p.visitsRemaining <= 0) {
      skippedPlayers.push({
        name: p.playerName,
        reason: 'Tier 4 — no visits required',
      })
    }
  }

  // ALL players are eligible for trip planning (not just those with visits remaining).
  // Players with completed visits still appear but score lower via visitsRemaining weight.
  const eligiblePlayers = new Set(
    players.filter((p) => !(p.tier === 4 && p.visitsRemaining <= 0)).map((p) => p.playerName),
  )

  // Clamp start date to today if in the past — no point planning trips to yesterday
  const today = new Date().toISOString().slice(0, 10)
  const effectiveStart = startDate < today ? today : startDate

  // Filter games: no Sundays, within date range, with eligible players, exclude cancelled
  const eligibleGames = games.filter(
    (g) =>
      isDateAllowed(g.date) &&
      g.date >= effectiveStart &&
      g.date <= endDate &&
      g.playerNames.some((n) => eligiblePlayers.has(n)) &&
      g.gameStatus !== 'Cancelled' &&
      g.gameStatus !== 'Canceled',
  )

  if (eligibleGames.length === 0) {
    // Compute reasons for each unreachable player
    const unreachableWithReasons: UnvisitablePlayer[] = [...eligiblePlayers].map((name) => {
      const player = playerMap.get(name)
      if (!player) return { name, reason: 'Player not found in roster' }
      if (player.level === 'Pro' && !resolveMLBTeamId(player.org)) return { name, reason: 'No recognized org — not in alias table' }
      if (player.level === 'NCAA' && !resolveNcaaName(player.org)) return { name, reason: 'No recognized org — not in alias table' }
      if (player.level === 'Pro' && playerTeamAssignments && !playerTeamAssignments[name]) {
        return { name, reason: 'Not assigned to a team — run Auto-assign Affiliates on the Roster tab' }
      }
      return { name, reason: 'No games in date range' }
    })
    return {
      trips: [],
      flyInVisits: [],
      unvisitablePlayers: unreachableWithReasons,
      skippedPlayers,
      analyzedEventCount: 0,
      totalPlayersWithVisits: 0,
      totalVisitsCovered: 0,
      totalVisitsPlanned: 0,
      coveragePercent: 0,
    }
  }

  // Pre-compute home-to-venue distances using Haversine (instant, no API needed)
  const homeToVenue = new Map<string, number>()
  for (const g of eligibleGames) {
    if (g.venue.coords.lat === 0 && g.venue.coords.lng === 0) continue
    const key = coordKey(g.venue.coords)
    if (!homeToVenue.has(key)) {
      homeToVenue.set(key, lookupHomeMinutes(g.venue.coords, homeBase))
    }
  }

  const uniqueVenueCount = homeToVenue.size
  onProgress?.('Analyzing', `${eligibleGames.length} visit opportunities across ${uniqueVenueCount} venues...`)

  // Pre-index games by date for O(1) lookup instead of O(n) filter per anchor
  const gamesByDate = new Map<string, typeof eligibleGames>()
  for (const g of eligibleGames) {
    const existing = gamesByDate.get(g.date)
    if (existing) existing.push(g)
    else gamesByDate.set(g.date, [g])
  }

  // Get ALL non-Sunday dates as potential anchor days (Tuesdays preferred via scoring bonus)
  const anchorDays = getDatesInRange(startDate, endDate).filter(isDateAllowed)

  // Build trip candidates — any day can anchor a trip
  // Deduplicate: only evaluate each venue once per week
  const candidates: TripCandidate[] = []
  const seenVenueWeeks = new Map<string, number>()
  const nearMisses: NearMiss[] = []
  const nearMissSeen = new Set<string>() // dedupe by player+venue

  // Cap candidates to prevent browser crash on wide date ranges
  // 100 is plenty for greedy selection of 8 trips
  const MAX_CANDIDATES = 100
  let candidateCount = 0

  for (const anchorDay of anchorDays) {
    if (candidateCount >= MAX_CANDIDATES) break
    const anchorGames = gamesByDate.get(anchorDay) ?? []

    for (const anchor of anchorGames) {
      if (candidateCount >= MAX_CANDIDATES) break
      if (anchor.venue.coords.lat === 0 && anchor.venue.coords.lng === 0) continue

      const anchorKey = coordKey(anchor.venue.coords)
      const homeToAnchor = homeToVenue.get(anchorKey) ?? Infinity
      if (homeToAnchor > maxDriveMinutes) {
        // Track near-misses: games 1-30 min over the limit
        const overBy = homeToAnchor - maxDriveMinutes
        if (overBy > 0 && overBy <= 30) {
          for (const name of anchor.playerNames) {
            if (!eligiblePlayers.has(name)) continue
            const nmKey = `${name}|${anchorKey}`
            if (nearMissSeen.has(nmKey)) continue
            nearMissSeen.add(nmKey)
            nearMisses.push({
              playerName: name,
              venue: anchor.venue.name,
              driveMinutes: homeToAnchor,
              overBy: Math.round(overBy),
            })
          }
        }
        continue
      }

      // Deduplicate: limit to 2 candidates per venue per week to reduce noise
      // while still allowing Tuesday vs non-Tuesday options at the same venue
      const weekNum = getWeekNumber(anchorDay)
      const venueWeekKey = `${anchorKey}-w${weekNum}`
      const venueWeekCount = seenVenueWeeks.get(venueWeekKey) ?? 0
      if (venueWeekCount >= 2) continue
      seenVenueWeeks.set(venueWeekKey, venueWeekCount + 1)

      const window = getTripWindow(anchorDay)

      // Find nearby games within the trip window using date index (O(1) per day vs O(n) filter)
      const windowGames: typeof eligibleGames = []
      for (const d of window) {
        const dayGames = gamesByDate.get(d)
        if (dayGames) {
          for (const g of dayGames) {
            if (g.id !== anchor.id && g.venue.coords.lat !== 0 && g.venue.coords.lng !== 0) {
              windowGames.push(g)
            }
          }
        }
      }

      if (windowGames.length === 0) {
        // Solo anchor trip
        const visitedPlayersList = anchor.playerNames.filter((n) => eligiblePlayers.has(n))
        const soloTuesday = new Date(anchorDay + 'T12:00:00Z').getUTCDay() === ANCHOR_DAY
        const soloBreakdown = computeScoreBreakdown(visitedPlayersList, playerMap, soloTuesday, urgencyMap, [anchor])
        candidates.push({
          anchorGame: anchor,
          nearbyGames: [],
          suggestedDays: [anchor.date],
          totalPlayersVisited: visitedPlayersList.length,
          visitValue: soloBreakdown.finalScore,
          driveFromHomeMinutes: homeToAnchor,
          totalDriveMinutes: homeToAnchor * 2,
          venueCount: 1,
          scoreBreakdown: soloBreakdown,
        })
        candidateCount++
        continue
      }

      // Use Haversine for nearby game distance estimation (cached, no API)
      // Inter-venue distance capped at MAX_INTER_VENUE_MINUTES (reasonable detour)
      // Also verify the nearby venue is reachable from home
      const nearbyGames = windowGames
        .map((g) => ({ ...g, driveMinutes: lookupDriveMinutes(anchor.venue.coords, g.venue.coords) }))
        .filter((g) => {
          if (g.driveMinutes < 0 || g.driveMinutes > MAX_INTER_VENUE_MINUTES) return false
          // Also check that the nearby venue itself is reachable from home
          const nearbyHomeKey = coordKey(g.venue.coords)
          const homeToNearby = homeToVenue.get(nearbyHomeKey) ?? Infinity
          if (homeToNearby > maxDriveMinutes * 1.5) return false
          // Time conflict check: if both games are on the same day and have known times,
          // ensure there's enough gap to attend both (game ~2.5h + drive between venues)
          if (g.date === anchor.date && g.time && anchor.time) {
            const anchorTime = new Date(anchor.time).getTime()
            const nearbyTime = new Date(g.time).getTime()
            if (!isNaN(anchorTime) && !isNaN(nearbyTime)) {
              const gapMinutes = Math.abs(nearbyTime - anchorTime) / 60000
              const minGap = 150 + Math.max(g.driveMinutes, 15) // ~2.5h for a game + travel
              if (gapMinutes < minGap) return false // Can't physically attend both
            }
          }
          return true
        })

      // Cap nearby games to prevent memory explosion in route optimization
      // Keep the closest venues — more distant ones add little trip value
      if (nearbyGames.length > 6) {
        nearbyGames.sort((a, b) => a.driveMinutes - b.driveMinutes)
        nearbyGames.length = 6
      }

      // Collect all unique players visited
      const allPlayerNames = new Set<string>()
      for (const name of anchor.playerNames) {
        if (eligiblePlayers.has(name)) allPlayerNames.add(name)
      }
      for (const g of nearbyGames) {
        for (const name of g.playerNames) {
          if (eligiblePlayers.has(name)) allPlayerNames.add(name)
        }
      }

      // Build suggested days: only include days with actual games + 1 return travel day if multi-venue
      const gameDays = [...new Set([anchor.date, ...nearbyGames.map((g) => g.date)])].sort()
      // If there are multiple venues, add 1 return day (max 3 day trip total)
      const needsReturnDay = nearbyGames.length > 0 || homeToAnchor > 90 // >1.5h drive merits a return day
      let suggestedDays = gameDays
      if (needsReturnDay && gameDays.length < 3) {
        const lastGameDay = new Date(gameDays[gameDays.length - 1]! + 'T12:00:00Z')
        const returnDay = new Date(lastGameDay)
        returnDay.setUTCDate(returnDay.getUTCDate() + 1)
        const returnStr = returnDay.toISOString().split('T')[0]!
        if (isDateAllowed(returnStr)) {
          suggestedDays = [...gameDays, returnStr]
        }
      }

      // Estimate total driving using nearest-neighbor route heuristic
      // O(n²) instead of O(n!) permutations — scales to any number of stops
      let interVenueDrive = 0
      let lastCoords = anchor.venue.coords
      const unvisited = new Set(nearbyGames.map((_, i) => i))
      while (unvisited.size > 0) {
        let bestIdx = -1
        let bestDist = Infinity
        for (const idx of unvisited) {
          const d = lookupDriveMinutes(lastCoords, nearbyGames[idx]!.venue.coords)
          if (d < bestDist) { bestDist = d; bestIdx = idx }
        }
        interVenueDrive += bestDist
        lastCoords = nearbyGames[bestIdx]!.venue.coords
        unvisited.delete(bestIdx)
      }
      const returnHome = homeToVenue.get(coordKey(lastCoords)) ?? homeToAnchor
      const totalDrive = homeToAnchor + interVenueDrive + returnHome

      // Skip trips that exceed total driving cap (too much time on the road for 3 days)
      if (totalDrive > MAX_TOTAL_DRIVE_MINUTES) continue

      // Tuesday bonus: prefer Tuesday anchors with 20% value boost
      const dayOfWeek = new Date(anchorDay + 'T12:00:00Z').getUTCDay()
      const isTuesday = dayOfWeek === ANCHOR_DAY
      const allTripGames = [anchor, ...nearbyGames]
      const breakdown = computeScoreBreakdown([...allPlayerNames], playerMap, isTuesday, urgencyMap, allTripGames)

      // Drive efficiency penalty: prefer trips with less driving per point
      // A 30-point trip with 6h driving should be close in value to a 20-point trip with 2h driving
      const driveHours = totalDrive / 60
      const efficiencyFactor = driveHours > 0 ? Math.max(0.6, 1.0 - (driveHours - 3) * 0.05) : 1.0
      const adjustedScore = Math.round(breakdown.finalScore * efficiencyFactor)

      candidates.push({
        anchorGame: anchor,
        nearbyGames,
        suggestedDays,
        totalPlayersVisited: allPlayerNames.size,
        visitValue: adjustedScore,
        driveFromHomeMinutes: homeToAnchor,
        totalDriveMinutes: totalDrive,
        venueCount: 1 + new Set(nearbyGames.map((g) => coordKey(g.venue.coords))).size,
        scoreBreakdown: breakdown,
      })
      candidateCount++
    }

    // Yield to browser periodically to prevent "Page Unresponsive"
    if (candidateCount % 50 === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  onProgress?.('Optimizing', `${candidates.length} trip candidates — selecting best trips...`)
  await new Promise(r => setTimeout(r, 0)) // yield to browser before heavy loop

  // --- Multi-visit tracking ---
  // Track how many trips each player appears in. A player is "saturated" when
  // they have enough trip appearances to cover their visitsRemaining.
  // This means T1 players (needing 5 visits) can appear in up to 5 trips.
  const playerVisitCounts = new Map<string, number>()

  function isPlayerSaturated(name: string): boolean {
    const player = playerMap.get(name)
    if (!player) return true
    // At least 1 trip appearance for every player, even if visitsRemaining is 0
    const maxAppearances = Math.max(1, player.visitsRemaining)
    return (playerVisitCounts.get(name) ?? 0) >= maxAppearances
  }

  function addPlayerVisit(name: string) {
    if (eligiblePlayers.has(name)) {
      playerVisitCounts.set(name, (playerVisitCounts.get(name) ?? 0) + 1)
    }
  }

  function recordTripPlayers(trip: TripCandidate) {
    for (const name of trip.anchorGame.playerNames) addPlayerVisit(name)
    for (const g of trip.nearbyGames) {
      for (const name of g.playerNames) addPlayerVisit(name)
    }
  }

  // Score a trip accounting for visits already planned
  function scoreWithCoverage(playerNames: string[]): number {
    let score = 0
    for (const name of playerNames) {
      const player = playerMap.get(name)
      if (!player) continue
      const weight = TIER_WEIGHTS[player.tier] ?? 0
      const remainingNeed = Math.max(0, player.visitsRemaining - (playerVisitCounts.get(name) ?? 0))
      // Always contribute at least 1 point (don't exclude completed players entirely)
      const base = remainingNeed > 0 ? weight * remainingNeed : 1
      const urgencyBoost = urgencyMap?.get(name) ?? 1.0
      score += Math.round(base * urgencyBoost)
    }
    return score
  }

  // --- Priority player handling ---
  const priorityResults: PriorityResult[] = []
  const selectedTrips: TripCandidate[] = []

  if (priorityPlayers.length > 0) {
    onProgress?.('Priority', `Building trip around ${priorityPlayers.join(' & ')}...`)

    // Helper: get all candidates containing a specific player
    // Sort by: trips where the priority player is on the ANCHOR game first (built around them),
    // then by visit value
    function candidatesWithPlayer(name: string): TripCandidate[] {
      return candidates
        .filter((c) => {
          const allNames = [
            ...c.anchorGame.playerNames,
            ...c.nearbyGames.flatMap((g) => g.playerNames),
          ]
          return allNames.includes(name)
        })
        .sort((a, b) => {
          // Prefer trips where the priority player is on the anchor game
          const aOnAnchor = a.anchorGame.playerNames.includes(name) ? 1 : 0
          const bOnAnchor = b.anchorGame.playerNames.includes(name) ? 1 : 0
          if (aOnAnchor !== bOnAnchor) return bOnAnchor - aOnAnchor
          // Then prefer higher confidence
          const aConf = CONFIDENCE_MULTIPLIER[a.anchorGame.confidence ?? 'high'] ?? 1
          const bConf = CONFIDENCE_MULTIPLIER[b.anchorGame.confidence ?? 'high'] ?? 1
          if (aConf !== bConf) return bConf - aConf
          // Then prefer Tuesday anchors
          const aDay = new Date(a.anchorGame.date + 'T12:00:00Z').getUTCDay()
          const bDay = new Date(b.anchorGame.date + 'T12:00:00Z').getUTCDay()
          const aTue = aDay === ANCHOR_DAY ? 1 : 0
          const bTue = bDay === ANCHOR_DAY ? 1 : 0
          if (aTue !== bTue) return bTue - aTue
          // Then by value
          return b.visitValue - a.visitValue
        })
    }

    // Try to find a trip that includes ALL priority players
    const allPriorityCandidates = candidates.filter((c) => {
      const allNames = new Set([
        ...c.anchorGame.playerNames,
        ...c.nearbyGames.flatMap((g) => g.playerNames),
      ])
      return priorityPlayers.every((p) => allNames.has(p))
    })

    if (allPriorityCandidates.length > 0) {
      allPriorityCandidates.sort((a, b) => b.visitValue - a.visitValue)
      const best = allPriorityCandidates[0]!
      selectedTrips.push(best)
      recordTripPlayers(best)
      for (const pName of priorityPlayers) {
        priorityResults.push({ playerName: pName, status: 'included' })
      }
    } else {
      // Can't get all priority players in one trip — report each player's status
      // and suggest expanding range if needed
      const missingFromDrive: string[] = []
      const missingFromFlight: string[] = []

      for (const pName of priorityPlayers) {
        const pCandidates = candidatesWithPlayer(pName)
        if (pCandidates.length > 0) {
          // This player IS reachable by road but can't be combined with the others
          const best = pCandidates[0]!
          selectedTrips.push(best)
          recordTripPlayers(best)
          priorityResults.push({
            playerName: pName,
            status: 'separate-trip',
            reason: priorityPlayers.length > 1
              ? `No single trip covers all priority players within the drive/flight range — ${pName} placed in a separate trip`
              : undefined,
          })
        } else {
          const hasGames = eligibleGames.some((g) => g.playerNames.includes(pName))
          if (hasGames) {
            const playerFlyInGames = eligibleGames.filter(g => g.playerNames.includes(pName) && g.venue.coords.lat !== 0)
            const minTravelHours = playerFlyInGames.length > 0
              ? Math.min(...playerFlyInGames.map(g => estimateFlightHours(haversineKm(homeBase, g.venue.coords))))
              : Infinity
            const beyondFlight = minTravelHours > maxFlightHours
            if (beyondFlight) {
              missingFromFlight.push(pName)
              priorityResults.push({
                playerName: pName,
                status: 'fly-in-only',
                reason: `${pName} requires ~${Math.round(minTravelHours * 10) / 10}h travel but max flight is ${maxFlightHours}h — increase Max Flight to see options`,
              })
            } else {
              missingFromDrive.push(pName)
              priorityResults.push({
                playerName: pName,
                status: 'fly-in-only',
                reason: `${pName} is beyond driving range — check Fly-in Visits below`,
              })
            }
          } else {
            priorityResults.push({
              playerName: pName,
              status: 'unreachable',
              reason: (() => {
                const p = playerMap.get(pName)
                if (p?.level === 'HS') return `No games for ${pName} in the selected date range — HS season may have ended`
                if (p?.level === 'NCAA') return `No games for ${pName} in the selected date range — check college schedule`
                return `No games for ${pName} in the selected date range — schedules may not be published yet`
              })(),
            })
          }
        }
      }
    }
  }

  // --- Greedy selection for remaining trips ---
  // Players can appear in multiple trips until their visit quota is met.
  // Capped at MAX_ROAD_TRIPS to avoid overwhelming results.
  // When priority players are set, prefer trips that include at least one of them.
  const hasPriorityFilter = priorityPlayers.length > 0
  const drivablePriority = new Set(
    priorityPlayers.filter((n) => priorityResults.some((r) => r.playerName === n && (r.status === 'included' || r.status === 'separate-trip'))),
  )
  // Sort candidates by priority players first, then by score.
  // Don't filter out non-priority candidates — just boost priority ones to the top.
  const remainingCandidates = [...candidates]
    .sort((a, b) => {
      // Priority-containing trips first
      if (hasPriorityFilter && drivablePriority.size > 0) {
        const aHasPriority = [...drivablePriority].some((n) =>
          a.anchorGame.playerNames.includes(n) || a.nearbyGames.some((g) => g.playerNames.includes(n)))
        const bHasPriority = [...drivablePriority].some((n) =>
          b.anchorGame.playerNames.includes(n) || b.nearbyGames.some((g) => g.playerNames.includes(n)))
        if (aHasPriority && !bHasPriority) return -1
        if (!aHasPriority && bHasPriority) return 1
      }
      return b.visitValue - a.visitValue
    })

  // Track selected trip date ranges for overlap detection
  function getTripDateRange(trip: TripCandidate): Set<string> {
    return new Set(trip.suggestedDays)
  }
  function tripsOverlap(a: TripCandidate, b: TripCandidate): boolean {
    const aDates = getTripDateRange(a)
    for (const d of b.suggestedDays) {
      if (aDates.has(d)) return true
    }
    return false
  }

  let greedyIterCount = 0
  while (remainingCandidates.length > 0 && selectedTrips.length < MAX_ROAD_TRIPS) {
    if (++greedyIterCount % 50 === 0) {
      await new Promise(r => setTimeout(r, 0)) // yield to browser
    }
    // Remove candidates that overlap with already-selected trips
    for (let i = remainingCandidates.length - 1; i >= 0; i--) {
      const overlaps = selectedTrips.some(existing => tripsOverlap(existing, remainingCandidates[i]!))
      if (overlaps) remainingCandidates.splice(i, 1)
    }

    if (remainingCandidates.length === 0) break

    // Rescore remaining candidates based on unsaturated player value
    for (const trip of remainingCandidates) {
      const tripPlayerNames = [
        ...trip.anchorGame.playerNames,
        ...trip.nearbyGames.flatMap((g) => g.playerNames),
      ].filter((n) => eligiblePlayers.has(n) && !isPlayerSaturated(n))

      const uniqueNames = [...new Set(tripPlayerNames)]
      let rawCoverageScore = scoreWithCoverage(uniqueNames)

      // Apply drive efficiency penalty during greedy selection too
      const driveHours = trip.totalDriveMinutes / 60
      const efficiencyFactor = driveHours > 0 ? Math.max(0.6, 1.0 - (driveHours - 3) * 0.05) : 1.0
      rawCoverageScore = Math.round(rawCoverageScore * efficiencyFactor)

      trip.visitValue = rawCoverageScore
      trip.totalPlayersVisited = uniqueNames.length
    }

    // Re-sort and pick best
    remainingCandidates.sort((a, b) => b.visitValue - a.visitValue)

    const best = remainingCandidates[0]!
    if (best.visitValue === 0) break

    selectedTrips.push(best)
    recordTripPlayers(best)

    // Remove this candidate
    remainingCandidates.shift()
  }

  // Post-selection improvement pass: drop redundant low-value trips
  for (let i = selectedTrips.length - 1; i >= 0; i--) {
    const trip = selectedTrips[i]!
    const tripPlayers = new Set([
      ...trip.anchorGame.playerNames,
      ...trip.nearbyGames.flatMap((g) => g.playerNames),
    ].filter((n) => eligiblePlayers.has(n)))

    // Check if all players in this trip are covered by other selected trips
    let allCovered = true
    for (const name of tripPlayers) {
      const coveredElsewhere = selectedTrips.some((other, j) =>
        j !== i && [
          ...other.anchorGame.playerNames,
          ...other.nearbyGames.flatMap((g) => g.playerNames),
        ].includes(name),
      )
      if (!coveredElsewhere) { allCovered = false; break }
    }
    if (allCovered && trip.visitValue < 5) {
      selectedTrips.splice(i, 1)
    }
  }

  // --- Fly-in visits for players beyond driving range ---
  onProgress?.('Fly-in analysis', 'Finding fly-in options for distant players...')

  const visitedPlayers = new Set(playerVisitCounts.keys())
  // Include priority players in fly-in consideration even if they appeared in road trips
  // (they might have better fly-in options). Also include any player not on a road trip.
  const prioritySet = new Set(priorityPlayers.map(n => n))
  const playersForFlyIns = [...eligiblePlayers].filter(
    (n) => !visitedPlayers.has(n) || prioritySet.has(n),
  )
  const flyInVisits: FlyInVisit[] = []
  const flyInCovered = new Set<string>()

  // Confidence priority for taking highest per venue
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 }

  // Build per-week fly-in trips: each fly-in = specific 3-day window at one venue.
  // Key by venue+team+week so each week produces a separate trip option.
  const flyInWeekMap = new Map<string, {
    venue: GameEvent['venue']
    players: Set<string>
    dates: Set<string>
    source: GameEvent['source']
    isHome: boolean
    distanceKm: number
    sourceUrl?: string
    confidence?: VisitConfidence
    teamLabel: string
    weekNum: number
    gameTimeByDate: Map<string, string> // date → game time
  }>()

  const MAX_FLYIN_ENTRIES = 200 // cap fly-in map to prevent OOM
  for (const game of eligibleGames) {
    if (flyInWeekMap.size >= MAX_FLYIN_ENTRIES) break
    if (game.venue.coords.lat === 0 && game.venue.coords.lng === 0) continue
    const relevantPlayers = game.playerNames.filter((n) => playersForFlyIns.includes(n))
    if (relevantPlayers.length === 0) continue

    const driveMinutes = homeToVenue.get(coordKey(game.venue.coords)) ?? Infinity
    // Skip venues within driving range UNLESS they have priority players who weren't
    // covered by road trips (prevents priority players from falling through the cracks)
    const hasPriorityPlayerNotOnTrip = relevantPlayers.some(
      (n) => prioritySet.has(n) && !visitedPlayers.has(n),
    )
    if (driveMinutes <= maxDriveMinutes && !hasPriorityPlayerNotOnTrip) continue

    // Key by venue coords + team + week number → one fly-in per week per venue
    // Use the SV player's actual team (from roster/assignments), not the game's home/away label
    const firstPlayer = playerMap.get(relevantPlayers[0]!)
    const teamName = playerTeamAssignments?.[relevantPlayers[0]!]?.teamName
      ?? firstPlayer?.org
      ?? (game.isHome ? game.homeTeam : game.awayTeam)
    const weekNum = getWeekNumber(game.date)
    const key = `${coordKey(game.venue.coords)}|${teamName}|w${weekNum}`
    const existing = flyInWeekMap.get(key)
    if (existing) {
      for (const name of relevantPlayers) existing.players.add(name)
      existing.dates.add(game.date)
      if (game.time && !existing.gameTimeByDate.has(game.date)) existing.gameTimeByDate.set(game.date, game.time)
      if (game.confidence && (confidenceRank[game.confidence] ?? 0) > (confidenceRank[existing.confidence ?? ''] ?? 0)) {
        existing.confidence = game.confidence
      }
      if (game.sourceUrl && !existing.sourceUrl) existing.sourceUrl = game.sourceUrl
    } else {
      const distKm = haversineKm(homeBase, game.venue.coords)
      const gameTimeByDate = new Map<string, string>()
      if (game.time) gameTimeByDate.set(game.date, game.time)
      flyInWeekMap.set(key, {
        venue: game.venue,
        players: new Set(relevantPlayers),
        dates: new Set([game.date]),
        source: game.source,
        isHome: game.isHome,
        distanceKm: distKm,
        sourceUrl: game.sourceUrl,
        confidence: game.confidence,
        teamLabel: teamName,
        weekNum,
        gameTimeByDate,
      })
    }
  }

  // --- Fly-in Combo Builder ---
  // Cluster distant venues that are drivable from each other, then build
  // multi-stop fly-in itineraries (fly to hub, drive between venues, fly home).
  const comboVenuesUsed = new Set<string>() // track venues claimed by combos

  // Group flyInWeekMap entries by week number
  const entriesByWeek = new Map<number, typeof flyInWeekMap extends Map<string, infer V> ? Array<{ key: string; entry: V }> : never>()
  for (const [key, entry] of flyInWeekMap) {
    const weekEntries = entriesByWeek.get(entry.weekNum) ?? []
    weekEntries.push({ key, entry })
    entriesByWeek.set(entry.weekNum, weekEntries)
  }

  // For each week, find venue clusters (venues within 3h drive of each other)
  const MAX_COMBO_INTER_VENUE = 180 // 3h drive between fly-in combo stops
  let comboCount = 0
  const MAX_COMBOS = 15 // cap combo generation to prevent OOM
  for (const [, weekEntries] of entriesByWeek) {
    if (comboCount >= MAX_COMBOS) break
    if (weekEntries.length < 2) continue // need 2+ venues to form a combo

    // Build adjacency: which venues are drivable from which
    const venues = weekEntries.map(({ key, entry }) => ({
      key,
      entry,
      coordKey: coordKey(entry.venue.coords),
    }))

    // Complete-linkage clustering: a new venue must be within drive range of
    // ALL existing cluster members (not just any one). Prevents chaining
    // across continents (e.g., Albuquerque → Ontario CA → Daytona FL).
    const visited = new Set<number>()
    for (let i = 0; i < venues.length; i++) {
      if (visited.has(i)) continue
      const cluster = [i]
      visited.add(i)

      for (let j = 0; j < venues.length; j++) {
        if (visited.has(j)) continue
        // Check distance to ALL current cluster members
        const closeToAll = cluster.every((ci) => {
          const drive = lookupDriveMinutes(venues[ci]!.entry.venue.coords, venues[j]!.entry.venue.coords)
          return drive <= MAX_COMBO_INTER_VENUE
        })
        if (closeToAll) {
          cluster.push(j)
          visited.add(j)
        }
      }

      if (cluster.length < 2) continue // single-venue, handle as regular fly-in

      // Build combo fly-in from this cluster (max 3 stops for a 3-day trip)
      const clusterVenues = cluster.slice(0, 3).map((idx) => venues[idx]!)

      // Find best anchor date across all cluster venues (prefer Tuesday)
      const allDates = new Set<string>()
      for (const v of clusterVenues) {
        for (const d of v.entry.dates) allDates.add(d)
      }
      const sortedDates = [...allDates].sort()
      const bestDate = sortedDates.find(d => new Date(d + 'T12:00:00Z').getUTCDay() === ANCHOR_DAY) ?? sortedDates[0]!
      const tripWindow = getTripWindow(bestDate)

      // Assign one venue per day within the trip window (dedup by venue coords)
      const stops: import('../types/schedule').FlyInStop[] = []
      const usedDays = new Set<string>()
      const usedVenueCoords = new Set<string>()
      const allPlayerNames = new Set<string>()

      // Sort cluster venues by player value (most valuable first)
      clusterVenues.sort((a, b) => b.entry.players.size - a.entry.players.size)

      for (const v of clusterVenues) {
        // Skip if we've already added this venue (same coords, different team label)
        const venueCoordStr = coordKey(v.entry.venue.coords)
        if (usedVenueCoords.has(venueCoordStr)) continue

        // Find best available day for this venue (prefer matching dates, then any trip day)
        const venueDates = [...v.entry.dates].sort()
        const matchingDay = tripWindow.find(d => venueDates.includes(d) && !usedDays.has(d))
          ?? tripWindow.find(d => !usedDays.has(d))
        if (!matchingDay) continue

        usedDays.add(matchingDay)
        usedVenueCoords.add(venueCoordStr)
        const prevStop = stops[stops.length - 1]
        const driveFromPrev = prevStop
          ? lookupDriveMinutes(prevStop.venue.coords, v.entry.venue.coords)
          : 0

        const playerNames = [...v.entry.players]
        for (const n of playerNames) allPlayerNames.add(n)

        stops.push({
          venue: v.entry.venue,
          playerNames,
          date: matchingDay,
          driveMinutesFromPrev: driveFromPrev,
          source: v.entry.source,
          isHome: v.entry.isHome,
          sourceUrl: v.entry.sourceUrl,
          confidence: v.entry.confidence,
          teamLabel: v.entry.teamLabel,
          gameTime: v.entry.gameTimeByDate.get(matchingDay),
        })

        comboVenuesUsed.add(v.coordKey)
      }

      if (stops.length < 2) continue // couldn't build a multi-stop combo

      // Sort stops by date and recalculate ALL inter-stop drives
      stops.sort((a, b) => a.date.localeCompare(b.date))
      stops[0]!.driveMinutesFromPrev = 0 // first stop has no previous
      for (let si = 1; si < stops.length; si++) {
        stops[si]!.driveMinutesFromPrev = lookupDriveMinutes(
          stops[si - 1]!.venue.coords, stops[si]!.venue.coords,
        )
      }

      const totalInterDrive = stops.reduce((sum, s) => sum + s.driveMinutesFromPrev, 0)
      const comboPlayerNames = [...allPlayerNames]
      const isTuesday = new Date(bestDate + 'T12:00:00Z').getUTCDay() === ANCHOR_DAY
      const comboBreakdown = computeScoreBreakdown(comboPlayerNames, playerMap, isTuesday, urgencyMap, [])
      // Combo bonus: 20% per additional stop
      const comboMultiplier = 1 + (0.2 * (stops.length - 1))
      comboBreakdown.finalScore = Math.round(comboBreakdown.finalScore * comboMultiplier)

      // Use first stop as primary venue, find nearest airport to centroid
      const centroidLat = stops.reduce((s, st) => s + st.venue.coords.lat, 0) / stops.length
      const centroidLng = stops.reduce((s, st) => s + st.venue.coords.lng, 0) / stops.length

      const hubCoords = { lat: centroidLat, lng: centroidLng }
      const distFromHome = haversineKm(homeBase, hubCoords)

      flyInVisits.push({
        playerNames: comboPlayerNames,
        venue: stops[0]!.venue, // primary venue
        dates: stops.map(s => s.date),
        distanceKm: Math.round(distFromHome),
        estimatedTravelHours: estimateFlightHours(distFromHome),
        visitValue: comboBreakdown.finalScore,
        scoreBreakdown: comboBreakdown,
        source: stops[0]!.source,
        isHome: stops[0]!.isHome,
        sourceUrl: stops[0]!.sourceUrl,
        confidence: stops.some(s => s.confidence !== 'high') ? 'medium' : 'high',
        teamLabel: stops[0]!.teamLabel,
        isCombo: true,
        stops,
        totalDriveMinutes: totalInterDrive,
      })

      for (const n of allPlayerNames) flyInCovered.add(n)
    }
  }

  // Convert remaining single-venue entries to FlyInVisit array (skip venues already in combos)
  for (const [, entry] of flyInWeekMap) {
    // Always count players as covered even if venue is in a combo
    for (const name of entry.players) flyInCovered.add(name)
    const venueCoordKey = coordKey(entry.venue.coords)
    if (comboVenuesUsed.has(venueCoordKey)) continue // already in a combo
    const sortedDates = [...entry.dates].sort()
    // Trim to a 3-day trip window centered on the best day (prefer Tuesday)
    const bestDate = sortedDates.find(d => new Date(d + 'T12:00:00Z').getUTCDay() === ANCHOR_DAY) ?? sortedDates[0]!
    const tripDates = getTripWindow(bestDate).filter(d => sortedDates.includes(d) || d === bestDate)
    // Use the trip window dates (max 3 days)
    const finalDates = tripDates.length > 0 ? tripDates : [bestDate]

    const isTuesday = new Date(bestDate + 'T12:00:00Z').getUTCDay() === ANCHOR_DAY
    const flyInPlayerNames = [...entry.players]
    const flyInBreakdown = computeScoreBreakdown(flyInPlayerNames, playerMap, isTuesday, urgencyMap, [])
    flyInVisits.push({
      playerNames: flyInPlayerNames,
      venue: entry.venue,
      dates: finalDates,
      distanceKm: Math.round(entry.distanceKm),
      estimatedTravelHours: estimateFlightHours(entry.distanceKm),
      visitValue: flyInBreakdown.finalScore,
      scoreBreakdown: flyInBreakdown,
      source: entry.source,
      isHome: entry.isHome,
      sourceUrl: entry.sourceUrl,
      confidence: entry.confidence,
      teamLabel: entry.teamLabel,
    })

    for (const name of entry.players) flyInCovered.add(name)
  }

  // Deduplicate fly-ins: keep at most 2 entries per player to ensure diversity.
  // For each player, keep their best fly-in (highest score) and best Tuesday fly-in.
  // This prevents a priority player from filling all 10 result slots.
  const playerFlyInCount = new Map<string, number>()
  const venuesSeen = new Set<string>()
  const MAX_FLYINS_PER_PLAYER = 2
  const diverseFlyIns: FlyInVisit[] = []

  // Sort by score first so we pick the best ones per player
  flyInVisits.sort((a, b) => {
    // Multi-player fly-ins first (more valuable)
    if (a.playerNames.length !== b.playerNames.length) return b.playerNames.length - a.playerNames.length
    return b.visitValue - a.visitValue
  })

  for (const visit of flyInVisits) {
    // Deduplicate venues — 1 fly-in per venue (keep best score, already sorted)
    const venueKey = `${visit.venue.coords.lat.toFixed(3)},${visit.venue.coords.lng.toFixed(3)}`
    if (venuesSeen.has(venueKey)) continue
    venuesSeen.add(venueKey)

    // Check if any player in this fly-in still has room
    const hasRoom = visit.playerNames.some((n) => {
      return (playerFlyInCount.get(n) ?? 0) < MAX_FLYINS_PER_PLAYER
    })
    if (hasRoom) {
      diverseFlyIns.push(visit)
      for (const name of visit.playerNames) {
        playerFlyInCount.set(name, (playerFlyInCount.get(name) ?? 0) + 1)
      }
    }
  }

  // Now sort the diverse list: priority players first, then by score
  const prioritySetLower = new Set(priorityPlayers.map(n => n.toLowerCase()))
  diverseFlyIns.sort((a, b) => {
    const aHasPriority = a.playerNames.some(n => prioritySetLower.has(n.toLowerCase()))
    const bHasPriority = b.playerNames.some(n => prioritySetLower.has(n.toLowerCase()))
    if (aHasPriority && !bHasPriority) return -1
    if (!aHasPriority && bHasPriority) return 1
    return b.visitValue - a.visitValue
  })

  // When priority players are set, prefer fly-ins that include them — but don't
  // filter out all others (priority players may only appear in 1-2 fly-ins)
  // Cap at 25 fly-ins — more than enough for display, saves computation
  const finalDiverseFlyIns = diverseFlyIns.slice(0, 25)

  // Replace flyInVisits with diverse set
  flyInVisits.length = 0
  flyInVisits.push(...finalDiverseFlyIns)

  // Filter out fly-in visits beyond max flight range
  // EXCEPTION: Always keep fly-ins that include a priority player — never silently drop them
  const beyondFlightRange: UnvisitablePlayer[] = []
  const filteredFlyIns = flyInVisits.filter((v) => {
    if (v.estimatedTravelHours <= maxFlightHours) return true
    // Keep fly-ins for priority players even if beyond max flight
    const hasPriority = v.playerNames.some(n => prioritySet.has(n))
    if (hasPriority) return true
    // Move non-priority players to unreachable
    for (const name of v.playerNames) {
      if (flyInCovered.has(name)) {
        const otherFlyIn = flyInVisits.some(
          (other) => other !== v && other.estimatedTravelHours <= maxFlightHours && other.playerNames.includes(name),
        )
        if (!otherFlyIn) {
          flyInCovered.delete(name)
          beyondFlightRange.push({
            name,
            reason: `Beyond max flight range (${v.estimatedTravelHours}h travel)`,
          })
        }
      }
    }
    return false
  })
  flyInVisits.length = 0
  flyInVisits.push(...filteredFlyIns)

  // Truly unreachable: no games at all in date range (not even fly-in or road trip)
  const trulyUnreachableNames = playersForFlyIns.filter((n) => !flyInCovered.has(n) && !visitedPlayers.has(n))

  // Compute reasons for each unreachable player
  const trulyUnreachable: UnvisitablePlayer[] = trulyUnreachableNames.map((name) => {
    const player = playerMap.get(name)
    if (!player) return { name, reason: 'Player not found in roster' }

    // Check if org is recognized
    if (player.level === 'Pro' && !resolveMLBTeamId(player.org)) {
      return { name, reason: 'No recognized org — not in alias table' }
    }
    if (player.level === 'NCAA' && !resolveNcaaName(player.org)) {
      return { name, reason: 'No recognized org — not in alias table' }
    }

    // Check if player had ANY games generated
    const playerGames = games.filter((g) => g.playerNames.includes(name))
    if (playerGames.length === 0) {
      // For Pro players: check if they have a team assignment
      if (player.level === 'Pro') {
        const hasAssignment = playerTeamAssignments && playerTeamAssignments[name]
        if (!hasAssignment) {
          return { name, reason: 'Not assigned to a team — click Verify Assignments on the Roster tab' }
        }
        return { name, reason: 'No games loaded — try reloading schedules after verifying assignments' }
      }
      // For NCAA: check if org resolves — if it does, schedule fetch may have failed
      if (player.level === 'NCAA') {
        if (resolveNcaaName(player.org)) {
          return { name, reason: `Schedule fetch may have failed for ${player.org} — try reloading schedules` }
        }
        return { name, reason: `School not matched (org: "${player.org}") — check Roster tab for unknown team names that need mapping` }
      }
      // For HS: similar check
      if (player.level === 'HS') {
        return { name, reason: `No HS schedule found for "${player.org}" — may need MaxPreps mapping` }
      }
      return { name, reason: 'No games found' }
    }

    // Check if all games have zero coords (venue couldn't be geocoded)
    const allZeroCoords = playerGames.every((g) => g.venue.coords.lat === 0 && g.venue.coords.lng === 0)
    if (allZeroCoords) {
      return { name, reason: 'No venue coordinates — geocoding failed' }
    }

    // Check if games exist but are all outside the date range
    const gamesInRange = playerGames.filter((g) => g.date >= startDate && g.date <= endDate)
    if (gamesInRange.length === 0) {
      // Player has games but none in the selected dates
      if (player.level === 'NCAA') return { name, reason: `College season may be over — games found outside ${startDate} to ${endDate}` }
      if (player.level === 'HS') return { name, reason: `HS season may be over — games found outside ${startDate} to ${endDate}` }
      return { name, reason: 'No games in date range' }
    }

    // Check if all in-range games fall on Sundays
    const allSundays = gamesInRange.every((g) => new Date(g.date + 'T12:00:00Z').getUTCDay() === 0)
    if (allSundays) {
      return { name, reason: 'All games on Sundays (blackout days)' }
    }

    return { name, reason: `Has ${gamesInRange.length} game${gamesInRange.length !== 1 ? 's' : ''} in range but not selected for a trip — may overlap with higher-priority trips` }
  })

  // Merge players filtered out by max flight range
  trulyUnreachable.push(...beyondFlightRange)

  const allCoveredPlayers = new Set([...visitedPlayers, ...flyInCovered])
  const totalCovered = allCoveredPlayers.size
  const totalVisitsPlanned = [...playerVisitCounts.values()].reduce((sum, v) => sum + v, 0)
  const totalTarget = players.reduce((sum, p) => sum + (TIER_VISIT_TARGETS[p.tier] ?? 0), 0)

  // Dedupe near-misses: only keep if player not already covered
  const filteredNearMisses = nearMisses.filter(
    (nm) => !visitedPlayers.has(nm.playerName) && !flyInCovered.has(nm.playerName),
  )

  return {
    trips: selectedTrips,
    flyInVisits,
    unvisitablePlayers: trulyUnreachable,
    skippedPlayers,
    analyzedEventCount: eligibleGames.length,
    totalPlayersWithVisits: totalCovered,
    totalVisitsCovered: totalCovered,
    totalVisitsPlanned,
    coveragePercent: totalTarget > 0 ? Math.round((totalCovered / eligiblePlayers.size) * 100) : 0,
    priorityResults: priorityResults.length > 0 ? priorityResults : undefined,
    nearMisses: filteredNearMisses.length > 0 ? filteredNearMisses : undefined,
  }
}

// Analyze best weeks for travel based on T1+T2 player coverage
export interface WeekSuggestion {
  weekStart: string // ISO date (Monday)
  weekEnd: string   // ISO date (Saturday)
  t1Count: number
  t2Count: number
  totalScore: number
}

export function analyzeBestWeeks(
  games: GameEvent[],
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  _maxDriveMinutes: number = MAX_DRIVE_MINUTES,
): WeekSuggestion[] {
  const playerMap = new Map<string, RosterPlayer>()
  for (const p of players) playerMap.set(p.playerName, p)

  const eligiblePlayers = new Set(
    players.filter((p) => p.visitsRemaining > 0).map((p) => p.playerName),
  )

  // Include all games with eligible players (drivable + fly-in) for week analysis
  const eligibleGames = games.filter(
    (g) =>
      isDateAllowed(g.date) &&
      g.date >= startDate &&
      g.date <= endDate &&
      g.playerNames.some((n) => eligiblePlayers.has(n)) &&
      g.gameStatus !== 'Cancelled' &&
      g.gameStatus !== 'Canceled' &&
      g.venue.coords.lat !== 0 &&
      g.venue.coords.lng !== 0,
  )

  // Build weeks (Mon-Sat) within the date range
  const weeks: WeekSuggestion[] = []
  const start = new Date(startDate + 'T12:00:00Z')
  // Advance to next Monday
  while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1)

  const end = new Date(endDate + 'T12:00:00Z')

  while (start < end) {
    const weekStart = start.toISOString().split('T')[0]!
    const sat = new Date(start)
    sat.setUTCDate(sat.getUTCDate() + 5)
    const weekEnd = sat.toISOString().split('T')[0]!

    // Find all unique T1+T2 players with games this week
    const weekPlayers = new Set<string>()
    for (const g of eligibleGames) {
      if (g.date >= weekStart && g.date <= weekEnd) {
        for (const name of g.playerNames) {
          if (eligiblePlayers.has(name)) weekPlayers.add(name)
        }
      }
    }

    let t1Count = 0, t2Count = 0
    for (const name of weekPlayers) {
      const tier = playerMap.get(name)?.tier
      if (tier === 1) t1Count++
      else if (tier === 2) t2Count++
    }

    if (t1Count + t2Count > 0) {
      weeks.push({
        weekStart,
        weekEnd,
        t1Count,
        t2Count,
        totalScore: t1Count * 5 + t2Count * 3,
      })
    }

    start.setUTCDate(start.getUTCDate() + 7)
  }

  // Sort by totalScore descending, return top 5
  weeks.sort((a, b) => b.totalScore - a.totalScore)
  return weeks.slice(0, 5)
}

export { HOME_BASE, DEFAULT_HOME_BASE, MAX_DRIVE_MINUTES, TIER_WEIGHTS }
