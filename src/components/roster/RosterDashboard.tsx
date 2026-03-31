import { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import type { SortField } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import type { AssignmentChange } from '../../store/scheduleStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { resolveMLBTeamId, resolveNcaaName, MLB_ORG_IDS, NCAA_ALIASES } from '../../data/aliases'
import type { RosterPlayer, PlayerLevel } from '../../types/roster'
import PlayerCard from './PlayerCard'

export default function RosterDashboard() {
  const players = useRosterStore((s) => s.players)
  const loading = useRosterStore((s) => s.loading)
  const error = useRosterStore((s) => s.error)
  const lastFetchedAt = useRosterStore((s) => s.lastFetchedAt)
  const parseWarnings = useRosterStore((s) => s.parseWarnings)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)

  const rosterMoves = useScheduleStore((s) => s.rosterMoves)
  const rosterMovesError = useScheduleStore((s) => s.rosterMovesError)
  const checkRosterMoves = useScheduleStore((s) => s.checkRosterMoves)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)
  const autoAssignPlayers = useScheduleStore((s) => s.autoAssignPlayers)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const autoAssignResult = useScheduleStore((s) => s.autoAssignResult)
  const assignPlayerToTeam = useScheduleStore((s) => s.assignPlayerToTeam)
  const affiliates = useScheduleStore((s) => s.affiliates)
  const assignmentLog = useScheduleStore((s) => s.assignmentLog) ?? []
  const customMlbAliases = useScheduleStore((s) => s.customMlbAliases)
  const customNcaaAliases = useScheduleStore((s) => s.customNcaaAliases)
  const setCustomAlias = useScheduleStore((s) => s.setCustomAlias)
  const proGames = useScheduleStore((s) => s.proGames)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)

  const sortField = useRosterStore((s) => s.sortColumn)
  const sortDir = useRosterStore((s) => s.sortDirection)
  const setSortField = useRosterStore((s) => s.setSortColumn)
  const setSortDir = useRosterStore((s) => s.setSortDirection)

  const [levelFilter, setLevelFilter] = useState<PlayerLevel | 'All'>('All')
  const [search, setSearch] = useState('')

  const fetchHeartbeat = useHeartbeatStore((s) => s.fetchHeartbeat)
  const heartbeatLastFetched = useHeartbeatStore((s) => s.lastFetchedAt)

  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    fetchRoster()
    // Auto-fetch heartbeat if not loaded or stale (>1 hour)
    const stale = !heartbeatLastFetched || (Date.now() - new Date(heartbeatLastFetched).getTime() > 3600000)
    if (stale) fetchHeartbeat()
  }, [fetchRoster, fetchHeartbeat, heartbeatLastFetched])

  const playerCount = players.length

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
      setSortDir('asc')
    }
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  // Unresolved org names (need alias mapping)
  const proPlayers = players.filter((p) => p.level === 'Pro')
  const ncaaPlayers = players.filter((p) => p.level === 'NCAA')
  const unresolvedPro = proPlayers.filter((p) => !resolveMLBTeamId(p.org, customMlbAliases))
  const unresolvedNcaa = ncaaPlayers.filter((p) => !resolveNcaaName(p.org, customNcaaAliases))
  const hasUnresolved = unresolvedPro.length > 0 || unresolvedNcaa.length > 0

  const mlbOrgNames = useMemo(() => {
    const names = new Set<string>()
    for (const key of Object.keys(MLB_ORG_IDS)) {
      if (key.includes(' ')) names.add(key)
    }
    return [...names].sort()
  }, [])
  const ncaaSchoolNames = useMemo(() => [...Object.keys(NCAA_ALIASES)].sort(), [])

  // Most recent assignment log entries (from last verify)
  const recentLog = useMemo(() => {
    if (assignmentLog.length === 0) return []
    const lastTimestamp = assignmentLog[assignmentLog.length - 1]?.timestamp ?? 0
    return assignmentLog.filter((e) => e.timestamp === lastTimestamp)
  }, [assignmentLog])

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
    <div className="space-y-4">
      {/* Compact summary: player count + refresh */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-text-dim">{playerCount} players</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {lastFetchedAt && (
              <span className="text-xs text-text-dim/60">
                Updated {new Date(lastFetchedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchRoster}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-text-dim hover:text-text hover:border-accent-blue transition-colors disabled:opacity-50"
              title="Pull the latest player list from the Google Sheet (names, orgs, tiers)"
            >
              {loading ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.657v4.992" />
                </svg>
              )}
              Reload Roster
            </button>
          </div>
        </div>
        {/* Thin progress bar at bottom of summary bar */}
        {loading && (
          <div className="h-0.5 bg-gray-800">
            <div className="h-full bg-accent-blue animate-pulse rounded-full w-2/3" />
          </div>
        )}
      </div>

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

      </div>


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
      {grouped.Pro.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">Professional</h3>
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-dim">
              {grouped.Pro.length}
            </span>
            <button
              onClick={autoAssignPlayers}
              disabled={autoAssignLoading}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
              title="Look up where each player is currently assigned using live MLB/MiLB rosters"
            >
              {autoAssignLoading ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              )}
              Check Assignments
            </button>
          </div>

          {/* Verify progress bar */}
          {autoAssignLoading && (
            <div className="mb-3 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-accent-blue border-t-transparent" />
                <span className="text-xs font-medium text-text">Scanning MLB/MiLB rosters...</span>
              </div>
              <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
                <div className="h-full rounded-full bg-accent-blue animate-pulse w-2/3" />
              </div>
              <p className="mt-1 text-[10px] text-text-dim/60">Checking {grouped.Pro.length} players against active rosters (~5s)</p>
            </div>
          )}

          {/* Verify results panel */}
          {recentLog.length > 0 && !autoAssignLoading && (
            <>
              <VerifyResultsPanel
                log={recentLog}
                springTraining={autoAssignResult?.springTrainingEstimate ?? false}
              />
              {/* Stale schedules warning when assignments changed */}
              {recentLog.some((e) => e.action === 'reassigned') && proGames.length > 0 && (
                <div className="mb-3 rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-accent-orange">Assignments changed — schedules may be stale</p>
                      <p className="mt-0.5 text-[11px] text-text-dim">
                        Pro schedules were loaded with previous team assignments. Reload to fetch games for the updated teams.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        const store = useScheduleStore.getState()
                        const y = new Date().getFullYear()
                        await store.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
                      }}
                      disabled={schedulesLoading}
                      className="ml-4 shrink-0 rounded-lg bg-accent-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
                    >
                      {schedulesLoading ? 'Reloading...' : 'Reload Pro Schedules'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {autoAssignResult?.springTrainingEstimate && recentLog.length === 0 && (
            <div className="mb-3 rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-4 py-2.5">
              <p className="text-xs font-medium text-accent-orange">Spring training — MiLB rosters not yet published</p>
              <p className="mt-0.5 text-[11px] text-text-dim">
                Affiliates are estimated from last year's assignment + one level promotion. Click Verify Assignments to check current rosters.
              </p>
            </div>
          )}

          <ProTable
            players={grouped.Pro}
            playerTeamAssignments={playerTeamAssignments}
            affiliates={affiliates}
            onAssign={assignPlayerToTeam}
            toggleSort={toggleSort}
            sortIndicator={sortIndicator}
          />
        </div>
      )}

      {(['NCAA', 'HS'] as const).map((level) => {
        const group = grouped[level]
        if (group.length === 0) return null

        return (
          <div key={level}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">{level}</h3>
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
                    <th className="px-4 py-2.5">Last Visit</th>
                    <th className="px-4 py-2.5">Love</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((player) => (
                    <PlayerCard key={player.normalizedName} player={player} />
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

      {/* Data Setup — unresolved org name mapping */}
      {hasUnresolved && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-accent-red">
            Unknown Team Names ({unresolvedPro.length + unresolvedNcaa.length})
          </h3>
          <p className="mb-3 text-xs text-text-dim">
            These team/school names from the roster don't match any known organization. Map them below so schedules load correctly.
          </p>
          <div className="space-y-2">
            {[...new Set(unresolvedPro.map((p) => p.org))].map((org) => {
              const orgPlayers = unresolvedPro.filter((p) => p.org === org)
              return (
                <div key={`pro-${org}`} className="flex items-center gap-3 rounded-lg border border-accent-red/20 bg-gray-950 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-accent-red">"{org}"</span>
                    <span className="ml-2 text-xs text-text-dim">(Pro — {orgPlayers.map((p) => p.playerName).join(', ')})</span>
                  </div>
                  <select
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
                    value=""
                    onChange={(e) => { if (e.target.value) setCustomAlias('mlb', org, e.target.value) }}
                  >
                    <option value="">Map to MLB org...</option>
                    {mlbOrgNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )
            })}
            {[...new Set(unresolvedNcaa.map((p) => p.org))].map((org) => {
              const orgPlayers = unresolvedNcaa.filter((p) => p.org === org)
              return (
                <div key={`ncaa-${org}`} className="flex items-center gap-3 rounded-lg border border-accent-red/20 bg-gray-950 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-accent-red">"{org}"</span>
                    <span className="ml-2 text-xs text-text-dim">(NCAA — {orgPlayers.map((p) => p.playerName).join(', ')})</span>
                  </div>
                  <select
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
                    value=""
                    onChange={(e) => { if (e.target.value) setCustomAlias('ncaa', org, e.target.value) }}
                  >
                    <option value="">Map to NCAA school...</option>
                    {ncaaSchoolNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ProTable({
  players,
  playerTeamAssignments,
  affiliates,
  onAssign,
  toggleSort,
  sortIndicator,
}: {
  players: RosterPlayer[]
  playerTeamAssignments: Record<string, { teamId: number; sportId: number; teamName: string }>
  affiliates: Array<{ teamId: number; teamName: string; sportId: number; parentOrgId: number }>
  onAssign: (playerName: string, assignment: { teamId: number; sportId: number; teamName: string }) => void
  toggleSort: (field: SortField) => void
  sortIndicator: (field: SortField) => string
}) {
  return (
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
            <th className="px-4 py-2.5">Affiliate</th>
            <th className="px-4 py-2.5">Pos</th>
            <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('tier')}>
              Tier{sortIndicator('tier')}
            </th>
            <th className="px-4 py-2.5">Last Visit</th>
            <th className="px-4 py-2.5">Love</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <PlayerCard
              key={player.normalizedName}
              player={player}
              showAffiliate
              affiliate={playerTeamAssignments[player.playerName] ?? null}
              affiliateOptions={affiliates}
              onAssignAffiliate={onAssign}
            />
          ))}
        </tbody>
      </table>
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

function VerifyResultsPanel({ log, springTraining: _springTraining }: { log: AssignmentChange[]; springTraining: boolean }) {
  const reassigned = log.filter((e) => e.action === 'reassigned')
  const notFound = log.filter((e) => e.action === 'not-found')
  const assignments = useScheduleStore((s) => s.playerTeamAssignments)
  const confirmedCount = Object.values(assignments).filter((a) => a.source === 'milb-roster' || a.source === 'mlb-roster').length
  const estimatedCount = Object.values(assignments).filter((a) => a.source === 'estimated').length

  return (
    <div className="mb-3 rounded-lg border border-border/50 bg-surface px-4 py-3">
      {/* Status summary badges */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        {confirmedCount > 0 && (
          <span className="flex items-center gap-1 text-accent-green">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            {confirmedCount} confirmed
          </span>
        )}
        {estimatedCount > 0 && (
          <span className="flex items-center gap-1 text-accent-orange">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            {estimatedCount} unconfirmed
          </span>
        )}
        {reassigned.length > 0 && (
          <span className="flex items-center gap-1 text-accent-blue">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
            {reassigned.length} moved
          </span>
        )}
        {notFound.length > 0 && (
          <span className="flex items-center gap-1 text-accent-red">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {notFound.length} not found
          </span>
        )}
      </div>

      {/* Plain-English explanations */}
      <div className="mb-2 space-y-1.5 text-[11px]">
        {confirmedCount > 0 && (
          <p className="text-text-dim">
            <span className="font-medium text-accent-green">Confirmed</span> — verified on a current MLB or MiLB roster. Good to go.
          </p>
        )}
        {estimatedCount > 0 && (
          <p className="text-text-dim">
            <span className="font-medium text-accent-orange">Unconfirmed</span> — according to the MLB Stats API, {estimatedCount === 1 ? 'this player does' : 'these players do'} not have an official affiliate assigned yet. We're using last year's team + one level promotion as an estimate. Click "Check Assignments" to refresh.
          </p>
        )}
        {reassigned.length > 0 && (
          <p className="text-text-dim">
            <span className="font-medium text-accent-blue">Moved</span> — these players are on a different affiliate than last time. Schedules updated.
          </p>
        )}
        {notFound.length > 0 && (
          <p className="text-text-dim">
            <span className="font-medium text-accent-red">Not found</span> — not on any MLB or MiLB roster right now. Could be unsigned, released, or just not added yet.
          </p>
        )}
      </div>

      {/* Estimated player details */}
      {estimatedCount > 0 && (() => {
        const estimatedNames = Object.entries(assignments)
          .filter(([, a]) => a.source === 'estimated')
          .map(([name, a]) => `${name} → ${a.teamName}`)
        return (
          <div className="mb-2 rounded bg-accent-orange/10 px-2 py-1.5 text-[10px] text-accent-orange">
            {estimatedNames.join(', ')}
          </div>
        )
      })()}

      {/* Reassigned player details */}
      {reassigned.length > 0 && (
        <div className="mb-2 space-y-1">
          {reassigned.map((e) => (
            <div key={e.playerName} className="flex items-center gap-2 rounded bg-accent-blue/10 px-2 py-1 text-[11px]">
              <span className="font-medium text-accent-blue">{e.playerName}</span>
              <span className="text-text-dim">{e.from}</span>
              <span className="text-text-dim/50">→</span>
              <span className="font-medium text-text">{e.to}</span>
            </div>
          ))}
        </div>
      )}

      {/* Not found player details */}
      {notFound.length > 0 && (
        <div className="space-y-1">
          {notFound.map((e) => (
            <div key={e.playerName} className="flex items-center gap-2 rounded bg-accent-red/10 px-2 py-1 text-[11px]">
              <span className="font-medium text-accent-red">{e.playerName}</span>
              <span className="text-text-dim">not on any current roster</span>
            </div>
          ))}
        </div>
      )}

      {/* All clear message */}
      {reassigned.length === 0 && notFound.length === 0 && confirmedCount > 0 && estimatedCount === 0 && (
        <p className="text-[11px] text-accent-green">All players verified on current rosters. No changes.</p>
      )}
      {reassigned.length === 0 && notFound.length === 0 && confirmedCount > 0 && estimatedCount > 0 && (
        <p className="text-[11px] text-text-dim">{confirmedCount} confirmed, {estimatedCount} unconfirmed. Click "Check Assignments" to refresh from the MLB Stats API.</p>
      )}
    </div>
  )
}

