import { useState } from 'react'
import type { WindowResult, BestWindowStrategy } from './hooks/useBestWindows'
import type { DestinationPick } from './hooks/useDestinationPicks'
import type { DoubleUp } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import { useTripStore } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'
import { formatDate, formatDriveTime } from '../../lib/formatters'
import { findNearestAirport } from '../../data/majorAirports'
import { DatesAndTimes } from '../trips/DoubleUpSection'

// One panel, three questions: WHEN should I travel, WHERE should I go,
// and WHO can I double up on. Replaces the old stacked Best Windows +
// Where to go? panels (Tom 2026-07-21: "feels busy/confusing — consolidate").
export type SuggestTab = 'when' | 'where' | 'doubleups'

const TIER_DOT_COLORS: Record<number, string> = { 1: 'bg-[#ef4444]', 2: 'bg-[#f97316]', 3: 'bg-gray-500' }

const TAB_SUBTITLES: Record<SuggestTab, string> = {
  when: 'Best dates to travel from your star location, within the drive radius.',
  where: 'Best cities anywhere in the US for this date range — ignores the drive radius.',
  doubleups: 'See 2+ clients in one outing — head-to-heads, same-day doubles, stay-overs.',
}

const STRATEGY_OPTIONS: { value: BestWindowStrategy; label: string; hint: string }[] = [
  { value: 'impact',            label: 'Highest overall impact',     hint: 'Tier-weighted score — best mix of must-see and high-priority coverage' },
  { value: 't1-count',          label: 'Most must-see players in one trip', hint: 'Maximize must-see player count in the window' },
  { value: 'overdue-priority',  label: 'Overdue high-priority players', hint: 'Catch must-see/high-priority players you haven\'t seen in 90+ days' },
  { value: 'player-count',      label: 'Most players (any tier)',     hint: 'Maximize total unique players regardless of tier' },
  { value: 'tuesday',           label: 'Includes a Tuesday',          hint: 'Best day for MiLB position-player visits' },
  { value: 'double-ups',        label: 'Contains double ups',         hint: 'Windows with the most double-up opportunities inside the drive radius' },
]

function strategyImplication(strategy: BestWindowStrategy, windows: WindowResult[]): string {
  if (windows.length === 0) return ''
  const top = windows[0]!
  switch (strategy) {
    case 'impact':
      return `Top pick: ${top.uniquePlayerCount} players (${top.t1Count} must-see · ${top.t2Count} high-priority).`
    case 't1-count': {
      const totalT1 = windows.reduce((s, w) => s + w.t1Count, 0)
      return `Top pick has ${top.t1Count} must-see player${top.t1Count === 1 ? '' : 's'}. ${totalT1} must-see visit${totalT1 === 1 ? '' : 's'} across all ${windows.length} window${windows.length === 1 ? '' : 's'}.`
    }
    case 'overdue-priority': {
      const totalOverdue = windows.reduce((s, w) => s + w.overdueCount, 0)
      return `Top pick catches ${top.overdueCount} overdue player${top.overdueCount === 1 ? '' : 's'}. ${totalOverdue} overdue visit${totalOverdue === 1 ? '' : 's'} across all windows.`
    }
    case 'player-count':
      return `Top pick reaches ${top.uniquePlayerCount} players. ${windows.length} window${windows.length === 1 ? '' : 's'} surfaced.`
    case 'tuesday': {
      const tuesCount = windows.filter((w) => w.hasTuesday).length
      if (tuesCount === 0) return 'No Tuesday-bearing windows in this date range.'
      return `${tuesCount} of ${windows.length} window${windows.length === 1 ? '' : 's'} include a Tuesday.`
    }
    case 'double-ups': {
      const total = windows.reduce((s, w) => s + w.doubleUpCount, 0)
      if (total === 0) return 'No windows with a reachable double up in this date range.'
      return `Top pick contains ${top.doubleUpCount} double up${top.doubleUpCount === 1 ? '' : 's'}. ${total} across all ${windows.length} window${windows.length === 1 ? '' : 's'} — see the Double Ups tab for details.`
    }
    default:
      return ''
  }
}

