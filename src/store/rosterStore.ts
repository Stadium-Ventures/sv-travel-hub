import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RosterPlayer } from '../types/roster'
import { fetchRoster } from '../lib/csv'

interface VisitOverride {
  visitsCompleted: number
  lastVisitDate: string | null
}

interface RosterState {
  players: RosterPlayer[]
  loading: boolean
  error: string | null
  lastFetchedAt: string | null
  parseWarnings: string[]
  visitOverrides: Record<string, VisitOverride> // playerName → override

  fetchRoster: () => Promise<void>
  setVisitOverride: (playerName: string, visitsCompleted: number, lastVisitDate: string | null) => void
  clearVisitOverride: (playerName: string) => void
}

function applyOverrides(players: RosterPlayer[], overrides: Record<string, VisitOverride>): RosterPlayer[] {
  return players.map((p) => {
    const override = overrides[p.playerName]
    if (!override) return p
    return {
      ...p,
      visitsCompleted: override.visitsCompleted,
      lastVisitDate: override.lastVisitDate,
      visitsRemaining: Math.max(0, p.visitTarget2026 - override.visitsCompleted),
    }
  })
}

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      players: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      parseWarnings: [],
      visitOverrides: {},

      fetchRoster: async () => {
        set({ loading: true, error: null, parseWarnings: [] })
        try {
          const result = await fetchRoster()
          // Prune stale visitOverrides for players no longer on the roster
          const currentNames = new Set(result.players.map((p) => p.playerName))
          const existingOverrides = get().visitOverrides
          const prunedOverrides: Record<string, VisitOverride> = {}
          for (const [name, override] of Object.entries(existingOverrides)) {
            if (currentNames.has(name)) prunedOverrides[name] = override
          }
          const players = applyOverrides(result.players, prunedOverrides)
          set({ players, loading: false, lastFetchedAt: new Date().toISOString(), parseWarnings: result.warnings, visitOverrides: prunedOverrides })
        } catch (e) {
          set({ loading: false, error: e instanceof Error ? e.message : 'Unknown error' })
        }
      },

      setVisitOverride: (playerName, visitsCompleted, lastVisitDate) => {
        const overrides = { ...get().visitOverrides, [playerName]: { visitsCompleted, lastVisitDate } }
        const players = applyOverrides(get().players, overrides)
        set({ visitOverrides: overrides, players })
      },

      clearVisitOverride: (playerName) => {
        const overrides = { ...get().visitOverrides }
        delete overrides[playerName]
        set({ visitOverrides: overrides })
      },
    }),
    {
      name: 'sv-travel-roster',
      partialize: (state) => ({
        players: state.players,
        lastFetchedAt: state.lastFetchedAt,
        visitOverrides: state.visitOverrides,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          players: p?.players ?? [],
          visitOverrides: p?.visitOverrides ?? {},
        }
      },
    },
  ),
)
