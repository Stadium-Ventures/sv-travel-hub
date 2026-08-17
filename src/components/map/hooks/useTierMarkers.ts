import { useMemo } from 'react'
import { useVenueStore } from '../../../store/venueStore'
import { useScheduleStore } from '../../../store/scheduleStore'
import type { VenuePlayer } from './useVenuePlayerMap'

/** One game at a marker's venue, for the popup's drill-in list — the
 *  Maptive-style "click the count, see the underlying games" view Mike D
 *  uses as his core workflow (2026-08-17). */
export interface MarkerGame {
  id: string
  date: string
  /** ISO time — only set for real (mlb-api) times */
  time?: string
  /** "vs X" (home) / "@ X" (away) */
  opponent?: string
  players: string[]
  tz?: string
}

export interface TierMarker {
  key: string
  coords: { lat: number; lng: number }
  venueName: string
  bestTier: number
  playerCount: number
  players: Array<{ name: string; tier: number; level: string }>
  gameDates: string[]
  games: MarkerGame[]
}

export const TIER_COLORS: Record<number, string> = {
  1: '#ef4444',
  2: '#f97316',
  3: '#6b7280',
  4: '#4b5563',
}

/**
 * Core transform: venue + player + date data -> TierMarker[] with tier-based colors.
 */
export function useTierMarkers(
  venuePlayerMap: Map<string, VenuePlayer[]>,
  dateFilteredVenues: Set<string> | null,
  filterStart?: string,
  filterEnd?: string,
) {
  const venues = useVenueStore((s) => s.venues)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)

  return useMemo(() => {
    const markers: TierMarker[] = []

    for (const [key, venueInfo] of Object.entries(venues)) {
      // Skip venues without players
      const playerList = venuePlayerMap.get(key)
      if (!playerList || playerList.length === 0) continue

      // Skip venues not in date filter
      if (dateFilteredVenues && !dateFilteredVenues.has(key)) continue

      // Collect game dates in window for this venue, plus which players
      // actually appear in those games — and the games themselves, so the
      // popup can list them (Mike D's drill-in, 2026-08-17).
      const gameDates = new Set<string>()
      const namesInRange = new Set<string>()
      const gamesById = new Map<string, MarkerGame>()
      const addGame = (game: typeof proGames[number]) => {
        gameDates.add(game.date)
        for (const n of game.playerNames) namesInRange.add(n)
        if (!gamesById.has(game.id)) {
          gamesById.set(game.id, {
            id: game.id,
            date: game.date,
            time: game.source === 'mlb-api' && game.time ? game.time : undefined,
            opponent: game.isHome
              ? (game.awayTeam ? `vs ${game.awayTeam}` : undefined)
              : (game.homeTeam ? `@ ${game.homeTeam}` : undefined),
            players: [...game.playerNames],
            tz: game.venue.tz,
          })
        }
      }
      const allGames = [...proGames, ...ncaaGames, ...hsGames]
      for (const game of allGames) {
        // Filter to date range
        if (filterStart && game.date < filterStart) continue
        if (filterEnd && game.date > filterEnd) continue
        // Match game to this venue by coordinate proximity
        const dLat = venueInfo.coords.lat - game.venue.coords.lat
        const dLng = venueInfo.coords.lng - game.venue.coords.lng
        if (dLat * dLat + dLng * dLng < 0.00002) {
          addGame(game)
        }
      }
      // Also match pro venues by key pattern
      if (key.startsWith('pro-')) {
        for (const game of proGames) {
          if (filterStart && game.date < filterStart) continue
          if (filterEnd && game.date > filterEnd) continue
          const gameKey = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
          if (gameKey === key) {
            addGame(game)
          }
        }
      }

      // Pro venue player lists are a union over the WHOLE loaded schedule,
      // so with a date filter active, keep only players who actually have a
      // game here in the window — otherwise a player whose team visited in
      // May haunts an August marker (and "Where to go" inherits the ghost).
      // NCAA/HS/ST venues keep their roster-based lists: a school venue with
      // games in range means its roster players are playing.
      let visiblePlayers = playerList
      if (key.startsWith('pro-') && (filterStart || filterEnd)) {
        visiblePlayers = playerList.filter((p) => namesInRange.has(p.name))
        if (visiblePlayers.length === 0) continue
      }

      const bestTier = Math.min(...visiblePlayers.map((p) => p.tier))

      markers.push({
        key,
        coords: { lat: venueInfo.coords.lat, lng: venueInfo.coords.lng },
        venueName: venueInfo.name,
        bestTier,
        playerCount: visiblePlayers.length,
        players: visiblePlayers.map((p) => ({ name: p.name, tier: p.tier, level: p.level })),
        gameDates: [...gameDates].sort(),
        games: [...gamesById.values()].sort(
          (a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''),
        ),
      })
    }

    return markers
  }, [venues, venuePlayerMap, dateFilteredVenues, filterStart, filterEnd, proGames, ncaaGames, hsGames])
}
