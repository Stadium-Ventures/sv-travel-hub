import { useState, useCallback } from 'react'
import { useTripStore } from '../../../store/tripStore'

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

const defaultRange = next7Days()

export function useMapDateRange() {
  const [filterStart, setFilterStart] = useState(defaultRange.start)
  const [filterEnd, setFilterEnd] = useState(defaultRange.end)

  const setNext7Days = useCallback(() => {
    const r = next7Days()
    setFilterStart(r.start)
    setFilterEnd(r.end)
  }, [])

  const setNext30Days = useCallback(() => {
    const r = next30Days()
    setFilterStart(r.start)
    setFilterEnd(r.end)
  }, [])

  const syncFromTrip = useCallback(() => {
    const { startDate, endDate } = useTripStore.getState()
    setFilterStart(startDate)
    setFilterEnd(endDate)
  }, [])

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
