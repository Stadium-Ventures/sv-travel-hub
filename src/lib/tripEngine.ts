import type { Coordinates } from '../types/roster'
import type { RosterPlayer } from '../types/roster'
import type { GameEvent, TripCandidate, TripPlan, PriorityResult, VisitConfidence, FlyInVisit, ScoreBreakdown, NearMiss, UnvisitablePlayer } from '../types/schedule'
import { TIER_VISIT_TARGETS } from '../types/roster'
import { isSpringTraining, getSpringTrainingSite } from '../data/springTraining'
import { resolveMLBTeamId, resolveNcaaName } from '../data/aliases'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { D1_BASEBALL_SLUGS } from '../data/d1baseballSlugs'
import { resolveMaxPrepsSlug } from './maxpreps'

// Constants
const HOME_BASE: Coordinates = { lat: 28.5383, lng: -81.3792 } // Orlando, FL
const MAX_DRIVE_MINUTES = 180 // 3 hours one-way
const ANCHOR_DAY = 2 // Tuesday (0=Sun, 2=Tue)

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
// ~95 km/h avg speed with 1.2 detour factor (calibrated for Florida interstate driving)
export function estimateDriveMinutes(a: Coordinates, b: Coordinates): number {
  const km = haversineKm(a, b)
  return Math.round((km * 1.2 / 95) * 60)
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
    const pts = Math.round(base * urgencyBoost * pitcherBoost)

    if (isPitcherMatch) {
      pitcherMatchBonus += Math.round(base * urgencyBoost * 0.5) // track the bonus portion
    }

    if (player.tier === 1) { tier1Count++; tier1Points += pts }
    else if (player.tier === 2) { tier2Count++; tier2Points += pts }
    else if (player.tier === 3) { tier3Count++; tier3Points += pts }
  }

  const rawScore = tier1Points + tier2Points + tier3Points
  const finalScore = tuesdayBonus ? Math.round(rawScore * 1.2) : rawScore

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

// Cache for inter-venue drive minutes to avoid redundant haversine calculations
const driveMinutesCache = new Map<string, number>()

