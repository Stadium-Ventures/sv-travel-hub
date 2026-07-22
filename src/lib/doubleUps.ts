import type { GameEvent, DoubleUp } from '../types/schedule'
import type { RosterPlayer } from '../types/roster'
import { haversineKm, estimateDriveMinutes, TIER_WEIGHTS } from './tripEngine'

/**
 * Find double-up opportunities: dates where 2+ SV-relevant games can be attended.
 *
 * Types:
 * - same-venue-matchup: two SV players on opposing teams in the same game
 * - nearby-venues: two games within a 90min drive on the same day. Start-time
 *   overlap does NOT disqualify — per Kent (2026-07-21): "if they are
 *   scheduled to physically be within a reasonable driving distance then we
 *   can double with a meal + game — doesn't have to be two games." Kent's
 *   tiers: green ≤45min drive, yellow 46-90min (rendered by the UI from
 *   driveMinutesBetween).
 * - tournament-cluster: 3+ games within 5km on the same day
 * - stay-over: games on back-to-back DAYS within a 90min drive — one hotel
 *   covers both visits. Suppressed when the same players already have a
 *   same-day double on either date.
 *
 * Consecutive-date repeats of the same opportunity (a series — e.g. Beloit
 * hosting Peoria for 6 games) are collapsed into ONE entry with `dates`
 * listing every game date in the run.
 */
