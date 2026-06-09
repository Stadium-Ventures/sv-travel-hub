import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchTeamRoster, fetchTransactions, extractActiveRehabAssignments } from '../lib/mlbApi'
import {
  type RehabWindow,
  type PlayerRole,
  endFromStart,
  estimateEndFromToday,
  todayISO,
} from '../lib/rehab'
import { useScheduleStore } from './scheduleStore'

interface RehabState {
  /** Player name (lowercased trim) → rehab window. */
  windows: Record<string, RehabWindow>
  /** Per-player loading flags so the UI can show a spinner. */
  loading: Record<string, boolean>
  /** Refresh all rehab windows for the players passed in (Pro + on MiLB affiliate). */
  refresh: (
    candidates: Array<{ playerName: string; teamId: number; sportId: number; parentOrgId?: number }>,
  ) => Promise<void>
  /** Last successful refresh timestamp. */
  refreshedAt: number | null
}

const KEY = (name: string) => name.trim().toLowerCase()

export const useRehabStore = create<RehabState>()(
  persist(
    (set, get) => ({
      windows: {},
      loading: {},
      refreshedAt: null,

      refresh: async (candidates) => {
        if (candidates.length === 0) return
        const today = todayISO()

        // Group by parent MLB org so we issue one transactions fetch per org
        // instead of one per player. Rehab assignments are recorded against
        // the MLB parent team.
        const affiliates = useScheduleStore.getState().affiliates
        const candidatesWithParents = candidates.map((c) => {
          const parentId = c.parentOrgId
            ?? affiliates.find((a) => a.teamId === c.teamId)?.parentOrgId
            ?? null
          return { ...c, parentId }
        })

        const parentIds = Array.from(new Set(
          candidatesWithParents.map((c) => c.parentId).filter((p): p is number => !!p),
        ))

        // Window for transactions: last 35 days (covers max 30-day pitcher
        // rehab assignment plus a couple days of buffer for late posting).
        const startWindow = addDaysISO(today, -35)
        const txnsByParent = new Map<number, Awaited<ReturnType<typeof fetchTransactions>>>()

        // Mark all candidates as loading
        set((s) => {
          const loading = { ...s.loading }
          for (const c of candidates) loading[KEY(c.playerName)] = true
          return { loading }
        })

        try {
          await Promise.all(
            parentIds.map(async (pid) => {
              try {
                const txns = await fetchTransactions(pid, startWindow, today)
                txnsByParent.set(pid, txns)
              } catch (e) {
                console.warn(`[rehab] transactions fetch failed for org ${pid}:`, e)
              }
            }),
          )
        } catch (e) {
          console.warn('[rehab] batch transactions error:', e)
        }

        // For each candidate, derive the rehab window.
        const windows = { ...get().windows }
        const rolesByPlayer = await resolveRoles(candidatesWithParents)

        for (const c of candidatesWithParents) {
          const role: PlayerRole = rolesByPlayer.get(KEY(c.playerName)) ?? 'position'
          let window: RehabWindow

          // Try to find a matching rehab assignment in the parent's transactions.
          const parentTxns = c.parentId ? txnsByParent.get(c.parentId) ?? [] : []
          const rehabs = extractActiveRehabAssignments(parentTxns)
          // Match by name AND, if available, to-team. Name match alone is OK
          // since rehab transactions are tied to a single MLB player.
          const match = rehabs.find((r) => {
            if (KEY(r.playerName) !== KEY(c.playerName)) return false
            if (!r.toTeamId) return true
            return r.toTeamId === c.teamId
          })

          if (match) {
            window = {
              playerName: c.playerName,
              teamId: c.teamId,
              sportId: c.sportId,
              startDate: match.effectiveDate,
              estimatedEndDate: endFromStart(match.effectiveDate, role),
              source: 'transactions',
              role,
              description: match.description,
              fetchedAt: Date.now(),
            }
          } else {
            window = {
              playerName: c.playerName,
              teamId: c.teamId,
              sportId: c.sportId,
              startDate: null,
              estimatedEndDate: estimateEndFromToday(today, role),
              source: 'estimated',
              role,
              fetchedAt: Date.now(),
            }
          }

          windows[KEY(c.playerName)] = window
        }

        set((s) => {
          const loading = { ...s.loading }
          for (const c of candidates) delete loading[KEY(c.playerName)]
          return { windows, loading, refreshedAt: Date.now() }
        })

        // Re-run the proGames regeneration so the new rehab windows clip
        // out-of-window MiLB games immediately for the map, trip planner,
        // and data tab.
        try {
          useScheduleStore.getState().regenerateProGames()
        } catch (e) {
          console.warn('[rehab] regenerateProGames after refresh failed:', e)
        }
      },
    }),
    {
      name: 'sv-travel-rehab-windows',
      partialize: (s) => ({ windows: s.windows, refreshedAt: s.refreshedAt }),
    },
  ),
)

/** Lookup by player name. Returns null if no window cached. */
export function getRehabWindow(playerName: string): RehabWindow | null {
  return useRehabStore.getState().windows[KEY(playerName)] ?? null
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * For each candidate player, figure out if they're a pitcher (role=pitcher)
 * or position player. We do this by fetching the affiliate's roster and
 * matching by name. Cached per affiliate to avoid duplicate fetches.
 */
async function resolveRoles(
  candidates: Array<{ playerName: string; teamId: number; sportId: number }>,
): Promise<Map<string, PlayerRole>> {
  const roles = new Map<string, PlayerRole>()
  const teamsToFetch = Array.from(new Set(candidates.map((c) => `${c.teamId}|${c.sportId}`)))
  await Promise.all(
    teamsToFetch.map(async (key) => {
      const [teamIdStr, sportIdStr] = key.split('|')
      const teamId = parseInt(teamIdStr!), sportId = parseInt(sportIdStr!)
      try {
        const roster = await fetchTeamRoster(teamId, sportId)
        for (const r of roster) {
          const role: PlayerRole = r.positionCode === 'P' ? 'pitcher' : 'position'
          roles.set(KEY(r.fullName), role)
        }
      } catch (e) {
        console.warn(`[rehab] role lookup failed for team ${teamId}:`, e)
      }
    }),
  )
  return roles
}
