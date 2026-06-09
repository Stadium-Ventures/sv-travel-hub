import { useCallback } from 'react'
import { useTripStore } from '../../../store/tripStore'

// Map date range is now a thin wrapper over tripStore so Map and Trip Planner
// share a single date window — Kent's 2026-06-08 ask: "filter parity needs to
// exist between the map and trip planner tab." Picking dates on either surface
// updates the other.

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]!
}

function next7Days(): { start: string; end: string } {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 7)
  return { start: toISO(now), end: toISO(end) }
}

function next30Days(): { start: string; end: string } {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 30)
  return { start: toISO(now), end: toISO(end) }
}

export function useMapDateRange() {
  const filterStart = useTripStore((s) => s.startDate)
  const filterEnd = useTripStore((s) => s.endDate)
  const setDateRange = useTripStore((s) => s.setDateRange)

  const setFilterStart = useCallback((v: string) => setDateRange(v, filterEnd), [setDateRange, filterEnd])
  const setFilterEnd = useCallback((v: string) => setDateRange(filterStart, v), [setDateRange, filterStart])

  const setNext7Days = useCallback(() => {
    const r = next7Days()
    setDateRange(r.start, r.end)
  }, [setDateRange])

  const setNext30Days = useCallback(() => {
    const r = next30Days()
    setDateRange(r.start, r.end)
  }, [setDateRange])

  // Retained for API compatibility — now a no-op because we ARE the trip range.
  const syncFromTrip = useCallback(() => { /* unified — nothing to sync */ }, [])

  return {
    filterStart,
    filterEnd,
    setFilterStart,
    setFilterEnd,
    setNext7Days,
    setNext30Days,
    syncFromTrip,
  }
}
