import { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { formatTimeAgo } from '../../lib/formatters'
import type { RosterPlayer, PlayerLevel } from '../../types/roster'
import PlayerCard from './PlayerCard'
import Term from '../ui/Term'

type SortField = 'playerName' | 'tier' | 'visitsRemaining' | 'org' | 'loveScore'
type SortDir = 'asc' | 'desc'

export default function RosterDashboard() {
  const players = useRosterStore((s) => s.players)
  const loading = useRosterStore((s) => s.loading)
  const error = useRosterStore((s) => s.error)
  const lastFetchedAt = useRosterStore((s) => s.lastFetchedAt)
  const parseWarnings = useRosterStore((s) => s.parseWarnings)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)

  const rosterMoves = useScheduleStore((s) => s.rosterMoves)
  const rosterMovesLoading = useScheduleStore((s) => s.rosterMovesLoading)
  const rosterMovesCheckedAt = useScheduleStore((s) => s.rosterMovesCheckedAt)
  const rosterMovesError = useScheduleStore((s) => s.rosterMovesError)
  const checkRosterMoves = useScheduleStore((s) => s.checkRosterMoves)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)

  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
  const heartbeatPriorities = useHeartbeatStore((s) => s.priorities)
  const heartbeatLoading = useHeartbeatStore((s) => s.loading)
  const heartbeatError = useHeartbeatStore((s) => s.error)
  const heartbeatLastFetched = useHeartbeatStore((s) => s.lastFetchedAt)
  const fetchHeartbeat = useHeartbeatStore((s) => s.fetchHeartbeat)
  const getPlayerData = useHeartbeatStore((s) => s.getPlayerData)
  const getPlayerUrgency = useHeartbeatStore((s) => s.getPlayerUrgency)

  const [levelFilter, setLevelFilter] = useState<PlayerLevel | 'All'>('All')
  const [sortField, setSortField] = useState<SortField>('tier')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [search, setSearch] = useState('')

  const hasHeartbeat = heartbeatPlayers.length > 0

  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    fetchRoster()
    // Auto-fetch heartbeat if not loaded or stale (>1 hour)
    const stale = !heartbeatLastFetched || (Date.now() - new Date(heartbeatLastFetched).getTime() > 3600000)
    if (stale) fetchHeartbeat()
  }, [fetchRoster, fetchHeartbeat, heartbeatLastFetched])

  const stats = useMemo(() => {
    const total = players.length
    const totalTarget = players.reduce((sum, p) => sum + p.visitTarget2026, 0)
    const totalCompleted = players.reduce((sum, p) => sum + p.visitsCompleted, 0)
    const coveragePercent = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0

    // Per-tier breakdown
    const tiers = [1, 2, 3, 4].map((tier) => {
      const tierPlayers = players.filter((p) => p.tier === tier)
      const target = tierPlayers.reduce((sum, p) => sum + p.visitTarget2026, 0)
      const completed = tierPlayers.reduce((sum, p) => sum + p.visitsCompleted, 0)
      return { tier, count: tierPlayers.length, target, completed, percent: target > 0 ? Math.round((completed / target) * 100) : 0 }
    }).filter((t) => t.count > 0)

    return { total, totalTarget, totalCompleted, coveragePercent, tiers }
  }, [players])

  // Heartbeat aggregate stats
  const heartbeatStats = useMemo(() => {
    if (!hasHeartbeat) return null

    const matched = players.filter((p) => getPlayerData(p.playerName))
    const avgLove = matched.length > 0
      ? Math.round(matched.reduce((sum, p) => sum + (getPlayerData(p.playerName)?.loveScore ?? 0), 0) / matched.length)
      : 0

    const overdue = heartbeatPriorities.filter((p) => p.inPersonOverdue).length
    const redCount = heartbeatPlayers.filter((p) => p.status === 'red').length
    const yellowCount = heartbeatPriorities.filter((p) => p.status === 'yellow').length

    return { avgLove, overdue, redCount, yellowCount, matchedCount: matched.length }
  }, [players, hasHeartbeat, heartbeatPlayers, heartbeatPriorities, getPlayerData, getPlayerUrgency])

  const filtered = players
    .filter((p) => levelFilter === 'All' || p.level === levelFilter)
    .filter((p) =>
      search === '' ||
      p.playerName.toLowerCase().includes(search.toLowerCase()) ||
      p.org.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortField === 'playerName') return mul * a.playerName.localeCompare(b.playerName)
      if (sortField === 'org') return mul * a.org.localeCompare(b.org)
      if (sortField === 'loveScore') {
        const aScore = getPlayerData(a.playerName)?.loveScore ?? -1
        const bScore = getPlayerData(b.playerName)?.loveScore ?? -1
        return mul * (aScore - bScore)
      }
      return mul * ((a[sortField] as number) - (b[sortField] as number))
    })

  const grouped: Record<PlayerLevel, RosterPlayer[]> = { Pro: [], NCAA: [], HS: [] }
  for (const p of filtered) {
    grouped[p.level].push(p)
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'loveScore' ? 'desc' : 'asc')
    }
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  if (loading && players.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        <span className="ml-3 text-text-dim">Loading roster...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-6 text-center">
        <p className="text-accent-red font-medium">Failed to load roster</p>
        <p className="mt-1 text-sm text-text-dim">{error}</p>
        <button
          onClick={fetchRoster}
          className="mt-4 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Players" value={stats.total} />
        <StatCard label="Visit Target" value={stats.totalTarget} />
        <StatCard label="Completed" value={stats.totalCompleted} />
        <StatCard
          label="Coverage"
          value={`${stats.coveragePercent}%`}
          accent={stats.coveragePercent >= 50 ? 'green' : stats.coveragePercent >= 25 ? 'orange' : 'red'}
        />
      </div>

      {/* Client Health panel from Heartbeat */}
      <ClientHealthPanel
        stats={heartbeatStats}
        loading={heartbeatLoading}
        error={heartbeatError}
        lastFetched={heartbeatLastFetched}
        onRefresh={fetchHeartbeat}
      />

      {/* Falling-behind alerts for T1/T2 */}
      <BehindPaceAlerts players={players} />

      {/* Per-tier coverage */}
      {stats.tiers.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-1 text-xs font-medium text-text-dim">Visit Progress by Tier</h3>
          <p className="mb-2 text-[10px] text-text-dim/60">
            Tier 1 = top priority (visit most often) · Tier 2 = medium · Tier 3 = lower · Tier 4 = minimal
          </p>
          <div className="flex flex-wrap gap-4">
            {stats.tiers.map(({ tier, count, target, completed, percent }) => (
              <div key={tier} className="flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  tier === 1 ? 'bg-accent-blue/20 text-accent-blue' :
                  tier === 2 ? 'bg-accent-green/20 text-accent-green' :
                  tier === 3 ? 'bg-accent-orange/20 text-accent-orange' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {tier}
                </span>
                <div className="w-20">
                  <div className="h-1.5 rounded-full bg-gray-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        percent >= 50 ? 'bg-accent-green' : percent >= 25 ? 'bg-accent-orange' : 'bg-accent-red'
                      }`}
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-[11px] text-text-dim">
                  {completed}/{target} ({percent}%)
                </span>
                <span className="text-[10px] text-text-dim/50">{count} players</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search players or orgs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-dim/50 focus:border-accent-blue focus:outline-none"
        />

        <div className="flex rounded-lg border border-border">
          {(['All', 'Pro', 'NCAA', 'HS'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                levelFilter === level
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-dim hover:text-text'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {Object.keys(playerTeamAssignments).length > 0 && (
            <button
              onClick={checkRosterMoves}
              disabled={rosterMovesLoading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text disabled:opacity-50"
              title="Check if any Pro players have been promoted, demoted, or traded in the last 30 days"
            >
              {rosterMovesLoading ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              )}
              Check for Trades
              {rosterMovesCheckedAt && (
                <span className="text-[9px] text-text-dim/50">{formatTimeAgo(new Date(rosterMovesCheckedAt).getTime())}</span>
              )}
            </button>
          )}
          <button
            onClick={fetchRoster}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text disabled:opacity-50"
          >
            {loading ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      {lastFetchedAt && (
        <p className="text-xs text-text-dim/60">
          Last updated: {new Date(lastFetchedAt).toLocaleTimeString()}
        </p>
      )}

      {/* Roster moves alerts */}
      {rosterMoves.length > 0 && (
        <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-accent-orange">
            {rosterMoves.length} Roster Move{rosterMoves.length !== 1 ? 's' : ''} Detected
          </h3>
          <div className="space-y-1.5">
            {rosterMoves.map((move, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-950/30 px-3 py-2 text-sm">
                <span className="font-medium text-text">{move.player.fullName}</span>
                <span className="text-xs text-text-dim">
                  {move.fromTeam?.name ?? '?'} → {move.toTeam?.name ?? '?'}
                </span>
                <span className="rounded bg-accent-orange/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-orange">
                  {move.typeDesc}
                </span>
                <span className="text-[11px] text-text-dim/60">
                  {move.effectiveDate || move.date}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-dim/60">
            Update the Google Sheet to reflect permanent changes, then click Refresh. Trades and promotions can affect trip plans — re-generate trips after updating.
          </p>
        </div>
      )}

      {rosterMovesError && (
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-sm text-accent-red">
          {rosterMovesError}
          <button onClick={checkRosterMoves} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* CSV parsing warnings */}
      {parseWarnings.length > 0 && (
        <ParseWarnings warnings={parseWarnings} />
      )}

      {/* Player table grouped by level */}
      {(['Pro', 'NCAA', 'HS'] as const).map((level) => {
        const group = grouped[level]
        if (group.length === 0 && levelFilter !== 'All' && levelFilter !== level) return null
        if (group.length === 0) return null

        return (
          <div key={level}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">
                {level === 'Pro' ? 'Professional' : level}
              </h3>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-dim">
                {group.length}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs font-medium text-text-dim">
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('playerName')}>
                      Name{sortIndicator('playerName')}
                    </th>
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('org')}>
                      Org{sortIndicator('org')}
                    </th>
                    <th className="px-4 py-2.5">Pos</th>
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('tier')}>
                      Tier{sortIndicator('tier')}
                    </th>
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('visitsRemaining')}>
                      Visits Left{sortIndicator('visitsRemaining')}
                    </th>
                    <th className="px-4 py-2.5">Target</th>
                    {hasHeartbeat && (
                      <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('loveScore')}>
                        <Term tip="Love Score from SV Heartbeat — a composite of call frequency, text frequency, in-person visits, and recency. 60+ = healthy, 30–59 = needs work, below 30 = at risk.">Love</Term>{sortIndicator('loveScore')}
                      </th>
                    )}
                    <th className="px-4 py-2.5">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((player) => (
                    <PlayerCard key={player.normalizedName} player={player} showHeartbeat={hasHeartbeat} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {filtered.length === 0 && players.length > 0 && (
        <p className="py-10 text-center text-sm text-text-dim">No players match your filters. Try adjusting your search or level filter above.</p>
      )}
      {players.length === 0 && !loading && !error && (
        <div className="py-10 text-center">
          <p className="text-sm text-text-dim">No players loaded yet.</p>
          <p className="mt-1 text-xs text-text-dim/60">The roster pulls automatically from the Google Sheet. Click Refresh above if it hasn't loaded.</p>
        </div>
      )}
    </div>
  )
}

function ClientHealthPanel({
  stats,
  loading,
  error,
  lastFetched,
  onRefresh,
}: {
  stats: { avgLove: number; overdue: number; redCount: number; yellowCount: number; matchedCount: number } | null
  loading: boolean
  error: string | null
  lastFetched: string | null
  onRefresh: () => void
}) {
  if (!stats && !loading && !error && !lastFetched) {
    // Never fetched — show connect prompt
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text">Client Health</h3>
            <p className="mt-0.5 text-xs text-text-dim">
              Connect to SV Heartbeat for love scores, contact freshness, and visit urgency data.
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {loading ? 'Syncing...' : 'Sync Heartbeat'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Client Health</h3>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-[10px] text-text-dim/60">
              via SV Heartbeat · {new Date(lastFetched).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-text-dim hover:text-text disabled:opacity-50"
          >
            {loading ? (
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-text-dim border-t-transparent" />
            ) : (
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-2 text-xs text-accent-red">{error}</p>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div title="Composite score based on call frequency, text frequency, in-person visits, and recency of all contact. 60+ = healthy, 30-59 = needs work, below 30 = at risk.">
            <p className="text-[10px] font-medium text-text-dim">Avg Love Score</p>
            <p className={`text-lg font-bold ${
              stats.avgLove >= 60 ? 'text-accent-green' :
              stats.avgLove >= 30 ? 'text-accent-orange' :
              'text-accent-red'
            }`}>
              {stats.avgLove}
              <span className="text-xs font-normal text-text-dim">/100</span>
            </p>
            <p className="text-[9px] text-text-dim/50">60+ green · 30+ yellow · &lt;30 red</p>
          </div>
          <div title="Players who haven't had an in-person visit within their tier's threshold: T1 = 60 days, T2 = 120 days, T3 = 180 days.">
            <p className="text-[10px] font-medium text-text-dim"><Term tip="Players who haven't had an in-person visit within their tier's threshold: Tier 1 = every 60 days, Tier 2 = every 120 days, Tier 3 = every 180 days.">In-Person Overdue</Term></p>
            <p className={`text-lg font-bold ${stats.overdue > 0 ? 'text-accent-red' : 'text-accent-green'}`}>
              {stats.overdue}
            </p>
            <p className="text-[9px] text-text-dim/50">T1: 60d · T2: 120d · T3: 180d</p>
          </div>
          <div title="Red = no contact in over 2x the threshold period. Yellow = contact is overdue but not critical. Green = all contact is current.">
            <p className="text-[10px] font-medium text-text-dim">Needs Attention</p>
            <p className={`text-lg font-bold ${
              stats.redCount > 0 ? 'text-accent-red' :
              stats.yellowCount > 0 ? 'text-accent-orange' :
              'text-accent-green'
            }`}>
              {stats.redCount + stats.yellowCount}
              {(stats.redCount > 0 || stats.yellowCount > 0) && (
                <span className="ml-1 text-xs font-normal text-text-dim">
                  ({stats.redCount > 0 ? `${stats.redCount} red` : ''}{stats.redCount > 0 && stats.yellowCount > 0 ? ', ' : ''}{stats.yellowCount > 0 ? `${stats.yellowCount} yellow` : ''})
                </span>
              )}
            </p>
          </div>
          <div title="How many roster players matched to a Heartbeat record by name. Unmatched players won't show love scores.">
            <p className="text-[10px] font-medium text-text-dim">Matched Players</p>
            <p className="text-lg font-bold text-text">
              {stats.matchedCount}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function BehindPaceAlerts({ players }: { players: RosterPlayer[] }) {
  const now = new Date()
  const seasonEnd = new Date(now.getFullYear(), 8, 30) // Sept 30
  if (now > seasonEnd) return null

  const monthsLeft = Math.max(
    (seasonEnd.getFullYear() - now.getFullYear()) * 12 + (seasonEnd.getMonth() - now.getMonth()),
    0.5,
  )

  const behindT1: Array<{ name: string; remaining: number; perMonth: number }> = []
  const behindT2: Array<{ name: string; remaining: number; perMonth: number }> = []

  for (const p of players) {
    if (p.visitsRemaining <= 0) continue
    if (p.tier !== 1 && p.tier !== 2) continue
    const perMonth = p.visitsRemaining / monthsLeft
    if (perMonth > 1.5) {
      const entry = { name: p.playerName, remaining: p.visitsRemaining, perMonth: Math.round(perMonth * 10) / 10 }
      if (p.tier === 1) behindT1.push(entry)
      else behindT2.push(entry)
    }
  }

  if (behindT1.length === 0 && behindT2.length === 0) return null

  return (
    <div className="space-y-2">
      {behindT1.length > 0 && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-accent-red">
            {behindT1.length} Tier 1 player{behindT1.length !== 1 ? 's' : ''} behind pace
          </h3>
          <p className="mb-2 text-xs text-text-dim">
            Need &gt;1.5 visits/month to hit targets by Sept 30 ({Math.round(monthsLeft)} months left). Consider prioritizing these players in your next trip.
          </p>
          <div className="space-y-1">
            {behindT1.map((p) => (
              <div key={p.name} className="flex items-center justify-between text-sm">
                <span className="font-medium text-text">{p.name}</span>
                <span className="text-xs text-accent-red">{p.remaining} visits left ({p.perMonth}/mo needed)</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {behindT2.length > 0 && (
        <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-accent-orange">
            {behindT2.length} Tier 2 player{behindT2.length !== 1 ? 's' : ''} behind pace
          </h3>
          <p className="mb-2 text-xs text-text-dim">
            Need &gt;1.5 visits/month to hit targets by Sept 30 ({Math.round(monthsLeft)} months left). Consider prioritizing these players in your next trip.
          </p>
          <div className="space-y-1">
            {behindT2.map((p) => (
              <div key={p.name} className="flex items-center justify-between text-sm">
                <span className="font-medium text-text">{p.name}</span>
                <span className="text-xs text-accent-orange">{p.remaining} visits left ({p.perMonth}/mo needed)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ParseWarnings({ warnings }: { warnings: string[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[11px] font-medium text-accent-orange">
          {warnings.length} roster parsing warning{warnings.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[10px] text-accent-orange/60">{expanded ? 'hide' : 'show'}</span>
      </button>
      {expanded && (
        <ul className="mt-2 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-text-dim">• {w}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[9px] text-text-dim/50">
        These values were auto-filled. Update the Google Sheet to fix them permanently.
      </p>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const accentColor =
    accent === 'green' ? 'text-accent-green' :
    accent === 'orange' ? 'text-accent-orange' :
    accent === 'red' ? 'text-accent-red' :
    'text-text'

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-text-dim">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentColor}`}>{value}</p>
    </div>
  )
}
