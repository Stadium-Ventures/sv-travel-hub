import { useState } from 'react'
import { useSummerStore } from '../../store/summerStore'
import { SUMMER_LEAGUES, type SummerLeagueCode } from '../../data/summerLeagues'

const DISMISS_KEY = 'sv-summer-coverage-dismissed'

/**
 * Compact notice that surfaces which summer leagues are live vs pending,
 * so Kent doesn't wonder why a Cape Cod player has games but a Northwoods
 * player has zero. Only renders when at least one SV player is in a
 * non-live league (presto/manual sources). Dismissible — once Kent has
 * read the gap explanation he can hide it and never see it again until
 * he clears the flag in localStorage (or we add a "show again" affordance).
 */
export default function SummerCoverageNotice() {
  const assignments = useSummerStore((s) => s.assignments)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  }
  if (dismissed) return null
  if (!assignments || assignments.length === 0) return null

  // Group active assignments by league to count affected players per league.
  const activeByLeague = new Map<SummerLeagueCode, number>()
  for (const a of assignments) {
    if (!a.active) continue
    activeByLeague.set(a.league, (activeByLeague.get(a.league) ?? 0) + 1)
  }
  if (activeByLeague.size === 0) return null

  const liveLeagues: { code: SummerLeagueCode; n: number }[] = []
  const pendingLeagues: { code: SummerLeagueCode; n: number; source: 'presto' | 'manual' }[] = []

  for (const [code, n] of activeByLeague) {
    const meta = SUMMER_LEAGUES[code]
    if (!meta) continue
    if (meta.source === 'mlb-api') liveLeagues.push({ code, n })
    else pendingLeagues.push({ code, n, source: meta.source })
  }

  if (pendingLeagues.length === 0) return null // all covered — no notice needed

  const pendingPlayerCount = pendingLeagues.reduce((s, l) => s + l.n, 0)

  return (
    <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-4 py-2.5 text-xs relative">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 text-text-dim/60 hover:text-text leading-none text-base"
        title="Dismiss this notice — it won't show again this browser. Clear localStorage to bring it back."
        aria-label="Dismiss summer coverage notice"
      >
        ×
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pr-6">
        <span className="font-medium text-accent-orange">⚠ Summer coverage gap</span>
        <span className="text-text-dim">
          {pendingPlayerCount} player{pendingPlayerCount === 1 ? '' : 's'} in {pendingLeagues.length} league{pendingLeagues.length === 1 ? '' : 's'} without live schedules:
        </span>
        {pendingLeagues.map((l) => (
          <span
            key={l.code}
            className="rounded bg-gray-950/40 px-1.5 py-0.5 text-[10px] text-accent-orange"
            title={`${SUMMER_LEAGUES[l.code]!.name} · ${l.n} SV player${l.n === 1 ? '' : 's'} · ${l.source === 'presto' ? 'awaiting dugout-pulse adapter' : 'awaiting manual sheet entry'}`}
          >
            {l.code}: {l.n}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-text-dim/60">
        Live coverage: {liveLeagues.length > 0
          ? liveLeagues.map((l) => `${l.code} (${l.n})`).join(' · ')
          : 'none'}
        . Pending leagues will be wired via dugout-pulse / Mike's manual sheet.
      </p>
    </div>
  )
}
