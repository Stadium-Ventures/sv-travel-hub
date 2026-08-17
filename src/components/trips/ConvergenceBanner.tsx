import { useState } from 'react'
import type { ConvergenceWindow } from '../../lib/convergence'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, formatGameTimeDisplay, TIER_DOT_COLORS } from '../../lib/formatters'
import { useTimeStore } from '../../store/timeStore'

/**
 * The all-N answer to "can I see Tanner, Garrett AND Kellon in one swing?"
 * (Kent's west-coast-swing text, 2026-07-24). Display rules (Tom's review,
 * same day; revised 2026-08-17):
 * - The best window carries the stop list. Everything else — night variants
 *   AND alternate windows — collapses behind ONE "other ways to run it"
 *   disclosure (Tom 2026-08-17: all-rows-visible made the page busy and
 *   confusing; they are NOT equal options, so weight stays with the best).
 * - Collapsed rows expand IN PLACE to their full itinerary — seeing an
 *   alternate's details must not wipe results or swap dates (Tom 2026-08-17).
 * - The actions that DO change dates (headline button, widen pointer) carry
 *   the exact route via plannedSwing, so the regenerated results are
 *   guaranteed to contain the itinerary that was promised — never just
 *   dates + a re-roll of the engine.
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
  const [showAlternates, setShowAlternates] = useState(false)
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

  // ── Full banner: best window with stops; every other option (night
  //    variants + alternate windows) behind ONE collapsed disclosure ──
  const variants = best.variants ?? []
  const alternates = windows.slice(1)
  const otherCount = variants.length + alternates.length
  return (
    <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{headline}</h3>
        <button
          onClick={() => onUseDates(best)}
          className="shrink-0 rounded-lg bg-accent-blue/15 px-2.5 py-1 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
          title="Set the planner to these dates — this exact itinerary will lead the results"
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

      {otherCount > 0 && (
        <>
          <button
            onClick={() => setShowAlternates((s) => !s)}
            className="mt-2 text-[11px] font-medium text-accent-blue/80 hover:text-accent-blue"
          >
            {showAlternates ? '▾' : '▸'} {otherCount} other way{otherCount !== 1 ? 's' : ''} to run it
          </button>
          {showAlternates && (
            <div className="mt-1 space-y-1">
              {variants.map((w) => (
                <AlternateRow
                  key={w.stops.map((s) => s.gameId).join('|')}
                  w={w}
                  detail={w.stops.map((s) => `${s.playerNames.join(' & ')} ${formatDate(s.date)}`).join(' → ')}
                  note="same stops, different nights"
                  playerMap={playerMap}
                  maxHopMinutes={maxHopMinutes}
                  onPlayerClick={onPlayerClick}
                />
              ))}
              {alternates.map((w) => (
                <AlternateRow
                  key={`${w.startDate}-${w.stops.map((s) => s.gameId).join('|')}`}
                  w={w}
                  detail={w.stops.map((s) => s.venueName).join(' → ')}
                  playerMap={playerMap}
                  maxHopMinutes={maxHopMinutes}
                  onPlayerClick={onPlayerClick}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** One collapsed-section row: an alternate way to run the swing. Expands
 *  in place to the full stop-by-stop itinerary — "planning" an alternate
 *  just means seeing its details, so it must not wipe the generated results
 *  or swap the dates (Tom 2026-08-17). */
function AlternateRow({ w, detail, note, playerMap, maxHopMinutes, onPlayerClick }: {
  w: ConvergenceWindow
  detail: string
  note?: string
  playerMap: Map<string, RosterPlayer>
  maxHopMinutes: number
  onPlayerClick?: (name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg bg-gray-950/50 px-3 py-1.5 text-[11px] text-text-dim">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium text-text">
          {formatDate(w.startDate)}{w.endDate !== w.startDate ? ` – ${formatDate(w.endDate)}` : ''}
        </span>
        <span>{detail}</span>
        {note && <span className="text-text-dim/60">· {note}</span>}
        <span className={w.feasible ? 'text-text-dim/60' : 'text-accent-orange'}>
          · longest drive {w.maxHopMinutes === 0 ? 'none' : formatDriveTime(w.maxHopMinutes)}
        </span>
        <button
          onClick={() => setExpanded((s) => !s)}
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/10 transition-colors"
        >
          {expanded ? '▾ hide' : '▸ details'}
        </button>
      </div>
      {expanded && (
        <div className="mt-1.5 space-y-0.5 border-t border-gray-800/60 pt-1.5">
          <StopLines w={w} playerMap={playerMap} maxHopMinutes={maxHopMinutes} onPlayerClick={onPlayerClick} />
        </div>
      )}
    </div>
  )
}

/** All the ways to run a swing — Kent's "Option A / Option B" choices
 *  (2026-07-24), including the primary combo as Option A. Rendered inside
 *  the covering trip card, so choices live WITH the trip rather than in a
 *  separate summary up top (Tom 2026-07-24).
 *
 *  "Pick one" means picking DOES something (Tom 2026-08-17): clicking an
 *  option swaps the card's detail view — venues, times, drives — to that
 *  option's itinerary. Clicking the picked option again restores the
 *  card's suggested route. */
export function SwingOptions({ swing, pickedIdx, onPick }: {
  swing: ConvergenceWindow
  /** Index of the combo currently shown as the card's detail view;
   *  null = the card's own suggested route. */
  pickedIdx: number | null
  onPick: (idx: number | null) => void
}) {
  const combos = [swing, ...(swing.variants ?? [])]
  if (combos.length < 2) return null
  const letters = ['A', 'B', 'C', 'D', 'E']
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-text-dim/60">Ways to run it: pick one to see it above</p>
      {combos.map((w, i) => {
        const picked = pickedIdx === i
        return (
          <button
            key={w.stops.map((s) => s.gameId).join('|')}
            onClick={() => onPick(picked ? null : i)}
            title={picked ? 'Click to go back to the suggested route' : 'Show this option as the trip above'}
            className={`block w-full rounded-lg px-3 py-1.5 text-left text-[11px] transition-colors ${
              picked
                ? 'bg-accent-blue/10 text-text-dim ring-1 ring-accent-blue/60'
                : 'bg-gray-950/50 text-text-dim hover:bg-gray-900/70'
            }`}
          >
            <span className="font-medium text-text">Option {letters[i] ?? String.fromCharCode(65 + i)}</span>
            {' · '}{w.stops.map((s) => `${s.playerNames.join(' & ')} ${formatDate(s.date)}`).join(' → ')}
            <span className="text-text-dim/60"> · longest drive {w.maxHopMinutes === 0 ? 'none' : formatDriveTime(w.maxHopMinutes)}</span>
            {picked && <span className="ml-2 font-medium text-accent-blue">Shown above</span>}
          </button>
        )
      })}
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
