// Parses the Summer Ball Placement Google Sheet (published as CSV) into a
// player -> summer team assignment map.
//
// Row parsing lives in api/_data/summerLeagues.ts (parseSummerPlacementRows)
// so the health monitor reads the sheet exactly the way the app does.

import Papa from 'papaparse'
import { fetchWithTimeout } from './fetchWithTimeout'
import type { SummerPlacementRow } from '../data/summerLeagues'
import { parseSummerPlacementRows } from '../data/summerLeagues'

const SUMMER_CSV_URL = import.meta.env.VITE_SUMMER_CSV_URL as string | undefined

export type SummerAssignment = SummerPlacementRow

export interface SummerAssignmentResult {
  assignments: SummerAssignment[]
  warnings: string[]
  fetchedAt: string
}

export async function fetchSummerAssignments(): Promise<SummerAssignmentResult> {
  if (!SUMMER_CSV_URL) {
    throw new Error('VITE_SUMMER_CSV_URL is not configured. Add it to your .env file.')
  }

  const res = await fetchWithTimeout(SUMMER_CSV_URL, { timeoutMs: 10000 })
  if (!res.ok) throw new Error(`Summer assignments fetch failed: ${res.status}`)
  const text = await res.text()

  // Parse without headers — the sheet uses repeated section headers, so we
  // walk rows by position.
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })
  const { placements: assignments, warnings } = parseSummerPlacementRows(parsed.data)

  return {
    assignments,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}
