import { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import type { SortField } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import type { AssignmentChange } from '../../store/scheduleStore'
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

  const sortField = useRosterStore((s) => s.sortColumn)
  const sortDir = useRosterStore((s) => s.sortDirection)
  const setSortField = useRosterStore((s) => s.setSortColumn)
  const setSortDir = useRosterStore((s) => s.setSortDirection)

  const [levelFilter, setLevelFilter] = useState<PlayerLevel | 'All'>('All')
  const [search, setSearch] = useState('')

  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    fetchRoster()
  }, [fetchRoster])

  const stats = useMemo(() => {
    const total = players.length

    // Per-tier breakdown (count only)
    const tiers = [1, 2, 3, 4].map((tier) => {
      const tierPlayers = players.filter((p) => p.tier === tier)
      return { tier, count: tierPlayers.length }
    }).filter((t) => t.count > 0)

    return { total, tiers }
  }, [players])

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
      {/* Compact summary: player count + tier breakdown */}
      <div className="rounded-xl border border-border bg-surface px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-text-dim">{stats.total} players</span>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {stats.tiers.map(({ tier, count }) => (
              <div key={tier} className="flex items-center gap-1.5">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                  tier === 1 ? 'bg-accent-blue/20 text-accent-blue' :
                  tier === 2 ? 'bg-accent-green/20 text-accent-green' :
                  tier === 3 ? 'bg-accent-orange/20 text-accent-orange' :
                  'bg-gray-500/20 text-gray-400'
                }`}>{tier}</span>
                <span className="text-[10px] text-text-dim">{count}</span>
              </div>
            ))}
          </div>
        </div>
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
              title="Check MLB/MiLB rosters and verify current affiliate assignments"
            >
              {autoAssignLoading ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              )}
              Verify Assignments
            </button>
          </div>

          {/* Verify results panel */}
          {recentLog.length > 0 && !autoAssignLoading && (
            <VerifyResultsPanel
              log={recentLog}
              springTraining={autoAssignResult?.springTrainingEstimate ?? false}
            />
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
                    <th className="px-4 py-2.5">Agent</th>
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
            <th className="px-4 py-2.5">Agent</th>
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

function VerifyResultsPanel({ log, springTraining }: { log: AssignmentChange[]; springTraining: boolean }) {
  const reassigned = log.filter((e) => e.action === 'reassigned')
  const assigned = log.filter((e) => e.action === 'assigned')
  const notFound = log.filter((e) => e.action === 'not-found')
  const nameMatched = log.filter((e) => e.action === 'name-matched')
  const fallback = log.filter((e) => e.action === 'fallback')
  const confirmed = assigned.length + nameMatched.length + fallback.length

  return (
    <div className="mb-3 rounded-lg border border-border/50 bg-surface px-4 py-3">
      <div className="mb-2 flex items-center gap-3 text-xs">
        {confirmed > 0 && (
          <span className="text-accent-green">{confirmed} confirmed</span>
        )}
        {reassigned.length > 0 && (
          <span className="text-accent-blue">{reassigned.length} changed</span>
        )}
        {notFound.length > 0 && (
          <span className="text-accent-red">{notFound.length} not found</span>
        )}
      </div>

      {springTraining && (
        <p className="mb-2 text-[10px] text-accent-orange">
          Spring training — affiliates estimated from last year + one level promotion. Will auto-correct when regular season rosters publish.
        </p>
      )}

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

      {notFound.length > 0 && (
        <div className="space-y-1">
          {notFound.map((e) => (
            <div key={e.playerName} className="flex items-center gap-2 rounded bg-accent-red/10 px-2 py-1 text-[11px]">
              <span className="font-medium text-accent-red">{e.playerName}</span>
              <span className="text-text-dim">not found on any MLB/MiLB roster</span>
            </div>
          ))}
        </div>
      )}

      {reassigned.length === 0 && notFound.length === 0 && confirmed > 0 && (
        <p className="text-[11px] text-accent-green">All assignments verified — no changes detected.</p>
      )}
    </div>
  )
}

