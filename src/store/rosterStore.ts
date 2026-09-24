import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RosterPlayer } from '../types/roster'
import { fetchRoster as fetchSheetRoster } from '../lib/csv'
import { getRosterSource, getRosterSourceOrNull, type RosterSource } from '../lib/rosterSource'
import {
  fetchRegistryRoster,
  RosterAuthError,
  DEFAULT_MIN_ROWS,
  DEFAULT_REGISTRY_ROSTER_URL,
} from '../lib/registryRoster'
import { getIdToken, invalidateIdToken } from '../lib/googleAuth'
import { applyOverrides, pruneOverrides, overrideKeyForName, playerKey, type VisitOverride } from './rosterOverrides'
import { useDiagnosticsStore } from './diagnosticsStore'
import { ROSTER_PERSIST_VERSION, migrateRosterPersist, scrubPlayer } from './rosterPersist'
// Cycles with the stores below (they import us) — safe under ESM because
// both sides only ACCESS the binding at runtime, never at module init (same
// pattern as the scheduleStore ↔ rehabStore cycle).
import { useScheduleStore } from './scheduleStore'
import { useTripStore } from './tripStore'
import { useRehabStore } from './rehabStore'
import { useSummerStore } from './summerStore'

export type SortField = 'playerName' | 'tier' | 'org' | 'daysSince'
export type SortDir = 'asc' | 'desc'

interface RosterState {
  players: RosterPlayer[]
  loading: boolean
  error: string | null
  lastFetchedAt: string | null
  /** Which source produced `players` (null until the first successful load). */
  source: RosterSource | null
  /** Registry build time (_meta.generated_at). Null on the sheet source. */
  generatedAt: string | null
  /** Registry source only: no usable Google ID token, show the sign-in prompt. */
  needsSignIn: boolean
  parseWarnings: string[]
  visitOverrides: Record<string, VisitOverride> // playerKey (slug, else playerName) → override
  sortColumn: SortField
  sortDirection: SortDir

  fetchRoster: () => Promise<void>
  setVisitOverride: (playerName: string, visitsCompleted: number, lastVisitDate: string | null) => void
  clearVisitOverride: (playerName: string) => void
  setSortColumn: (column: SortField) => void
  setSortDirection: (dir: SortDir) => void
}

function registryUrl(): string {
  return (import.meta.env.VITE_REGISTRY_ROSTER_URL as string | undefined) || DEFAULT_REGISTRY_ROSTER_URL
}

function minRows(): number {
  const n = parseInt((import.meta.env.VITE_ROSTER_MIN_ROWS as string | undefined) ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_ROWS
}

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      players: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      source: null,
      generatedAt: null,
      needsSignIn: false,
      parseWarnings: [],
      visitOverrides: {},
      sortColumn: 'tier',
      sortDirection: 'asc',

      fetchRoster: async () => {
        if (get().loading) return
        set({ loading: true, error: null, parseWarnings: [] })
        let source: RosterSource | null = null
        try {
          source = getRosterSource()
          // ROSTER_SOURCE switch. The registry branch NEVER falls back to the
          // sheet: a failure keeps the previous roster and shows the error.
          const result = source === 'registry'
            ? await fetchRegistryRoster({ url: registryUrl(), getToken: getIdToken, minRows: minRows() })
            : { ...(await fetchSheetRoster()), generatedAt: null }
          // Zero players from a "successful" fetch is a failure in disguise
          // (wrong document, shifted columns). Keep whatever roster we had
          // and surface the problem instead of stamping a fresh timestamp.
          if (result.players.length === 0) {
            set({ loading: false, error: source === 'registry'
              ? 'Registry roster returned 0 players'
              : 'Roster sheet parsed to 0 players — sheet unreachable or columns changed' })
            return
          }
          // Prune stale visitOverrides for players no longer on the roster
          // (and move name-keyed ones onto the slug when the registry has one).
          const prunedOverrides = pruneOverrides(get().visitOverrides, result.players)
          const players = applyOverrides(result.players, prunedOverrides)
          set({
            players,
            loading: false,
            lastFetchedAt: new Date().toISOString(),
            source,
            generatedAt: result.generatedAt,
            needsSignIn: false,
            parseWarnings: result.warnings,
            visitOverrides: prunedOverrides,
          })

          // Removed from the master sheet = removed from the app (Tom
          // 2026-08-17). Persisted names outlive the roster otherwise —
          // team assignments keep stamping ex-clients onto games, and
          // priority picks / rehab windows / summer assignments keep
          // surfacing them elsewhere. Prune every persisted name store
          // against the fresh roster.
          useScheduleStore.getState().pruneRemovedPlayers()
          useTripStore.getState().pruneRemovedPlayers()
          useRehabStore.getState().pruneRemovedPlayers()
          useSummerStore.getState().pruneRemovedPlayers()

          // Diagnostics
          const diag = useDiagnosticsStore.getState()
          diag.clearSource('roster')
          if (result.warnings.length > 0) {
            for (const warning of result.warnings) {
              diag.addIssue({
                level: 'warning',
                source: 'roster',
                message: warning,
              })
            }
          }
        } catch (e) {
          if (e instanceof RosterAuthError) {
            // 401 = the registry rejected a token we thought was fresh.
            if (e.status === 401) invalidateIdToken()
            set({ loading: false, needsSignIn: true, error: e.message })
            return
          }
          set({ loading: false, error: e instanceof Error ? e.message : 'Unknown error' })
          if (source === 'registry') {
            useDiagnosticsStore.getState().addIssue({
              level: 'error',
              source: 'roster',
              message: `Registry roster load failed (no sheet fallback): ${e instanceof Error ? e.message : String(e)}`,
            })
          }
        }
      },

      setVisitOverride: (playerName, visitsCompleted, lastVisitDate) => {
        const key = overrideKeyForName(get().players, playerName)
        const overrides = { ...get().visitOverrides, [key]: { visitsCompleted, lastVisitDate } }
        const players = applyOverrides(get().players, overrides)
        set({ visitOverrides: overrides, players })
      },

      clearVisitOverride: (playerName) => {
        const overrides = { ...get().visitOverrides }
        const p = get().players.find((x) => x.playerName === playerName)
        delete overrides[playerName]
        if (p) delete overrides[playerKey(p)]
        set({ visitOverrides: overrides })
      },

      setSortColumn: (column) => set({ sortColumn: column }),
      setSortDirection: (dir) => set({ sortDirection: dir }),
    }),
    {
      name: 'sv-travel-roster',
      version: ROSTER_PERSIST_VERSION,
      migrate: (persisted, version) => migrateRosterPersist(persisted, version) as RosterState,
      partialize: (state) => ({
        // Defence in depth: RosterPlayer no longer carries contact fields, but
        // scrub anyway so a future field can't quietly land in localStorage.
        // Registry source: never persist the roster. The door answers
        // `private, no-store` and the SOP says not to cache it beyond a few
        // minutes, so a signed-out browser must not keep a copy.
        players: getRosterSourceOrNull() === 'registry' ? [] : state.players.map(scrubPlayer),
        lastFetchedAt: state.lastFetchedAt,
        visitOverrides: state.visitOverrides,
        sortColumn: state.sortColumn,
        sortDirection: state.sortDirection,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          // Registry source starts empty: a snapshot left by the sheet build
          // must not paint as if it came from the registry.
          players: getRosterSourceOrNull() === 'registry' ? [] : (p?.players ?? []),
          visitOverrides: p?.visitOverrides ?? {},
          sortColumn: p?.sortColumn ?? 'tier',
          sortDirection: p?.sortDirection ?? 'asc',
        }
      },
    },
  ),
)
