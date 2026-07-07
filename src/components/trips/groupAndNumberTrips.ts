import type { TripCandidate, FlyInVisit } from '../../types/schedule'

/**
 * Shared trip grouping + numbering logic.
 *
 * Used by BOTH the Priority Player Results / status banner (via findTripNum /
 * findAllTripNums) AND the rendered trip list — so the displayed "Trip #N"
 * matches everywhere. Previously TripPlanner kept two hand-synced copies of
 * this (a useMemo and the render path) and they diverged twice:
 * - 2026-06-08: "Cade Doughty → Trip #8" pointed at the wrong card because
 *   one copy didn't account for alt-date merging.
 * - 2026-06-09: "Cebert is in all trips so why does it say Trip 1?"
 *
 * Semantics (must match what the card list actually renders):
 * 1. Sort all items by score desc, priority-bearing items first when
 *    priority players are set.
 * 2. Group identical trips (same player set + venue coords) — the primary
 *    is the best-scored variant; the rest become date alternatives.
 * 3. If sorting by date, re-sort the GROUPS by the primary's date.
 * 4. Number groups sequentially — that number is the "Trip #N" shown.
 */

export type UnifiedTripItem =
  | { type: 'road'; trip: TripCandidate; sortDate: string }
  | { type: 'flyin'; visit: FlyInVisit; sortDate: string }

export type TripGroup = {
  primary: UnifiedTripItem
  alternatives: UnifiedTripItem[] // other date options (best-scored first)
  displayIndex: number // 1-based "Trip #N"
}

export type TripGrouping = {
  /** All items before grouping (used for alt-date merge counts). */
  unified: UnifiedTripItem[]
  /** Grouped + numbered trips, in display order. */
  groups: TripGroup[]
  groupCount: number
  /** First trip number a player appears in (0 = not in any trip). */
  findTripNum: (playerName: string) => number
  /** Every trip number a player appears in. */
  findAllTripNums: (playerName: string) => number[]
}

export function itemPlayerNames(item: UnifiedTripItem): Set<string> {
  if (item.type === 'road') {
    return new Set([
      ...item.trip.anchorGame.playerNames,
      ...item.trip.nearbyGames.flatMap((g) => g.playerNames),
    ])
  }
  return new Set(item.visit.playerNames)
}

export function itemHasPriorityPlayer(item: UnifiedTripItem, prioritySet: Set<string>): boolean {
  if (prioritySet.size === 0) return false
  for (const name of itemPlayerNames(item)) {
    if (prioritySet.has(name)) return true
  }
  return false
}

/** Group signature: type + sorted player names + venue coords (3 decimals). */
export function getGroupKey(item: UnifiedTripItem): string {
  const venue = item.type === 'road' ? item.trip.anchorGame.venue : item.visit.venue
  const venueKey = `${venue.coords.lat.toFixed(3)},${venue.coords.lng.toFixed(3)}`
  return `${item.type === 'road' ? 'road' : 'flyin'}|${[...itemPlayerNames(item)].sort().join(',')}|${venueKey}`
}

function itemScore(item: UnifiedTripItem): number {
  return item.type === 'road'
    ? (item.trip.scoreBreakdown?.finalScore ?? item.trip.visitValue)
    : item.visit.visitValue
}

export function groupAndNumberTrips({
  trips,
  flyInVisits,
  priorityPlayers,
  sortBy,
}: {
  trips: TripCandidate[]
  flyInVisits: FlyInVisit[]
  priorityPlayers: string[]
  sortBy: 'score' | 'date'
}): TripGrouping {
  const unified: UnifiedTripItem[] = [
    ...trips.map((trip): UnifiedTripItem => ({ type: 'road', trip, sortDate: trip.anchorGame.date })),
    ...flyInVisits.map((visit): UnifiedTripItem => ({ type: 'flyin', visit, sortDate: visit.dates[0] ?? '' })),
  ]

  // Sort: priority-bearing first (when priority set), then by score desc.
  // Grouping below picks the best-scored variant as each group's primary.
  const prioritySet = new Set(priorityPlayers)
  unified.sort((a, b) => {
    if (prioritySet.size > 0) {
      const ap = itemHasPriorityPlayer(a, prioritySet) ? 0 : 1
      const bp = itemHasPriorityPlayer(b, prioritySet) ? 0 : 1
      if (ap !== bp) return ap - bp
    }
    return itemScore(b) - itemScore(a)
  })

  // Group identical trips (same players + destination) into one card with
  // date alternatives. Insertion order = score order, so primary is best.
  const groupMap = new Map<string, { primary: UnifiedTripItem; alternatives: UnifiedTripItem[] }>()
  const groupOrder: string[] = []
  for (const item of unified) {
    const key = getGroupKey(item)
    const existing = groupMap.get(key)
    if (existing) {
      existing.alternatives.push(item)
    } else {
      groupMap.set(key, { primary: item, alternatives: [] })
      groupOrder.push(key)
    }
  }
  const grouped = groupOrder.map((k) => groupMap.get(k)!)

  if (sortBy === 'date') {
    grouped.sort((a, b) => a.primary.sortDate.localeCompare(b.primary.sortDate))
  }
  // (score sort is already applied — primary is the best-scored variant)

  const groups: TripGroup[] = grouped.map((g, i) => ({ ...g, displayIndex: i + 1 }))

  // Player → trip number maps. Track first occurrence AND every trip the
  // player appears in (so the status banner can show "Trips #1, #2, #4").
  const playerToTripNum = new Map<string, number>()
  const playerToAllTripNums = new Map<string, number[]>()
  for (const group of groups) {
    for (const name of itemPlayerNames(group.primary)) {
      if (!playerToTripNum.has(name)) playerToTripNum.set(name, group.displayIndex)
      const arr = playerToAllTripNums.get(name) ?? []
      arr.push(group.displayIndex)
      playerToAllTripNums.set(name, arr)
    }
  }

  return {
    unified,
    groups,
    groupCount: groups.length,
    findTripNum: (playerName: string) => playerToTripNum.get(playerName) ?? 0,
    findAllTripNums: (playerName: string) => playerToAllTripNums.get(playerName) ?? [],
  }
}
