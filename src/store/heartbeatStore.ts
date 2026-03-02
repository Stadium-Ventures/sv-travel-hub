import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const HEARTBEAT_BASE = 'https://sv-heartbeat.vercel.app/api/heartbeat'

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

export const useHeartbeatStore = create<HeartbeatState>()(
  persist(
    (set, get) => ({
      priorities: [],
      players: [],
      loading: false,
      error: null,
      lastFetchedAt: null,

      fetchHeartbeat: async () => {
        set({ loading: true, error: null })
        try {
          const [priorityRes, summaryRes] = await Promise.all([
            fetch(`${HEARTBEAT_BASE}/visit-priority`),
            fetch(`${HEARTBEAT_BASE}/summary`),
          ])

          if (!priorityRes.ok) throw new Error(`Visit priority API: ${priorityRes.status}`)
          if (!summaryRes.ok) throw new Error(`Summary API: ${summaryRes.status}`)

          const priorityData = await priorityRes.json()
          const summaryData = await summaryRes.json()

          set({
            priorities: priorityData.priorities ?? [],
            players: summaryData.players ?? [],
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
        const normalized = normalizeName(playerName)
        return get().players.find((p) => normalizeName(p.name) === normalized)
      },

      getPlayerUrgency: (playerName: string) => {
        const normalized = normalizeName(playerName)
        return get().priorities.find((p) => normalizeName(p.name) === normalized)
      },
    }),
    {
      name: 'sv-travel-heartbeat',
      partialize: (state) => ({
        priorities: state.priorities,
        players: state.players,
        lastFetchedAt: state.lastFetchedAt,
      }),
    },
  ),
)
