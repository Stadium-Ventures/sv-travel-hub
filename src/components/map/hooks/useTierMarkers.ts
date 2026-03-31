import { useMemo } from 'react'
import { useVenueStore } from '../../../store/venueStore'
import { useScheduleStore } from '../../../store/scheduleStore'
import type { VenuePlayer } from './useVenuePlayerMap'

export interface TierMarker {
  key: string
  coords: { lat: number; lng: number }
  venueName: string
  bestTier: number
  playerCount: number
  players: Array<{ name: string; tier: number; level: string }>
  gameDates: string[]
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

      // Collect game dates in window for this venue
      const gameDates = new Set<string>()
      const allGames = [...proGames, ...ncaaGames, ...hsGames]
      for (const game of allGames) {
        // Filter to date range
        if (filterStart && game.date < filterStart) continue
        if (filterEnd && game.date > filterEnd) continue
        // Match game to this venue by coordinate proximity
        const dLat = venueInfo.coords.lat - game.venue.coords.lat
        const dLng = venueInfo.coords.lng - game.venue.coords.lng
        if (dLat * dLat + dLng * dLng < 0.00002) {
          gameDates.add(game.date)
        }
      }
      // Also match pro venues by key pattern
      if (key.startsWith('pro-')) {
        for (const game of proGames) {
          if (filterStart && game.date < filterStart) continue
          if (filterEnd && game.date > filterEnd) continue
          const gameKey = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
          if (gameKey === key) gameDates.add(game.date)
        }
      }

      const bestTier = Math.min(...playerList.map((p) => p.tier))

      markers.push({
        key,
        coords: { lat: venueInfo.coords.lat, lng: venueInfo.coords.lng },
        venueName: venueInfo.name,
        bestTier,
        playerCount: playerList.length,
        players: playerList.map((p) => ({ name: p.name, tier: p.tier, level: p.level })),
        gameDates: [...gameDates].sort(),
      })
    }

    return markers
  }, [venues, venuePlayerMap, dateFilteredVenues, filterStart, filterEnd, proGames, ncaaGames, hsGames])
}
