import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'
import type { MLBAffiliate, MLBGameRaw, MLBTransaction } from '../lib/mlbApi'
import { fetchAllAffiliates, fetchAllSchedules, fetchAllTransactions, fetchAllRosters } from '../lib/mlbApi'
import { MLB_PARENT_IDS, resolveNcaaName, resolveMLBTeamId } from '../data/aliases'
import type { GameEvent } from '../types/schedule'
import { extractVenueCoords } from '../lib/mlbApi'
import type { D1Schedule } from '../lib/d1baseball'
import { fetchAllD1Schedules, resolveOpponentVenue, resolveOpponentVenueAsync } from '../lib/d1baseball'
import { NCAA_VENUES } from '../data/ncaaVenues'
import type { MaxPrepsSchedule } from '../lib/maxpreps'
import { fetchAllMaxPrepsSchedules } from '../lib/maxpreps'
import { useRosterStore } from './rosterStore'
import { useVenueStore } from './venueStore'
import { useDiagnosticsStore } from './diagnosticsStore'

export interface PlayerTeamAssignment {
  teamId: number
  sportId: number
  teamName: string
  /** How this assignment was determined */
  source?: 'milb-roster' | 'mlb-roster' | 'estimated' | 'manual'
}

// Activity log entry — tracks visible changes for transparency
export interface AssignmentChange {
  playerName: string
  action: 'assigned' | 'reassigned' | 'not-found' | 'name-matched' | 'fallback'
  from?: string // previous team name
  to?: string   // new team name
  timestamp: number
}

interface ScheduleState {
  // Affiliates
  affiliates: MLBAffiliate[]
  affiliatesLoading: boolean
  affiliatesError: string | null

  // Player → team assignments (persisted)
  playerTeamAssignments: Record<string, PlayerTeamAssignment>

  // Custom aliases for unrecognized org names (persisted)
  customMlbAliases: Record<string, string>   // raw name → canonical MLB org name
  customNcaaAliases: Record<string, string>   // raw name → canonical NCAA school name

  // Assignment activity log (persisted) — shows what auto-assign did
  assignmentLog: AssignmentChange[]

  // Pro schedules
  proSchedules: Record<number, MLBGameRaw[]> // teamId → games
  proGames: GameEvent[]
  proDroppedGames: number // games dropped due to missing venue coordinates
  schedulesLoading: boolean
  schedulesError: string | null
  schedulesProgress: { completed: number; total: number } | null

  // NCAA schedules (from D1Baseball)
  ncaaSchedules: Record<string, D1Schedule> // school name → schedule
  ncaaGames: GameEvent[]
  ncaaLoading: boolean
  ncaaError: string | null
  ncaaProgress: { completed: number; total: number } | null
  ncaaFailedSchools: string[]         // schools whose schedule fetch failed
  ncaaDroppedAwayGames: number        // away games skipped due to unknown opponent venue

  // HS schedules (from MaxPreps)
  hsSchedules: Record<string, MaxPrepsSchedule> // org|state key → schedule
  hsGames: GameEvent[]
  hsLoading: boolean
  hsError: string | null
  hsProgress: { completed: number; total: number } | null
  hsFailedSchools: string[]
  hsFetchedAt: number | null

  // Roster moves detection
  rosterMoves: MLBTransaction[]
  rosterMovesLoading: boolean
  rosterMovesCheckedAt: string | null
  rosterMovesError: string | null

  // Fetch timestamps
  proFetchedAt: number | null
  ncaaFetchedAt: number | null

  // Cached coverage tracking (for incremental fetching)
  cachedProTeamIds: number[]
  cachedNcaaSchools: string[]
  cachedHsSchools: string[]

  // Auto-assign
  autoAssignLoading: boolean
  autoAssignResult: { assigned: number; confirmed: number; estimated: number; notFound: string[]; error?: string; springTrainingEstimate?: boolean } | null

  // Actions
  fetchAffiliates: (forceRefresh?: boolean) => Promise<void>
  assignPlayerToTeam: (playerName: string, assignment: PlayerTeamAssignment) => void
  removePlayerAssignment: (playerName: string) => void
  setCustomAlias: (type: 'mlb' | 'ncaa', raw: string, canonical: string) => void
  autoAssignPlayers: () => Promise<void>
  fetchProSchedules: (startDate: string, endDate: string) => Promise<void>
  regenerateProGames: () => void
  checkRosterMoves: () => Promise<void>
  fetchNcaaSchedules: (playerOrgs: Array<{ playerName: string; org: string }>, opts?: { merge?: boolean; forceRefresh?: boolean }) => Promise<void>
  fetchHsSchedules: (playerOrgs: Array<{ playerName: string; org: string; state: string }>, opts?: { merge?: boolean; forceRefresh?: boolean }) => Promise<void>
}