const MAX_DRIVE_MINUTES = 90
export function findDoubleUps(
  allGames: GameEvent[],
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  filterPlayerNames?: string[],
  filterTiers?: number[],
): DoubleUp[] {
  const playerMap = new Map(players.map((p) => [p.playerName, p]))

  // A player counts toward a double-up if they pass the same rules used for
  // game eligibility (visits remaining + active player/tier filters). Also
  // used to restrict displayed playerNames so zero-visit/filtered players
  // riding along on an eligible game aren't listed.
  const isEligiblePlayer = (n: string): boolean => {
    const p = playerMap.get(n)
    if (!p || p.visitsRemaining <= 0) return false
    if (filterPlayerNames && filterPlayerNames.length > 0 && !filterPlayerNames.includes(n)) return false
    if (filterTiers && filterTiers.length > 0 && !filterTiers.includes(p.tier)) return false
    return true
  }

  // Filter games to date range and eligible players
  const eligible = allGames.filter((g) => {
    if (g.date < startDate || g.date > endDate) return false
    if (g.gameStatus === 'Cancelled' || g.gameStatus === 'Postponed') return false
    return g.playerNames.some(isEligiblePlayer)
  })

  // Group games by date
  const byDate = new Map<string, GameEvent[]>()
  for (const g of eligible) {
    const arr = byDate.get(g.date) ?? []
    arr.push(g)
    byDate.set(g.date, arr)
  }

  const doubleUps: DoubleUp[] = []
  // Merged (mirror-collapsed) games per date, reused by the stay-over pass
  const mergedByDate = new Map<string, GameEvent[]>()

  for (const [date, dateGames] of byDate) {
    // NCAA/HS schedules produce one event PER TRACKED SCHOOL, so a game
    // between two client schools arrives as two mirrored events. Merge them
    // so both sides' players sit on one game (Pro games are pre-merged in
    // scheduleStore, keyed by gamePk).
    const games = mergeMirroredEvents(dateGames)
    mergedByDate.set(date, games)

    // Same-venue matchups: eligible SV players on BOTH sides of one game
    for (const game of games) {
      const home: string[] = []
      const away: string[] = []
      const sides = game.playerSides ?? {}
      for (const name of game.playerNames) {
        if (!isEligiblePlayer(name)) continue
        if (sides[name] === 'home') home.push(name)
        else if (sides[name] === 'away') away.push(name)
      }
      if (home.length > 0 && away.length > 0) {
        doubleUps.push({
          date,
          dates: [date],
          games: [game],
          type: 'same-venue-matchup',
          driveMinutesBetween: 0,
          timeFeasible: true,
          combinedValue: scoreGames([game], playerMap),
          playerNames: [...home, ...away],
        })
      }
    }

    if (games.length < 2) continue

    // Tournament clusters (3+ games within 5km)
    const clusters = findTournamentClusters(games)
    for (const cluster of clusters) {
      const allPlayerNames = [...new Set(cluster.flatMap((g) => g.playerNames))].filter(isEligiblePlayer)
      doubleUps.push({
        date,
        dates: [date],
        games: cluster,
        type: 'tournament-cluster',
        driveMinutesBetween: 0,
        timeFeasible: true,
        combinedValue: scoreGames(cluster, playerMap),
        playerNames: allPlayerNames,
      })
    }

    // Check all pairs for nearby-venues double ups
    // Skip pairs already covered by tournament clusters
    const clusteredGameIds = new Set(clusters.flat().map((g) => g.id))
    for (let i = 0; i < games.length; i++) {
      for (let j = i + 1; j < games.length; j++) {
        const g1 = games[i]!
        const g2 = games[j]!

        // Skip if both already in a tournament cluster
        if (clusteredGameIds.has(g1.id) && clusteredGameIds.has(g2.id)) continue

        // A pair with identical player sets is the same outing, not a double up
        // (e.g. synthetic + real event for one school that escaped dedup)
        const p1 = g1.playerNames.filter(isEligiblePlayer)
        const p2 = g2.playerNames.filter(isEligiblePlayer)
        if (p1.length === 0 || p2.length === 0) continue
        if ([...p1].sort().join('|') === [...p2].sort().join('|')) continue

        const distKm = haversineKm(g1.venue.coords, g2.venue.coords)
        // Same complex (< 1km): a doubleheader-style pair — zero drive
        const driveMin = distKm < 1 ? 0 : estimateDriveMinutes(g1.venue.coords, g2.venue.coords)
        if (driveMin > MAX_DRIVE_MINUTES) continue

        // Informational only — an overlap downgrades the badge ("split
        // innings or game + meal"), it never disqualifies the double up
        const timeFeasible = checkTimeFeasibility(g1, g2, driveMin)

        const allPlayerNames = [...new Set([...p1, ...p2])]
        doubleUps.push({
          date,
          dates: [date],
          games: [g1, g2],
          type: 'nearby-venues',
          driveMinutesBetween: driveMin,
          timeFeasible,
          combinedValue: scoreGames([g1, g2], playerMap),
          playerNames: allPlayerNames,
        })
      }
    }
  }

  // Stay-over pass: back-to-back days, different clients, short drive.
  // A same-day double for the same player set on either date makes the
  // stay-over redundant (they can already be seen in one day).
  const sameDayKeys = new Set(
    doubleUps.map((du) => `${[...du.playerNames].sort().join(',')}|${du.date}`),
  )
  const sortedDates = [...mergedByDate.keys()].sort()
  for (let di = 0; di < sortedDates.length - 1; di++) {
    const d1 = sortedDates[di]!
    const d2 = sortedDates[di + 1]!
    if (daysBetween(d1, d2) !== 1) continue
    for (const g1 of mergedByDate.get(d1)!) {
      for (const g2 of mergedByDate.get(d2)!) {
        const p1 = g1.playerNames.filter(isEligiblePlayer)
        const p2 = g2.playerNames.filter(isEligiblePlayer)
        if (p1.length === 0 || p2.length === 0) continue
        // Same players on consecutive days is just their own series
        if ([...p1].sort().join('|') === [...p2].sort().join('|')) continue

        const distKm = haversineKm(g1.venue.coords, g2.venue.coords)
        const driveMin = distKm < 1 ? 0 : estimateDriveMinutes(g1.venue.coords, g2.venue.coords)
        if (driveMin > MAX_DRIVE_MINUTES) continue

        const allPlayerNames = [...new Set([...p1, ...p2])]
        const playersKey = [...allPlayerNames].sort().join(',')
        if (sameDayKeys.has(`${playersKey}|${d1}`) || sameDayKeys.has(`${playersKey}|${d2}`)) continue

        doubleUps.push({
          date: d1,
          dates: [d1],
          games: [g1, g2],
          type: 'stay-over',
          driveMinutesBetween: driveMin,
          timeFeasible: true, // different days — both games always doable
          combinedValue: scoreGames([g1, g2], playerMap),
          playerNames: allPlayerNames,
        })
      }
    }
  }

  const collapsed = collapseSeries(doubleUps)

  // Sort by combined value descending, then soonest first
  collapsed.sort((a, b) => b.combinedValue - a.combinedValue || a.date.localeCompare(b.date))

  return collapsed
}

