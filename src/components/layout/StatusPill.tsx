import { useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useSummerStore } from '../../store/summerStore'
import { useRehabStore } from '../../store/rehabStore'

/**
 * Compact data-freshness indicator in the header. Tells Kent at a glance
 * whether any source is currently loading, when each one was last refreshed,
 * and whether any is stale. Click to expand for the per-source breakdown.
 */
export default function StatusPill() {
  const [open, setOpen] = useState(false)

  const rosterLoading = useRosterStore((s) => s.loading)
  const rosterFetched = useRosterStore((s) => s.lastFetchedAt)
  const heartbeatLoading = useHeartbeatStore((s) => s.loading)
  const heartbeatFetched = useHeartbeatStore((s) => s.lastFetchedAt)
  const proLoading = useScheduleStore((s) => s.schedulesLoading)
  const proFetched = useScheduleStore((s) => s.proFetchedAt)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaFetched = useScheduleStore((s) => s.ncaaFetchedAt)
  const summerLoading = useSummerStore((s) => s.loading)
  const summerFetched = useSummerStore((s) => s.fetchedAt)
  const rehabLoading = useRehabStore((s) => Object.keys(s.loading).length > 0)
  const rehabFetched = useRehabStore((s) => s.refreshedAt)

  // Per-source staleness thresholds. Matches AutoFetchData's refresh cadence
  // so the pill agrees with what the app actually re-fetches.
  const SIX_H = 6 * 3600_000
  const TWELVE_H = 12 * 3600_000
  const TWENTY_FOUR_H = 24 * 3600_000

  const sources = [
    { name: 'Roster', loading: rosterLoading, fetched: rosterFetched, staleMs: TWENTY_FOUR_H },
    { name: 'Heartbeat', loading: heartbeatLoading, fetched: heartbeatFetched, staleMs: SIX_H },
    { name: 'Pro games', loading: proLoading, fetched: proFetched, staleMs: SIX_H },
    { name: 'NCAA games', loading: ncaaLoading, fetched: ncaaFetched, staleMs: SIX_H },
    { name: 'Summer ball', loading: summerLoading, fetched: summerFetched, staleMs: SIX_H },
    { name: 'Rehab windows', loading: rehabLoading, fetched: rehabFetched, staleMs: TWELVE_H },
  ]

  const anyLoading = sources.some((s) => s.loading)
  const loadingCount = sources.filter((s) => s.loading).length

  const now = Date.now()
  function isStale(fetched: number | string | null | undefined, threshold: number): boolean {
    if (!fetched) return true
    const t = typeof fetched === 'string' ? new Date(fetched).getTime() : fetched
    return now - t > threshold
  }
  const staleCount = sources.filter((s) => !s.loading && isStale(s.fetched, s.staleMs)).length

  const summary = anyLoading
    ? `Refreshing ${loadingCount} source${loadingCount === 1 ? '' : 's'}…`
    : staleCount > 0
      ? `${staleCount} stale`
      : 'All current'

  const dotColor = anyLoading ? 'bg-accent-blue animate-pulse' : staleCount > 0 ? 'bg-accent-orange' : 'bg-accent-green'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-dim hover:text-text hover:border-accent-blue/50 transition-colors"
        title={`Data freshness — click for details${anyLoading ? ` (refreshing ${loadingCount})` : ''}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <span>{summary}</span>
        <span className={`text-text-dim/50 text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-text-dim/60 border-b border-border/40">
            Data Freshness
          </div>
          <div className="divide-y divide-border/30">
            {sources.map((s) => {
              const stale = !s.loading && isStale(s.fetched, s.staleMs)
              return (
                <div key={s.name} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-text">{s.name}</span>
                  <span className={`text-[10px] ${s.loading ? 'text-accent-blue' : stale ? 'text-accent-orange' : 'text-text-dim/60'}`}>
                    {s.loading ? 'refreshing…' : formatAgo(s.fetched)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function formatAgo(f: number | string | null | undefined): string {
  if (!f) return 'never'
  const t = typeof f === 'string' ? new Date(f).getTime() : f
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
