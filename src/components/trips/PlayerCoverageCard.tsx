import { useState, useMemo } from 'react'
import type { RosterPlayer } from '../../types/roster'
import type { GameEvent } from '../../types/schedule'
import { TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'

interface Props {
  players: RosterPlayer[]
  allGames: GameEvent[]
  onPlayerClick?: (name: string) => void
  onLoadAll?: () => void
  loadingAll?: boolean
}

type DataStatus = 'mlb-api' | 'ncaa-real' | 'hs-real' | 'estimated' | 'no-data'

const STATUS_CONFIG: Record<DataStatus, { label: string; color: string; icon: string }> = {
  'mlb-api': { label: 'MLB API', color: 'text-accent-green', icon: '●' },
  'ncaa-real': { label: 'D1Baseball', color: 'text-accent-green', icon: '●' },
  'hs-real': { label: 'MaxPreps', color: 'text-accent-green', icon: '●' },
  'estimated': { label: 'Estimated', color: 'text-accent-orange', icon: '◐' },
  'no-data': { label: 'No Data', color: 'text-accent-red', icon: '○' },
}

export default function PlayerCoverageCard({ players, allGames, onPlayerClick, onLoadAll, loadingAll }: Props) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

  const playerData = useMemo(() => {
    const eligible = players.filter((p) => p.visitsRemaining > 0)

    return eligible.map((player) => {
      const games = allGames.filter((g) => g.playerNames.includes(player.playerName))
      const gameCount = games.length

      // Determine data status
      let dataStatus: DataStatus = 'no-data'
      if (gameCount > 0) {
        const hasHighConfidence = games.some((g) => g.confidence === 'high')
        if (hasHighConfidence) {
          const sources = new Set(games.filter((g) => g.confidence === 'high').map((g) => g.source))
          if (sources.has('mlb-api')) dataStatus = 'mlb-api'
          else if (sources.has('ncaa-lookup')) dataStatus = 'ncaa-real'
          else if (sources.has('hs-lookup')) dataStatus = 'hs-real'
          else dataStatus = 'estimated'
        } else {
          dataStatus = 'estimated'
        }
      }

      return { player, gameCount, dataStatus }
    }).sort((a, b) => {
      // Sort by tier first, then name
      if (a.player.tier !== b.player.tier) return a.player.tier - b.player.tier
      return a.player.playerName.localeCompare(b.player.playerName)
    })
  }, [players, allGames])

  const grouped = useMemo(() => {
    const groups: Record<number, typeof playerData> = {}
    for (const pd of playerData) {
      const tier = pd.player.tier
      if (!groups[tier]) groups[tier] = []
      groups[tier]!.push(pd)
    }
    return groups
  }, [playerData])

  // Summary stats
  const noDataCount = playerData.filter((pd) => pd.dataStatus === 'no-data').length
  const estimatedCount = playerData.filter((pd) => pd.dataStatus === 'estimated').length

  if (playerData.length === 0) return null

  const realDataCount = playerData.length - noDataCount - estimatedCount

  return (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer px-5 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          Player Coverage
          <span className="ml-2 text-xs font-normal text-text-dim">
            {playerData.length} players
          </span>
        </h3>
        <div className="flex items-center gap-2 text-[10px]">
          {realDataCount > 0 && (
            <span className="rounded bg-accent-green/10 px-1.5 py-0.5 text-accent-green cursor-help" title={`${realDataCount} players have confirmed schedules from MLB, D1Baseball, or MaxPreps.`}>
              {realDataCount} with schedules
            </span>
          )}
          {estimatedCount > 0 && (
            <span className="rounded bg-accent-orange/10 px-1.5 py-0.5 text-accent-orange cursor-help" title={`${estimatedCount} players don't have confirmed schedule data yet. Pro players may not have an official affiliate assigned in the MLB Stats API — their schedules are estimated from last year's team. Hit "Load all schedules" to refresh.`}>
              {estimatedCount} estimated
            </span>
          )}
          {noDataCount > 0 && (
            <span className="rounded bg-accent-red/10 px-1.5 py-0.5 text-accent-red cursor-help" title={`${noDataCount} players have no schedule data at all. Their team may not be recognized, or schedules haven't been published yet.`}>
              {noDataCount} no data
            </span>
          )}
          {onLoadAll && estimatedCount > 0 && (
            <button
              onClick={(e) => { e.preventDefault(); onLoadAll() }}
              disabled={loadingAll}
              className="rounded bg-accent-blue/15 px-1.5 py-0.5 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-50 transition-colors"
            >
              {loadingAll ? 'Loading...' : 'Load all schedules'}
            </button>
          )}
        </div>
      </summary>

      <div className="border-t border-border px-5 py-3 space-y-3">
        {Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([tierStr, items]) => {
          const tier = Number(tierStr)
          const isCollapsed = collapsed[tier] ?? (tier >= 3)
          const tierColor = tier === 1 ? 'text-accent-red' : tier === 2 ? 'text-accent-orange' : 'text-yellow-400'

          return (
            <div key={tier}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [tier]: !isCollapsed }))}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className={`text-[9px] text-text-dim transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
                <span className={`text-xs font-semibold ${tierColor}`}>
                  {TIER_LABELS[tier] ?? `Tier ${tier}`}
                </span>
                <span className="text-[11px] text-text-dim">({items.length})</span>
              </button>

              {!isCollapsed && (
                <div className="mt-1.5 ml-4 space-y-1">
                  {items.map(({ player, gameCount, dataStatus }) => {
                    const dotColor = TIER_DOT_COLORS[player.tier] ?? 'bg-gray-500'
                    const status = STATUS_CONFIG[dataStatus]
                    return (
                      <div
                        key={player.playerName}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] ${onPlayerClick ? 'cursor-pointer hover:bg-gray-800/50' : ''}`}
                        onClick={onPlayerClick ? () => onPlayerClick(player.playerName) : undefined}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${dotColor} shrink-0`} />
                        <span className="font-medium text-text min-w-[120px]">{player.playerName}</span>
                        <span className="text-text-dim/60 min-w-[100px] truncate">{player.org}</span>
                        <span className={`${status.color} shrink-0`}>
                          {status.icon} {status.label}
                        </span>
                        <span className="ml-auto text-text-dim/50">
                          {gameCount > 0 ? `${gameCount} game${gameCount !== 1 ? 's' : ''}` : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}
