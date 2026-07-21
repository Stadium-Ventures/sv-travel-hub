import React, { useState, useMemo } from 'react'
import type { DoubleUp } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import type { PairApproach } from '../../lib/doubleUps'
import { formatDate, formatDriveTime, TIER_DOT_COLORS } from '../../lib/formatters'
import { findNearestAirport } from '../../data/majorAirports'

/** "Does X double up with Y?" verdict for a pair of priority players —
 *  Tom 2026-07-21: when two players are picked, an impossible combo must be
 *  SAID, not implied by their absence from the list. */
export interface PairVerdict {
  a: string
  b: string
  /** Dates where the two actually double up; null = no double up in window */
  doubleUpDates: string[] | null
  /** When no double up: how close their schedules come (null = never within a day) */
  closest: PairApproach | null
}

export function PairVerdictBanner({ verdicts }: { verdicts: PairVerdict[] }) {
  if (verdicts.length === 0) return null
  return (
    <div className="mb-3 space-y-1">
      {verdicts.map((v) => {
        if (v.doubleUpDates) {
          const first = v.doubleUpDates[0]!
          const last = v.doubleUpDates[v.doubleUpDates.length - 1]!
          const when = first === last
            ? formatDate(first)
            : `${formatDate(first)} – ${formatDate(last)}${v.doubleUpDates.length > 2 ? ` (${v.doubleUpDates.length} dates)` : ''}`
          return (
            <p key={`${v.a}|${v.b}`} className="rounded-lg border border-accent-green/30 bg-accent-green/10 px-3 py-1.5 text-xs text-accent-green">
              <strong>{v.a} + {v.b}</strong> double up {when} — their cards are pinned first below.
            </p>
          )
        }
        return (
          <p key={`${v.a}|${v.b}`} className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-1.5 text-xs text-accent-orange/90">
            <strong>{v.a} + {v.b}:</strong> no double up in this window.{' '}
            {v.closest
              ? `Closest their schedules come: ${formatDate(v.closest.dateA)}${v.closest.dateB !== v.closest.dateA ? `/${formatDate(v.closest.dateB)}` : ''} — venues ${formatDriveTime(v.closest.driveMinutes)} apart (needs 90 min or less).`
              : 'Their schedules are never within a day of each other in this window.'}
          </p>
        )
      })}
    </div>
  )
}

interface Props {
  doubleUps: DoubleUp[]
  playerMap: Map<string, RosterPlayer>
  priorityPlayers: string[]
  windowDays?: number
  pairVerdicts?: PairVerdict[]
  onPlayerClick?: (name: string) => void
  onPlanTrip?: (du: DoubleUp) => void
}

// Categories are named for what Kent physically does, not the data shape:
// Head-to-Head = one seat sees two clients; Same-Day Double = two parks,
// short drive between; Tournament = camp out at one complex.
const TYPE_LABELS: Record<string, { label: string; color: string; hint: string }> = {
  'nearby-venues': { label: 'Same-Day Double', color: 'bg-accent-blue/15 text-accent-blue', hint: 'Two games a reasonable drive apart on the same day — even with overlapping times, double with a game + a meal' },
  'same-venue-matchup': { label: 'Head-to-Head', color: 'bg-purple-500/15 text-purple-400', hint: 'Clients on opposing teams — one game covers both visits' },
  'tournament-cluster': { label: 'Tournament', color: 'bg-accent-green/15 text-accent-green', hint: '3+ games at the same complex on the same day' },
  'stay-over': { label: 'Stay-Over Double', color: 'bg-accent-orange/15 text-accent-orange', hint: 'Games on back-to-back days a short drive apart — one hotel covers both visits' },
}

/** Kent's proximity tiers (2026-07-21): green within 45 min, yellow 46–90. */
function driveTierClass(driveMin: number): string {
  return driveMin <= 45 ? 'text-accent-green' : 'text-yellow-400'
}

