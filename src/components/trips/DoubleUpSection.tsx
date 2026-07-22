import { useState, useMemo } from 'react'
import type { DoubleUp } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import type { PairApproach } from '../../lib/doubleUps'
import { formatDate, formatDriveTime, formatGameTime, TIER_DOT_COLORS } from '../../lib/formatters'
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
  const hits = verdicts.filter((v) => v.doubleUpDates)
  const misses = verdicts.filter((v) => !v.doubleUpDates)

  const missLine = (v: PairVerdict) => (
    <p key={`${v.a}|${v.b}`} className="rounded-lg bg-accent-orange/10 px-3 py-1.5 text-xs text-accent-orange/90">
      <strong>{v.a} + {v.b}:</strong> no double up in this window.{' '}
      {v.closest
        ? `Closest their schedules come: ${formatDate(v.closest.dateA)}${v.closest.dateB !== v.closest.dateA ? `/${formatDate(v.closest.dateB)}` : ''} — venues ${formatDriveTime(v.closest.driveMinutes)} apart (needs 90 min or less).`
        : 'Their schedules are never within a day of each other in this window.'}
    </p>
  )

  // With 3+ priority players the pair count explodes (5 players = 10 pairs)
  // and a wall of "they double up" banners buries the actual cards. The
  // good news compresses to one line; only the MISSES stay itemized —
  // that's the actionable signal.
  if (verdicts.length > 3) {
    return (
      <div className="mb-3 space-y-1">
        {hits.length > 0 && (
          <p className="rounded-lg bg-accent-green/10 px-3 py-1.5 text-xs text-accent-green">
            {hits.length === verdicts.length
              ? <>All <strong>{verdicts.length} priority pairs</strong> double up in this window — their cards are pinned first below.</>
              : <><strong>{hits.length} of {verdicts.length} priority pairs</strong> double up in this window — their cards are pinned first below.</>}
          </p>
        )}
        {misses.map(missLine)}
      </div>
    )
  }

  return (
    <div className="mb-3 space-y-1">
      {verdicts.map((v) => {
        if (!v.doubleUpDates) return missLine(v)
        const first = v.doubleUpDates[0]!
        const last = v.doubleUpDates[v.doubleUpDates.length - 1]!
        const when = first === last
          ? formatDate(first)
          : `${formatDate(first)} – ${formatDate(last)}${v.doubleUpDates.length > 2 ? ` (${v.doubleUpDates.length} dates)` : ''}`
        return (
          <p key={`${v.a}|${v.b}`} className="rounded-lg bg-accent-green/10 px-3 py-1.5 text-xs text-accent-green">
            <strong>{v.a} + {v.b}</strong> double up {when} — their cards are pinned first below.
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
// short drive between; Tournament = camp out at one complex. Plain gray
// labels (2026-07-21 polish pass) — color is reserved for the drive tier.
const TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  'nearby-venues': { label: 'Same-Day Double', hint: 'Two games a reasonable drive apart on the same day — even with overlapping times, double with a game + a meal' },
  'same-venue-matchup': { label: 'Head-to-Head', hint: 'Clients on opposing teams — one game covers both visits' },
  'tournament-cluster': { label: 'Tournament', hint: '3+ games at the same complex on the same day' },
  'stay-over': { label: 'Stay-Over Double', hint: 'Games on back-to-back days a short drive apart — one hotel covers both visits' },
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
    <div id="section-double-ups" className="rounded-xl border border-border/50 bg-surface p-5">
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
  const typeInfo = TYPE_LABELS[du.type] ?? { label: du.type, hint: '' }

  // Series (consecutive dates at the same venue) collapse to one card
  const isSeries = du.dates.length > 1
  const dateLabel = isSeries
    ? `${formatDate(du.dates[0]!)} – ${formatDate(du.dates[du.dates.length - 1]!)}`
    : formatDate(du.date)

  // Nearest major airport(s) for fly-in planning
  const airportCodes = [...new Set(du.games.map((g) => findNearestAirport(g.venue.coords).code))]

  // Detail-line fragments: date · series · type · drive tier · fly. Only
  // the drive time carries color (Kent's green ≤45 / yellow 46–90).
  return (
    <div className="rounded-xl bg-gray-900/40 px-4 py-3 transition-colors hover:bg-gray-900/60">
      {/* Title: the players — that's what Kent scans for */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-semibold text-text">
          {du.playerNames.map((name) => {
            const tier = playerMap.get(name)?.tier ?? 4
            const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
            return (
              <span
                key={name}
                className={`inline-flex items-center gap-1.5 ${onPlayerClick ? 'cursor-pointer hover:text-accent-blue' : ''}`}
                onClick={onPlayerClick ? () => onPlayerClick(name) : undefined}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
                {name}
              </span>
            )
          })}
        </span>
        {onPlanTrip && (
          <button
            onClick={() => onPlanTrip(du)}
            className="ml-auto shrink-0 rounded-lg bg-accent-blue/15 px-2.5 py-1 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
            title="Set these players as priority and generate trips for these dates"
          >
            Plan trip →
          </button>
        )}
      </div>

      {/* Detail line: when · what kind · how far · where to fly */}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-dim">
        <span className="font-medium text-text-dim">{dateLabel}</span>
        {isSeries && <span title={du.dates.join(', ')}>· {du.dates.length}-game series</span>}
        <span title={typeInfo.hint}>· {typeInfo.label}</span>
        {du.driveMinutesBetween > 0 && (
          <span
            className={`font-medium ${driveTierClass(du.driveMinutesBetween)}`}
            title={du.driveMinutesBetween <= 45 ? 'Green: within 45 min' : 'Yellow: 46–90 min'}
          >
            · {formatDriveTime(du.driveMinutesBetween)} apart
          </span>
        )}
        <span title="Nearest major airport">· fly {airportCodes.join(' / ')}</span>
      </p>

      {/* Venues — one line per game so it's clear WHO is at WHICH park
          (Tom 2026-07-21: "not clear what games I would be going to") */}
      <div className="mt-0.5 space-y-0.5">
        {du.games.map((g, gi) => {
          const names = g.playerNames.filter((n) => du.playerNames.includes(n))
          return (
            <p key={g.id} className="truncate text-[11px] text-text-dim/60">
              {gi > 0 && <span className="text-text-dim/40">→ </span>}
              {du.type === 'stay-over' && <span className="text-text-dim">{formatDate(g.date)}: </span>}
              <span className="text-text-dim">{g.venue.name}</span>
              <span className="text-text-dim/40"> · {g.homeTeam} vs {g.awayTeam}</span>
              {names.length > 0 && <span> · sees {names.join(', ')}</span>}
            </p>
          )
        })}
      </div>

      {/* Timing note — quiet, informational only */}
      {du.timeFeasible === true && du.type === 'nearby-venues' && (
        <p className="mt-0.5 text-[10px] text-accent-green/80" title="Enough time between first pitches to watch both games in full">Both games in full</p>
      )}
      {du.timeFeasible === false && (
        <p className="mt-0.5 text-[10px] text-text-dim/60" title="Games overlap — split innings between parks, or watch one game and do a meal with the other client">Overlap — split innings or game + meal</p>
      )}

      <DatesAndTimes du={du} />
    </div>
  )
}

/** Expandable per-date detail — which night of the series is best. Shows
 *  each date's start times per venue and its own feasibility verdict. */
export function DatesAndTimes({ du, compact = false }: { du: DoubleUp; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const occurrences = du.occurrences ?? []
  if (occurrences.length === 0) return null

  return (
    <div className={compact ? 'mt-1' : 'mt-1.5'}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] font-medium text-accent-blue/80 hover:text-accent-blue transition-colors"
      >
        {expanded ? '▾' : '▸'} Dates & times
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 rounded-lg bg-gray-950/50 px-3 py-2">
          {occurrences.map((occ) => (
            <p key={occ.date} className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-text-dim">
              <span className="w-24 shrink-0 font-medium text-text">{formatDate(occ.date)}</span>
              {occ.games.map((g, gi) => {
                const t = g.source === 'mlb-api' ? formatGameTime(g.time) : ''
                return (
                  <span key={g.id} className="whitespace-nowrap">
                    {gi > 0 && <span className="text-text-dim/40">→ </span>}
                    {g.venue.name}
                    <span className="text-text-dim/60">{t ? ` ${t}` : ' time TBD'}</span>
                  </span>
                )
              })}
              {occ.timeFeasible === true && <span className="text-accent-green/80">✓ both in full</span>}
              {occ.timeFeasible === false && <span className="text-text-dim/50">overlap</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
