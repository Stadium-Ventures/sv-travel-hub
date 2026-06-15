import { useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useSummerStore } from '../../store/summerStore'
import { useRehabStore } from '../../store/rehabStore'
import { useTripStore } from '../../store/tripStore'

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

  // "Stale" was alarming for what's usually a benign cache miss. Wording is
  // now neutral: "X to refresh" reads as routine rather than urgent.
  const summary = anyLoading
    ? `Refreshing ${loadingCount}…`
    : staleCount > 0
      ? `${staleCount} to refresh`
      : 'All current'

  const dotColor = anyLoading ? 'bg-accent-blue animate-pulse' : staleCount > 0 ? 'bg-accent-orange/70' : 'bg-accent-green'

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
        <div className="absolute right-0 top-full z-30 mt-1 w-72 max-h-[480px] overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
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
          <RecentActivitySection />
          <SlackRecapAdminSection />
        </div>
      )}
    </div>
  )
}

/** Admin-only "Send weekly Slack recap now" trigger. Hits the same serverless
 *  endpoint the Monday 6 AM ET cron hits. Requires CRON_SECRET; the user
 *  pastes it into a small prompt the first time (cached in localStorage) so
 *  Kent doesn't see this surface unless someone hands him the secret. */
function SlackRecapAdminSection() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  async function send(mode: 'live' | 'dry') {
    const stored = (() => { try { return localStorage.getItem('sv-cron-secret') ?? '' } catch { return '' } })()
    let secret = stored
    if (!secret) {
      const entered = window.prompt('Paste CRON_SECRET (one-time; cached locally):')
      if (!entered) return
      secret = entered.trim()
      try { localStorage.setItem('sv-cron-secret', secret) } catch {}
    }
    setStatus('sending'); setErrMsg(null)
    try {
      const url = `/api/slack-recap?secret=${encodeURIComponent(secret)}${mode === 'dry' ? '&dryRun=1' : ''}`
      const res = await fetch(url)
      const body = await res.json()
      if (!res.ok) {
        setStatus('err'); setErrMsg(body?.error ?? `HTTP ${res.status}`)
        if (res.status === 401) try { localStorage.removeItem('sv-cron-secret') } catch {}
        return
      }
      setStatus('ok')
      if (mode === 'dry') console.log('[slack-recap dry run]', body)
    } catch (e) {
      setStatus('err'); setErrMsg(e instanceof Error ? e.message : 'unknown')
    }
  }
  return (
    <div className="border-t border-border/40">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-text-dim/60">Slack recap</div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          onClick={() => send('live')}
          disabled={status === 'sending'}
          className="rounded-md bg-accent-blue/15 px-2 py-1 text-[10px] font-semibold text-accent-blue hover:bg-accent-blue/25 disabled:opacity-50"
          title="Post the weekly recap to #travel-schedule now"
        >
          {status === 'sending' ? 'Sending…' : 'Post now'}
        </button>
        <button
          onClick={() => send('dry')}
          disabled={status === 'sending'}
          className="rounded-md border border-border px-2 py-1 text-[10px] text-text-dim hover:text-text disabled:opacity-50"
          title="Compute the recap but DON'T post — check the browser console for the message JSON"
        >
          Dry run
        </button>
        {status === 'ok' && <span className="text-[10px] text-accent-green">✓ done</span>}
        {status === 'err' && <span className="text-[10px] text-accent-red" title={errMsg ?? ''}>error — see console</span>}
      </div>
      <p className="px-3 pb-2 text-[10px] text-text-dim/50 leading-relaxed">
        Cron runs Monday 6 AM ET automatically. These buttons are for testing or off-schedule recaps.
      </p>
    </div>
  )
}

/**
 * Lists what's happened in the last 24h — roster moves detected, trips
 * starred, etc. Gives Kent confidence the app is alive without him having
 * to dig into each tab. Lives inside the StatusPill so it's discoverable
 * via the existing pill click, not yet another header chip.
 */
function RecentActivitySection() {
  const rosterMoves = useScheduleStore((s) => s.rosterMoves)
  const starredTrips = useTripStore((s) => s.starredTrips)
  const tripStatuses = useTripStore((s) => s.tripStatuses)

  type Item = { kind: 'move' | 'star' | 'status'; label: string; sub?: string }
  const items: Item[] = []
  for (const m of rosterMoves) {
    items.push({
      kind: 'move',
      label: m.player.fullName,
      sub: `${m.typeDesc} · ${m.fromTeam?.name ?? '?'} → ${m.toTeam?.name ?? '?'}`,
    })
  }
  const starCount = Object.keys(starredTrips).length
  if (starCount > 0) {
    items.push({ kind: 'star', label: `${starCount} starred trip${starCount === 1 ? '' : 's'} saved`, sub: 'Visible via the ★ Starred filter in Trip Planner' })
  }
  const planned = Object.values(tripStatuses).filter((s) => s === 'planned').length
  const completed = Object.values(tripStatuses).filter((s) => s === 'completed').length
  if (planned + completed > 0) {
    items.push({ kind: 'status', label: `${planned} planned · ${completed} completed`, sub: 'Trip statuses on PlayerSchedulePanel' })
  }

  if (items.length === 0) {
    return (
      <>
        <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-text-dim/60 border-t border-border/40">Recent Activity</div>
        <p className="px-3 py-2 text-[11px] italic text-text-dim/50">Nothing in the last 24h.</p>
      </>
    )
  }

  return (
    <>
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-text-dim/60 border-t border-border/40">
        Recent Activity
      </div>
      <div className="divide-y divide-border/30">
        {items.map((it, i) => (
          <div key={`${it.kind}-${i}`} className="px-3 py-1.5 text-xs">
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] mt-0.5">
                {it.kind === 'move' ? '🔄' : it.kind === 'star' ? '★' : '📋'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-text">{it.label}</div>
                {it.sub && <div className="text-[10px] text-text-dim/60">{it.sub}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
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