// Plain gray type labels — color is reserved for the drive tier (green/yellow)
const DU_TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  'nearby-venues': { label: 'Same-Day Double', hint: 'Two games a reasonable drive apart on the same day' },
  'same-venue-matchup': { label: 'Head-to-Head', hint: 'Clients on opposing teams — one game covers both visits' },
  'tournament-cluster': { label: 'Tournament', hint: '3+ games at the same complex on the same day' },
  'stay-over': { label: 'Stay-Over', hint: 'Back-to-back days a short drive apart — one hotel covers both' },
}

interface Props {
  // When
  windows: WindowResult[]
  windowDays: number
  setWindowDays: (n: number) => void
  strategy: BestWindowStrategy
  setStrategy: (s: BestWindowStrategy) => void
  /** Set the window's dates, jump to Trip Planner, and generate. */
  onPlanWindow: (w: WindowResult) => void
  // Where
  picks: DestinationPick[]
  // Double ups
  doubleUps: DoubleUp[]
  playerMap: Map<string, RosterPlayer>
  activeTab: SuggestTab
  setActiveTab: (t: SuggestTab) => void
  selectedDoubleUp: number | null
  setSelectedDoubleUp: (i: number | null) => void
  onPlanDoubleUp: (du: DoubleUp) => void
}