/** How close two specific players' schedules come to a double up. Scans
 *  same-day and back-to-back-day game pairs in the range and returns the
 *  minimum venue-to-venue drive. Null = they're never within a day of each
 *  other. Used for the "does X double up with Y?" verdict when a priority
 *  pair has no actual double up. */
export interface PairApproach {
  dateA: string
  dateB: string
  driveMinutes: number
  venueA: string
  venueB: string
}

export function findClosestApproach(
  allGames: GameEvent[],
  nameA: string,
  nameB: string,
  startDate: string,
  endDate: string,
): PairApproach | null {
  const inRange = (g: GameEvent) =>
    g.date >= startDate && g.date <= endDate &&
    g.gameStatus !== 'Cancelled' && g.gameStatus !== 'Postponed'
  const gamesA = allGames.filter((g) => inRange(g) && g.playerNames.includes(nameA))
  const gamesB = allGames.filter((g) => inRange(g) && g.playerNames.includes(nameB))

  let best: PairApproach | null = null
  for (const gA of gamesA) {
    for (const gB of gamesB) {
      if (Math.abs(daysBetween(gA.date, gB.date)) > 1) continue
      const distKm = haversineKm(gA.venue.coords, gB.venue.coords)
      const driveMin = distKm < 1 ? 0 : estimateDriveMinutes(gA.venue.coords, gB.venue.coords)
      if (!best || driveMin < best.driveMinutes) {
        best = { dateA: gA.date, dateB: gB.date, driveMinutes: driveMin, venueA: gA.venue.name, venueB: gB.venue.name }
      }
    }
  }
  return best
}

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Loose team-name equality — tolerates "Florida St." vs "Florida State" style
 *  drift between a school's own schedule and its opponent's listing. */
