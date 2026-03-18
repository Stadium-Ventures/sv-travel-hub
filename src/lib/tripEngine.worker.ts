import { generateTrips } from './tripEngine'
import type { GameEvent } from '../types/schedule'
import type { RosterPlayer } from '../types/roster'
import type { UrgencyMap } from './tripEngine'

export interface WorkerParams {
  games: GameEvent[]
  players: RosterPlayer[]
  startDate: string
  endDate: string
  maxDriveMinutes: number
  priorityPlayers: string[]
  urgencyRecord?: Record<string, number>
  maxFlightHours: number
  playerTeamAssignments?: Record<string, { teamId: number; sportId: number; teamName: string }>
}

export type WorkerMessage =
  | { type: 'progress'; step: string; detail?: string }
  | { type: 'result'; plan: ReturnType<typeof generateTrips> extends Promise<infer T> ? T : never }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<WorkerParams>) => {
  const params = e.data

  // Convert Record back to Map for the engine
  let urgencyMap: UrgencyMap | undefined
  if (params.urgencyRecord) {
    urgencyMap = new Map(Object.entries(params.urgencyRecord))
  }

  try {
    const plan = await generateTrips(
      params.games,
      params.players,
      params.startDate,
      params.endDate,
      (step, detail) => {
        self.postMessage({ type: 'progress', step, detail } satisfies WorkerMessage)
      },
      params.maxDriveMinutes,
      params.priorityPlayers,
      urgencyMap,
      params.maxFlightHours,
      params.playerTeamAssignments,
    )
    self.postMessage({ type: 'result', plan } satisfies WorkerMessage)
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Trip generation failed',
    } satisfies WorkerMessage)
  }
}
