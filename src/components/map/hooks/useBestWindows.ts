import { useMemo } from 'react'
import type { TierMarker } from './useTierMarkers'
import type { Coordinates } from '../../../types/roster'

const TIER_WEIGHTS: Record<number, number> = { 1: 5, 2: 3, 3: 1, 4: 0 }

export interface WindowResult {
  startDate: string // ISO
  endDate: string   // ISO
  days: number
  players: Array<{ name: string; tier: number }>
  uniquePlayerCount: number
  tierWeightedScore: number
  t1Count: number
  t2Count: number
  t3Count: number
  hasTuesday: boolean
}

function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function estimateDriveMinutes(from: Coordinates, to: Coordinates): number {
  const km = haversineKm(from, to)
  return (km * 1.2 / 95) * 60 // 1.2x detour factor, 95 km/h average
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay()
}

/**
 * Slide a window of `windowDays` across the date range, scoring each by
 * tier-weighted unique player count at venues within drive radius.
 * Returns top N results.
 */
export function useBestWindows(
  tierMarkers: TierMarker[],
  homeBase: Coordinates,
  maxDriveMinutes: number,
  filterStart: string,
  filterEnd: string,
  windowDays = 3,
  topN = 5,
): WindowResult[] {
  return useMemo(() => {
    if (!filterStart || !filterEnd || tierMarkers.length === 0) return []

    // Pre-filter markers to those within drive radius
    const reachableMarkers = tierMarkers.filter((tm) => {
      const driveMin = estimateDriveMinutes(homeBase, tm.coords)
      return driveMin <= maxDriveMinutes
    })

    if (reachableMarkers.length === 0) return []

    // Build a date → players map from reachable markers
    const datePlayerMap = new Map<string, Map<string, number>>() // date → (playerName → tier)
    for (const tm of reachableMarkers) {
      for (const date of tm.gameDates) {
        if (date < filterStart || date > filterEnd) continue
        let playerMap = datePlayerMap.get(date)
        if (!playerMap) {
          playerMap = new Map()
          datePlayerMap.set(date, playerMap)
        }
        for (const p of tm.players) {
          const existing = playerMap.get(p.name)
          if (existing === undefined || p.tier < existing) {
            playerMap.set(p.name, p.tier)
          }
        }
      }
    }

    // Slide window across date range
    const results: WindowResult[] = []
    let current = filterStart

    while (current <= filterEnd) {
      const windowEnd = addDays(current, windowDays - 1)
      if (windowEnd > filterEnd) break

      // Skip windows that are entirely on Sunday
      const startDow = getDayOfWeek(current)
      if (windowDays === 1 && startDow === 0) {
        current = addDays(current, 1)
        continue
      }

      // Collect unique players across all days in the window
      const windowPlayers = new Map<string, number>() // name → tier
      let hasTuesday = false
      let d = current
      for (let i = 0; i < windowDays; i++) {
        if (getDayOfWeek(d) === 0) { d = addDays(d, 1); continue } // skip Sunday
        if (getDayOfWeek(d) === 2) hasTuesday = true
        const dayPlayers = datePlayerMap.get(d)
        if (dayPlayers) {
          for (const [name, tier] of dayPlayers) {
            const existing = windowPlayers.get(name)
            if (existing === undefined || tier < existing) {
              windowPlayers.set(name, tier)
            }
          }
        }
        d = addDays(d, 1)
      }

      if (windowPlayers.size > 0) {
        let tierWeightedScore = 0
        let t1 = 0, t2 = 0, t3 = 0
        const players: Array<{ name: string; tier: number }> = []

        for (const [name, tier] of windowPlayers) {
          players.push({ name, tier })
          tierWeightedScore += TIER_WEIGHTS[tier] ?? 0
          if (tier === 1) t1++
          if (tier === 2) t2++
          if (tier === 3) t3++
        }

        // Tuesday bonus
        if (hasTuesday) tierWeightedScore *= 1.2

        results.push({
          startDate: current,
          endDate: windowEnd,
          days: windowDays,
          players: players.sort((a, b) => a.tier - b.tier),
          uniquePlayerCount: windowPlayers.size,
          tierWeightedScore,
          t1Count: t1,
          t2Count: t2,
          t3Count: t3,
          hasTuesday,
        })
      }

      current = addDays(current, 1)
    }

    // Sort by score descending, deduplicate overlapping windows (keep best)
    results.sort((a, b) => b.tierWeightedScore - a.tierWeightedScore)

    // Remove windows that overlap with a higher-scored window already picked
    const picked: WindowResult[] = []
    for (const r of results) {
      const overlaps = picked.some((p) => r.startDate <= p.endDate && r.endDate >= p.startDate)
      if (!overlaps) {
        picked.push(r)
        if (picked.length >= topN) break
      }
    }

    return picked
  }, [tierMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays, topN])
}
