import { useState } from 'react'
import type { ConvergenceWindow } from '../../lib/convergence'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, formatGameTimeDisplay, TIER_DOT_COLORS } from '../../lib/formatters'
import { useTimeStore } from '../../store/timeStore'

/**
 * The all-N answer to "can I see Tanner, Garrett AND Kellon in one swing?"
 * (Kent's west-coast-swing text, 2026-07-24). Display rules (Tom's review,
 * same day):
 * - All windows visible as rows — no expander. The best one carries the stop
 *   list; the rest are one-liners. They are NOT equal options (1h55m vs
 *   9h48m drives), so weight stays with the best.
 * - Once a generated trip below covers every priority player, the parent
 *   renders NO banner at all — the covering trip card carries the swing and
 *   its Option rows (a headline summarizing the card beneath it was noise).
 * - No doable in-window swing = a muted miss LINE (details behind a toggle),
 *   not a hero itinerary — an infeasible route must not get top billing.
 *   When a feasible swing exists OUTSIDE the dates, say so and offer it.
 * - Plain English only: "drive between stops", never engine words like
 *   "hop" (Tom 2026-07-24).
 */
export default function ConvergenceBanner({
  windows,
  playerNames,
  missingPlayers,
  playerMap,
  maxHopMinutes,
  maxSpanDays,
  outOfWindow,
  onUseDates,
  onPlayerClick,
}: {
  windows: ConvergenceWindow[]
  playerNames: string[]
  missingPlayers: string[]
  playerMap: Map<string, RosterPlayer>
  maxHopMinutes: number
  maxSpanDays: number
  /** Feasible swing OUTSIDE the selected dates (set when the in-window
   *  result is missing or infeasible) — "widen your dates" pointer */
  outOfWindow?: ConvergenceWindow | null
  onUseDates: (w: ConvergenceWindow) => void
  onPlayerClick?: (name: string) => void
}) {
  const [showMissDetails, setShowMissDetails] = useState(false)
  const n = playerNames.length

  if (missingPlayers.length > 0) {
    return (
      <p className="rounded-lg bg-gray-900/40 px-3 py-1.5 text-xs text-text-dim">
        <strong className="text-text">All {n} together:</strong> not possible in your dates —{' '}
        {missingPlayers.join(' and ')} {missingPlayers.length === 1 ? 'has' : 'have'} no games in this range.
      </p>
    )
  }

  const best = windows[0]
  const feasible = best?.feasible === true

  const widenPointer = outOfWindow ? (
    <>
      {' '}They line up{' '}
      <button
        onClick={() => onUseDates(outOfWindow)}
        className="font-semibold text-accent-green hover:underline underline-offset-2"
        title="Set the planner to these dates and regenerate trips"
      >
        {formatDate(outOfWindow.startDate)}{outOfWindow.endDate !== outOfWindow.startDate ? ` – ${formatDate(outOfWindow.endDate)}` : ''}
      </button>
      {' '}— widen your dates to catch it.
    </>
  ) : null

  // ── No doable swing in the selected dates: one muted miss line ──
  if (!feasible) {
    return (
      <div className="rounded-lg bg-gray-900/40 px-3 py-1.5 text-xs text-text-dim">
        <p>
          <strong className="text-text">All {n} together:</strong>{' '}
          {best ? (
            <>
              no drivable route covers all {n} in your dates
              (closest needs a {formatDriveTime(best.maxHopMinutes)} drive; drives are capped at {formatDriveTime(maxHopMinutes)}
              <button
                onClick={() => setShowMissDetails((s) => !s)}
                className="ml-1 text-accent-blue/80 hover:text-accent-blue"
              >
                {showMissDetails ? '▾ hide' : '▸ details'}
              </button>).
            </>
          ) : (
            <>their games never fall within {maxSpanDays} days of each other in your dates.</>
          )}
          {widenPointer}
        </p>
        {showMissDetails && best && (
          <div className="mt-1.5 space-y-0.5 rounded-lg bg-gray-950/50 px-3 py-2">
            <StopLines w={best} playerMap={playerMap} maxHopMinutes={maxHopMinutes} onPlayerClick={onPlayerClick} />
          </div>
        )}
      </div>
    )
  }

  const headline = (
    <>All {n} together:{' '}
      <span className="text-accent-green">
        {formatDate(best.startDate)}{best.endDate !== best.startDate ? ` – ${formatDate(best.endDate)}` : ''}
      </span>
    </>
  )

  // ── Full banner: best window with stops, other windows as visible rows ──
  const alternates = windows.slice(1)
  return (
    <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{headline}</h3>
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
        {best.stops.length > 1 && <> · longest drive between stops {best.maxHopMinutes === 0 ? "none — same venue" : formatDriveTime(best.maxHopMinutes)}</>}
      </p>

      <div className="mt-2 space-y-0.5">
        <StopLines w={best} playerMap={playerMap} maxHopMinutes={maxHopMinutes} onPlayerClick={onPlayerClick} />
      </div>

      <VariantRows primary={best} />

      {alternates.length > 0 && (
        <div className="mt-2 space-y-1">
          {alternates.map((w) => (
            <div key={`${w.startDate}-${w.stops.map((s) => s.gameId).join('|')}`} className="flex flex-wrap items-center gap-x-2 rounded-lg bg-gray-950/50 px-3 py-1.5 text-[11px] text-text-dim">
              <span className="font-medium text-text">
                {formatDate(w.startDate)}{w.endDate !== w.startDate ? ` – ${formatDate(w.endDate)}` : ''}
              </span>
              <span>{w.stops.map((s) => s.venueName).join(' → ')}</span>
              <span className={w.feasible ? 'text-text-dim/60' : 'text-accent-orange'}>
                · longest drive {w.maxHopMinutes === 0 ? 'none' : formatDriveTime(w.maxHopMinutes)}
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
  )
}

/** All the ways to run a swing — Kent's "Option A / Option B" choices
 *  (2026-07-24), including the primary combo as Option A. Rendered inside
 *  the covering trip card, so choices live WITH the trip rather than in a
 *  separate summary up top (Tom 2026-07-24). */
export function SwingOptions({ swing }: { swing: ConvergenceWindow }) {
  const combos = [swing, ...(swing.variants ?? [])]
  if (combos.length < 2) return null
  const letters = ['A', 'B', 'C', 'D', 'E']
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-text-dim/60">Ways to run it — pick one</p>
      {combos.map((w, i) => (
        <p key={w.stops.map((s) => s.gameId).join('|')} className="rounded-lg bg-gray-950/50 px-3 py-1.5 text-[11px] text-text-dim">
          <span className="font-medium text-text">Option {letters[i] ?? String.fromCharCode(65 + i)}</span>
          {' · '}{w.stops.map((s) => `${s.playerNames.join(' & ')} ${formatDate(s.date)}`).join(' → ')}
          <span className="text-text-dim/60"> · longest drive {w.maxHopMinutes === 0 ? 'none' : formatDriveTime(w.maxHopMinutes)}</span>
        </p>
      ))}
    </div>
  )
}

/** Same venues, different nights — variant rows for the PRE-generation
 *  banner (the only place the full banner still renders). */
function VariantRows({ primary }: { primary: ConvergenceWindow }) {
  const variants = primary.variants ?? []
  if (variants.length === 0) return null
  const letters = ['B', 'C', 'D']
  const describe = (w: ConvergenceWindow) =>
    w.stops.map((s) => `${s.playerNames.join(' & ')} ${formatDate(s.date)}`).join(' → ')
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-text-dim/60">
        Other ways to run it (same stops, different nights) — above is Option A
      </p>
      {variants.map((w, i) => (
        <p key={w.stops.map((s) => s.gameId).join('|')} className="rounded-lg bg-gray-950/50 px-3 py-1.5 text-[11px] text-text-dim">
          <span className="font-medium text-text">Option {letters[i] ?? String.fromCharCode(66 + i)}</span>
          {' · '}{describe(w)}
          <span className="text-text-dim/60"> · longest drive {w.maxHopMinutes === 0 ? 'none' : formatDriveTime(w.maxHopMinutes)}</span>
        </p>
      ))}
    </div>
  )
}

function StopLines({ w, playerMap, maxHopMinutes, onPlayerClick }: {
  w: ConvergenceWindow
  playerMap: Map<string, RosterPlayer>
  maxHopMinutes: number
  onPlayerClick?: (name: string) => void
}) {
  const timeMode = useTimeStore((s) => s.mode)
  return (
    <>
      {w.stops.map((stop, i) => {
        const hop = i > 0 ? w.hopMinutes[i - 1]! : null
        const t = stop.source === 'mlb-api' ? formatGameTimeDisplay(stop.time, timeMode, { coords: stop.coords, tz: stop.venueTz }) : ''
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
    </>
  )
}
