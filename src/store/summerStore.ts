// Summer assignments + schedules. Cross-cutting layer that overlays NCAA
// players' college identity with their summer-league team during the summer
// window. Produces summerGames: GameEvent[] for tripStore to merge into the
// trip-engine input pool.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'
import type { GameEvent } from '../types/schedule'
import type { SummerAssignment } from '../lib/summerAssignments'
import { fetchSummerAssignments } from '../lib/summerAssignments'
import type { PartnerLeagueTeam } from '../lib/summerLeagues'
import { fetchPartnerLeagueTeams, fetchPartnerLeagueSchedule, matchTeamByName } from '../lib/summerLeagues'
import { extractVenueCoords } from '../lib/mlbApi'
import { SUMMER_LEAGUES, type SummerLeagueCode } from '../data/summerLeagues'
import { lookupSummerVenueCoords } from '../data/summerVenues'
import { fetchManualSummerSchedule, isManualCsvConfigured } from '../lib/summerManualSchedule'
import { useDiagnosticsStore } from './diagnosticsStore'

export interface ResolvedSummerTeam {
  team: PartnerLeagueTeam
  players: string[]   // SV player names assigned here
  league: SummerLeagueCode
}

interface SummerState {
  assignments: SummerAssignment[]
  /** Player name → assignment (for UI badges, fast lookup). */
  byPlayer: Record<string, SummerAssignment>
  /** Player names whose assignment we couldn't resolve to a fetchable schedule. */
  unresolvedPlayers: string[]
  /** Summer games tagged with SV player names. Joined into tripStore's allGames. */
  summerGames: GameEvent[]
  loading: boolean
  error: string | null
  fetchedAt: string | null
  warnings: string[]

  loadAssignments: () => Promise<void>
  loadSchedules: (startDate: string, endDate: string, opts?: { force?: boolean }) => Promise<void>
}

function gameToEvent(
  game: import('../lib/mlbApi').MLBGameRaw,
  team: PartnerLeagueTeam,
  playerNames: string[],
  league: SummerLeagueCode,
): GameEvent | null {
  // Partner-league venues from the MLB API don't carry defaultCoordinates,
  // so check our hardcoded lookup before giving up.
  const coords = extractVenueCoords(game) ?? lookupSummerVenueCoords(game.venue?.name ?? '')
  if (!coords) return null
  const date = new Date(game.gameDate)
  const isHome = game.teams.home.team.id === team.teamId
  const pitcherNames: string[] = []
  if (game.teams.home.probablePitcher?.fullName) pitcherNames.push(game.teams.home.probablePitcher.fullName)
  if (game.teams.away.probablePitcher?.fullName) pitcherNames.push(game.teams.away.probablePitcher.fullName)
  return {
    id: `summer-${league}-${game.gamePk}`,
    date: game.gameDate.split('T')[0]!,
    dayOfWeek: date.getUTCDay(),
    time: date.toISOString(),
    homeTeam: game.teams.home.team.name,
    awayTeam: game.teams.away.team.name,
    isHome,
    venue: { name: game.venue.name, coords },
    // Reuse 'mlb-api' as the source — CCBL/MLBD schedules genuinely come
    // from MLB Stats API. The id prefix tells us it's a summer game.
    source: 'mlb-api',
    playerNames,
    confidence: 'high',
    confidenceNote: `${SUMMER_LEAGUES[league].name} (${league})`,
    sourceUrl: `https://www.mlb.com/gameday/${game.gamePk}`,
    gameStatus: game.status?.detailedState,
    probablePitcherNames: pitcherNames.length > 0 ? pitcherNames : undefined,
  }
}