function mlbGameToEvent(game: MLBGameRaw, teamId: number, playerNames: string[]): GameEvent | null {
  const coords = extractVenueCoords(game)
  if (!coords) return null

  const date = new Date(game.gameDate)
  const isHome = game.teams.home.team.id === teamId

  // Extract probable pitcher names
  const pitcherNames: string[] = []
  if (game.teams.home.probablePitcher?.fullName) {
    pitcherNames.push(game.teams.home.probablePitcher.fullName)
  }
  if (game.teams.away.probablePitcher?.fullName) {
    pitcherNames.push(game.teams.away.probablePitcher.fullName)
  }

  return {
    id: `mlb-${game.gamePk}`,
    date: game.gameDate.split('T')[0]!,
    dayOfWeek: date.getUTCDay(),
    time: date.toISOString(),
    homeTeam: game.teams.home.team.name,
    awayTeam: game.teams.away.team.name,
    isHome,
    venue: {
      name: game.venue.name,
      coords,
    },
    source: 'mlb-api',
    playerNames,
    sportId: undefined,
    sourceUrl: `https://www.mlb.com/gameday/${game.gamePk}`,
    gameStatus: game.status?.detailedState,
    probablePitcherNames: pitcherNames.length > 0 ? pitcherNames : undefined,
  }
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      affiliates: [],
      affiliatesLoading: false,
      affiliatesError: null,

      playerTeamAssignments: {},
      customMlbAliases: {},
      customNcaaAliases: {},
      assignmentLog: [],

      proSchedules: {},
      proGames: [],
      proDroppedGames: 0,
      schedulesLoading: false,
      schedulesError: null,
      schedulesProgress: null,

      ncaaSchedules: {},
      ncaaGames: [],
      ncaaLoading: false,
      ncaaError: null,
      ncaaProgress: null,
      ncaaFailedSchools: [],
      ncaaDroppedAwayGames: 0,

      hsSchedules: {},
      hsGames: [],
      hsLoading: false,
      hsError: null,
      hsProgress: null,
      hsFailedSchools: [],
      hsFetchedAt: null,

      autoAssignLoading: false,
      autoAssignResult: null,

      rosterMoves: [],
      rosterMovesLoading: false,
      rosterMovesCheckedAt: null,
      rosterMovesError: null,

      proFetchedAt: null,
      ncaaFetchedAt: null,

      cachedProTeamIds: [],
      cachedNcaaSchools: [],
      cachedHsSchools: [],

      fetchAffiliates: async (forceRefresh?: boolean) => {
        if (get().affiliatesLoading) return
        // Skip if already cached from localStorage (unless forced)
        if (!forceRefresh && get().affiliates.length > 0) return
        set({ affiliatesLoading: true, affiliatesError: null })
        try {
          const affiliates = await fetchAllAffiliates(MLB_PARENT_IDS)
          set({ affiliates, affiliatesLoading: false })
        } catch (e) {
          set({ affiliatesLoading: false, affiliatesError: e instanceof Error ? e.message : 'Failed to fetch affiliates' })
        }
      },

      assignPlayerToTeam: (playerName, assignment) => {
        set((state) => ({
          playerTeamAssignments: {
            ...state.playerTeamAssignments,
            [playerName]: { ...assignment, source: 'manual' },
          },
        }))
      },

      removePlayerAssignment: (playerName) => {
        set((state) => {
          const next = { ...state.playerTeamAssignments }
          delete next[playerName]
          return { playerTeamAssignments: next }
        })
      },

      setCustomAlias: (type, raw, canonical) => {
        if (type === 'mlb') {
          set((state) => ({
            customMlbAliases: { ...state.customMlbAliases, [raw]: canonical },
          }))
        } else {
          set((state) => ({
            customNcaaAliases: { ...state.customNcaaAliases, [raw]: canonical },
          }))
        }
      },

      autoAssignPlayers: async () => {
        if (get().autoAssignLoading) return
        set({ autoAssignLoading: true, autoAssignResult: null })

        let state = get()
        const customMlb = state.customMlbAliases
        const rosterPlayers = useRosterStore.getState().players

        // Auto-fetch affiliates if not loaded yet
        if (state.affiliates.length === 0) {
          await get().fetchAffiliates()
          state = get() // re-read after fetch
        }

        const allAffiliates = state.affiliates

        // Get ALL Pro players — re-check even previously assigned ones
        const proPlayers = rosterPlayers.filter(
          (p) => p.level === 'Pro' && p.mlbPlayerId,
        )

        // Also get Pro players without mlbPlayerId (will be handled via fallback)
        const proPlayersWithoutId = rosterPlayers.filter(
          (p) => p.level === 'Pro' && !p.mlbPlayerId,
        )

        if (proPlayers.length === 0 && proPlayersWithoutId.length === 0) {
          set({ autoAssignLoading: false, autoAssignResult: { assigned: 0, confirmed: 0, estimated: 0, notFound: [] } })
          return
        }

        // Collect unique parent org IDs and build orgId → orgName lookup
        const parentOrgIds = new Set<number>()
        const orgIdToName = new Map<number, string>()
        for (const p of [...proPlayers, ...proPlayersWithoutId]) {
          const orgId = resolveMLBTeamId(p.org, customMlb)
          if (orgId) {
            parentOrgIds.add(orgId)
            if (!orgIdToName.has(orgId)) orgIdToName.set(orgId, p.org)
          }
        }

        if (parentOrgIds.size === 0) {
          set({ autoAssignLoading: false, autoAssignResult: { assigned: 0, confirmed: 0, estimated: 0, notFound: [...proPlayers, ...proPlayersWithoutId].map((p) => p.playerName) } })
          return
        }

        try {
          const newAssignments: Record<string, PlayerTeamAssignment> = { ...state.playerTeamAssignments }
          let assignedCount = 0
          const notFoundNames: string[] = []

          // Phase 1: Try MLB-level rosters first (sportId=1) — players on the
          // 40-man roster can be assigned directly to the parent org without
          // needing to search through all affiliate teams.
          const mlbTeamsToQuery = [...parentOrgIds].map((orgId) => {
            // Try to get the canonical team name from affiliates, fall back to org name
            const affEntry = allAffiliates.find((a) => a.parentOrgId === orgId && a.sportId === 1)
            const teamName = affEntry?.teamName ?? orgIdToName.get(orgId) ?? `Team ${orgId}`
            return { teamId: orgId, sportId: 1, teamName }
          })

          const mlbRosterEntries = await fetchAllRosters(mlbTeamsToQuery)
          const mlbPlayerIdToTeam = new Map<number, PlayerTeamAssignment>()
          for (const entry of mlbRosterEntries) {
            if (entry.playerId > 0) {
              mlbPlayerIdToTeam.set(entry.playerId, {
                teamId: entry.teamId,
                sportId: 1,
                teamName: entry.teamName,
              })
            }
          }

          // Phase 2: ALWAYS check MiLB rosters — a player on the 40-man may be
          // optioned to the minors and should use the MiLB team's schedule, not MLB.
          // Hoist milbRosterEntries so Phase 3 can also use them for name matching
          let milbRosterEntries: typeof mlbRosterEntries = []

          {
            const allOrgIds = new Set<number>()
            for (const p of proPlayers) {
              const orgId = resolveMLBTeamId(p.org, customMlb)
              if (orgId) allOrgIds.add(orgId)
            }

            // Get MiLB affiliate teams (exclude sportId=1 since that's MLB level)
            const teamsToQuery = allAffiliates
              .filter((a) => allOrgIds.has(a.parentOrgId) && a.sportId !== 1)
              .map((a) => ({ teamId: a.teamId, sportId: a.sportId, teamName: a.teamName }))

            if (teamsToQuery.length > 0) {
              milbRosterEntries = await fetchAllRosters(teamsToQuery)
            }
          }

          // Build MiLB player lookup
          const milbPlayerIdToTeam = new Map<number, PlayerTeamAssignment>()
          for (const entry of milbRosterEntries) {
            if (entry.playerId > 0) {
              milbPlayerIdToTeam.set(entry.playerId, {
                teamId: entry.teamId,
                sportId: entry.sportId,
                teamName: entry.teamName,
              })
            }
          }

          // Detect spring training: use month check + MiLB roster coverage heuristic.
          // Even in April, MiLB rosters may not be finalized until opening day.
          const now = new Date()
          const monthBasedST = now.getMonth() < 3 // Jan=0, Feb=1, Mar=2 → before April

          // Check if current MiLB rosters cover our tracked players well
          const trackedProWithId = proPlayers.filter((p) => p.mlbPlayerId)
          const milbCoverage = trackedProWithId.length > 0
            ? trackedProWithId.filter((p) => milbPlayerIdToTeam.has(p.mlbPlayerId!)).length / trackedProWithId.length
            : 0

          // Use spring training estimation if: before April OR if MiLB coverage is < 50%
          // (MiLB rosters aren't finalized yet even in early April)
          const isSpringTraining = monthBasedST || milbCoverage < 0.5
          // Log spring training detection for debugging assignment issues
          const diagST = useDiagnosticsStore.getState()
          diagST.addIssue({
            level: 'info',
            source: 'pro',
            message: isSpringTraining
              ? `Spring training mode active (month-based: ${monthBasedST}, MiLB coverage: ${Math.round(milbCoverage * 100)}%) — using estimated assignments`
              : `Regular season mode (MiLB coverage: ${Math.round(milbCoverage * 100)}%) — using current rosters`,
          })
          // During spring training, ALWAYS fetch last year's rosters to estimate
          // each player's level, then promote by one level. Current MiLB rosters
          // are unreliable before April — they may have some entries but not all players.
          let lastYearMilbLookup = new Map<number, PlayerTeamAssignment>()
          if (isSpringTraining) {
            const lastYear = now.getFullYear() - 1
            const lastYearTeamsToQuery = allAffiliates
              .filter((a) => [...parentOrgIds].some((orgId) => a.parentOrgId === orgId) && a.sportId !== 1)
              .map((a) => ({ teamId: a.teamId, sportId: a.sportId, teamName: a.teamName }))

            if (lastYearTeamsToQuery.length > 0) {
              const lastYearEntries = await fetchAllRosters(lastYearTeamsToQuery, undefined, lastYear)
              for (const entry of lastYearEntries) {
                if (entry.playerId > 0) {
                  lastYearMilbLookup.set(entry.playerId, {
                    teamId: entry.teamId,
                    sportId: entry.sportId,
                    teamName: entry.teamName,
                  })
                }
              }
            }
          }

          // Promotion map: sportId → promoted sportId
          // 14 (A) → 13 (High-A), 13 → 12 (AA), 12 → 11 (AAA), 11 → 11 (stay AAA)
          const PROMOTE_SPORT: Record<number, number> = { 14: 13, 13: 12, 12: 11, 11: 11 }

          // Find the affiliate team for a promoted sportId within the same org
          // Skip complex league teams (ACL/FCL/Prospects/DSL) — they don't play regular schedules
          const COMPLEX_LEAGUE_PATTERNS = /\b(ACL|FCL|DSL|Prospects|Complex)\b/i
          function findAffiliateForSport(orgId: number, targetSportId: number): { teamId: number; sportId: number; teamName: string } | null {
            // First try to find a non-complex-league team at this level
            const match = allAffiliates.find((a) =>
              a.parentOrgId === orgId && a.sportId === targetSportId && !COMPLEX_LEAGUE_PATTERNS.test(a.teamName)
            )
            if (match) return { teamId: match.teamId, sportId: match.sportId, teamName: match.teamName }
            // Fall back to any team at this level
            const fallback = allAffiliates.find((a) => a.parentOrgId === orgId && a.sportId === targetSportId)
            return fallback ? { teamId: fallback.teamId, sportId: fallback.sportId, teamName: fallback.teamName } : null
          }

          // Assign players: prefer MiLB roster (where they're actually playing)
          // over 40-man roster (where they might just be on the reserve list).
          // During spring training, use last year's level + 1 as estimate.
          const remainingPlayers: typeof proPlayers = []
          for (const player of proPlayers) {
            // Check current MiLB first — if found, they're playing at that level
            const milbMatch = milbPlayerIdToTeam.get(player.mlbPlayerId!)
            if (milbMatch) {
              // During spring training, skip complex league teams (ACL/FCL/Prospects)
              // — the player is probably at a higher level and just listed there as a default
              if (isSpringTraining && COMPLEX_LEAGUE_PATTERNS.test(milbMatch.teamName)) {
                // Fall through to spring training promotion logic below
              } else {
                newAssignments[player.playerName] = { ...milbMatch, source: 'milb-roster' }
                assignedCount++
                continue
              }
            }

            // Spring training fallback: use last year's level, promote by 1
            if (isSpringTraining && lastYearMilbLookup.size > 0) {
              const lastYearMatch = lastYearMilbLookup.get(player.mlbPlayerId!)
              if (lastYearMatch) {
                const promotedSportId = PROMOTE_SPORT[lastYearMatch.sportId] ?? lastYearMatch.sportId
                const orgId = resolveMLBTeamId(player.org, customMlb)
                const promoted = orgId ? findAffiliateForSport(orgId, promotedSportId) : null
                if (promoted) {
                  newAssignments[player.playerName] = { ...promoted, source: 'estimated' }
                  assignedCount++
                  continue
                }
              }
            }

            // If player was on a complex league team and promotion logic didn't find them,
            // assign to the org's lowest full-season affiliate (A→High-A→AA→AAA) instead of MLB
            const wasOnComplexTeam = milbMatch && COMPLEX_LEAGUE_PATTERNS.test(milbMatch.teamName)
            if (isSpringTraining && wasOnComplexTeam) {
              const orgId = resolveMLBTeamId(player.org, customMlb)
              if (orgId) {
                // Try A (14), then High-A (13), then AA (12), then AAA (11)
                const levelOrder = [14, 13, 12, 11]
                let assigned = false
                for (const sportId of levelOrder) {
                  const affiliate = findAffiliateForSport(orgId, sportId)
                  if (affiliate) {
                    newAssignments[player.playerName] = { ...affiliate, source: 'estimated' }
                    assignedCount++
                    assigned = true
                    break
                  }
                }
                if (assigned) continue
              }
            }

            // Fall back to MLB roster (40-man)
            const mlbMatch2 = mlbPlayerIdToTeam.get(player.mlbPlayerId!)
            if (mlbMatch2) {
              // On the 40-man roster — assign to MLB team directly.
              // During spring training this is the right call for established MLB players
              // who weren't found on any complex league team.
              newAssignments[player.playerName] = { ...mlbMatch2, source: 'mlb-roster' }
              assignedCount++
            } else {
              remainingPlayers.push(player)
            }
          }

          // For remaining players (not found on any roster), mark as not found
          for (const player of remainingPlayers) {
            notFoundNames.push(player.playerName)
          }

          // Phase 3: Name-based fallback for players without mlbPlayerId
          if (proPlayersWithoutId.length > 0) {
            // Build a name lookup from all rosters already fetched (MLB + MiLB)
            const allRosterEntries = [...mlbRosterEntries, ...milbRosterEntries]

            const nameToTeam = new Map<string, PlayerTeamAssignment>()
            for (const entry of allRosterEntries) {
              if (entry.fullName) {
                nameToTeam.set(entry.fullName.toLowerCase().trim(), {
                  teamId: entry.teamId,
                  sportId: entry.sportId,
                  teamName: entry.teamName,
                })
              }
            }

            for (const player of proPlayersWithoutId) {
              const normalizedName = player.playerName.toLowerCase().trim()
              const match = nameToTeam.get(normalizedName)
              if (match) {
                // During spring training, redirect MLB-level matches to MiLB estimate
                if (isSpringTraining && match.sportId === 1) {
                  const orgId = resolveMLBTeamId(player.org, customMlb)
                  const highA = orgId ? findAffiliateForSport(orgId, 13) : null
                  if (highA) {
                    newAssignments[player.playerName] = { ...highA, source: 'estimated' }
                    assignedCount++
                    const idx = notFoundNames.indexOf(player.playerName)
                    if (idx >= 0) notFoundNames.splice(idx, 1)
                    continue
                  }
                }
                newAssignments[player.playerName] = { ...match, source: match.sportId === 1 ? 'mlb-roster' : 'milb-roster' }
                assignedCount++
                // Remove from notFoundNames if present
                const idx = notFoundNames.indexOf(player.playerName)
                if (idx >= 0) notFoundNames.splice(idx, 1)
              } else {
                if (!notFoundNames.includes(player.playerName)) {
                  notFoundNames.push(player.playerName)
                }
              }
            }
          }

          // Build activity log — compare old vs new assignments
          const oldAssignments = state.playerTeamAssignments
          const changeLog: AssignmentChange[] = []
          const logTimestamp = Date.now()
          for (const [playerName, newAssignment] of Object.entries(newAssignments)) {
            const oldAssignment = oldAssignments[playerName]
            if (!oldAssignment) {
              changeLog.push({ playerName, action: 'assigned', to: newAssignment.teamName, timestamp: logTimestamp })
            } else if (oldAssignment.teamId !== newAssignment.teamId) {
              changeLog.push({ playerName, action: 'reassigned', from: oldAssignment.teamName, to: newAssignment.teamName, timestamp: logTimestamp })
            } else {
              // Same assignment — confirmed
              changeLog.push({ playerName, action: 'assigned', to: newAssignment.teamName, timestamp: logTimestamp })
            }
          }
          for (const name of notFoundNames) {
            changeLog.push({ playerName: name, action: 'not-found', timestamp: logTimestamp })
          }

          set({
            playerTeamAssignments: newAssignments,
            autoAssignLoading: false,
            autoAssignResult: {
              assigned: assignedCount,
              confirmed: Object.values(newAssignments).filter((a) => a.source === 'milb-roster' || a.source === 'mlb-roster').length,
              estimated: Object.values(newAssignments).filter((a) => a.source === 'estimated').length,
              notFound: notFoundNames,
              springTrainingEstimate: isSpringTraining,
            },
            assignmentLog: [...(get().assignmentLog ?? []), ...changeLog],
          })

          // Re-process cached schedule data with new assignments
          // so players appear on their correct team's games
          const cachedSchedules = get().proSchedules
          if (cachedSchedules && Object.keys(cachedSchedules).length > 0) {
            get().regenerateProGames()
          }

          // Diagnostics
          const diagAuto = useDiagnosticsStore.getState()
          if (notFoundNames.length > 0) {
            diagAuto.addIssue({
              level: 'warning',
              source: 'pro',
              message: `${notFoundNames.length} player(s) not found on any roster`,
              details: notFoundNames.join(', '),
            })
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error'
          set({
            autoAssignLoading: false,
            autoAssignResult: { assigned: 0, confirmed: 0, estimated: 0, notFound: [...proPlayers, ...proPlayersWithoutId].map((p) => p.playerName), error: msg },
          })
          console.error('Auto-assign failed:', e)
        }
      },

      regenerateProGames: () => {
        const state = get()
        const assignments = state.playerTeamAssignments
        const rawSchedules = state.proSchedules

        // Build player-to-teamId mapping directly from assignments
        const playersByTeamId = new Map<number, string[]>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          const existing = playersByTeamId.get(assignment.teamId)
          if (existing) existing.push(playerName)
          else playersByTeamId.set(assignment.teamId, [playerName])
        }

        // Re-process cached raw game data
        const allGames: GameEvent[] = []
        const seenIds = new Set<string>()
        for (const [teamIdStr, games] of Object.entries(rawSchedules)) {
          const teamId = parseInt(teamIdStr)
          const teamPlayers = playersByTeamId.get(teamId) ?? []
          if (teamPlayers.length === 0) continue

          for (const game of games) {
            const event = mlbGameToEvent(game, teamId, teamPlayers)
            if (event && !seenIds.has(event.id)) {
              seenIds.add(event.id)
              allGames.push(event)
            }
          }
        }

        allGames.sort((a, b) => a.date.localeCompare(b.date))
        set({ proGames: allGames })
      },

      fetchProSchedules: async (startDate, endDate) => {
        if (get().schedulesLoading) return
        const state = get()
        const assignments = state.playerTeamAssignments
        const allAffiliates = state.affiliates

        // Collect players by their specific assigned teamId
        const playersByTeamId = new Map<number, string[]>()
        const parentOrgIds = new Set<number>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          const existing = playersByTeamId.get(assignment.teamId)
          if (existing) existing.push(playerName)
          else playersByTeamId.set(assignment.teamId, [playerName])
          // Also track parent orgs so we fetch ALL affiliate schedules
          const aff = allAffiliates.find((a) => a.teamId === assignment.teamId)
          if (aff?.parentOrgId) parentOrgIds.add(aff.parentOrgId)
        }

        if (playersByTeamId.size === 0) {
          set({ proGames: [], schedulesError: 'No players assigned to teams yet' })
          return
        }

        // For each parent org, get ALL affiliate teams (not just assigned ones)
        const teamsToFetch: Array<{ teamId: number; sportId: number }> = []
        for (const parentOrgId of parentOrgIds) {
          const orgAffiliates = allAffiliates.filter((a) => a.parentOrgId === parentOrgId)
          for (const aff of orgAffiliates) {
            if (!teamsToFetch.some((t) => t.teamId === aff.teamId)) {
              teamsToFetch.push({ teamId: aff.teamId, sportId: aff.sportId })
            }
          }
        }

        set({ schedulesLoading: true, schedulesError: null, schedulesProgress: { completed: 0, total: teamsToFetch.length } })

        try {
          const schedules = await fetchAllSchedules(teamsToFetch, startDate, endDate, (completed, total) => {
            set({ schedulesProgress: { completed, total } })
          })

          // Convert to GameEvents — attach only players assigned to this specific team
          const allGames: GameEvent[] = []
          const seenIds = new Set<string>()
          let droppedGames = 0

          for (const [teamId, games] of schedules.entries()) {
            const teamPlayers = playersByTeamId.get(teamId) ?? []
            if (teamPlayers.length === 0) continue

            for (const game of games) {
              const event = mlbGameToEvent(game, teamId, teamPlayers)
              if (event && !seenIds.has(event.id)) {
                seenIds.add(event.id)
                allGames.push(event)
              } else if (!event) {
                droppedGames++
              }
            }
          }

          // Sort by date
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          const rawSchedules: Record<number, MLBGameRaw[]> = {}
          for (const [teamId, games] of schedules.entries()) {
            rawSchedules[teamId] = games
          }

          set({
            proSchedules: rawSchedules,
            proGames: allGames,
            proDroppedGames: droppedGames,
            schedulesLoading: false,
            schedulesProgress: null,
            proFetchedAt: Date.now(),
            cachedProTeamIds: [...teamsToFetch.keys()],
          })

          // Diagnostics
          const diag = useDiagnosticsStore.getState()
          diag.clearSource('pro')
          if (droppedGames > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'pro',
              message: `${droppedGames} Pro games dropped — missing venue coordinates`,
            })
          }
        } catch (e) {
          set({
            schedulesLoading: false,
            schedulesError: e instanceof Error ? e.message : 'Failed to fetch schedules',
            schedulesProgress: null,
          })
        }
      },
      checkRosterMoves: async () => {
        if (get().rosterMovesLoading) return
        const state = get()
        const assignments = state.playerTeamAssignments
        const allAffiliates = state.affiliates

        // Collect unique parent org IDs from assigned players
        const parentOrgIds = new Set<number>()
        for (const assignment of Object.values(assignments)) {
          const aff = allAffiliates.find((a) => a.teamId === assignment.teamId)
          if (aff?.parentOrgId) parentOrgIds.add(aff.parentOrgId)
        }

        if (parentOrgIds.size === 0) return

        set({ rosterMovesLoading: true })

        try {
          // Look back to start of current season (Feb 1) to catch all moves
          const now = new Date()
          const endDate = now.toISOString().split('T')[0]!
          const seasonStart = new Date(now.getFullYear(), 1, 1) // Feb 1
          const startDate = seasonStart.toISOString().split('T')[0]!

          const txResult = await fetchAllTransactions(
            [...parentOrgIds],
            startDate,
            endDate,
          )
          const transactions = txResult.transactions
          if (txResult.failedTeamIds.length > 0) {
            console.warn(`Transaction fetch failed for ${txResult.failedTeamIds.length} team(s):`, txResult.failedTeamIds)
          }

          // Cross-reference: find transactions involving assigned players
          const playerMlbIds = new Map<number, string>() // mlbPlayerId → playerName
          const playerAssignedTeams = new Map<string, number>() // playerName → assigned teamId

          const rosterPlayers = useRosterStore.getState().players

          for (const player of rosterPlayers) {
            if (player.level !== 'Pro' || !player.mlbPlayerId) continue
            playerMlbIds.set(player.mlbPlayerId, player.playerName)
            const assignment = assignments[player.playerName]
            if (assignment) playerAssignedTeams.set(player.playerName, assignment.teamId)
          }

          // Filter transactions to only those involving our rostered players
          const relevantMoves = transactions.filter((t) => {
            const playerName = playerMlbIds.get(t.player.id)
            if (!playerName) return false
            // Check if the destination team differs from their current assignment
            const assignedTeamId = playerAssignedTeams.get(playerName)
            if (!assignedTeamId || !t.toTeam) return false
            return t.toTeam.id !== assignedTeamId
          })

          // Auto-correct assignments based on detected moves
          const updatedAssignments = { ...assignments }
          const moveLog: AssignmentChange[] = []
          const moveTimestamp = Date.now()

          for (const move of relevantMoves) {
            const playerName = playerMlbIds.get(move.player.id)
            if (!playerName || !move.toTeam) continue

            const oldAssignment = assignments[playerName]
            if (!oldAssignment) continue

            // Find the destination team in affiliates to get sportId
            const destAff = allAffiliates.find((a) => a.teamId === move.toTeam!.id)
            if (destAff) {
              updatedAssignments[playerName] = {
                teamId: destAff.teamId,
                sportId: destAff.sportId,
                teamName: destAff.teamName,
              }
              moveLog.push({
                playerName,
                action: 'reassigned',
                from: oldAssignment.teamName,
                to: destAff.teamName,
                timestamp: moveTimestamp,
              })
            }
          }

          set({
            rosterMoves: relevantMoves,
            rosterMovesLoading: false,
            rosterMovesCheckedAt: new Date().toISOString(),
            // Auto-update assignments from detected moves
            ...(moveLog.length > 0 ? {
              playerTeamAssignments: updatedAssignments,
              assignmentLog: [...(get().assignmentLog ?? []), ...moveLog].slice(-50),
            } : {}),
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error'
          set({
            rosterMovesLoading: false,
            rosterMovesError: `Failed to check roster moves: ${msg}`,
          })
          console.error('Failed to check roster moves:', e)
        }
      },
      fetchNcaaSchedules: async (playerOrgs, { merge = false, forceRefresh = false } = {}) => {
        if (get().ncaaLoading) return
        // Resolve each player's org to a canonical NCAA school name
        const customNcaa = get().customNcaaAliases
        const schoolToPlayers = new Map<string, string[]>()
        for (const { playerName, org } of playerOrgs) {
          const canonical = resolveNcaaName(org, customNcaa)
          if (!canonical) continue
          const existing = schoolToPlayers.get(canonical)
          if (existing) existing.push(playerName)
          else schoolToPlayers.set(canonical, [playerName])
        }

        if (schoolToPlayers.size === 0) {
          set({ ncaaError: 'No recognized NCAA schools found' })
          return
        }

        const prevState = get()
        set({
          ncaaLoading: true,
          ncaaError: null,
          ncaaProgress: { completed: 0, total: schoolToPlayers.size },
          ncaaFailedSchools: merge ? prevState.ncaaFailedSchools : [],
          ncaaDroppedAwayGames: merge ? prevState.ncaaDroppedAwayGames : 0,
        })

        try {
          const { schedules, failedSchools } = await fetchAllD1Schedules(
            [...schoolToPlayers.keys()],
            (completed, total) => set({ ncaaProgress: { completed, total } }),
            { forceRefresh },
          )

          // Convert D1 games to GameEvents
          const newGames: GameEvent[] = []
          const schedulesObj: Record<string, D1Schedule> = merge ? { ...prevState.ncaaSchedules } : {}
          let droppedAwayGames = merge ? prevState.ncaaDroppedAwayGames : 0

          // Collect unresolved away games for async geocoding
          const unresolvedAway: Array<{ school: string; game: D1Schedule['games'][number]; playerNames: string[] }> = []

          for (const [school, schedule] of schedules) {
            schedulesObj[school] = schedule
            const playerNames = schoolToPlayers.get(school) ?? []
            const homeVenue = NCAA_VENUES[school]

            for (const game of schedule.games) {
              const d = new Date(game.date + 'T12:00:00Z')

              let venue: { name: string; coords: { lat: number; lng: number } }
              if (game.isHome && homeVenue) {
                venue = { name: homeVenue.venueName, coords: homeVenue.coords }
              } else if (!game.isHome) {
                // Away game: try sync resolution first (fast)
                const oppVenue = resolveOpponentVenue(game.opponent, game.opponentSlug)
                if (oppVenue) {
                  venue = oppVenue
                } else {
                  // Queue for async geocoding
                  unresolvedAway.push({ school, game, playerNames })
                  continue
                }
              } else {
                continue // No venue coords
              }

              newGames.push({
                id: `ncaa-d1-${school.toLowerCase().replace(/\s+/g, '-')}-${game.date}-${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                date: game.date,
                dayOfWeek: d.getUTCDay(),
                time: game.date + 'T14:00:00Z',
                homeTeam: game.isHome ? school : game.opponent,
                awayTeam: game.isHome ? game.opponent : school,
                isHome: game.isHome,
                venue,
                source: 'ncaa-lookup',
                playerNames,
                confidence: 'high',
                confidenceNote: game.isHome
                  ? 'Confirmed home game from D1Baseball'
                  : `Away game at ${game.opponent}`,
                sourceUrl: `https://d1baseball.com/team/${schedule.slug}/schedule/`,
              })
            }
          }

          // Phase 2: Resolve away games at unknown venues
          // Try cached venues first (instant), then batch-geocode uncached ones
          if (unresolvedAway.length > 0) {
            const needsGeocoding: typeof unresolvedAway = []
            // Fast pass: resolve from localStorage cache
            for (const entry of unresolvedAway) {
              const oppVenue = resolveOpponentVenue(entry.game.opponent, entry.game.opponentSlug)
              if (oppVenue) {
                const d = new Date(entry.game.date + 'T12:00:00Z')
                newGames.push({
                  id: `ncaa-d1-${entry.school.toLowerCase().replace(/\s+/g, '-')}-${entry.game.date}-${entry.game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                  date: entry.game.date,
                  dayOfWeek: d.getUTCDay(),
                  time: entry.game.date + 'T14:00:00Z',
                  homeTeam: entry.game.opponent,
                  awayTeam: entry.school,
                  isHome: false,
                  venue: oppVenue,
                  source: 'ncaa-lookup',
                  playerNames: entry.playerNames,
                  confidence: 'medium',
                  confidenceNote: `Away game at ${entry.game.opponent} (cached venue)`,
                  sourceUrl: `https://d1baseball.com/team/${schedulesObj[entry.school]!.slug}/schedule/`,
                })
              } else {
                needsGeocoding.push(entry)
              }
            }

            // Async geocoding only for truly unknown venues — skip on first load
            // (bundled data + NCAA_VENUES covers most cases; geocode on reload)
            const MAX_GEOCODE = merge ? 10 : 0
            const geocodeBatch = needsGeocoding.slice(0, MAX_GEOCODE)
            if (geocodeBatch.length > 0) {
              const baseCompleted = schoolToPlayers.size
              const extendedTotal = baseCompleted + geocodeBatch.length
              set({ ncaaProgress: { completed: baseCompleted, total: extendedTotal } })
              let geocoded = 0
              let geocodeIdx = 0
              for (const { school, game, playerNames } of geocodeBatch) {
                geocodeIdx++
                set({ ncaaProgress: { completed: baseCompleted + geocodeIdx, total: extendedTotal } })
                const oppVenue = await resolveOpponentVenueAsync(
                  game.opponent, game.opponentSlug,
                  game.venueName, game.venueCity,
                )
                if (oppVenue) {
                  const d = new Date(game.date + 'T12:00:00Z')
                  const schedule = schedulesObj[school]!
                  newGames.push({
                    id: `ncaa-d1-${school.toLowerCase().replace(/\s+/g, '-')}-${game.date}-${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                    date: game.date,
                    dayOfWeek: d.getUTCDay(),
                    time: game.date + 'T14:00:00Z',
                    homeTeam: game.opponent,
                    awayTeam: school,
                    isHome: false,
                    venue: oppVenue,
                    source: 'ncaa-lookup',
                    playerNames,
                    confidence: 'medium',
                    confidenceNote: `Away game at ${game.opponent} (venue geocoded)`,
                    sourceUrl: `https://d1baseball.com/team/${schedule.slug}/schedule/`,
                  })
                  geocoded++
                } else {
                  droppedAwayGames++
                }
                // Rate limit for Nominatim
                await new Promise(r => setTimeout(r, 1200))
              }
              if (geocoded > 0) {
                const diag = useDiagnosticsStore.getState()
                diag.addIssue({
                  level: 'info',
                  source: 'ncaa',
                  message: `${geocoded} NCAA away game venue(s) discovered via geocoding`,
                })
              }
            }
            // Count remaining unresolved as dropped (will be geocoded on next load from cache)
            droppedAwayGames += needsGeocoding.length - geocodeBatch.length
          }

          // Merge or replace games
          let allGames: GameEvent[]
          if (merge) {
            // Dedup by game ID — new games overwrite existing ones for the same ID
            const gameMap = new Map<string, GameEvent>()
            for (const g of prevState.ncaaGames) gameMap.set(g.id, g)
            for (const g of newGames) gameMap.set(g.id, g)
            allGames = [...gameMap.values()]
          } else {
            allGames = newGames
          }
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          // Merge failed schools — append new failures, don't duplicate
          const mergedFailed = merge
            ? [...new Set([...prevState.ncaaFailedSchools, ...failedSchools])]
            : failedSchools

          set({
            ncaaSchedules: schedulesObj,
            ncaaGames: allGames,
            ncaaLoading: false,
            ncaaProgress: null,
            ncaaFetchedAt: merge ? (prevState.ncaaFetchedAt ?? Date.now()) : Date.now(),
            ncaaFailedSchools: mergedFailed,
            ncaaDroppedAwayGames: droppedAwayGames,
            cachedNcaaSchools: [...new Set([...(merge ? prevState.cachedNcaaSchools ?? [] : []), ...schoolToPlayers.keys()])],
          })

          // Diagnostics
          const diag = useDiagnosticsStore.getState()
          diag.clearSource('ncaa')
          if (mergedFailed.length > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'ncaa',
              message: `${mergedFailed.length} NCAA school(s) failed to fetch`,
              details: mergedFailed.join(', '),
            })
          }
          if (droppedAwayGames > 0) {
            diag.addIssue({
              level: 'info',
              source: 'ncaa',
              message: `${droppedAwayGames} NCAA away games skipped — unknown opponent venue`,
            })
          }
        } catch (e) {
          set({
            ncaaLoading: false,
            ncaaError: e instanceof Error ? e.message : 'Failed to fetch NCAA schedules',
            ncaaProgress: null,
          })
        }
      },
      fetchHsSchedules: async (playerOrgs, { merge = false, forceRefresh = false } = {}) => {
        if (get().hsLoading) return

        // Group players by org|state key — include all schools (slug discovery
        // in fetchMaxPrepsSchedule will attempt to find unknown slugs automatically)
        const schoolToPlayers = new Map<string, string[]>()
        for (const { playerName, org, state } of playerOrgs) {
          const key = `${org}|${state}`
          const existing = schoolToPlayers.get(key)
          if (existing) existing.push(playerName)
          else schoolToPlayers.set(key, [playerName])
        }

        if (schoolToPlayers.size === 0) {
          set({ hsError: 'No HS schools found in roster' })
          return
        }

        const prevState = get()
        set({
          hsLoading: true,
          hsError: null,
          hsProgress: { completed: 0, total: schoolToPlayers.size },
          hsFailedSchools: merge ? prevState.hsFailedSchools : [],
        })

        try {
          const { schedules, failedSchools } = await fetchAllMaxPrepsSchedules(
            [...schoolToPlayers.keys()],
            (completed, total) => set({ hsProgress: { completed, total } }),
            { forceRefresh },
          )

          // Convert MaxPreps games to GameEvents — home games only
          const newGames: GameEvent[] = []
          const schedulesObj: Record<string, MaxPrepsSchedule> = merge ? { ...prevState.hsSchedules } : {}

          // Get venue store for home venue coords
          const venueState = useVenueStore.getState().venues

          for (const [schoolKey, schedule] of schedules) {
            schedulesObj[schoolKey] = schedule
            const playerNames = schoolToPlayers.get(schoolKey) ?? []

            // Look up home venue coords — check bundled coords first, then venueStore
            let homeVenue: { name: string; coords: { lat: number; lng: number } } | null = null
            const [schoolOrg] = schoolKey.split('|')

            // Use bundled venue coords if available (from generateSchedules.ts geocoding)
            if (schedule.homeVenue) {
              homeVenue = {
                name: schedule.homeVenue.name,
                coords: { lat: schedule.homeVenue.lat, lng: schedule.homeVenue.lng },
              }
            }

            const normalizedSchoolOrg = (schoolOrg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
            if (!homeVenue) for (const [vKey, v] of Object.entries(venueState)) {
              if (v.source === 'hs-geocoded') {
                const venueSchoolKey = vKey.replace(/^hs-/, '')
                // Match on org name portion (venueStore key: "OrgName|City, State")
                const [venueOrg] = venueSchoolKey.split('|')
                const normalizedVenueOrg = (venueOrg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
                // Exact match or fuzzy: one name contains the other (handles "Hebron" vs "Hebron High School")
                if (normalizedVenueOrg === normalizedSchoolOrg ||
                    normalizedVenueOrg.includes(normalizedSchoolOrg) ||
                    normalizedSchoolOrg.includes(normalizedVenueOrg)) {
                  homeVenue = { name: v.name, coords: v.coords }
                  break
                }
              }
            }

            if (!homeVenue) {
              // Add diagnostic warning — these players will fall back to synthetic events
              const diag = useDiagnosticsStore.getState()
              diag.addIssue({
                level: 'warning',
                source: 'hs',
                message: `HS venue not geocoded for ${schoolKey.split('|')[0]} — games will use roster coordinates as fallback`,
                details: `Players: ${playerNames.join(', ')}`,
              })

              // Fallback: try matching by full key (org|state) or any venue with the school org name
              for (const [vKey, v] of Object.entries(venueState)) {
                if (v.source === 'hs-geocoded') {
                  const normalizedVKey = vKey.replace(/^hs-/, '').toLowerCase().replace(/[^a-z0-9|]/g, '')
                  if (normalizedVKey.includes(normalizedSchoolOrg)) {
                    homeVenue = { name: v.name, coords: v.coords }
                    break
                  }
                }
              }
              if (!homeVenue) {
                continue // No venue found — truly unresolvable
              }
            }

            // Collect away games for async geocoding
            const hsAwayGames: Array<{ game: typeof schedule.games[number]; schoolOrg: string }> = []

            for (const game of schedule.games) {
              const d = new Date(game.date + 'T12:00:00Z')
              const [schoolOrg] = schoolKey.split('|')

              if (game.isHome) {
                newGames.push({
                  id: `hs-mp-${schoolKey.toLowerCase().replace(/[|]/g, '-')}-${game.date}-${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                  date: game.date,
                  dayOfWeek: d.getUTCDay(),
                  time: game.time ?? game.date + 'T16:00:00Z',
                  homeTeam: schedule.teamName || schoolOrg || schoolKey,
                  awayTeam: game.opponent,
                  isHome: true,
                  venue: homeVenue,
                  source: 'hs-lookup',
                  playerNames,
                  confidence: 'high',
                  confidenceNote: 'Confirmed home game from MaxPreps',
                  sourceUrl: `https://www.maxpreps.com/${schedule.slug}/baseball/schedule/`,
                })
              } else {
                // Queue away game for geocoding
                hsAwayGames.push({ game, schoolOrg: schoolOrg || schoolKey })
              }
            }

            // Geocode away game venues
            for (const { game, schoolOrg } of hsAwayGames) {
              try {
                const params = new URLSearchParams({
                  q: `${game.opponent} high school baseball field`,
                  format: 'json',
                  limit: '1',
                  countrycodes: 'us',
                })
                const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
                  headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures internal tool)' },
                })
                if (res.ok) {
                  const results = await res.json()
                  if (results.length > 0) {
                    const coords = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) }
                    if (coords.lat >= 24.5 && coords.lat <= 49.5 && coords.lng >= -125.0 && coords.lng <= -66.5) {
                      const d = new Date(game.date + 'T12:00:00Z')
                      newGames.push({
                        id: `hs-mp-${schoolKey.toLowerCase().replace(/[|]/g, '-')}-${game.date}-away-${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                        date: game.date,
                        dayOfWeek: d.getUTCDay(),
                        time: game.time ?? game.date + 'T16:00:00Z',
                        homeTeam: game.opponent,
                        awayTeam: schedule.teamName || schoolOrg,
                        isHome: false,
                        venue: { name: `${game.opponent} Field`, coords },
                        source: 'hs-lookup',
                        playerNames,
                        confidence: 'medium',
                        confidenceNote: `Away game at ${game.opponent} (venue geocoded)`,
                        sourceUrl: `https://www.maxpreps.com/${schedule.slug}/baseball/schedule/`,
                      })
                    }
                  }
                }
              } catch {
                // Skip if geocoding fails
              }
              // Rate limit for Nominatim
              await new Promise(r => setTimeout(r, 1200))
            }
          }

          // Merge or replace games
          let allGames: GameEvent[]
          if (merge) {
            const gameMap = new Map<string, GameEvent>()
            for (const g of prevState.hsGames) gameMap.set(g.id, g)
            for (const g of newGames) gameMap.set(g.id, g)
            allGames = [...gameMap.values()]
          } else {
            allGames = newGames
          }
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          // Merge failed schools
          const mergedFailed = merge
            ? [...new Set([...prevState.hsFailedSchools, ...failedSchools])]
            : failedSchools

          set({
            hsSchedules: schedulesObj,
            hsGames: allGames,
            hsLoading: false,
            hsProgress: null,
            hsFetchedAt: merge ? (prevState.hsFetchedAt ?? Date.now()) : Date.now(),
            hsFailedSchools: mergedFailed,
            cachedHsSchools: [...new Set([...(merge ? prevState.cachedHsSchools ?? [] : []), ...schoolToPlayers.keys()])],
          })

          // Diagnostics
          const diag = useDiagnosticsStore.getState()
          diag.clearSource('hs')
          if (mergedFailed.length > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'hs',
              message: `${mergedFailed.length} HS school(s) failed to fetch`,
              details: mergedFailed.join(', '),
            })
          }
        } catch (e) {
          set({
            hsLoading: false,
            hsError: e instanceof Error ? e.message : 'Failed to fetch HS schedules',
            hsProgress: null,
          })
        }
      },
    }),
    {
      name: 'sv-travel-schedule',
      version: 3,
      storage: createJSONStorage(() => idbStorage),
      migrate: (persisted: any) => ({
        playerTeamAssignments: persisted?.playerTeamAssignments ?? {},
        affiliates: persisted?.affiliates ?? [],
        customMlbAliases: persisted?.customMlbAliases ?? {},
        customNcaaAliases: persisted?.customNcaaAliases ?? {},
        rosterMoves: persisted?.rosterMoves ?? [],
        rosterMovesCheckedAt: persisted?.rosterMovesCheckedAt ?? null,
        // Preserve cached game data across migrations
        proGames: persisted?.proGames ?? [],
        ncaaGames: persisted?.ncaaGames ?? [],
        hsGames: persisted?.hsGames ?? [],
        proFetchedAt: persisted?.proFetchedAt ?? null,
        ncaaFetchedAt: persisted?.ncaaFetchedAt ?? null,
        hsFetchedAt: persisted?.hsFetchedAt ?? null,
        // Track which teams/schools are in the cache for incremental fetching
        cachedProTeamIds: persisted?.cachedProTeamIds ?? [],
        cachedNcaaSchools: persisted?.cachedNcaaSchools ?? [],
        cachedHsSchools: persisted?.cachedHsSchools ?? [],
      }),
      partialize: (state) => ({
        playerTeamAssignments: state.playerTeamAssignments,
        affiliates: state.affiliates,
        customMlbAliases: state.customMlbAliases,
        customNcaaAliases: state.customNcaaAliases,
        assignmentLog: (state.assignmentLog ?? []).slice(-50),
        rosterMoves: state.rosterMoves,
        rosterMovesCheckedAt: state.rosterMovesCheckedAt,
        // Persist game data (stored in IndexedDB, no size limit)
        proGames: state.proGames,
        // NCAA and HS games are NOT persisted — always recomputed from bundled data on startup
        // This prevents stale cached games from overriding newer bundled schedules
        proFetchedAt: state.proFetchedAt,
        // Track cached coverage for incremental fetching
        cachedProTeamIds: state.cachedProTeamIds,
        cachedNcaaSchools: state.cachedNcaaSchools,
        cachedHsSchools: state.cachedHsSchools,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          affiliates: p?.affiliates ?? [],
          playerTeamAssignments: p?.playerTeamAssignments ?? {},
          customMlbAliases: p?.customMlbAliases ?? {},
          customNcaaAliases: p?.customNcaaAliases ?? {},
          assignmentLog: p?.assignmentLog ?? [],
          // Restore cached game data (was previously cleared every session)
          proGames: p?.proGames ?? [],
          // NCAA and HS games always start empty — recomputed from bundle on startup
          ncaaGames: [],
          hsGames: [],
          proFetchedAt: p?.proFetchedAt ?? null,
          ncaaFetchedAt: null,
          hsFetchedAt: null,
          cachedProTeamIds: p?.cachedProTeamIds ?? [],
          cachedNcaaSchools: p?.cachedNcaaSchools ?? [],
          cachedHsSchools: p?.cachedHsSchools ?? [],
          rosterMoves: p?.rosterMoves ?? [],
        }
      },
    },
  ),
)
