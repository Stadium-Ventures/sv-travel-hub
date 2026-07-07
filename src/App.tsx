import { Component, useEffect, useRef, type ReactNode } from 'react'
import AppShell from './components/layout/AppShell'
import RosterDashboard from './components/roster/RosterDashboard'
import TripPlanner from './components/trips/TripPlanner'
import MapView from './components/map/MapView'
import DataTab from './components/data/DataTab'
import { useSummerStore } from './store/summerStore'
import { useRosterStore } from './store/rosterStore'
import { useHeartbeatStore } from './store/heartbeatStore'
import { useScheduleStore } from './store/scheduleStore'
import { useRehabStore } from './store/rehabStore'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Full stack goes to the console for debugging — Kent never needs to see it.
    console.error('[sv-travel-hub] App crashed:', error, info.componentStack ?? '')
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl p-10">
          <h1 className="text-xl font-bold text-accent-red">Something went wrong</h1>
          <p className="mt-3 text-sm text-text-dim">
            The app hit an unexpected error. Reloading usually fixes it — your data is safe.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-text-dim hover:text-text"
            >
              Try Again Without Reloading
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  // All "core" data sources are auto-fetched at the App level so they're
  // ready regardless of which tab the user lands on first. Previously these
  // lived inside RosterDashboard, which meant Heartbeat coloring and Rehab
  // clipping had no data until the user clicked Roster — confusing on a
  // freshly-loaded app.
  return (
    <ErrorBoundary>
      <AutoFetchData />
      <AppShell>
        {{
          roster: <RosterDashboard />,
          trips: <TripPlanner />,
          map: <MapView />,
          data: <DataTab />,
        }}
      </AppShell>
    </ErrorBoundary>
  )
}

/** Top-level data hydration. No UI; uses effects to refresh each source on
 *  its own cadence whenever it's stale. Order matters — Roster + Affiliates
 *  must be loaded before Rehab fetches kick in. */
