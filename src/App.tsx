import { Component, useEffect, type ReactNode } from 'react'
import AppShell from './components/layout/AppShell'
import RosterDashboard from './components/roster/RosterDashboard'
import TripPlanner from './components/trips/TripPlanner'
import MapView from './components/map/MapView'
import DataTab from './components/data/DataTab'
import { useSummerStore } from './store/summerStore'

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
  // Pull the summer assignment sheet at the top level so player-card badges
  // populate regardless of which tab the user lands on first. Stale check: 6h.
  const loadSummerAssignments = useSummerStore((s) => s.loadAssignments)
  const summerFetchedAt = useSummerStore((s) => s.fetchedAt)
  useEffect(() => {
    const stale = !summerFetchedAt || (Date.now() - new Date(summerFetchedAt).getTime() > 6 * 3600000)
    if (stale) loadSummerAssignments()
  }, [loadSummerAssignments, summerFetchedAt])

  return (
    <ErrorBoundary>
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