export default function DoubleUpSection({ doubleUps, playerMap, priorityPlayers, windowDays, pairVerdicts = [], onPlayerClick, onPlanTrip }: Props) {
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    let items = doubleUps

    if (tierFilter !== null) {
      items = items.filter((du) =>
        du.playerNames.some((n) => playerMap.get(n)?.tier === tierFilter),
      )
    }

    // Double ups involving priority players float to the top, ranked by HOW
    // MANY priority players they include — a card with both picked players
    // outranks one with either alone. (Not a hard filter — a great matchup
    // is worth seeing even if it's other clients.)
    if (priorityPlayers.length > 0) {
      const rank = (du: DoubleUp) => priorityPlayers.filter((n) => du.playerNames.includes(n)).length
      items = [...items].sort((a, b) => rank(b) - rank(a))
    }

    return items
  }, [doubleUps, tierFilter, priorityPlayers, playerMap])

  const visible = showAll ? filtered : filtered.slice(0, 10)
  const hasMore = filtered.length > 10

  if (doubleUps.length === 0) return null

  return (
    <div id="section-double-ups" className="rounded-xl border border-accent-green/30 bg-accent-green/5 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-accent-green">
            Double Up Opportunities
            <span className="ml-2 rounded-full bg-accent-green/20 px-2 py-0.5 text-xs font-bold text-accent-green">
              {filtered.length}
            </span>
          </h3>
          <p className="text-[10px] text-text-dim/60">
            {windowDays ? `Next ${windowDays} days · ` : ''}see 2+ clients in one outing — same game, or a short drive apart
          </p>
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(tierFilter === t ? null : t)}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                tierFilter === t
                  ? t === 1 ? 'bg-accent-red/20 text-accent-red' : t === 2 ? 'bg-accent-orange/20 text-accent-orange' : 'bg-yellow-400/20 text-yellow-400'
                  : 'bg-gray-800/50 text-text-dim hover:text-text'
              }`}
            >
              T{t}
            </button>
          ))}
          <button
            onClick={() => setTierFilter(null)}
            className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
              tierFilter === null ? 'bg-gray-700 text-text' : 'bg-gray-800/50 text-text-dim hover:text-text'
            }`}
          >
            All
          </button>
        </div>
      </div>

      <PairVerdictBanner verdicts={pairVerdicts} />

      {filtered.length === 0 ? (
        <p className="py-2 text-center text-xs text-text-dim">No double ups match the selected filter.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((du, i) => (
            <DoubleUpCard key={`${du.date}-${i}`} doubleUp={du} playerMap={playerMap} onPlayerClick={onPlayerClick} onPlanTrip={onPlanTrip} />
          ))}
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full rounded-lg bg-gray-800/50 py-1.5 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
            >
              Show {filtered.length - 10} more
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DoubleUpCard({
  doubleUp,
  playerMap,
  onPlayerClick,
  onPlanTrip,
}: {
  doubleUp: DoubleUp
  playerMap: Map<string, RosterPlayer>
  onPlayerClick?: (name: string) => void
  onPlanTrip?: (du: DoubleUp) => void
}) {
  const du = doubleUp
  const typeInfo = TYPE_LABELS[du.type] ?? { label: du.type, color: 'bg-gray-700 text-text-dim', hint: '' }

  // Series (consecutive dates at the same venue) collapse to one card
  const isSeries = du.dates.length > 1
  const dateLabel = isSeries
    ? `${formatDate(du.dates[0]!)} – ${formatDate(du.dates[du.dates.length - 1]!)}`
    : formatDate(du.date)

  // Nearest major airport(s) for fly-in planning
  const airportCodes = [...new Set(du.games.map((g) => findNearestAirport(g.venue.coords).code))]

  return (
    <div className="rounded-lg border border-border/30 bg-gray-950/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-text">
          {dateLabel}
        </span>
        {isSeries && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-text-dim" title={du.dates.join(', ')}>
            {du.dates.length}-game series
          </span>
        )}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeInfo.color}`} title={typeInfo.hint}>
          {typeInfo.label}
        </span>
        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-text-dim" title="Nearest major airport">
          Fly: {airportCodes.join(' / ')}
        </span>
        {du.timeFeasible === true && du.type === 'nearby-venues' && (
          <span className="text-[10px] text-accent-green" title="Enough time between first pitches to watch both games in full">&#10003; Both games in full</span>
        )}
        {du.timeFeasible === false && (
          <span className="text-[10px] text-text-dim" title="Games overlap — split innings between parks, or watch one game and do a meal with the other client">Overlap — split innings or game + meal</span>
        )}
        {du.timeFeasible === null && du.type === 'nearby-venues' && (
          <span className="text-[10px] text-text-dim" title="Game times not confirmed yet — check closer to the date">? Times TBD</span>
        )}
        {onPlanTrip && (
          <button
            onClick={() => onPlanTrip(du)}
            className="ml-auto rounded-lg bg-accent-green/15 px-2.5 py-1 text-[11px] font-medium text-accent-green hover:bg-accent-green/25 transition-colors"
            title="Set these players as priority and generate trips for these dates"
          >
            Plan trip →
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {du.games.map((game, gi) => (
          <React.Fragment key={game.id}>
            {gi > 0 && du.driveMinutesBetween > 0 && (
              <div className="flex flex-col items-center px-1" title={du.driveMinutesBetween <= 45 ? 'Green: within 45 min' : 'Yellow: 46–90 min'}>
                <span className={`text-[10px] font-medium ${driveTierClass(du.driveMinutesBetween)}`}>{formatDriveTime(du.driveMinutesBetween)}</span>
                <span className="text-text-dim/40">→</span>
              </div>
            )}
            {gi > 0 && du.driveMinutesBetween === 0 && (
              <span className="text-text-dim/30 text-xs">·</span>
            )}
            <div className="min-w-0 flex-1 rounded-lg bg-surface/50 px-3 py-2">
              {du.type === 'stay-over' && (
                <p className="text-[10px] font-semibold text-accent-orange">{formatDate(game.date)}</p>
              )}
              <p className="text-[11px] font-medium text-text truncate">{game.venue.name}</p>
              <p className="text-[10px] text-text-dim/60 truncate">
                {game.homeTeam} vs {game.awayTeam}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {game.playerNames.filter((n) => du.playerNames.includes(n)).map((name) => {
                  const p = playerMap.get(name)
                  const tier = p?.tier ?? 4
                  const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                  return (
                    <span
                      key={name}
                      className={`inline-flex items-center gap-1 text-[10px] font-medium text-text ${onPlayerClick ? 'cursor-pointer hover:text-accent-blue' : ''}`}
                      onClick={onPlayerClick ? () => onPlayerClick(name) : undefined}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                      {name}
                    </span>
                  )
                })}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
