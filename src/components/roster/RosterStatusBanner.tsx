import { useRosterStore } from '../../store/rosterStore'
import AcceptSmallerRosterButton from './AcceptSmallerRosterButton'

/** App-wide roster problems, on every tab (the Map is where Kent lands, and
 *  these used to show only on Data health):
 *  - the roster came back far smaller than last time (shown, not trusted),
 *  - the roster could not load at all, so the map has no clients.
 *  The sign-in prompt is RegistrySignIn's job, so nothing shows here then. */
export default function RosterStatusBanner() {
  const shrinkBlocked = useRosterStore((s) => s.shrinkBlocked)
  const error = useRosterStore((s) => s.error)
  const needsSignIn = useRosterStore((s) => s.needsSignIn)
  const loading = useRosterStore((s) => s.loading)
  const playerCount = useRosterStore((s) => s.players.length)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)

  if (shrinkBlocked) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-accent-red/30 bg-accent-red/5 px-5 py-3 text-sm" role="alert">
        <span className="text-text">
          The roster has {shrinkBlocked.count} clients, down from {shrinkBlocked.previous} last time. Everyone's saved teams, trip picks and visit counts are kept until you confirm. If clients were not really removed, tell Tom in #sv-automation.
        </span>
        <AcceptSmallerRosterButton />
      </div>
    )
  }

  if (error && playerCount === 0 && !needsSignIn && !loading) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-accent-red/30 bg-accent-red/5 px-5 py-3 text-sm" role="alert">
        <span className="text-text">
          The roster could not load, so no clients show on the map or in trips. {error}
        </span>
        <button
          onClick={() => { void fetchRoster() }}
          className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
        >
          Retry
        </button>
      </div>
    )
  }

  return null
}
