import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'

const HEARTBEAT_BASE = 'https://sv-heartbeat.vercel.app/api/heartbeat'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_RETRY_ATTEMPTS = 3

async function fetchWithRetry(
  url: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 10000, ...options })
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
        return res
      }
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastError = e
    }
    if (attempt < MAX_RETRY_ATTEMPTS - 1) {
      const delayMs = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError
}

export interface HeartbeatPriority {
  name: string
  tier: number
  leadAgent: string
  status: 'green' | 'yellow' | 'red'
  loveScore: number
  daysSinceInPerson: number | null
  inPersonThresholdDays: number
  inPersonOverdue: boolean
  daysSinceLeadContact: number
  daysSinceTeamContact: number
  thresholdDays: number
  visitUrgencyScore: number
}

export interface HeartbeatPlayer {
  name: string
  tier: number
  leadAgent: string
  source: 'roster' | 'follow'
  status: 'green' | 'yellow' | 'red'
  channelName: string
  daysSinceLeadContact: number | null
  daysSinceTeamContact: number | null
  daysSinceLastCall: number | null
  daysSinceInPerson: number | null
  inPersonThresholdDays: number | null
  thresholdDays: number
  loveScore: number
  interactionCounts: {
    calls: number
    texts: number
    inPerson: number
  }
}

interface HeartbeatState {
  priorities: HeartbeatPriority[]
  players: HeartbeatPlayer[]
  playerLookup: Map<string, HeartbeatPlayer>
  urgencyLookup: Map<string, HeartbeatPriority>
  loading: boolean
  error: string | null
  lastFetchedAt: string | null

  fetchHeartbeat: () => Promise<void>
  getPlayerData: (playerName: string) => HeartbeatPlayer | undefined
  getPlayerUrgency: (playerName: string) => HeartbeatPriority | undefined
}

// Normalize name for matching (heartbeat uses "First Last", roster uses "First Last")
function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function buildLookups(players: HeartbeatPlayer[], priorities: HeartbeatPriority[]) {
  const playerLookup = new Map<string, HeartbeatPlayer>()
  for (const p of players) playerLookup.set(normalizeName(p.name), p)
  const urgencyLookup = new Map<string, HeartbeatPriority>()
  for (const p of priorities) urgencyLookup.set(normalizeName(p.name), p)
  return { playerLookup, urgencyLookup }
}

export const useHeartbeatStore = create<HeartbeatState>()(
  persist(
    (set, get) => ({
      priorities: [],
      players: [],
      playerLookup: new Map(),
      urgencyLookup: new Map(),
      loading: false,
      error: null,
      lastFetchedAt: null,

      fetchHeartbeat: async () => {
        if (get().loading) return
        set({ loading: true, error: null })
        try {
          const [priorityRes, summaryRes] = await Promise.all([
            fetchWithRetry(`${HEARTBEAT_BASE}/visit-priority`),
            fetchWithRetry(`${HEARTBEAT_BASE}/summary`),
          ])

          if (!priorityRes.ok) throw new Error(`Visit priority API: ${priorityRes.status}`)
          if (!summaryRes.ok) throw new Error(`Summary API: ${summaryRes.status}`)

          const priorityData = await priorityRes.json()
          const summaryData = await summaryRes.json()

          const priorities = priorityData.priorities ?? []
          const players = summaryData.players ?? []
          const { playerLookup, urgencyLookup } = buildLookups(players, priorities)

          set({
            priorities,
            players,
            playerLookup,
            urgencyLookup,
            loading: false,
            lastFetchedAt: new Date().toISOString(),
          })
        } catch (e) {
          set({
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to fetch heartbeat data',
          })
        }
      },

      getPlayerData: (playerName: string) => {
        return get().playerLookup.get(normalizeName(playerName))
      },

      getPlayerUrgency: (playerName: string) => {
        return get().urgencyLookup.get(normalizeName(playerName))
      },
    }),
    {
      name: 'sv-travel-heartbeat',
      partialize: (state) => ({
        priorities: state.priorities,
        players: state.players,
        lastFetchedAt: state.lastFetchedAt,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          players: p?.players ?? [],
          priorities: p?.priorities ?? [],
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          const { playerLookup, urgencyLookup } = buildLookups(state.players ?? [], state.priorities ?? [])
          state.playerLookup = playerLookup
          state.urgencyLookup = urgencyLookup
        }
      },
    },
  ),
)
