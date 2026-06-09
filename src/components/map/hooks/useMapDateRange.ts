import { useCallback, useEffect } from 'react'
import { useTripStore } from '../../../store/tripStore'

// Map date range is now a thin wrapper over tripStore so Map and Trip Planner
// share a single date window — Kent's 2026-06-08 ask: "filter parity needs to
// exist between the map and trip planner tab." Picking dates on either surface
// updates the other.

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]!
}

function todayISO(): string {
  return toISO(new Date())
}

// Clamp a date input so it never starts in the past. Persisted trip ranges
// from before today are auto-bumped to today on next interaction.
function clampStart(v: string): string {
  const today = todayISO()
  return v < today ? today : v
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
  const rawStart = useTripStore((s) => s.startDate)
  const rawEnd = useTripStore((s) => s.endDate)
  const setDateRange = useTripStore((s) => s.setDateRange)

  // If the persisted start date is in the past — common after the app sat
  // overnight, or after returning days later — bump it forward to today.
  // We re-run on any change to start/end so post-hydration values get fixed
  // too. No infinite loop: once clamped, the condition is false.
  useEffect(() => {
    const today = todayISO()
    if (rawStart && rawStart < today) {
      const newEnd = rawEnd && rawEnd >= today ? rawEnd : today
      setDateRange(today, newEnd)
    }
  }, [rawStart, rawEnd, setDateRange])

  // Display-time clamp so the inputs NEVER show a past date, even on the
  // very first frame before the bump effect runs.
  const today = todayISO()
  const filterStart = rawStart && rawStart < today ? today : rawStart
  const filterEnd = rawEnd && rawEnd < filterStart ? filterStart : rawEnd

  const setFilterStart = useCallback(
    (v: string) => {
      const start = clampStart(v)
      const end = filterEnd < start ? start : filterEnd
      setDateRange(start, end)
    },
    [setDateRange, filterEnd],
  )
  const setFilterEnd = useCallback(
    (v: string) => {
      const start = clampStart(filterStart)
      const end = v < start ? start : v
      setDateRange(start, end)
    },
    [setDateRange, filterStart],
  )

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
