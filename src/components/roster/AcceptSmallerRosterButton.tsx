import { useRosterStore } from '../../store/rosterStore'

/** Shown while the roster on screen is far smaller than the last good one.
 *  Confirming it prunes the saved state of everyone it leaves out. */
export default function AcceptSmallerRosterButton() {
  const acceptSmallerRoster = useRosterStore((s) => s.acceptSmallerRoster)
  const loading = useRosterStore((s) => s.loading)
  return (
    <button
      onClick={() => { void acceptSmallerRoster() }}
      disabled={loading}
      title="Only if clients really were removed. Their saved teams, trip picks and visit counts are dropped."
      className="rounded-lg border border-accent-red/40 px-4 py-2 text-sm font-medium text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
    >
      Confirm the smaller roster
    </button>
  )
}
