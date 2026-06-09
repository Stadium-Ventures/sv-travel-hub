import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchTeamRoster, fetchTransactions, extractActiveRehabAssignments } from '../lib/mlbApi'
import {
  type RehabWindow,
  type PlayerRole,
  endFromStart,
  todayISO,
} from '../lib/rehab'
import { useScheduleStore } from './scheduleStore'

interface RehabState {
  /** Player name (lowercased trim) → rehab window. Only present for players
   *  we have something to say about — confirmed rehab OR known to be on
   *  parent 40-man at MiLB. Genuine MiLB-career players don't get an entry. */
  windows: Record<string, RehabWindow>
  /** Per-player loading flags. */
  loading: Record<string, boolean>
  refresh: (
    candidates: Array<{ playerName: string; teamId: number; sportId: number; parentOrgId?: number }>,
  ) => Promise<void>
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

        // Resolve each candidate's parent org so we know which 40-man to
        // check and which org's transactions to read.
        const affiliates = useScheduleStore.getState().affiliates
        const withParents = candidates.map((c) => {
          const parentId = c.parentOrgId
            ?? affiliates.find((a) => a.teamId === c.teamId)?.parentOrgId
            ?? null
          return { ...c, parentId }
        })

        const parentIds = Array.from(new Set(
          withParents.map((c) => c.parentId).filter((p): p is number => !!p),
        ))

        // Mark loading
        set((s) => {
          const loading = { ...s.loading }
          for (const c of candidates) loading[KEY(c.playerName)] = true
          return { loading }
        })

        // Fetch transactions (last 35d) AND 40-man rosters in parallel per parent.
        const startWindow = addDaysISOInternal(today, -35)
        const txnsByParent = new Map<number, Awaited<ReturnType<typeof fetchTransactions>>>()
        const fortyManByParent = new Map<number, Set<string>>() // KEYED by lowercased name

        await Promise.all(
          parentIds.flatMap((pid) => [
            fetchTransactions(pid, startWindow, today)
              .then((txns) => { txnsByParent.set(pid, txns) })
              .catch((e) => console.warn(`[rehab] txns fetch failed for ${pid}:`, e)),
            fetchTeamRoster(pid, 1, undefined, '40Man')
              .then((roster) => {
                const set40 = new Set<string>()
                for (const r of roster) set40.add(KEY(r.fullName))
                fortyManByParent.set(pid, set40)
              })
              .catch((e) => console.warn(`[rehab] 40-man fetch failed for ${pid}:`, e)),
          ]),
        )

        // Roles: derive pitcher vs position from the affiliate's roster
        // (which we'd already need for clipping calculation).
        const rolesByPlayer = await resolveRoles(withParents)

        const windows = { ...get().windows }

        // For every candidate decide which bucket they fall into:
        //   1. confirmedRehab (transactions say so) → clip MiLB games to window
        //   2. is40Man only → warn but don't clip (could be option or rehab pre-API)
        //   3. neither → genuine MiLB player, REMOVE any existing entry
        for (const c of withParents) {
          const key = KEY(c.playerName)
          const role: PlayerRole = rolesByPlayer.get(key) ?? 'position'
          const parentTxns = c.parentId ? txnsByParent.get(c.parentId) ?? [] : []
          const rehabs = extractActiveRehabAssignments(parentTxns)
          const txnMatch = rehabs.find((r) => {
            if (KEY(r.playerName) !== key) return false
            if (!r.toTeamId) return true
            return r.toTeamId === c.teamId
          })
          const fortyMan = c.parentId ? fortyManByParent.get(c.parentId) ?? new Set<string>() : new Set<string>()
          const is40Man = fortyMan.has(key)

          if (txnMatch) {
            windows[key] = {
              playerName: c.playerName,
              teamId: c.teamId,
              sportId: c.sportId,
              is40Man: true, // rehabbing players are by definition MLB-level
              confirmedRehab: true,
              startDate: txnMatch.effectiveDate,
              estimatedEndDate: endFromStart(txnMatch.effectiveDate, role),
              source: 'transactions',
              role,
              description: txnMatch.description,
              fetchedAt: Date.now(),
            }
          } else if (is40Man) {
            windows[key] = {
              playerName: c.playerName,
              teamId: c.teamId,
              sportId: c.sportId,
              is40Man: true,
              confirmedRehab: false,
              startDate: null,
              estimatedEndDate: null,
              source: 'inferred-40man',
              role,
              fetchedAt: Date.now(),
            }
          } else {
            // Genuine MiLB career player: no warning, no clipping. Drop any
            // stale entry from a previous refresh where the data was thinner.
            delete windows[key]
          }
        }

        set((s) => {
          const loading = { ...s.loading }
          for (const c of candidates) delete loading[KEY(c.playerName)]
          return { windows, loading, refreshedAt: Date.now() }
        })

        // Re-clip proGames now that windows changed.
        try {
          useScheduleStore.getState().regenerateProGames()
        } catch (e) {
          console.warn('[rehab] regenerateProGames failed:', e)
        }
      },
    }),
    {
      name: 'sv-travel-rehab-windows',
      partialize: (s) => ({ windows: s.windows, refreshedAt: s.refreshedAt }),
    },
  ),
)

export function getRehabWindow(playerName: string): RehabWindow | null {
  return useRehabStore.getState().windows[KEY(playerName)] ?? null
}

function addDaysISOInternal(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

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
