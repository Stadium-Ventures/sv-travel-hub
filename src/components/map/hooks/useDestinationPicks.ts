import { useMemo } from 'react'
import type { TierMarker } from './useTierMarkers'
import type { Coordinates } from '../../../types/roster'
import { haversineKm } from '../../../lib/tripEngine'

const TIER_WEIGHTS: Record<number, number> = { 1: 5, 2: 3, 3: 1, 4: 0 }

/** Result row for the "Where to go?" panel — a candidate destination
 *  centered on a high-density venue, with everything reachable nearby. */
export interface DestinationPick {
  /** Lat/lng of the seed venue used as the cluster center. */
  centroid: Coordinates
  /** Friendly label for the destination — nearest known city + state. */
  label: string
  /** All SV players reachable from this destination within clusterRadius. */
  players: Array<{ name: string; tier: number }>
  /** Tier-weighted score (T1=5, T2=3, T3=1) used to rank. */
  score: number
  /** Counts by tier for the summary card. */
  t1Count: number
  t2Count: number
  t3Count: number
  /** Number of distinct venues bundled into this destination. */
  venueCount: number
  /** Estimated one-way drive minutes from the user's current home base. */
  driveFromHomeMin: number
  /** Estimated one-way flight time in hours from the user's current home
   *  base (great-circle / 500mph + 1h overhead). */
  flightHoursFromHome: number
  /** Whether driving from home is realistic (under driveCapMin). */
  drivable: boolean
}

function estimateDriveMinutes(from: Coordinates, to: Coordinates): number {
  const km = haversineKm(from, to)
  return (km * 1.2 / 95) * 60
}

function estimateFlightHours(from: Coordinates, to: Coordinates): number {
  const km = haversineKm(from, to)
  const miles = km * 0.621371
  // 500mph cruise + 1h overhead for taxi/climb/descent.
  return miles / 500 + 1
}

/** Friendly label for a destination. Picks the nearest US city from a
 *  curated set so "Tampa, FL" reads better than raw coordinates. */
