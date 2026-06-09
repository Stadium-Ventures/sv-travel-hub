import { Component, useEffect, type ReactNode } from 'react'
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

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl p-10">
          <h1 className="text-xl font-bold text-accent-red">Something went wrong</h1>
          <pre className="mt-4 overflow-auto rounded-lg bg-surface p-4 text-sm text-text-dim">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-text-dim hover:text-text"
            >
              Reload Page
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

  return null
}