export const useSummerStore = create<SummerState>()(
  persist(
    (set, get) => ({
      assignments: [],
      byPlayer: {},
      unresolvedPlayers: [],
      summerGames: [],
      loading: false,
      error: null,
      fetchedAt: null,
      warnings: [],

      loadAssignments: async () => {
        if (get().loading) return
        set({ loading: true, error: null })
        const diag = useDiagnosticsStore.getState()
        diag.clearSource('summer')
        try {
          const result = await fetchSummerAssignments()
          const byPlayer: Record<string, SummerAssignment> = {}
          for (const a of result.assignments) byPlayer[a.playerName] = a
          set({
            assignments: result.assignments,
            byPlayer,
            fetchedAt: result.fetchedAt,
            warnings: result.warnings,
            loading: false,
          })
          for (const w of result.warnings) {
            diag.addIssue({ level: 'warning', source: 'summer', message: w })
          }
        } catch (e) {
          set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load summer assignments' })
          diag.addIssue({
            level: 'error',
            source: 'summer',
            message: `Summer assignments failed to load: ${e instanceof Error ? e.message : 'unknown'}`,
          })
        }
      },

      loadSchedules: async (startDate, endDate, opts) => {
        // Reentrancy guard — mirrors loadAssignments
        if (get().loading) return
        const state = get()
        if (state.assignments.length === 0) {
          await get().loadAssignments()
          if (get().error) return // assignments fetch failed — error already surfaced
        }
        const refreshed = get()
        const active = refreshed.assignments.filter((a) => a.active)
        if (active.length === 0) {
          set({ summerGames: [], unresolvedPlayers: [] })
          return
        }

        set({ loading: true, error: null })
        const diag = useDiagnosticsStore.getState()

        try {
          // Group active assignments by league
          const byLeague = new Map<SummerLeagueCode, SummerAssignment[]>()
          for (const a of active) {
            const arr = byLeague.get(a.league) ?? []
            arr.push(a)
            byLeague.set(a.league, arr)
          }

          const season = new Date(startDate).getUTCFullYear()
          const summerGames: GameEvent[] = []
          const unresolved: string[] = []

          // Process MLB-API-backed leagues (CCBL + MLBD)
          for (const [code, league] of Object.entries(SUMMER_LEAGUES) as [SummerLeagueCode, typeof SUMMER_LEAGUES[SummerLeagueCode]][]) {
            const leagueAssignments = byLeague.get(code) ?? []
            if (leagueAssignments.length === 0) continue

            if (league.source !== 'mlb-api' || !league.mlbApiLeagueId) {
              // PrestoSports / manual — not handled in this pass. Surface the
              // assignment so it appears on player cards, but flag unresolved.
              for (const a of leagueAssignments) unresolved.push(a.playerName)
              diag.addIssue({
                level: 'info',
                source: 'summer',
                message: `${code} schedule ingestion not yet built — ${leagueAssignments.length} player(s) have assignments but no game data.`,
                details: leagueAssignments.map((a) => `${a.playerName} → ${a.summerTeam}`).join(', '),
              })
              continue
            }

            try {
              const teams = await fetchPartnerLeagueTeams(league.mlbApiLeagueId, season)
              const resolved: ResolvedSummerTeam[] = []
              const unmatched: string[] = []

              // Match each assignment's summerTeam string to an MLB-API team
              const teamToPlayers = new Map<number, { team: PartnerLeagueTeam; players: string[] }>()
              for (const a of leagueAssignments) {
                const match = matchTeamByName(a.summerTeam, teams)
                if (!match) {
                  unmatched.push(`${a.playerName} → "${a.summerTeam}"`)
                  unresolved.push(a.playerName)
                  continue
                }
                const entry = teamToPlayers.get(match.teamId)
                if (entry) entry.players.push(a.playerName)
                else teamToPlayers.set(match.teamId, { team: match, players: [a.playerName] })
              }

              if (unmatched.length > 0) {
                diag.addIssue({
                  level: 'warning',
                  source: 'summer',
                  message: `${code}: ${unmatched.length} team name(s) didn't match the league roster.`,
                  details: unmatched.join('; '),
                })
              }

              for (const entry of teamToPlayers.values()) {
                resolved.push({ team: entry.team, players: entry.players, league: code })
              }

              // Fetch schedules sequentially (gentle on MLB API; few teams)
              for (const r of resolved) {
                try {
                  const games = await fetchPartnerLeagueSchedule(r.team, startDate, endDate)
                  for (const g of games) {
                    const event = gameToEvent(g, r.team, r.players, r.league)
                    if (event) summerGames.push(event)
                  }
                } catch (e) {
                  diag.addIssue({
                    level: 'warning',
                    source: 'summer',
                    message: `${code}: failed to fetch schedule for ${r.team.teamName}`,
                    details: e instanceof Error ? e.message : 'unknown',
                  })
                }
              }
            } catch (e) {
              diag.addIssue({
                level: 'error',
                source: 'summer',
                message: `${code}: league fetch failed`,
                details: e instanceof Error ? e.message : 'unknown',
              })
            }
          }

          // Layer in any games from the manual sheet (Northwoods, CPL, etc.).
          // Manual entries clear "unresolved" status for the players they cover.
          if (isManualCsvConfigured()) {
            try {
              const manual = await fetchManualSummerSchedule()
              for (const w of manual.warnings) {
                diag.addIssue({ level: 'warning', source: 'summer', message: `Manual sheet: ${w}` })
              }
              const manualPlayers = new Set(manual.games.flatMap((g) => g.playerNames))
              for (const game of manual.games) summerGames.push(game)
              const stillUnresolved = unresolved.filter((p) => !manualPlayers.has(p))
              unresolved.length = 0
              unresolved.push(...stillUnresolved)
              if (manual.games.length > 0) {
                diag.addIssue({
                  level: 'info',
                  source: 'summer',
                  message: `Manual sheet: ${manual.games.length} games loaded covering ${manualPlayers.size} player(s).`,
                })
              }
            } catch (e) {
              diag.addIssue({
                level: 'warning',
                source: 'summer',
                message: 'Manual summer schedule sheet fetch failed',
                details: e instanceof Error ? e.message : 'unknown',
              })
            }
          }

          set({
            summerGames,
            unresolvedPlayers: [...new Set(unresolved)],
            loading: false,
            error: null,
            fetchedAt: new Date().toISOString(), // only stamped on success
          })

          diag.addIssue({
            level: 'info',
            source: 'summer',
            message: `Summer schedule: ${summerGames.length} games loaded for ${active.length - unresolved.length} of ${active.length} active players.`,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to load summer schedules'
          set({ loading: false, error: msg })
          diag.addIssue({
            level: 'error',
            source: 'summer',
            message: `Summer schedules failed to load: ${msg}`,
          })
        }

        // Silence unused-var warning when opts is not supplied
        void opts
      },
    }),
    {
      name: 'sv-travel-summer',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        assignments: state.assignments,
        byPlayer: state.byPlayer,
        fetchedAt: state.fetchedAt,
        warnings: state.warnings,
        // summerGames are not persisted — refetched per session to avoid stale schedules
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SummerState> | undefined
        return {
          ...current,
          assignments: p?.assignments ?? [],
          byPlayer: p?.byPlayer ?? {},
          fetchedAt: p?.fetchedAt ?? null,
          warnings: p?.warnings ?? [],
          summerGames: [],
          unresolvedPlayers: [],
        }
      },
    },
  ),
)