function cachedDriveMinutes(a: Coordinates, b: Coordinates): number {
  const ka = coordKey(a), kb = coordKey(b)
  const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  const cached = driveMinutesCache.get(key)
  if (cached !== undefined) return cached
  const result = estimateDriveMinutes(a, b)
  driveMinutesCache.set(key, result)
  return result
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
): Promise<TripPlan> {
  onProgress?.('Preparing', 'Filtering eligible players...')

  // Build player lookup
  const playerMap = new Map<string, RosterPlayer>()
  for (const p of players) {
    playerMap.set(p.playerName, p)
  }

  // Track players skipped (T4 / no visits needed)
  const skippedPlayers: Array<{ name: string; reason: string }> = []
  for (const p of players) {
    if (p.visitsRemaining <= 0) {
      skippedPlayers.push({
        name: p.playerName,
        reason: p.tier === 4 ? 'Tier 4 — no visits required' : 'All visits already completed',
      })
    }
  }

  // Filter to players needing visits
  const eligiblePlayers = new Set(
    players.filter((p) => p.visitsRemaining > 0).map((p) => p.playerName),
  )

  // Filter games: no Sundays, within date range, with eligible players, exclude cancelled
  const eligibleGames = games.filter(
    (g) =>
      isDateAllowed(g.date) &&
      g.date >= startDate &&
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
      homeToVenue.set(key, estimateDriveMinutes(HOME_BASE, g.venue.coords))
    }
  }

  const uniqueVenueCount = homeToVenue.size
  onProgress?.('Analyzing', `${eligibleGames.length} visit opportunities across ${uniqueVenueCount} venues...`)

  // Get ALL non-Sunday dates as potential anchor days (Tuesdays preferred via scoring bonus)
  const anchorDays = getDatesInRange(startDate, endDate).filter(isDateAllowed)

  // Build trip candidates — any day can anchor a trip
  // Deduplicate: only evaluate each venue once per week
  const candidates: TripCandidate[] = []
  const seenVenueWeeks = new Set<string>()
  const nearMisses: NearMiss[] = []
  const nearMissSeen = new Set<string>() // dedupe by player+venue

  for (const anchorDay of anchorDays) {
    const anchorGames = eligibleGames.filter((g) => g.date === anchorDay)

    for (const anchor of anchorGames) {
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

      // Deduplicate: same venue within same week → skip
      const weekNum = getWeekNumber(anchorDay)
      const venueWeekKey = `${anchorKey}-w${weekNum}`
      if (seenVenueWeeks.has(venueWeekKey)) continue
      seenVenueWeeks.add(venueWeekKey)

      const window = getTripWindow(anchorDay)

      // Find nearby games within the trip window at any venue
      const windowGames = eligibleGames.filter(
        (g) =>
          window.includes(g.date) &&
          g.id !== anchor.id &&
          g.venue.coords.lat !== 0 &&
          g.venue.coords.lng !== 0,
      )

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
        continue
      }

      // Use Haversine for nearby game distance estimation (cached, no API)
      const nearbyGames = windowGames
        .map((g) => ({ ...g, driveMinutes: cachedDriveMinutes(anchor.venue.coords, g.venue.coords) }))
        .filter((g) => g.driveMinutes <= maxDriveMinutes && g.driveMinutes >= 0)

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

      const suggestedDays = [...new Set([anchor.date, ...nearbyGames.map((g) => g.date)])].sort()

      // Estimate total driving — sequential chain: home → anchor → stop2 → stop3 → ... → home
      // Sort nearby games by distance from anchor so we visit closest first
      const sortedNearby = [...nearbyGames].sort((a, b) => a.driveMinutes - b.driveMinutes)
      let interVenueDrive = 0
      let prevCoords = anchor.venue.coords
      for (const g of sortedNearby) {
        interVenueDrive += cachedDriveMinutes(prevCoords, g.venue.coords)
        prevCoords = g.venue.coords
      }
      const lastVenueKey = sortedNearby.length > 0
        ? coordKey(sortedNearby[sortedNearby.length - 1]!.venue.coords)
        : anchorKey
      const returnHome = homeToVenue.get(lastVenueKey) ?? homeToAnchor
      const totalDrive = homeToAnchor + interVenueDrive + returnHome

      // Tuesday bonus: prefer Tuesday anchors with 20% value boost
      const dayOfWeek = new Date(anchorDay + 'T12:00:00Z').getUTCDay()
      const isTuesday = dayOfWeek === ANCHOR_DAY
      const allTripGames = [anchor, ...nearbyGames]
      const breakdown = computeScoreBreakdown([...allPlayerNames], playerMap, isTuesday, urgencyMap, allTripGames)

      candidates.push({
        anchorGame: anchor,
        nearbyGames,
        suggestedDays,
        totalPlayersVisited: allPlayerNames.size,
        visitValue: breakdown.finalScore,
        driveFromHomeMinutes: homeToAnchor,
        totalDriveMinutes: totalDrive,
        venueCount: 1 + new Set(nearbyGames.map((g) => coordKey(g.venue.coords))).size,
        scoreBreakdown: breakdown,
      })
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
    return (playerVisitCounts.get(name) ?? 0) >= player.visitsRemaining
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
      if (remainingNeed <= 0) continue
      const base = weight * remainingNeed
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
    function candidatesWithPlayer(name: string): TripCandidate[] {
      return candidates.filter((c) => {
        const allNames = [
          ...c.anchorGame.playerNames,
          ...c.nearbyGames.flatMap((g) => g.playerNames),
        ]
        return allNames.includes(name)
      })
    }

    if (priorityPlayers.length === 2) {
      const [p1, p2] = priorityPlayers as [string, string]

      // Try to find a trip that includes BOTH priority players
      const bothCandidates = candidates.filter((c) => {
        const allNames = new Set([
          ...c.anchorGame.playerNames,
          ...c.nearbyGames.flatMap((g) => g.playerNames),
        ])
        return allNames.has(p1) && allNames.has(p2)
      })

      if (bothCandidates.length > 0) {
        bothCandidates.sort((a, b) => b.visitValue - a.visitValue)
        const best = bothCandidates[0]!
        selectedTrips.push(best)
        recordTripPlayers(best)
        priorityResults.push({ playerName: p1, status: 'included' })
        priorityResults.push({ playerName: p2, status: 'included' })
      } else {
        for (const pName of [p1, p2]) {
          const pCandidates = candidatesWithPlayer(pName)
          if (pCandidates.length > 0) {
            pCandidates.sort((a, b) => b.visitValue - a.visitValue)
            const best = pCandidates[0]!
            selectedTrips.push(best)
            recordTripPlayers(best)
            priorityResults.push({
              playerName: pName,
              status: 'separate-trip',
              reason: `No trip covers both ${p1} and ${p2} within the drive radius — created separate trips`,
            })
          } else {
            // Check if the player has any eligible games (would appear as fly-in)
            const hasGames = eligibleGames.some((g) => g.playerNames.includes(pName))
            priorityResults.push({
              playerName: pName,
              status: hasGames ? 'fly-in-only' : 'unreachable',
              reason: hasGames
                ? `${pName} is beyond driving range — check Fly-in Visits section below`
                : `No reachable games for ${pName} in the selected date range`,
            })
          }
        }
      }
    } else if (priorityPlayers.length === 1) {
      const pName = priorityPlayers[0]!
      const pCandidates = candidatesWithPlayer(pName)
      if (pCandidates.length > 0) {
        pCandidates.sort((a, b) => b.visitValue - a.visitValue)
        const best = pCandidates[0]!
        selectedTrips.push(best)
        recordTripPlayers(best)
        priorityResults.push({ playerName: pName, status: 'included' })
      } else {
        // Check if the player has any eligible games (would appear as fly-in)
        const hasGames = eligibleGames.some((g) => g.playerNames.includes(pName))
        priorityResults.push({
          playerName: pName,
          status: hasGames ? 'fly-in-only' : 'unreachable',
          reason: hasGames
            ? `${pName} is beyond driving range — check Fly-in Visits section below`
            : `No reachable games for ${pName} in the selected date range`,
        })
      }
    }
  }

  // --- Greedy selection for remaining trips ---
  // Players can appear in multiple trips until their visit quota is met.
  const remainingCandidates = [...candidates].sort((a, b) => b.visitValue - a.visitValue)

  let greedyIterCount = 0
  while (remainingCandidates.length > 0) {
    if (++greedyIterCount % 50 === 0) {
      await new Promise(r => setTimeout(r, 0)) // yield to browser
    }
    // Rescore remaining candidates based on unsaturated player value
    for (const trip of remainingCandidates) {
      const tripPlayerNames = [
        ...trip.anchorGame.playerNames,
        ...trip.nearbyGames.flatMap((g) => g.playerNames),
      ].filter((n) => eligiblePlayers.has(n) && !isPlayerSaturated(n))

      const uniqueNames = [...new Set(tripPlayerNames)]
      trip.visitValue = scoreWithCoverage(uniqueNames)
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

  // Post-selection improvement pass: check if any low-value trip at the end
  // can be dropped without losing coverage (all its players are covered by other trips)
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
  const playersNotOnRoadTrips = [...eligiblePlayers].filter((n) => !visitedPlayers.has(n))
  const flyInVisits: FlyInVisit[] = []
  const flyInCovered = new Set<string>()

  // Group remaining eligible games by venue + team (not just venue coords).
  // Different teams visiting the same stadium are separate fly-in options.
  const flyInVenueMap = new Map<string, {
    venue: GameEvent['venue']
    players: Set<string>
    dates: Set<string>
    source: GameEvent['source']
    isHome: boolean
    distanceKm: number
    sourceUrl?: string
    confidence?: VisitConfidence
    teamLabel: string // the team whose schedule this game belongs to
  }>()

  // Confidence priority for taking highest per venue
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 }

  for (const game of eligibleGames) {
    if (game.venue.coords.lat === 0 && game.venue.coords.lng === 0) continue
    const relevantPlayers = game.playerNames.filter((n) => playersNotOnRoadTrips.includes(n))
    if (relevantPlayers.length === 0) continue

    // Key by venue coords + the team the players belong to (home or away side)
    // This prevents merging Red Sox players with Nationals players at the same stadium
    const teamName = game.isHome ? game.homeTeam : game.awayTeam
    const key = `${coordKey(game.venue.coords)}|${teamName}`
    const existing = flyInVenueMap.get(key)
    if (existing) {
      for (const name of relevantPlayers) existing.players.add(name)
      existing.dates.add(game.date)
      // Take highest confidence per venue
      if (game.confidence && (confidenceRank[game.confidence] ?? 0) > (confidenceRank[existing.confidence ?? ''] ?? 0)) {
        existing.confidence = game.confidence
      }
      if (game.sourceUrl && !existing.sourceUrl) existing.sourceUrl = game.sourceUrl
    } else {
      const distKm = haversineKm(HOME_BASE, game.venue.coords)
      flyInVenueMap.set(key, {
        venue: game.venue,
        players: new Set(relevantPlayers),
        dates: new Set([game.date]),
        source: game.source,
        isHome: game.isHome,
        distanceKm: distKm,
        sourceUrl: game.sourceUrl,
        confidence: game.confidence,
        teamLabel: teamName,
      })
    }
  }

  // Convert to FlyInVisit array (only venues beyond driving range)
  for (const [, entry] of flyInVenueMap) {
    const driveMinutes = estimateDriveMinutes(HOME_BASE, entry.venue.coords)
    if (driveMinutes <= maxDriveMinutes) continue // already handled by road trips

    const sortedDates = [...entry.dates].sort()
    const flyInPlayerNames = [...entry.players]
    const flyInScore = scoreTripCandidate(flyInPlayerNames, playerMap, urgencyMap)
    const flyInBreakdown = computeScoreBreakdown(flyInPlayerNames, playerMap, false, urgencyMap, [])
    flyInVisits.push({
      playerNames: flyInPlayerNames,
      venue: entry.venue,
      dates: sortedDates,
      distanceKm: Math.round(entry.distanceKm),
      estimatedTravelHours: estimateFlightHours(entry.distanceKm),
      visitValue: flyInScore,
      scoreBreakdown: flyInBreakdown,
      source: entry.source,
      isHome: entry.isHome,
      sourceUrl: entry.sourceUrl,
      confidence: entry.confidence,
      teamLabel: entry.teamLabel,
    })

    for (const name of entry.players) flyInCovered.add(name)
  }

  // Sort fly-in visits by score (highest value first)
  flyInVisits.sort((a, b) => b.visitValue - a.visitValue)

  // Filter out fly-in visits beyond max flight range
  const beyondFlightRange: UnvisitablePlayer[] = []
  const filteredFlyIns = flyInVisits.filter((v) => {
    if (v.estimatedTravelHours <= maxFlightHours) return true
    // Move these players to unreachable
    for (const name of v.playerNames) {
      if (flyInCovered.has(name)) {
        // Only mark unreachable if this was their only fly-in option
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

  // Truly unreachable: no games at all in date range (not even fly-in)
  const trulyUnreachableNames = playersNotOnRoadTrips.filter((n) => !flyInCovered.has(n))

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
      return { name, reason: 'No games in date range' }
    }

    // Check if all games have zero coords (venue couldn't be geocoded)
    const allZeroCoords = playerGames.every((g) => g.venue.coords.lat === 0 && g.venue.coords.lng === 0)
    if (allZeroCoords) {
      return { name, reason: 'No venue coordinates — geocoding failed' }
    }

    // Check if all eligible games fall on Sundays
    const allSundays = playerGames
      .filter((g) => g.date >= startDate && g.date <= endDate)
      .every((g) => new Date(g.date + 'T12:00:00Z').getUTCDay() === 0)
    if (allSundays) {
      return { name, reason: 'All games on Sundays (blackout days)' }
    }

    return { name, reason: 'No games in date range' }
  })

  // Merge players filtered out by max flight range
  trulyUnreachable.push(...beyondFlightRange)

  const totalCovered = visitedPlayers.size + flyInCovered.size
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

export { HOME_BASE, MAX_DRIVE_MINUTES }
