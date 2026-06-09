import { useMemo } from 'react'
import type { TierMarker } from './useTierMarkers'
import type { Coordinates } from '../../../types/roster'
import { useScheduleStore } from '../../../store/scheduleStore'
import { useHeartbeatStore } from '../../../store/heartbeatStore'

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
  /** Approximate count of overlapping-start-time conflicts inside the window
   *  (per-day, across different venues). E.g. 2 venues both starting 5pm
   *  on the same day = 1 conflict. Kent can only attend one of them. */
  timeConflictCount: number
  /** Players in this window who are >90 days overdue OR have no visit on
   *  record (per Heartbeat). Drives a small "N overdue" boost in scoring. */
  overdueCount: number
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
  // Pull all games + heartbeat data so we can detect time conflicts and
  // weight overdue players. Subscribing here means Best Windows updates
  // automatically when schedules or visit data refresh.
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)

  return useMemo(() => {
    if (!filterStart || !filterEnd || tierMarkers.length === 0) return []

    // Pre-filter markers to those within drive radius
    const reachableMarkers = tierMarkers.filter((tm) => {
      const driveMin = estimateDriveMinutes(homeBase, tm.coords)
      return driveMin <= maxDriveMinutes
    })

    if (reachableMarkers.length === 0) return []

    // Quick lookups
    const reachableKeys = new Set(reachableMarkers.map((m) => m.key))
    const allGames = [...proGames, ...ncaaGames, ...hsGames]
    // date → array of hour-of-day start times across DIFFERENT venues
    // (used to flag time-conflict windows)
    const dateVenueStartHours = new Map<string, Array<{ venueKey: string; hour: number }>>()
    for (const g of allGames) {
      if (!g.time) continue
      const hour = new Date(g.time).getUTCHours()
      const venueKey = `${g.venue.coords.lat.toFixed(4)},${g.venue.coords.lng.toFixed(4)}`
      // Skip games whose venue isn't reachable (out of drive radius)
      // Approximation: include if any reachable marker is close
      const inReach = reachableMarkers.some((m) => {
        const dLat = m.coords.lat - g.venue.coords.lat
        const dLng = m.coords.lng - g.venue.coords.lng
        return dLat * dLat + dLng * dLng < 0.00002
      })
      if (!inReach) continue
      const arr = dateVenueStartHours.get(g.date) ?? []
      arr.push({ venueKey, hour })
      dateVenueStartHours.set(g.date, arr)
    }
    // Heartbeat lookup
    const daysSinceByName = new Map<string, number | null>()
    for (const p of heartbeatPlayers) {
      daysSinceByName.set(p.name.trim().toLowerCase(), p.daysSinceInPerson ?? null)
    }
    function isOverdue(name: string): boolean {
      const d = daysSinceByName.get(name.trim().toLowerCase())
      return d == null || d > 90 // null = no visit on record = treat as overdue
    }

    // Build a date → players map from reachable markers
    const datePlayerMap = new Map<string, Map<string, number>>() // date → (playerName → tier)
    for (const tm of reachableMarkers) {
      if (!reachableKeys.has(tm.key)) continue
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

        // Count overdue players in window (>90d since last visit, OR null/no
        // record). Boost score by 10% per overdue player up to +50%.
        const overdueCount = players.filter((p) => isOverdue(p.name)).length

        // Count time-conflicts inside the window: per-day, how many extra
        // venues share the same start hour. (e.g. 3 venues all 5pm on Tue
        // = 2 conflicts. You can only attend 1 of those 3.)
        let timeConflictCount = 0
        let dWalk = current
        for (let i = 0; i < windowDays; i++) {
          const dayStarts = dateVenueStartHours.get(dWalk)
          if (dayStarts) {
            const venuesByHour = new Map<number, Set<string>>()
            for (const ds of dayStarts) {
              const set = venuesByHour.get(ds.hour) ?? new Set()
              set.add(ds.venueKey)
              venuesByHour.set(ds.hour, set)
            }
            for (const set of venuesByHour.values()) {
              if (set.size >= 2) timeConflictCount += set.size - 1
            }
          }
          dWalk = addDays(dWalk, 1)
        }

        // Tuesday bonus (kept)
        if (hasTuesday) tierWeightedScore *= 1.2
        // Overdue boost — small reward for catching slipping players
        if (overdueCount > 0) {
          tierWeightedScore *= (1 + Math.min(0.5, overdueCount * 0.1))
        }
        // Conflict penalty — discount windows where many games overlap in
        // time. Kent can't attend overlapping games, so the "score" was
        // overstated. Penalty caps at 30% off.
        if (timeConflictCount > 0) {
          tierWeightedScore *= Math.max(0.7, 1 - timeConflictCount * 0.07)
        }

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
          timeConflictCount,
          overdueCount,
        })
      }

      current = addDays(current, 1)
    }

    // Sort by score descending, deduplicate overlapping windows (keep best)
    results.sort((a, b) => b.tierWeightedScore - a.tierWeightedScore)

    // Remove windows that overlap with a higher-scored already-picked window,
    // OR that bring no new player coverage vs. the windows already picked.
    // (Kent 2026-06-08: noticed every Best Window listed the same 4 players —
    // mathematically correct given drive radius, visually noisy. We now
    // suppress windows whose player set is fully contained in the union of
    // earlier picks unless they meaningfully differ in date pattern.)
    const picked: WindowResult[] = []
    const coveredPlayers = new Set<string>()
    for (const r of results) {
      const overlaps = picked.some((p) => r.startDate <= p.endDate && r.endDate >= p.startDate)
      if (overlaps) continue
      const newPlayers = r.players.filter((p) => !coveredPlayers.has(p.name))
      // Always accept the first window (best), and any window that adds at
      // least one new player. Skip "same set, different date" duplicates.
      if (picked.length === 0 || newPlayers.length > 0) {
        picked.push(r)
        for (const p of r.players) coveredPlayers.add(p.name)
        if (picked.length >= topN) break
      }
    }

    return picked
  }, [tierMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays, topN, proGames, ncaaGames, hsGames, heartbeatPlayers])
}
