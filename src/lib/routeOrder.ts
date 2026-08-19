import { estimateDriveMinutes } from './tripEngine'
import type { TripCandidate } from '../types/schedule'

interface Coordinates {
  lat: number
  lng: number
}

// Trip stops are ordered for the DRIVE, not the clock (Tom 2026-08-19).
// Kent visits players around the games — coffee, meals — and rarely attends
// every first pitch, so first-pitch order produced zig-zags (Jupiter →
// Tampa → Port St. Lucie, 6h+ of driving where 3.5h covers the same parks).
// Within each day the venues are sequenced for the shortest total drive,
// starting from the previous day's last stop. Game times stay on each line
// so the reader can still judge what's catchable.

function coordKey(c: Coordinates): string {
  return `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
}

/** Cheapest visiting order for a day's venues. Brute force for the tiny
 *  counts trips actually have (≤5 unique venues/day); greedy
 *  nearest-neighbor beyond that. `start` = previous day's last stop, or
 *  null on the first day (free choice of starting venue). */
function orderVenues(keys: string[], coords: Map<string, Coordinates>, start: Coordinates | null): string[] {
  if (keys.length <= 1) return keys

  const drive = (a: Coordinates, b: Coordinates) => estimateDriveMinutes(a, b)

  if (keys.length <= 5) {
    let best: string[] = keys
    let bestCost = Infinity
    const permute = (remaining: string[], path: string[], cost: number) => {
      if (cost >= bestCost) return
      if (remaining.length === 0) {
        bestCost = cost
        best = path
        return
      }
      for (let i = 0; i < remaining.length; i++) {
        const k = remaining[i]!
        const from = path.length > 0 ? coords.get(path[path.length - 1]!)! : start
        const legCost = from ? drive(from, coords.get(k)!) : 0
        permute([...remaining.slice(0, i), ...remaining.slice(i + 1)], [...path, k], cost + legCost)
      }
    }
    permute(keys, [], 0)
    return best
  }

  // Greedy nearest-neighbor for improbably long days
  const remaining = new Set(keys)
  const ordered: string[] = []
  let from = start
  while (remaining.size > 0) {
    let pick: string | null = null
    let pickCost = Infinity
    for (const k of remaining) {
      const c = from ? drive(from, coords.get(k)!) : 0
      if (c < pickCost) { pickCost = c; pick = k }
    }
    ordered.push(pick!)
    remaining.delete(pick!)
    from = coords.get(pick!)!
  }
  return ordered
}

/** Reorder stop lines (one per game) so each day runs its venues in the
 *  shortest-drive sequence, chaining day to day. Lines at the same venue on
 *  the same day keep their relative (time) order. */
export function orderLinesByDrive<T extends { date: string; coords: Coordinates }>(lines: T[]): T[] {
  const dates = [...new Set(lines.map((l) => l.date))].sort()
  const out: T[] = []
  let prevEnd: Coordinates | null = null
  for (const date of dates) {
    const dayLines = lines.filter((l) => l.date === date)
    const venueKeys: string[] = []
    const venueCoords = new Map<string, Coordinates>()
    for (const l of dayLines) {
      const k = coordKey(l.coords)
      if (!venueCoords.has(k)) {
        venueKeys.push(k)
        venueCoords.set(k, l.coords)
      }
    }
    const orderedKeys = orderVenues(venueKeys, venueCoords, prevEnd)
    for (const k of orderedKeys) {
      out.push(...dayLines.filter((l) => coordKey(l.coords) === k))
    }
    prevEnd = venueCoords.get(orderedKeys[orderedKeys.length - 1]!) ?? prevEnd
  }
  return out
}

/** Unique venues of a trip in drive order — the map's numbered stops. Must
 *  match the trip card's line order (they disagreed before: card sorted by
 *  first pitch, map drew anchor-first). */
export function orderedTripStops(trip: TripCandidate): Array<{ lat: number; lng: number; name: string }> {
  const lines = [trip.anchorGame, ...trip.nearbyGames].map((g) => ({
    date: g.date,
    coords: g.venue.coords,
    name: g.venue.name,
  }))
  const ordered = orderLinesByDrive(lines)
  const seen = new Set<string>()
  const stops: Array<{ lat: number; lng: number; name: string }> = []
  for (const l of ordered) {
    const k = coordKey(l.coords)
    if (seen.has(k)) continue
    seen.add(k)
    stops.push({ lat: l.coords.lat, lng: l.coords.lng, name: l.name })
  }
  return stops
}
