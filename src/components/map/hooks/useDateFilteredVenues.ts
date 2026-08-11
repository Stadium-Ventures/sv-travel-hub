import { useMemo } from 'react'
import { useScheduleStore } from '../../../store/scheduleStore'
import { useVenueStore } from '../../../store/venueStore'

// Spring training runs roughly mid-February through the end of March.
const ST_WINDOW_START = '02-14'
const ST_WINDOW_END = '03-31'

function rangeOverlapsSpringTraining(start: string, end: string): boolean {
  if (!start && !end) return true
  const startYear = parseInt((start || end).slice(0, 4), 10)
  const endYear = parseInt((end || start).slice(0, 4), 10)
  if (Number.isNaN(startYear) || Number.isNaN(endYear)) return true
  for (let y = startYear; y <= endYear; y++) {
    const stStart = `${y}-${ST_WINDOW_START}`
    const stEnd = `${y}-${ST_WINDOW_END}`
    if ((!start || start <= stEnd) && (!end || end >= stStart)) return true
  }
  return false
}

/**
 * Returns a Set of venue keys that have games in the given date range,
 * or null if no date filter is active.
 */
export function useDateFilteredVenues(filterStart: string, filterEnd: string) {
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const venues = useVenueStore((s) => s.venues)

  return useMemo(() => {
    if (!filterStart && !filterEnd) return null

    const keys = new Set<string>()

    // Pro games → match by venue name key
    for (const game of proGames) {
      if (filterStart && game.date < filterStart) continue
      if (filterEnd && game.date > filterEnd) continue
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      keys.add(key)
    }

    // NCAA games → match by coordinate proximity to ncaa venues (~500m)
    for (const game of ncaaGames) {
      if (filterStart && game.date < filterStart) continue
      if (filterEnd && game.date > filterEnd) continue
      for (const [vk, v] of Object.entries(venues)) {
        if (!vk.startsWith('ncaa-')) continue
        const dLat = v.coords.lat - game.venue.coords.lat
        const dLng = v.coords.lng - game.venue.coords.lng
        if (dLat * dLat + dLng * dLng < 0.00002) { keys.add(vk); break }
      }
    }

    // HS games → match by coordinate proximity to hs venues (~500m)
    for (const game of hsGames) {
      if (filterStart && game.date < filterStart) continue
      if (filterEnd && game.date > filterEnd) continue
      for (const [vk, v] of Object.entries(venues)) {
        if (!vk.startsWith('hs-')) continue
        const dLat = v.coords.lat - game.venue.coords.lat
        const dLng = v.coords.lng - game.venue.coords.lng
        if (dLat * dLat + dLng * dLng < 0.00002) { keys.add(vk); break }
      }
    }

    // ST venues have no per-game schedule data, so gate them on the season
    // instead: only show complexes when the range overlaps spring training.
    // Otherwise empty Cactus/Grapefruit sites flood "Where to go" with
    // players who have no games (Tom 2026-08-11, the Myles Bailey case).
    if (rangeOverlapsSpringTraining(filterStart, filterEnd)) {
      for (const vk of Object.keys(venues)) {
        if (vk.startsWith('st-')) keys.add(vk)
      }
    }

    return keys
  }, [filterStart, filterEnd, proGames, ncaaGames, hsGames, venues])
}
