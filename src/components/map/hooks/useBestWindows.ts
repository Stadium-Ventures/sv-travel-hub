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
 * Strategy controls how Best Windows are ranked. The underlying window
 * computation is unchanged; only the final sort + tie-breakers differ.
 *  - impact:     tier-weighted score (default — overall value of the window)
 *  - t1-count:   most T1 players in one trip (Kent's "T1 cluster" ask)
 *  - overdue-priority: prioritize windows that catch overdue T1/T2 players
 *  - player-count: maximize unique player coverage regardless of tier
 *  - tuesday:    Tuesday-bearing windows first (Kent's MiLB position-player rule)
 */
export type BestWindowStrategy = 'impact' | 't1-count' | 'overdue-priority' | 'player-count' | 'tuesday'

export function useBestWindows(
  tierMarkers: TierMarker[],
  homeBase: Coordinates,
  maxDriveMinutes: number,
  filterStart: string,
  filterEnd: string,
  windowDays = 3,
  topN = 5,
  strategy: BestWindowStrategy = 'impact',
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
      // Clamp the final window to the range end instead of skipping it —
      // breaking meant a range shorter than windowDays produced no windows
      // at all, and the trailing days could never start one.
      const rawEnd = addDays(current, windowDays - 1)
      const windowEnd = rawEnd > filterEnd ? filterEnd : rawEnd

      // Skip windows that are entirely on Sunday
      const startDow = getDayOfWeek(current)
      if (current === windowEnd && startDow === 0) {
        current = addDays(current, 1)
        continue
      }

      // Collect unique players across all days in the window
      const windowPlayers = new Map<string, number>() // name → tier
      let hasTuesday = false
      let daysInWindow = 0
      let d = current
      while (d <= windowEnd) {
        daysInWindow++
        if (getDayOfWeek(d) === 0) { d = addDays(d, 1); continue } // skip Sunday
        const dayPlayers = datePlayerMap.get(d)
        // Tuesday bonus only counts when there are actual players/games on
        // that Tuesday — a bare Tuesday date in the window is worth nothing
        if (getDayOfWeek(d) === 2 && dayPlayers && dayPlayers.size > 0) hasTuesday = true
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
        while (dWalk <= windowEnd) {
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
          days: daysInWindow,
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

    // Strategy-driven sort. Every strategy uses tierWeightedScore as the
    // tie-breaker so windows with identical primary metric still order
    // sensibly by overall value.
    function overdueHighPriCount(w: WindowResult): number {
      let n = 0
      for (const p of w.players) {
        if (p.tier <= 2 && isOverdue(p.name)) n++
      }
      return n
    }
    results.sort((a, b) => {
      switch (strategy) {
        case 't1-count':
          if (b.t1Count !== a.t1Count) return b.t1Count - a.t1Count
          return b.tierWeightedScore - a.tierWeightedScore
        case 'overdue-priority': {
          const ao = overdueHighPriCount(a), bo = overdueHighPriCount(b)
          if (bo !== ao) return bo - ao
          return b.tierWeightedScore - a.tierWeightedScore
        }
        case 'player-count':
          if (b.uniquePlayerCount !== a.uniquePlayerCount) return b.uniquePlayerCount - a.uniquePlayerCount
          return b.tierWeightedScore - a.tierWeightedScore
        case 'tuesday':
          if (a.hasTuesday !== b.hasTuesday) return a.hasTuesday ? -1 : 1
          return b.tierWeightedScore - a.tierWeightedScore
        case 'impact':
        default:
          return b.tierWeightedScore - a.tierWeightedScore
      }
    })

    // Strategy-aware dedupe. We drop a candidate window only if it doesn't
    // add anything new *in the dimension the user is optimizing for*. Without
    // this, picking "Most T1" or "Overdue priority" returned the same windows
    // as "Highest overall impact" — the dedupe would drop a high-T1 window
    // because its players overlapped the top pick's, even though it brought
    // new T1 coverage. The "novel" check is now strategy-driven.
    function novelCount(r: WindowResult, coveredKeys: Set<string>): number {
      switch (strategy) {
        case 't1-count':
          return r.players.filter((p) => p.tier === 1 && !coveredKeys.has(p.name)).length
        case 'overdue-priority':
          return r.players.filter((p) => p.tier <= 2 && isOverdue(p.name) && !coveredKeys.has(p.name)).length
        case 'tuesday':
          // For Tuesday: any new player counts, but ALSO require hasTuesday
          // to even be considered (handled by the pre-filter below).
          return r.players.filter((p) => !coveredKeys.has(p.name)).length
        case 'impact':
        case 'player-count':
        default:
          return r.players.filter((p) => !coveredKeys.has(p.name)).length
      }
    }

    // For 'tuesday' strategy, drop non-Tuesday windows entirely before dedupe
    // so the secondary results don't fall through to non-Tuesday options.
    const candidates = strategy === 'tuesday'
      ? results.filter((r) => r.hasTuesday)
      : results

    const picked: WindowResult[] = []
    const coveredPlayers = new Set<string>()
    for (const r of candidates) {
      const overlaps = picked.some((p) => r.startDate <= p.endDate && r.endDate >= p.startDate)
      if (overlaps) continue
      const novel = novelCount(r, coveredPlayers)
      // Always accept the first window. After that, accept any window that
      // adds at least one new item along the strategy's axis.
      if (picked.length === 0 || novel > 0) {
        picked.push(r)
        for (const p of r.players) coveredPlayers.add(p.name)
        if (picked.length >= topN) break
      }
    }

    return picked
  }, [tierMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays, topN, strategy, proGames, ncaaGames, hsGames, heartbeatPlayers])
}
