import type { GameEvent, DoubleUp } from '../types/schedule'
import type { RosterPlayer } from '../types/roster'
import { haversineKm, estimateDriveMinutes, TIER_WEIGHTS } from './tripEngine'

/**
 * Find double-up opportunities: dates where 2+ SV-relevant games can be attended.
 *
 * Types:
 * - nearby-venues: two games at different venues within 60min drive, with enough time gap
 * - same-venue-matchup: two SV players on opposing teams in the same game
 * - tournament-cluster: 3+ games within 5km on the same day
 */
export function findDoubleUps(
  allGames: GameEvent[],
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  filterPlayerNames?: string[],
  filterTiers?: number[],
): DoubleUp[] {
  const playerMap = new Map(players.map((p) => [p.playerName, p]))

  // Filter games to date range and eligible players
  const eligible = allGames.filter((g) => {
    if (g.date < startDate || g.date > endDate) return false
    if (g.gameStatus === 'Cancelled' || g.gameStatus === 'Postponed') return false
    return g.playerNames.some((n) => {
      const p = playerMap.get(n)
      if (!p || p.visitsRemaining <= 0) return false
      if (filterPlayerNames && filterPlayerNames.length > 0 && !filterPlayerNames.includes(n)) return false
      if (filterTiers && filterTiers.length > 0 && !filterTiers.includes(p.tier)) return false
      return true
    })
  })

  // Group games by date
  const byDate = new Map<string, GameEvent[]>()
  for (const g of eligible) {
    const arr = byDate.get(g.date) ?? []
    arr.push(g)
    byDate.set(g.date, arr)
  }

  const doubleUps: DoubleUp[] = []

  for (const [date, games] of byDate) {
    if (games.length < 2) continue

    // Check for same-venue matchups (two SV players on opposing teams)
    const matchups = findSameVenueMatchups(games, playerMap)
    for (const m of matchups) {
      doubleUps.push({
        date,
        games: [m.game],
        type: 'same-venue-matchup',
        driveMinutesBetween: 0,
        timeFeasible: true,
        combinedValue: scoreGames([m.game], playerMap),
        playerNames: m.playerNames,
      })
    }

    // Check for tournament clusters (3+ games within 5km)
    const clusters = findTournamentClusters(games)
    for (const cluster of clusters) {
      const allPlayerNames = [...new Set(cluster.flatMap((g) => g.playerNames))]
      doubleUps.push({
        date,
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

        // Skip if same venue (within 1km) — handled by matchup/cluster detection
        const distKm = haversineKm(g1.venue.coords, g2.venue.coords)
        if (distKm < 1) continue

        // Skip if both already in a tournament cluster
        if (clusteredGameIds.has(g1.id) && clusteredGameIds.has(g2.id)) continue

        const driveMin = estimateDriveMinutes(g1.venue.coords, g2.venue.coords)
        if (driveMin > 60) continue

        // Time feasibility: need at least 180min (game) + drive time gap
        const timeFeasible = checkTimeFeasibility(g1, g2, driveMin)

        const allPlayerNames = [...new Set([...g1.playerNames, ...g2.playerNames])]
        doubleUps.push({
          date,
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

  // Sort by combined value descending
  doubleUps.sort((a, b) => b.combinedValue - a.combinedValue)

  return doubleUps
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

function findSameVenueMatchups(
  games: GameEvent[],
  playerMap: Map<string, RosterPlayer>,
): Array<{ game: GameEvent; playerNames: string[] }> {
  const results: Array<{ game: GameEvent; playerNames: string[] }> = []

  for (const game of games) {
    // Check if we have SV players on BOTH sides of this game
    const homePlayers: string[] = []
    const awayPlayers: string[] = []

    for (const name of game.playerNames) {
      const p = playerMap.get(name)
      if (!p) continue
      // Determine which team the player is on based on org matching
      if (game.isHome) {
        // The "tracked" team is the home team; if player's org matches away team, they're on away side
        // Simple heuristic: check if the player org matches homeTeam or awayTeam
        if (p.org.toLowerCase().includes(game.awayTeam.toLowerCase()) ||
            game.awayTeam.toLowerCase().includes(p.org.toLowerCase())) {
          awayPlayers.push(name)
        } else {
          homePlayers.push(name)
        }
      } else {
        if (p.org.toLowerCase().includes(game.homeTeam.toLowerCase()) ||
            game.homeTeam.toLowerCase().includes(p.org.toLowerCase())) {
          homePlayers.push(name)
        } else {
          awayPlayers.push(name)
        }
      }
    }

    if (homePlayers.length > 0 && awayPlayers.length > 0) {
      results.push({
        game,
        playerNames: [...homePlayers, ...awayPlayers],
      })
    }
  }

  return results
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