export default function SuggestionsPanel(props: Props) {
  const { activeTab, setActiveTab, doubleUps } = props
  // Open by default on desktop; collapsed on small screens so the map
  // (rendered first there) stays the star of the tab.
  const [open, setOpen] = useState(() => {
    try { return window.matchMedia('(min-width: 1024px)').matches } catch { return true }
  })

  const TABS: { key: SuggestTab; label: string }[] = [
    { key: 'when', label: 'When to go' },
    { key: 'where', label: 'Where to go' },
    { key: 'doubleups', label: `Double Ups${doubleUps.length > 0 ? ` (${doubleUps.length})` : ''}` },
  ]

  return (
    <div className="rounded-xl bg-surface border border-border/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-semibold text-text hover:text-accent-blue transition-colors"
        >
          <span className={`text-text-dim transition-transform text-xs ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          Suggestions
        </button>
        <div className="ml-1 flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setOpen(true); if (t.key !== 'doubleups') props.setSelectedDoubleUp(null) }}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeTab === t.key
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-dim hover:text-text hover:bg-gray-800/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1.5 text-[10px] text-text-dim/60">{TAB_SUBTITLES[activeTab]}</p>

      {open && (
        <div className="mt-3">
          {activeTab === 'when' && <WhenTab {...props} />}
          {activeTab === 'where' && <WhereTab picks={props.picks} />}
          {activeTab === 'doubleups' && <DoubleUpsTab {...props} />}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────── WHEN ────────────────────────── */

function WhenTab({ windows, windowDays, setWindowDays, strategy, setStrategy, onPlanWindow }: Props) {
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const topPick = windows[0]
  const currentStrategy = STRATEGY_OPTIONS.find((o) => o.value === strategy) ?? STRATEGY_OPTIONS[0]!

  return (
    <div className="space-y-2">
      {/* Controls in one compact row */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-text-dim/70">Prioritize</span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as BestWindowStrategy)}
            title={currentStrategy.hint}
            className="rounded border border-border bg-gray-950/50 px-2 py-1 text-xs text-text focus:border-accent-blue focus:outline-none"
          >
            {STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          {([1, 2, 3] as const).map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                windowDays === d ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-800/50 text-text-dim hover:text-text'
              }`}
            >
              {d}-day
            </button>
          ))}
        </div>
      </div>

      {windows.length > 0 && (
        <p className="text-[10px] text-text-dim/70">{strategyImplication(strategy, windows)}</p>
      )}
      {topPick && topPick.uniquePlayerCount <= 2 && (
        <p className="text-[10px] text-accent-orange/80 leading-relaxed">
          ⚠ Only {topPick.uniquePlayerCount} player{topPick.uniquePlayerCount === 1 ? '' : 's'} reachable here.
          Try changing the date range, moving the star, or widening the drive radius (top-right of the map).
        </p>
      )}

      {windows.length === 0 ? (
        <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2.5 text-xs">
          <p className="text-accent-orange/90 font-medium">No reachable games in this window</p>
          <p className="mt-1 text-text-dim/80 leading-relaxed">
            No SV player has a game inside the drive radius from {homeBaseName} in this date range.
            Try widening the radius (top-right of the map), moving the star, or changing dates.
          </p>
        </div>
      ) : (
        windows.map((w, i) => (
          <div
            key={w.startDate}
            className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors ${
              i === 0 ? 'bg-accent-blue/10' : 'bg-gray-900/40 hover:bg-gray-900/60'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {i === 0 && (
                  <span className="rounded-full bg-accent-blue/20 px-2 py-0.5 text-[10px] font-bold text-accent-blue">BEST</span>
                )}
                <span className="text-sm font-medium text-text">
                  {formatDate(w.startDate)} – {formatDate(w.endDate)}
                </span>
                {w.hasTuesday && <span className="text-[10px] text-accent-blue/70">Tue</span>}
              </div>
              {/* Stat chips — flex-wrap so they never slide under the button */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-dim">{w.uniquePlayerCount} player{w.uniquePlayerCount !== 1 ? 's' : ''}</span>
                {w.t1Count > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[1]}`} />{w.t1Count} must-see
                  </span>
                )}
                {w.t2Count > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[2]}`} />{w.t2Count} high-priority
                  </span>
                )}
                {w.t3Count > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[3]}`} />{w.t3Count} standard
                  </span>
                )}
                {w.overdueCount > 0 && (
                  <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-red"
                    title={`${w.overdueCount} player(s) in this window are overdue (>90 days since visit) or never visited.`}>
                    {w.overdueCount} overdue
                  </span>
                )}
                {w.timeConflictCount > 0 && (
                  <span className="rounded bg-accent-orange/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-orange"
                    title={`${w.timeConflictCount} game(s) overlap in start time across different venues.`}>
                    {w.timeConflictCount} conflict{w.timeConflictCount !== 1 ? 's' : ''}
                  </span>
                )}
                {w.doubleUpCount > 0 && (
                  <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green"
                    title={`${w.doubleUpCount} double-up opportunit${w.doubleUpCount === 1 ? 'y' : 'ies'} fall inside this window — see the Double Ups tab.`}>
                    {w.doubleUpCount} double up{w.doubleUpCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {w.players.slice(0, 8).map((p) => (
                  <span key={p.name} className="text-[10px] text-text-dim/70">
                    <span className={`inline-block h-1 w-1 rounded-full ${TIER_DOT_COLORS[p.tier] ?? 'bg-gray-600'} mr-0.5`} />
                    {p.name}
                  </span>
                ))}
                {w.players.length > 8 && (
                  <span className="text-[10px] text-text-dim/40">+{w.players.length - 8} more</span>
                )}
              </div>
            </div>
            {/* One action — the card already SAYS its dates, so a "narrow the
                map to these dates" button was a no-op in practice (Tom). */}
            <button
              onClick={() => onPlanWindow(w)}
              className="shrink-0 rounded-lg bg-accent-blue/15 px-3 py-1.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
              title="Set these dates and generate trips in the Trip Planner"
            >
              Plan trips →
            </button>
          </div>
        ))
      )}
    </div>
  )
}

/* ────────────────────────── WHERE ────────────────────────── */

function WhereTab({ picks }: { picks: DestinationPick[] }) {
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)

  // "Go here" MOVES THE STAR and stays on the map (Tom 2026-07-21) — the
  // radius, Best Windows, and drive times all recompute from the new spot
  // so Kent can explore before committing. The map fits to the WHOLE
  // cluster (not the old keep-current-zoom recenter, which could land
  // zoomed into an empty spot). "Plan trips" does the old jump.
  function goHere(p: DestinationPick) {
    setHomeBase(p.centroid, p.label)
    if (p.venues.length > 0) {
      dispatchMapEvent('map:fit-points', { points: p.venues.map((v) => v.coords) })
    }
  }
  function planFrom(p: DestinationPick) {
    setHomeBase(p.centroid, p.label)
    dispatchMapEvent('app:switch-tab', { tab: 'trips' })
    window.scrollTo({ top: 0 })
    setTimeout(() => {
      useTripStore.getState().generateTrips().catch((e) => console.warn('[where-to-go] auto-generate failed:', e))
    }, 100)
  }

  return (
    <div className="space-y-2">
      {picks.length === 0 ? (
        <p className="text-xs text-text-dim">No reachable SV players anywhere in this date range. Try a wider window.</p>
      ) : (
        picks.map((p, i) => {
          const driveH = Math.floor(p.driveFromHomeMin / 60)
          const driveM = Math.round(p.driveFromHomeMin % 60)
          const driveLabel = driveH > 0 ? `${driveH}h${driveM > 0 ? ` ${driveM}m` : ''}` : `${driveM}m`
          const flightLabel = `${p.flightHoursFromHome.toFixed(1)}h flight`
          // After "Go here" the star sits on this pick — "from Cleveland:
          // 0m drive" reads as nonsense, so say what's actually true.
          const isCurrentOrigin = p.driveFromHomeMin < 15
          return (
            <div
              key={`${p.centroid.lat},${p.centroid.lng}`}
              className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                i === 0 ? 'bg-accent-blue/10' : 'bg-gray-900/40 hover:bg-gray-900/60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {i === 0 && (
                    <span className="rounded-full bg-accent-blue/20 px-2 py-0.5 text-[10px] font-bold text-accent-blue">BEST</span>
                  )}
                  <span className="text-sm font-medium text-text">{p.label}</span>
                  <span className="text-[10px] text-text-dim/60">
                    {isCurrentOrigin ? 'your current origin' : `from ${homeBaseName}: ${p.drivable ? `${driveLabel} drive` : flightLabel}`}
                  </span>
                </div>
                {/* What "near" means — the cluster is anchored on a real
                    venue, and every listed player is within a 3h drive of it */}
                <p className="mt-0.5 text-[10px] text-text-dim/50">
                  {p.venueCount} venue{p.venueCount === 1 ? '' : 's'} within a 3h drive of {p.anchorVenue}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-dim">{p.players.length} player{p.players.length === 1 ? '' : 's'}</span>
                  {p.t1Count > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[1]}`} />{p.t1Count} T1
                    </span>
                  )}
                  {p.t2Count > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[2]}`} />{p.t2Count} T2
                    </span>
                  )}
                  {p.t3Count > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[3]}`} />{p.t3Count} T3
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.players.slice(0, 8).map((pl) => (
                    <span key={pl.name} className="text-[10px] text-text-dim/70">
                      <span className={`inline-block h-1 w-1 rounded-full ${TIER_DOT_COLORS[pl.tier] ?? 'bg-gray-600'} mr-0.5`} />
                      {pl.name}
                    </span>
                  ))}
                  {p.players.length > 8 && (
                    <span className="text-[10px] text-text-dim/40">+{p.players.length - 8} more</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {isCurrentOrigin ? (
                  <span className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-dim" title="The star is already here">★ Here</span>
                ) : (
                  <button
                    onClick={() => goHere(p)}
                    className="rounded-lg bg-accent-blue/15 px-3 py-1.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
                    title="Move the star here and keep exploring — the radius, drive times, and When to go all recompute from this spot"
                  >
                    ★ Go here
                  </button>
                )}
                <button
                  onClick={() => planFrom(p)}
                  className="text-[10px] text-text-dim hover:text-accent-blue transition-colors"
                  title={`Set ${p.label} as the trip origin and generate trips`}
                >
                  Plan trips →
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

/* ─────────────────────── DOUBLE UPS ─────────────────────── */

function DoubleUpsTab({ doubleUps, playerMap, selectedDoubleUp, setSelectedDoubleUp, onPlanDoubleUp }: Props) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? doubleUps : doubleUps.slice(0, 6)

  if (doubleUps.length === 0) {
    return (
      <p className="text-xs text-text-dim">
        No double ups in this date range — no two clients playing each other, or near enough
        (within a 90-min drive, same day or back-to-back days). Widen the dates to check further out.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((du, i) => {
        const typeInfo = DU_TYPE_LABELS[du.type] ?? { label: du.type, hint: '' }
        const isSeries = du.dates.length > 1
        const dateLabel = isSeries
          ? `${formatDate(du.dates[0]!)} – ${formatDate(du.dates[du.dates.length - 1]!)}`
          : formatDate(du.date)
        const airports = [...new Set(du.games.map((g) => findNearestAirport(g.venue.coords).code))]
        const selected = selectedDoubleUp === i
        return (
          <div
            key={`${du.date}-${i}`}
            className={`rounded-xl px-3 py-2.5 transition-colors ${
              selected ? 'bg-accent-blue/10' : 'bg-gray-900/40 hover:bg-gray-900/60'
            }`}
          >
            {/* Title: the players */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-semibold text-text">
              {du.playerNames.map((name) => {
                const tier = playerMap.get(name)?.tier ?? 4
                return (
                  <span key={name} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[tier] ?? 'bg-gray-500'}`} />
                    {name}
                  </span>
                )
              })}
            </div>
            {/* Detail: when · kind · drive · fly */}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-text-dim">
              <span className="font-medium">{dateLabel}</span>
              {isSeries && <span title={du.dates.join(', ')}>· {du.dates.length}-game series</span>}
              <span title={typeInfo.hint}>· {typeInfo.label}</span>
              {du.driveMinutesBetween > 0 && (
                <span
                  className={`font-medium ${du.driveMinutesBetween <= 45 ? 'text-accent-green' : 'text-yellow-400'}`}
                  title={du.driveMinutesBetween <= 45 ? 'Green: within 45 min' : 'Yellow: 46–90 min'}
                >
                  · {formatDriveTime(du.driveMinutesBetween)} apart
                </span>
              )}
              <span title="Nearest major airport">· fly {airports.join(' / ')}</span>
            </p>
            {/* Venues — one line per game so who-is-where is explicit */}
            <div className="mt-0.5 space-y-0.5">
              {du.games.map((g, gi) => {
                const names = g.playerNames.filter((n) => du.playerNames.includes(n))
                return (
                  <p key={g.id} className="truncate text-[10px] text-text-dim/60">
                    {gi > 0 && <span className="text-text-dim/40">→ </span>}
                    {du.type === 'stay-over' && <span className="text-text-dim">{formatDate(g.date)}: </span>}
                    <span className="text-text-dim">{g.venue.name}</span>
                    {names.length > 0 && <span> · sees {names.join(', ')}</span>}
                  </p>
                )
              })}
            </div>
            <DatesAndTimes du={du} compact />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={() => setSelectedDoubleUp(selected ? null : i)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  selected ? 'bg-accent-blue/20 text-accent-blue' : 'text-text-dim hover:text-text hover:bg-gray-800/50'
                }`}
                title="Zoom the map to this pair"
              >
                {selected ? 'On map' : 'Show on map'}
              </button>
              <button
                onClick={() => onPlanDoubleUp(du)}
                className="rounded-lg bg-accent-blue/15 px-2.5 py-1 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
                title="Set these players as priority and generate trips for these dates"
              >
                Plan trip →
              </button>
            </div>
          </div>
        )
      })}
      {doubleUps.length > 6 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full rounded-lg bg-gray-800/50 py-1.5 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
        >
          Show {doubleUps.length - 6} more
        </button>
      )}
      <p className="text-[10px] text-text-dim/40">
        Lines on the map connect each pair — <span className="text-accent-green">green ≤45 min</span> · <span className="text-yellow-400">yellow 46–90 min</span> · dashed = overnight. ×2 = both clients in one game.
      </p>
    </div>
  )
}