function teamsMatch(a: string, b: string): boolean {
  const na = normTeam(a)
  const nb = normTeam(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** Which side each tracked player is on. Pro events carry explicit
 *  playerSides; NCAA/HS events are single-school so isHome covers everyone. */
function sidesFor(g: GameEvent): Record<string, 'home' | 'away'> {
  if (g.playerSides) return g.playerSides
  const side: 'home' | 'away' = g.isHome ? 'home' : 'away'
  const out: Record<string, 'home' | 'away'> = {}
  for (const n of g.playerNames) out[n] = side
  return out
}

/** True when two events describe the same physical game (mirrored sources). */
function samePhysicalGame(g1: GameEvent, g2: GameEvent): boolean {
  if (g1.date !== g2.date) return false
  if (haversineKm(g1.venue.coords, g2.venue.coords) >= 1) return false
  return (
    (teamsMatch(g1.homeTeam, g2.homeTeam) && teamsMatch(g1.awayTeam, g2.awayTeam)) ||
    (teamsMatch(g1.homeTeam, g2.awayTeam) && teamsMatch(g1.awayTeam, g2.homeTeam))
  )
}

/** Merge mirrored events (one per tracked school) into single games carrying
 *  both sides' players, so matchup detection can see across them. */
function mergeMirroredEvents(games: GameEvent[]): GameEvent[] {
  const merged: GameEvent[] = []
  for (const g of games) {
    const host = merged.find((m) => samePhysicalGame(m, g))
    if (!host) {
      merged.push({ ...g, playerNames: [...g.playerNames], playerSides: { ...sidesFor(g) } })
      continue
    }
    // The incoming event may list home/away flipped relative to the host
    const flipped = teamsMatch(g.homeTeam, host.awayTeam) && !teamsMatch(g.homeTeam, host.homeTeam)
    const sides = sidesFor(g)
    for (const name of g.playerNames) {
      if (!host.playerNames.includes(name)) host.playerNames.push(name)
      const s = sides[name]
      if (s) host.playerSides![name] = flipped ? (s === 'home' ? 'away' : 'home') : s
    }
  }
  return merged
}

/** Collapse back-to-back repeats of the same opportunity (a home series)
 *  into one entry listing every date. Allows one off-day inside a run. */
function collapseSeries(doubleUps: DoubleUp[]): DoubleUp[] {
  const groups = new Map<string, DoubleUp[]>()
  for (const du of doubleUps) {
    const venues = du.games.map((g) => g.venue.name).sort().join('~')
    const key = `${du.type}|${[...du.playerNames].sort().join(',')}|${venues}`
    const arr = groups.get(key) ?? []
    arr.push(du)
    groups.set(key, arr)
  }

  const out: DoubleUp[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date))
    let run: DoubleUp[] = []
    const flush = () => {
      if (run.length === 0) return
      // Per-date detail survives collapsing so the UI can show each night's
      // start times and feasibility ("which night of the series is best?")
      const occurrences = run.map((r) => ({ date: r.date, games: r.games, timeFeasible: r.timeFeasible }))
      if (run.length === 1) {
        out.push({ ...run[0]!, occurrences })
      } else {
        const first = run[0]!
        out.push({
          ...first,
          dates: run.map((r) => r.date),
          occurrences,
          combinedValue: Math.max(...run.map((r) => r.combinedValue)),
          timeFeasible: run.some((r) => r.timeFeasible === true)
            ? true
            : run.some((r) => r.timeFeasible === null) ? null : false,
        })
      }
      run = []
    }
    for (const du of group) {
      const prev = run[run.length - 1]
      if (prev && daysBetween(prev.date, du.date) > 2) flush()
      run.push(du)
    }
    flush()
  }
  return out
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000,
  )
}

function checkTimeFeasibility(g1: GameEvent, g2: GameEvent, driveMin: number): boolean | null {
  // If either game has no real time info, we can't determine feasibility
  if (!g1.time || !g2.time) return null
  if (g1.source !== 'mlb-api' && g2.source !== 'mlb-api') return null

  const t1 = new Date(g1.time).getTime()
  const t2 = new Date(g2.time).getTime()
  if (isNaN(t1) || isNaN(t2)) return null

  const gapMinutes = Math.abs(t2 - t1) / 60000
  // Need at least 180min (game duration) + drive time between venues
  return gapMinutes >= 180 + driveMin
}

function findTournamentClusters(games: GameEvent[]): GameEvent[][] {
  if (games.length < 3) return []

  // Group games that are all within 5km of each other
  const clusters: GameEvent[][] = []
  const used = new Set<string>()

  for (let i = 0; i < games.length; i++) {
    if (used.has(games[i]!.id)) continue
    const cluster = [games[i]!]
    for (let j = i + 1; j < games.length; j++) {
      if (used.has(games[j]!.id)) continue
      // Check if this game is within 5km of ALL games in the cluster
      const fitsCluster = cluster.every(
        (cg) => haversineKm(cg.venue.coords, games[j]!.venue.coords) <= 5,
      )
      if (fitsCluster) {
        cluster.push(games[j]!)
      }
    }
    if (cluster.length >= 3) {
      for (const g of cluster) used.add(g.id)
      clusters.push(cluster)
    }
  }

  return clusters
}

function scoreGames(games: GameEvent[], playerMap: Map<string, RosterPlayer>): number {
  const seenPlayers = new Set<string>()
  let score = 0
  for (const game of games) {
    for (const name of game.playerNames) {
      if (seenPlayers.has(name)) continue
      seenPlayers.add(name)
      const p = playerMap.get(name)
      if (!p) continue
      const tierWeight = TIER_WEIGHTS[p.tier] ?? 0
      score += tierWeight * Math.max(p.visitsRemaining, 1)
    }
  }
  return score
}