function AutoFetchData() {
  // Per-source staleness thresholds — Roster barely changes (24h); Heartbeat
  // logs visits throughout the day (6h); Rehab posts ~once a day (12h).
  const SIX_H = 6 * 3600_000
  const TWELVE_H = 12 * 3600_000
  const TWENTY_FOUR_H = 24 * 3600_000

  const fetchRoster = useRosterStore((s) => s.fetchRoster)
  const rosterFetched = useRosterStore((s) => s.lastFetchedAt)
  useEffect(() => {
    const stale = !rosterFetched || (Date.now() - new Date(rosterFetched).getTime() > TWENTY_FOUR_H)
    if (stale) fetchRoster()
  }, [fetchRoster, rosterFetched, TWENTY_FOUR_H])

  const fetchHeartbeat = useHeartbeatStore((s) => s.fetchHeartbeat)
  const heartbeatFetched = useHeartbeatStore((s) => s.lastFetchedAt)
  useEffect(() => {
    const stale = !heartbeatFetched || (Date.now() - new Date(heartbeatFetched).getTime() > SIX_H)
    if (stale) fetchHeartbeat()
  }, [fetchHeartbeat, heartbeatFetched, SIX_H])

  const loadSummerAssignments = useSummerStore((s) => s.loadAssignments)
  const summerFetched = useSummerStore((s) => s.fetchedAt)
  useEffect(() => {
    const stale = !summerFetched || (Date.now() - new Date(summerFetched).getTime() > SIX_H)
    if (stale) loadSummerAssignments()
  }, [loadSummerAssignments, summerFetched, SIX_H])

  const checkRosterMoves = useScheduleStore((s) => s.checkRosterMoves)
  const rosterMovesCheckedAt = useScheduleStore((s) => s.rosterMovesCheckedAt)
  useEffect(() => {
    const stale = !rosterMovesCheckedAt || (Date.now() - new Date(rosterMovesCheckedAt).getTime() > TWENTY_FOUR_H)
    if (stale) {
      // Defer 3s so affiliates + roster have time to load first
      const id = setTimeout(() => { checkRosterMoves() }, 3000)
      return () => clearTimeout(id)
    }
  }, [checkRosterMoves, rosterMovesCheckedAt, TWENTY_FOUR_H])

  // Rehab fetch depends on roster + assignments. Re-runs when either changes
  // so a freshly-assigned MiLB player gets their rehab window populated.
  const players = useRosterStore((s) => s.players)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)
  const refreshRehab = useRehabStore((s) => s.refresh)
  const rehabRefreshedAt = useRehabStore((s) => s.refreshedAt)
  useEffect(() => {
    const stale = !rehabRefreshedAt || (Date.now() - rehabRefreshedAt > TWELVE_H)
    if (!stale) return
    const candidates: Array<{ playerName: string; teamId: number; sportId: number }> = []
    for (const p of players) {
      if (p.level !== 'Pro') continue
      const a = playerTeamAssignments[p.playerName]
      if (!a) continue
      if (a.sportId >= 11 && a.sportId <= 14) {
        candidates.push({ playerName: p.playerName, teamId: a.teamId, sportId: a.sportId })
      }
    }
    if (candidates.length > 0) refreshRehab(candidates)
  }, [players, playerTeamAssignments, refreshRehab, rehabRefreshedAt, TWELVE_H])

  // Schedule fetches: Pro (MLB API), NCAA (bundled + scrape), HS (CSV),
  // and Summer (MLB API for live leagues). Previously these only fired
  // when TripPlanner mounted, which broke the Map tab when Kent landed
  // there first. Now they fire as soon as the roster is loaded, so the
  // Map has venue dots without needing a tab tour.
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const hsLoading = useScheduleStore((s) => s.hsLoading)
  const cachedProTeamIds = useScheduleStore((s) => s.cachedProTeamIds)
  const schedulesInitialized = useRef(false)
  useEffect(() => {
    if (schedulesInitialized.current) return
    if (players.length === 0) return // wait for roster
    const anyLoading = schedulesLoading || ncaaLoading || hsLoading
    if (anyLoading) return

    const hasHs = players.some((p) => p.level === 'HS')
    const allLoaded = proGames.length > 0 && ncaaGames.length > 0 && (!hasHs || hsGames.length > 0)

    if (allLoaded) {
      schedulesInitialized.current = true
      // Re-run HS + NCAA on startup so the latest bundled venue coords are used.
      const sched = useScheduleStore.getState()
      const hsOrgs = players.filter((p) => p.level === 'HS' && p.state).map((p) => ({ playerName: p.playerName, org: p.org, state: p.state! }))
      if (hsOrgs.length > 0) sched.fetchHsSchedules(hsOrgs)
      const ncaaOrgs = players.filter((p) => p.level === 'NCAA').map((p) => ({ playerName: p.playerName, org: p.org }))
      if (ncaaOrgs.length > 0) sched.fetchNcaaSchedules(ncaaOrgs)
      // Pick up any Pro teams that became assigned since the cache was built.
      const assigned = new Set(Object.values(sched.playerTeamAssignments).map((a) => a.teamId))
      const cachedSet = new Set(cachedProTeamIds)
      const missingProTeams = [...assigned].filter((id) => !cachedSet.has(id))
      if (missingProTeams.length > 0) {
        const y = new Date().getFullYear()
        sched.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
      }
      return
    }

    // Cold path: nothing cached. Walk through the same steps TripPlanner
    // used to run on its first mount.
    schedulesInitialized.current = true
    void (async () => {
      const sched = useScheduleStore.getState()
      // Pro: auto-assign players → MLB teams, then fetch schedules
      if (Object.keys(sched.playerTeamAssignments).length === 0) {
        await sched.autoAssignPlayers()
      }
      if (Object.keys(useScheduleStore.getState().playerTeamAssignments).length > 0) {
        const y = new Date().getFullYear()
        sched.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
      }
      // NCAA — bundled instant
      const ncaaOrgs = players.filter((p) => p.level === 'NCAA').map((p) => ({ playerName: p.playerName, org: p.org }))
      if (ncaaOrgs.length > 0) sched.fetchNcaaSchedules(ncaaOrgs)
      // HS — CSV (per yesterday's change, no bundled fallback).
      // Same `p.state` filter as the warm path above — players without a
      // state can't be matched to a school schedule.
      if (hasHs) {
        const hsOrgs = players.filter((p) => p.level === 'HS' && p.state).map((p) => ({ playerName: p.playerName, org: p.org, state: p.state! }))
        if (hsOrgs.length > 0) sched.fetchHsSchedules(hsOrgs)
      }
      // Summer — live partner leagues (CCBL, MLBD, Appalachian)
      const summer = useSummerStore.getState()
      if (summer.assignments.length === 0) {
        await summer.loadAssignments()
      }
      if (useSummerStore.getState().assignments.length > 0) {
        const y = new Date().getFullYear()
        summer.loadSchedules(`${y}-05-20`, `${y}-08-31`)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, proGames.length, ncaaGames.length, hsGames.length, schedulesLoading, ncaaLoading, hsLoading])

  return null
}