const KNOWN_CITIES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Orlando, FL',     lat: 28.5383, lng: -81.3792 },
  { name: 'Tampa, FL',       lat: 27.9506, lng: -82.4572 },
  { name: 'Miami, FL',       lat: 25.7617, lng: -80.1918 },
  { name: 'Jacksonville, FL',lat: 30.3322, lng: -81.6557 },
  { name: 'Atlanta, GA',     lat: 33.7490, lng: -84.3880 },
  { name: 'Charlotte, NC',   lat: 35.2271, lng: -80.8431 },
  { name: 'Raleigh, NC',     lat: 35.7796, lng: -78.6382 },
  { name: 'Nashville, TN',   lat: 36.1627, lng: -86.7816 },
  { name: 'Memphis, TN',     lat: 35.1495, lng: -90.0490 },
  { name: 'New Orleans, LA', lat: 29.9511, lng: -90.0715 },
  { name: 'Houston, TX',     lat: 29.7604, lng: -95.3698 },
  { name: 'Dallas, TX',      lat: 32.7767, lng: -96.7970 },
  { name: 'Austin, TX',      lat: 30.2672, lng: -97.7431 },
  { name: 'Phoenix, AZ',     lat: 33.4484, lng: -112.0740 },
  { name: 'Denver, CO',      lat: 39.7392, lng: -104.9903 },
  { name: 'Albuquerque, NM', lat: 35.0844, lng: -106.6504 },
  { name: 'Las Vegas, NV',   lat: 36.1699, lng: -115.1398 },
  { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  { name: 'San Diego, CA',   lat: 32.7157, lng: -117.1611 },
  { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  { name: 'Sacramento, CA',  lat: 38.5816, lng: -121.4944 },
  { name: 'Portland, OR',    lat: 45.5152, lng: -122.6784 },
  { name: 'Seattle, WA',     lat: 47.6062, lng: -122.3321 },
  { name: 'Chicago, IL',     lat: 41.8781, lng: -87.6298 },
  { name: 'St. Louis, MO',   lat: 38.6270, lng: -90.1994 },
  { name: 'Kansas City, MO', lat: 39.0997, lng: -94.5786 },
  { name: 'Minneapolis, MN', lat: 44.9778, lng: -93.2650 },
  { name: 'Milwaukee, WI',   lat: 43.0389, lng: -87.9065 },
  { name: 'Indianapolis, IN',lat: 39.7684, lng: -86.1581 },
  { name: 'Cincinnati, OH',  lat: 39.1031, lng: -84.5120 },
  { name: 'Cleveland, OH',   lat: 41.4993, lng: -81.6944 },
  { name: 'Detroit, MI',     lat: 42.3314, lng: -83.0458 },
  { name: 'Pittsburgh, PA',  lat: 40.4406, lng: -79.9959 },
  { name: 'Philadelphia, PA',lat: 39.9526, lng: -75.1652 },
  { name: 'New York, NY',    lat: 40.7128, lng: -74.0060 },
  { name: 'Boston, MA',      lat: 42.3601, lng: -71.0589 },
  { name: 'Washington, DC',  lat: 38.9072, lng: -77.0369 },
  { name: 'Baltimore, MD',   lat: 39.2904, lng: -76.6122 },
  { name: 'Birmingham, AL',  lat: 33.5186, lng: -86.8104 },
]

function labelFor(coords: Coordinates): string {
  let best = KNOWN_CITIES[0]!
  let bestKm = Infinity
  for (const c of KNOWN_CITIES) {
    const km = haversineKm(coords, { lat: c.lat, lng: c.lng })
    if (km < bestKm) { bestKm = km; best = c }
  }
  if (bestKm < 50) return best.name           // very close → use city directly
  if (bestKm < 200) return `Near ${best.name}` // regional
  return best.name                              // remote — still anchor to known city
}

/**
 * Generate destination recommendations: for each candidate venue, build a
 * synthetic cluster (that venue + every other reachable venue within
 * clusterRadius), score by tier-weighted player count, and return the top
 * non-overlapping results.
 *
 * Different from useBestWindows: this isn't about WHEN to go — it assumes
 * the date range is fixed. It's about WHERE. The user's homeBase becomes
 * a reference point (for "fly vs drive?" hint), not a constraint.
 */
export function useDestinationPicks(
  tierMarkers: TierMarker[],
  homeBase: Coordinates,
  clusterRadiusMin: number = 180,
  driveCapMin: number = 360,
  topN: number = 5,
): DestinationPick[] {
  return useMemo(() => {
    if (tierMarkers.length === 0) return []

    // Each tier marker is a potential cluster seed. For each, find every
    // other marker within clusterRadius drive-time and union their players.
    type Seed = {
      seed: TierMarker
      players: Map<string, number> // name → tier (best/lowest)
      venueCount: number
    }
    const seeds: Seed[] = []
    for (const seed of tierMarkers) {
      const players = new Map<string, number>()
      let venueCount = 0
      for (const other of tierMarkers) {
        const driveMin = estimateDriveMinutes(seed.coords, other.coords)
        if (driveMin > clusterRadiusMin) continue
        venueCount++
        for (const p of other.players) {
          const existing = players.get(p.name)
          if (existing === undefined || p.tier < existing) {
            players.set(p.name, p.tier)
          }
        }
      }
      if (players.size === 0) continue
      seeds.push({ seed, players, venueCount })
    }

    // Score and rank.
    const scored = seeds.map((s) => {
      let score = 0
      let t1 = 0, t2 = 0, t3 = 0
      const playerArr: Array<{ name: string; tier: number }> = []
      for (const [name, tier] of s.players) {
        playerArr.push({ name, tier })
        score += TIER_WEIGHTS[tier] ?? 0
        if (tier === 1) t1++
        else if (tier === 2) t2++
        else if (tier === 3) t3++
      }
      const driveFromHomeMin = estimateDriveMinutes(homeBase, s.seed.coords)
      return {
        centroid: s.seed.coords,
        label: labelFor(s.seed.coords),
        players: playerArr.sort((a, b) => a.tier - b.tier),
        score,
        t1Count: t1,
        t2Count: t2,
        t3Count: t3,
        venueCount: s.venueCount,
        driveFromHomeMin,
        flightHoursFromHome: estimateFlightHours(homeBase, s.seed.coords),
        drivable: driveFromHomeMin <= driveCapMin,
      } satisfies DestinationPick
    })

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Tie-break: prefer the closer one to the user's home base (less effort).
      return a.driveFromHomeMin - b.driveFromHomeMin
    })

    // Dedupe destinations that overlap by label OR by >60% player set.
    const picked: DestinationPick[] = []
    const usedLabels = new Set<string>()
    const coveredPlayerSets: Array<Set<string>> = []
    for (const r of scored) {
      if (usedLabels.has(r.label)) continue
      const rSet = new Set(r.players.map((p) => p.name))
      const isMostlyContained = coveredPlayerSets.some((prev) => {
        let overlap = 0
        for (const n of rSet) if (prev.has(n)) overlap++
        return rSet.size > 0 && overlap / rSet.size > 0.6
      })
      if (isMostlyContained) continue
      picked.push(r)
      usedLabels.add(r.label)
      coveredPlayerSets.push(rSet)
      if (picked.length >= topN) break
    }
    return picked
  }, [tierMarkers, homeBase, clusterRadiusMin, driveCapMin, topN])
}
