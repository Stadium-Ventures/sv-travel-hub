import { useEffect, useRef, useState } from 'react'
import type { Coordinates } from '../../../types/roster'
import { fetchEvents, type SvEvent } from '../../../lib/eventsCsv'
import { geocodeCity } from '../../../lib/geocoding'

export interface EventMarker extends SvEvent {
  coords: Coordinates
}

/**
 * Loads non-game events (SV Summer Coverage sheet), geocodes each city once,
 * and returns markers for events SV physically travels to that overlap the
 * given date range. Self-contained: failures degrade to an empty list so the
 * map never breaks.
 */
export function useEventMarkers(filterStart: string, filterEnd: string): EventMarker[] {
  const [all, setAll] = useState<EventMarker[]>([])
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let cancelled = false

    ;(async () => {
      const events = (await fetchEvents()).filter((e) => e.travels && e.startDate && e.endDate)
      // Geocode unique cities (cached, so cheap after first load).
      const byCity = new Map<string, { city: string; state: string }>()
      for (const e of events) {
        const key = `${e.city}|${e.state}`.toLowerCase()
        if (e.city && !byCity.has(key)) byCity.set(key, { city: e.city, state: e.state })
      }
      const coordsByCity = new Map<string, Coordinates>()
      for (const { city, state } of byCity.values()) {
        const c = await geocodeCity(city, state)
        if (c) coordsByCity.set(`${city}|${state}`.toLowerCase(), c)
        if (cancelled) return
      }
      const markers: EventMarker[] = []
      for (const e of events) {
        const c = coordsByCity.get(`${e.city}|${e.state}`.toLowerCase())
        if (c) markers.push({ ...e, coords: c })
      }
      if (!cancelled) setAll(markers)
    })()

    return () => { cancelled = true }
  }, [])

  // Date overlap: event is visible if its window intersects the selected range.
  return all.filter((e) => e.endDate >= filterStart && e.startDate <= filterEnd)
}
