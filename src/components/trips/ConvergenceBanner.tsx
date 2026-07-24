import { useState } from 'react'
import type { ConvergenceWindow } from '../../lib/convergence'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, formatGameTime, TIER_DOT_COLORS } from '../../lib/formatters'

/**
 * The all-N answer to "can I see Tanner, Garrett AND Kellon in one swing?"
 * (Kent's west-coast-swing text, 2026-07-24). Pair verdicts say whether two
 * players double up; this banner says when ALL priority players converge —
 * and per Tom, it surfaces the CLOSEST window even when the hops are too
 * long to call it a doable trip.
 */
export default function ConvergenceBanner({
  windows,
  playerNames,
  missingPlayers,
  playerMap,
  maxHopMinutes,
  maxSpanDays,
  onUseDates,
  onPlayerClick,
}: {
  windows: ConvergenceWindow[]
  playerNames: string[]
  missingPlayers: string[]
  playerMap: Map<string, RosterPlayer>
  maxHopMinutes: number
  maxSpanDays: number
  onUseDates: (w: ConvergenceWindow) => void
  onPlayerClick?: (name: string) => void
}) {
  const [showAlternates, setShowAlternates] = useState(false)
  const n = playerNames.length

  // A priority player with zero games makes any window impossible — say WHY
  // instead of rendering nothing.
  if (missingPlayers.length > 0) {
    return (
      <p className="rounded-lg bg-gray-900/40 px-3 py-1.5 text-xs text-text-dim">
        <strong className="text-text">All {n} together:</strong> not possible in your dates —{' '}
        {missingPlayers.join(' and ')} {missingPlayers.length === 1 ? 'has' : 'have'} no games in this range.
      </p>
    )
  }

  if (windows.length === 0) {
    return (
      <p className="rounded-lg bg-gray-900/40 px-3 py-1.5 text-xs text-text-dim">
        <strong className="text-text">All {n} together:</strong> their schedules never land within one{' '}
        {maxSpanDays}-day swing in your dates — see the pair verdicts below for the best two-player options.
      </p>
    )
  }

  const best = windows[0]!
  const alternates = windows.slice(1)

  return (
    <div className={`rounded-xl border p-4 ${best.feasible ? 'border-accent-green/30 bg-accent-green/5' : 'border-border bg-surface'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">
          {best.feasible ? (
            <>All {n} in one swing:{' '}
              <span className="text-accent-green">
                {formatDate(best.startDate)}{best.endDate !== best.startDate ? ` – ${formatDate(best.endDate)}` : ''}
              </span>
            </>
          ) : (
            <>No swing within {formatDriveTime(maxHopMinutes)} hops covers all {n} — closest they come:{' '}
              <span className="text-text-dim">
                {formatDate(best.startDate)}{best.endDate !== best.startDate ? ` – ${formatDate(best.endDate)}` : ''}
              </span>
            </>
          )}
        </h3>
        <button
          onClick={() => onUseDates(best)}
          className="shrink-0 rounded-lg bg-accent-blue/15 px-2.5 py-1 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
          title="Set the planner to these dates and regenerate trips"
        >
          Plan around these dates →
        </button>
      </div>

      <p className="mt-0.5 text-[11px] text-text-dim">
        {best.spanDays} day{best.spanDays !== 1 ? 's' : ''}
        {best.stops.length > 1 && <> · longest hop {best.maxHopMinutes === 0 ? 'none — same venue' : `${formatDriveTime(best.maxHopMinutes)} drive`}</>}
      </p>

      <div className="mt-2 space-y-0.5">
        {best.stops.map((stop, i) => {
          const hop = i > 0 ? best.hopMinutes[i - 1]! : null
          const t = stop.source === 'mlb-api' ? formatGameTime(stop.time) : ''
          return (
            <p key={stop.gameId} className="flex flex-wrap items-baseline gap-x-2 text-xs text-text-dim">
              <span className="w-24 shrink-0 font-medium text-text">{formatDate(stop.date)}</span>
              <span className="flex items-center gap-x-2">
                {stop.playerNames.map((name) => {
                  const tier = playerMap.get(name)?.tier ?? 4
                  return (
                    <span
                      key={name}
                      className={`inline-flex items-center gap-1 font-medium text-text ${onPlayerClick ? 'cursor-pointer hover:text-accent-blue' : ''}`}
                      onClick={onPlayerClick ? () => onPlayerClick(name) : undefined}
                    >
                      <span className={`inline-block h-2 w-2 rounded-full ${TIER_DOT_COLORS[tier] ?? 'bg-gray-500'}`} />
                      {name}
                    </span>
                  )
                })}
              </span>
              <span>{stop.venueName}{t ? ` · ${t}` : ''}</span>
              {hop != null && hop > 0 && (
                <span className={hop > maxHopMinutes ? 'text-accent-orange' : 'text-text-dim/60'}>
                  · {formatDriveTime(hop)} from previous stop
                </span>
              )}
            </p>
          )
        })}
      </div>

      {alternates.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowAlternates((s) => !s)}
            className="text-[11px] font-medium text-accent-blue/80 hover:text-accent-blue transition-colors"
          >
            {showAlternates ? '▾' : '▸'} {alternates.length} other window{alternates.length !== 1 ? 's' : ''}
          </button>
          {showAlternates && (
            <div className="mt-1 space-y-1">
              {alternates.map((w) => (
                <div key={`${w.startDate}-${w.stops.map((s) => s.gameId).join('|')}`} className="flex flex-wrap items-center gap-x-2 rounded-lg bg-gray-950/50 px-3 py-1.5 text-[11px] text-text-dim">
                  <span className="font-medium text-text">
                    {formatDate(w.startDate)}{w.endDate !== w.startDate ? ` – ${formatDate(w.endDate)}` : ''}
                  </span>
                  <span>{w.stops.map((s) => s.venueName).join(' → ')}</span>
                  <span className={w.feasible ? 'text-text-dim/60' : 'text-accent-orange'}>
                    · longest hop {w.maxHopMinutes === 0 ? 'none' : formatDriveTime(w.maxHopMinutes)}
                  </span>
                  <button
                    onClick={() => onUseDates(w)}
                    className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/10 transition-colors"
                  >
                    Plan →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
