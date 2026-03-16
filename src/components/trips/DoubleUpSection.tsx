import React, { useState, useMemo } from 'react'
import type { DoubleUp } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, TIER_DOT_COLORS } from '../../lib/formatters'

interface Props {
  doubleUps: DoubleUp[]
  playerMap: Map<string, RosterPlayer>
  priorityPlayers: string[]
  onPlayerClick?: (name: string) => void
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  'nearby-venues': { label: 'Nearby Venues', color: 'bg-accent-blue/15 text-accent-blue' },
  'same-venue-matchup': { label: 'SV Matchup', color: 'bg-purple-500/15 text-purple-400' },
  'tournament-cluster': { label: 'Tournament', color: 'bg-accent-green/15 text-accent-green' },
}

export default function DoubleUpSection({ doubleUps, playerMap, priorityPlayers, onPlayerClick }: Props) {
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    let items = doubleUps

    // When priority players are set, only show double ups involving them
    if (priorityPlayers.length > 0) {
      items = items.filter((du) =>
        du.playerNames.some((n) => priorityPlayers.includes(n)),
      )
    }

    if (tierFilter !== null) {
      items = items.filter((du) =>
        du.playerNames.some((n) => playerMap.get(n)?.tier === tierFilter),
      )
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
            See 2+ games in a single day
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

      {filtered.length === 0 ? (
        <p className="py-2 text-center text-xs text-text-dim">No double ups match the selected filter.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((du, i) => (
            <DoubleUpCard key={`${du.date}-${i}`} doubleUp={du} playerMap={playerMap} onPlayerClick={onPlayerClick} />
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
}: {
  doubleUp: DoubleUp
  playerMap: Map<string, RosterPlayer>
  onPlayerClick?: (name: string) => void
}) {
  const du = doubleUp
  const typeInfo = TYPE_LABELS[du.type] ?? { label: du.type, color: 'bg-gray-700 text-text-dim' }

  return (
    <div className="rounded-lg border border-border/30 bg-gray-950/30 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-text">
          {formatDate(du.date)}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeInfo.color}`}>
          {typeInfo.label}
        </span>
        <span className="rounded-lg bg-accent-green/10 px-1.5 py-0.5 text-[10px] font-bold text-accent-green">
          {du.combinedValue} pts
        </span>
        {du.timeFeasible === true && (
          <span className="text-[10px] text-accent-green" title="Time gap is sufficient">&#10003; Feasible</span>
        )}
        {du.timeFeasible === false && (
          <span className="text-[10px] text-accent-red" title="Not enough time between games">&#10007; Tight</span>
        )}
        {du.timeFeasible === null && (
          <span className="text-[10px] text-accent-orange" title="Game times unknown">? Times TBD</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {du.games.map((game, gi) => (
          <React.Fragment key={game.id}>
            {gi > 0 && du.driveMinutesBetween > 0 && (
              <div className="flex flex-col items-center px-1">
                <span className="text-[10px] text-text-dim/60">{formatDriveTime(du.driveMinutesBetween)}</span>
                <span className="text-text-dim/40">→</span>
              </div>
            )}
            {gi > 0 && du.driveMinutesBetween === 0 && (
              <span className="text-text-dim/30 text-xs">·</span>
            )}
            <div className="min-w-0 flex-1 rounded-lg bg-surface/50 px-3 py-2">
              <p className="text-[11px] font-medium text-text truncate">{game.venue.name}</p>
              <p className="text-[10px] text-text-dim/60 truncate">
                {game.homeTeam} vs {game.awayTeam}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {game.playerNames.map((name) => {
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
