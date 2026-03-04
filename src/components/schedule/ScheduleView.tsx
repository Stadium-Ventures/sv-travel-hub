import { useEffect, useMemo, useRef, useState } from 'react'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { resolveMLBTeamId, resolveNcaaName, MLB_ORG_IDS, NCAA_ALIASES } from '../../data/aliases'
import { NCAA_VENUES } from '../../data/ncaaVenues'
import { isSpringTraining, getSpringTrainingSite, isGrapefruitLeague, SPRING_TRAINING_SITES } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason } from '../../lib/tripEngine'
import { formatTimeAgo } from '../../lib/formatters'
import type { MLBAffiliate } from '../../lib/mlbApi'
import { D1_BASEBALL_SLUGS } from '../../data/d1baseballSlugs'
import { resolveMaxPrepsSlug } from '../../lib/maxpreps'
import type { RosterPlayer } from '../../types/roster'
import type { GameEvent } from '../../types/schedule'

export default function ScheduleView() {
  const players = useRosterStore((s) => s.players)
  const proPlayers = players.filter((p) => p.level === 'Pro')
  const ncaaPlayers = players.filter((p) => p.level === 'NCAA')
  const hsPlayers = players.filter((p) => p.level === 'HS')

  const affiliates = useScheduleStore((s) => s.affiliates)
  const affiliatesLoading = useScheduleStore((s) => s.affiliatesLoading)
  const affiliatesError = useScheduleStore((s) => s.affiliatesError)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)
  const proGames = useScheduleStore((s) => s.proGames)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const schedulesError = useScheduleStore((s) => s.schedulesError)
  const fetchAffiliates = useScheduleStore((s) => s.fetchAffiliates)
  const assignPlayerToTeam = useScheduleStore((s) => s.assignPlayerToTeam)
  const fetchProSchedules = useScheduleStore((s) => s.fetchProSchedules)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaProgress = useScheduleStore((s) => s.ncaaProgress)
  const ncaaError = useScheduleStore((s) => s.ncaaError)
  const fetchNcaaSchedules = useScheduleStore((s) => s.fetchNcaaSchedules)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const ncaaFetchedAt = useScheduleStore((s) => s.ncaaFetchedAt)
  const customMlbAliases = useScheduleStore((s) => s.customMlbAliases)
  const customNcaaAliases = useScheduleStore((s) => s.customNcaaAliases)
  const setCustomAlias = useScheduleStore((s) => s.setCustomAlias)
  const rosterMoves = useScheduleStore((s) => s.rosterMoves)
  const autoAssignPlayers = useScheduleStore((s) => s.autoAssignPlayers)
  const removePlayerAssignment = useScheduleStore((s) => s.removePlayerAssignment)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const autoAssignResult = useScheduleStore((s) => s.autoAssignResult)
  const ncaaFailedSchools = useScheduleStore((s) => s.ncaaFailedSchools)
  const ncaaDroppedAwayGames = useScheduleStore((s) => s.ncaaDroppedAwayGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const hsLoading = useScheduleStore((s) => s.hsLoading)
  const hsProgress = useScheduleStore((s) => s.hsProgress)
  const hsError = useScheduleStore((s) => s.hsError)
  const fetchHsSchedules = useScheduleStore((s) => s.fetchHsSchedules)
  const hsFetchedAt = useScheduleStore((s) => s.hsFetchedAt)
  const hsFailedSchools = useScheduleStore((s) => s.hsFailedSchools)
  const rosterMovesError = useScheduleStore((s) => s.rosterMovesError)

  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-03-01`)
  const [endDate, setEndDate] = useState(`${new Date().getFullYear()}-09-30`)
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    if (affiliates.length === 0 && !affiliatesLoading) {
      initialized.current = true
      fetchAffiliates()
    }
  }, [affiliates.length, affiliatesLoading, fetchAffiliates])

  // Group affiliates by parent org
  const affiliatesByParent = new Map<number, MLBAffiliate[]>()
  for (const aff of affiliates) {
    const existing = affiliatesByParent.get(aff.parentOrgId)
    if (existing) existing.push(aff)
    else affiliatesByParent.set(aff.parentOrgId, [aff])
  }

  const assignedCount = Object.keys(playerTeamAssignments).length
  const unassigned = proPlayers.filter((p) => !playerTeamAssignments[p.playerName])

  const isStActive = isSpringTraining(new Date().toISOString().slice(0, 10))

  // Unresolved players (org not recognized even with custom aliases)
  const unresolvedPro = proPlayers.filter((p) => !resolveMLBTeamId(p.org, customMlbAliases))
  const unresolvedNcaa = ncaaPlayers.filter((p) => !resolveNcaaName(p.org, customNcaaAliases))
  const hasUnresolved = unresolvedPro.length > 0 || unresolvedNcaa.length > 0

  // Get unique canonical MLB org names for the dropdown
  const mlbOrgNames = useMemo(() => {
    const names = new Set<string>()
    for (const key of Object.keys(MLB_ORG_IDS)) {
      // Only include full names (contain space) to avoid duplicates like "Reds" and "Cincinnati Reds"
      if (key.includes(' ')) names.add(key)
    }
    return [...names].sort()
  }, [])

  // Get unique canonical NCAA school names for the dropdown
  const ncaaSchoolNames = useMemo(() => [...Object.keys(NCAA_ALIASES)].sort(), [])

  // Data Health: find players with zero games
  const playersWithNoGames = useMemo(() => {
    const missing: Array<{ name: string; level: string; reason: string }> = []

    for (const p of proPlayers) {
      if (!playerTeamAssignments[p.playerName]) {
        missing.push({ name: p.playerName, level: 'Pro', reason: 'Not connected to a team yet' })
      } else if (proGames.length > 0 && !proGames.some((g) => g.playerNames.includes(p.playerName))) {
        missing.push({ name: p.playerName, level: 'Pro', reason: 'Connected but no games found in loaded schedules' })
      }
    }

    for (const p of ncaaPlayers) {
      const canonical = resolveNcaaName(p.org, customNcaaAliases)
      if (!canonical) {
        missing.push({ name: p.playerName, level: 'College', reason: `Organization "${p.org}" not recognized` })
      } else if (ncaaGames.length > 0 && !ncaaGames.some((g) => g.playerNames.includes(p.playerName))) {
        missing.push({ name: p.playerName, level: 'College', reason: 'School recognized but no games loaded' })
      }
    }

    return missing
  }, [proPlayers, ncaaPlayers, proGames, ncaaGames, playerTeamAssignments, customNcaaAliases])

  // Collect all issues for the health panel
  const hasIssues = playersWithNoGames.length > 0 || hasUnresolved || ncaaFailedSchools.length > 0 || ncaaDroppedAwayGames > 0 || hsFailedSchools.length > 0 || schedulesError || ncaaError || hsError || rosterMovesError || (autoAssignResult?.error)

  return (
    <div className="space-y-6">
      {/* Data Health Summary */}
      {players.length > 0 && (
        <div className={`rounded-xl border p-4 ${hasIssues ? 'border-accent-orange/30 bg-accent-orange/5' : 'border-accent-green/30 bg-accent-green/5'}`}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${hasIssues ? 'bg-accent-orange' : 'bg-accent-green'}`}>
              {hasIssues ? '!' : '\u2713'}
            </span>
            <h2 className={`text-sm font-semibold ${hasIssues ? 'text-accent-orange' : 'text-accent-green'}`}>
              {hasIssues ? 'Data Health — Issues Found' : 'Data Health — All Good'}
            </h2>
          </div>

          {/* Quick stats line */}
          <div className="mb-2 flex flex-wrap gap-3 text-xs text-text-dim">
            <span>{proPlayers.length} Pro players ({assignedCount} connected)</span>
            <span>{ncaaPlayers.length} College players</span>
            <span>{hsPlayers.length} HS players</span>
            {proGames.length > 0 && <span className="text-accent-green">{proGames.length} Pro games loaded</span>}
            {ncaaGames.length > 0 && <span className="text-accent-green">{ncaaGames.length} College games loaded</span>}
            {hsGames.length > 0 && <span className="text-accent-green">{hsGames.length} HS games loaded</span>}
          </div>

          {/* Issues list */}
          {hasIssues && (
            <div className="space-y-1.5">
              {playersWithNoGames.length > 0 && (
                <div className="rounded-lg bg-gray-950/30 px-3 py-2">
                  <p className="text-xs font-medium text-accent-orange">{playersWithNoGames.length} player{playersWithNoGames.length !== 1 ? 's' : ''} with no games:</p>
                  <div className="mt-1 space-y-0.5">
                    {playersWithNoGames.map((p) => (
                      <p key={p.name} className="text-[11px] text-text-dim">
                        <span className="text-text">{p.name}</span> ({p.level}) — {p.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {ncaaFailedSchools.length > 0 && (
                <p className="text-[11px] text-accent-red">
                  Failed to load schedules for: {ncaaFailedSchools.join(', ')}. These schools' games won't appear in trip planning.
                </p>
              )}

              {ncaaDroppedAwayGames > 0 && (
                <p className="text-[11px] text-accent-orange">
                  {ncaaDroppedAwayGames} college away game{ncaaDroppedAwayGames !== 1 ? 's' : ''} skipped because we don't have the opponent's stadium location. Only home games and away games at known schools are included.
                </p>
              )}

              {schedulesError && (
                <p className="text-[11px] text-accent-red">Pro schedule error: {schedulesError}</p>
              )}

              {ncaaError && (
                <p className="text-[11px] text-accent-red">College schedule error: {ncaaError}</p>
              )}

              {hsFailedSchools.length > 0 && (
                <p className="text-[11px] text-accent-red">
                  Failed to load HS schedules for: {hsFailedSchools.join(', ')}
                </p>
              )}

              {hsError && (
                <p className="text-[11px] text-accent-red">HS schedule error: {hsError}</p>
              )}

              {autoAssignResult?.error && (
                <p className="text-[11px] text-accent-red">Auto-assign failed: {autoAssignResult.error}. Try again or assign players manually.</p>
              )}

              {rosterMovesError && (
                <p className="text-[11px] text-accent-red">{rosterMovesError}</p>
              )}
            </div>
          )}

          {!hasIssues && (
            <p className="text-[11px] text-accent-green">All players are connected, schedules are loaded, and no errors detected.</p>
          )}
        </div>
      )}

      {/* Unresolved players — alias editor */}
      {hasUnresolved && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-accent-red">Unknown Team Names</h3>
          <p className="mb-3 text-xs text-text-dim">
            We couldn't match these team/school names from the roster. Pick the correct organization below so their schedules load properly.
          </p>
          <div className="space-y-2">
            {/* Group unresolved by unique org name */}
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
                    onChange={(e) => {
                      if (e.target.value) setCustomAlias('mlb', org, e.target.value)
                    }}
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
                    onChange={(e) => {
                      if (e.target.value) setCustomAlias('ncaa', org, e.target.value)
                    }}
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

      {/* Assignment section */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Where Are Your Pro Players?</h2>
            <p className="text-xs text-text-dim">
              Pick which team each Pro player is currently on so we can find their games ({assignedCount}/{proPlayers.length} connected)
              {isStActive && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" />
                  Spring Training Active — see ST locations below
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {affiliatesLoading && (
              <span className="flex items-center gap-2 text-xs text-text-dim">
                <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
                Loading affiliates...
              </span>
            )}
            {unassigned.length > 0 && affiliates.length > 0 && (
              <button
                onClick={autoAssignPlayers}
                disabled={autoAssignLoading}
                className="rounded-lg bg-accent-green px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
              >
                {autoAssignLoading ? 'Scanning rosters...' : 'Find on Rosters'}
              </button>
            )}
          </div>
        </div>

        {autoAssignResult && (
          <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${autoAssignResult.error ? 'border border-accent-red/30 bg-accent-red/5 text-accent-red' : autoAssignResult.assigned > 0 ? 'border border-accent-green/30 bg-accent-green/5 text-accent-green' : 'border border-accent-orange/30 bg-accent-orange/5 text-accent-orange'}`}>
            {autoAssignResult.error ? (
              <span>Auto-assign failed: {autoAssignResult.error}. Try again or assign players manually.</span>
            ) : (
              <>
                {autoAssignResult.assigned > 0 && `Found ${autoAssignResult.assigned} player${autoAssignResult.assigned !== 1 ? 's' : ''} on MLB rosters. `}
                {autoAssignResult.notFound.length > 0 && (
                  <span className="text-text-dim">
                    Not found on any roster: {autoAssignResult.notFound.join(', ')}
                  </span>
                )}
                {autoAssignResult.assigned === 0 && autoAssignResult.notFound.length === 0 && 'All Pro players already connected.'}
              </>
            )}
          </div>
        )}

        {affiliatesError && (
          <div className="mb-4 rounded-lg border border-accent-red/30 bg-accent-red/5 px-4 py-2 text-sm text-accent-red">
            {affiliatesError}
            <button onClick={() => fetchAffiliates()} className="ml-2 underline">Retry</button>
          </div>
        )}

        {unassigned.length > 0 && (
          <div className="space-y-2">
            {unassigned.map((player) => {
              const parentId = resolveMLBTeamId(player.org, customMlbAliases)
              const teamOptions = parentId ? affiliatesByParent.get(parentId) ?? [] : []

              return (
                <div key={player.playerName} className="flex items-center gap-3 rounded-lg border border-border/50 bg-gray-950 px-3 py-2">
                  <span className="min-w-[140px] text-sm font-medium text-text">{player.playerName}</span>
                  <span className="text-xs text-text-dim">{player.org}</span>
                  <select
                    className="ml-auto rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
                    value=""
                    onChange={(e) => {
                      const [teamId, sportId, teamName] = e.target.value.split('|')
                      if (teamId && sportId && teamName) {
                        assignPlayerToTeam(player.playerName, {
                          teamId: parseInt(teamId),
                          sportId: parseInt(sportId),
                          teamName,
                        })
                      }
                    }}
                  >
                    <option value="">Select team...</option>
                    {teamOptions
                      .sort((a, b) => a.sportId - b.sportId)
                      .map((t) => (
                        <option key={t.teamId} value={`${t.teamId}|${t.sportId}|${t.teamName}`}>
                          {t.teamName} ({t.sportName})
                        </option>
                      ))}
                    {teamOptions.length === 0 && parentId === null && (
                      <option disabled>Org not recognized — check aliases</option>
                    )}
                  </select>
                </div>
              )
            })}
          </div>
        )}

        {assignedCount > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-text-dim">
              Assigned Players
              <span className="ml-1 text-[10px] text-text-dim/50">— click team name to reassign, × to remove</span>
            </h3>
            <div className="grid gap-1 sm:grid-cols-2">
              {Object.entries(playerTeamAssignments).map(([name, assignment]) => {
                const rosterPlayer = players.find((p) => p.playerName === name)
                const parentId = rosterPlayer ? resolveMLBTeamId(rosterPlayer.org, customMlbAliases) : null
                const teamOptions = parentId ? affiliatesByParent.get(parentId) ?? [] : []
                return (
                  <AssignedPlayerRow
                    key={name}
                    name={name}
                    assignment={assignment}
                    teamOptions={teamOptions}
                    org={rosterPlayer?.org ?? ''}
                    position={rosterPlayer?.position ?? ''}
                    onReassign={(newAssignment) => assignPlayerToTeam(name, newAssignment)}
                    onRemove={() => removePlayerAssignment(name)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Spring Training info */}
      {isSpringTraining(new Date().toISOString().slice(0, 10)) && (
        <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-5">
          <h2 className="mb-2 text-base font-semibold text-accent-orange">Spring Training Active</h2>
          <p className="mb-3 text-xs text-text-dim">
            Pro players are at spring training facilities, not their regular season affiliates.
            Grapefruit League sites (Florida) are drivable from Orlando.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {proPlayers.map((player) => {
              const parentId = resolveMLBTeamId(player.org, customMlbAliases)
              const site = parentId ? getSpringTrainingSite(parentId) : null
              if (!site) return null
              const drivable = parentId ? isGrapefruitLeague(parentId) : false
              return (
                <div key={player.playerName} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-1.5 text-sm">
                  <span className="text-text">{player.playerName}</span>
                  <span className={`text-xs ${drivable ? 'text-accent-green' : 'text-accent-red'}`}>
                    {site.venueName} ({site.league})
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ST Mailing Directory — always visible during spring training */}
      {isSpringTraining(new Date().toISOString().slice(0, 10)) && (
        <div className="rounded-xl border border-border/30 bg-surface/50 p-5">
          <h2 className="mb-3 text-base font-semibold text-text">ST Mailing Directory</h2>
          <p className="mb-3 text-xs text-text-dim">
            Mailing addresses for all 30 Spring Training facilities. Grapefruit League (Florida) listed first.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(SPRING_TRAINING_SITES)
              .sort(([, a], [, b]) => {
                // Grapefruit first, then alphabetical by team name
                if (a.league !== b.league) return a.league === 'Grapefruit' ? -1 : 1
                return a.teamName.localeCompare(b.teamName)
              })
              .map(([id, site]) => (
                <div key={id} className="rounded-lg bg-gray-950/50 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{site.teamName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      site.league === 'Grapefruit'
                        ? 'bg-accent-green/15 text-accent-green'
                        : 'bg-accent-orange/15 text-accent-orange'
                    }`}>
                      {site.league}
                    </span>
                  </div>
                  <div className="text-xs text-text-dim">{site.complexName}</div>
                  <div className="text-xs text-text-dim">
                    {site.streetAddress}, {site.cityState} {site.zip}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Schedule fetch controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-base font-semibold text-text">Load Pro Schedules</h2>
          {proFetchedAt && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              Date.now() - proFetchedAt > 24 * 60 * 60 * 1000
                ? 'bg-accent-orange/10 text-accent-orange'
                : 'bg-accent-green/10 text-accent-green'
            }`}>
              {formatTimeAgo(proFetchedAt)}
            </span>
          )}
          {!proFetchedAt && proGames.length === 0 && (
            <span className="rounded bg-accent-red/10 px-2 py-0.5 text-[10px] font-medium text-accent-red">Required — not loaded yet</span>
          )}
        </div>
        <p className="mb-3 text-xs text-text-dim">
          <strong className="text-text">Required for trip planning.</strong> This pulls real game dates and locations from the MLB API so the Trip Planner knows when and where each player will be. Covers all levels in each organization (MLB, AAA, AA, A) so you won't miss games if a player gets promoted or sent down. Re-fetch periodically to pick up schedule changes and rain-outs.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
            />
          </div>
          <button
            onClick={() => fetchProSchedules(startDate, endDate)}
            disabled={schedulesLoading || assignedCount === 0}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {schedulesLoading ? 'Loading games...' : 'Load Game Schedules'}
          </button>
        </div>

        {schedulesProgress && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-text-dim">
              Loading schedules: {schedulesProgress.completed}/{schedulesProgress.total} teams
            </div>
            <div className="h-1.5 rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-accent-blue transition-all"
                style={{ width: `${(schedulesProgress.completed / schedulesProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {schedulesError && (
          <p className="mt-3 text-sm text-accent-red">{schedulesError}</p>
        )}

        {proGames.length > 0 && (
          <p className="mt-3 text-sm text-accent-green">
            Loaded {proGames.length} games across all affiliate levels
          </p>
        )}
      </div>

      {/* Roster moves — check via Roster tab button */}
      {rosterMoves.length > 0 && (
        <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-4 py-2">
          <p className="text-xs text-accent-orange">
            {rosterMoves.length} roster move{rosterMoves.length !== 1 ? 's' : ''} detected — see the Roster tab for details.
          </p>
        </div>
      )}

      {/* NCAA players section */}
      {ncaaPlayers.length > 0 && (
        <NcaaSection
          ncaaPlayers={ncaaPlayers}
          ncaaGames={ncaaGames}
          ncaaLoading={ncaaLoading}
          ncaaProgress={ncaaProgress}
          ncaaError={ncaaError}
          ncaaFetchedAt={ncaaFetchedAt}
          ncaaFailedSchools={ncaaFailedSchools}
          ncaaDroppedAwayGames={ncaaDroppedAwayGames}
          customNcaaAliases={customNcaaAliases}
          fetchNcaaSchedules={fetchNcaaSchedules}
        />
      )}

      {/* HS players section */}
      {hsPlayers.length > 0 && (
        <HsSection
          hsPlayers={hsPlayers}
          hsGames={hsGames}
          hsLoading={hsLoading}
          hsProgress={hsProgress}
          hsError={hsError}
          hsFetchedAt={hsFetchedAt}
          hsFailedSchools={hsFailedSchools}
          fetchHsSchedules={fetchHsSchedules}
        />
      )}

    </div>
  )
}

function AssignedPlayerRow({
  name,
  assignment,
  teamOptions,
  org,
  position,
  onReassign,
  onRemove,
}: {
  name: string
  assignment: { teamId: number; sportId: number; teamName: string }
  teamOptions: MLBAffiliate[]
  org: string
  position: string
  onReassign: (a: { teamId: number; sportId: number; teamName: string }) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="flex items-center gap-2 rounded-lg bg-accent-green/5 px-3 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <span className="text-text">{name}</span>
        {(position || org) && (
          <span className="ml-1.5 text-[10px] text-text-dim/60">
            {position}{position && org ? ' · ' : ''}{org}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {editing ? (
          <>
            <select
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text focus:border-accent-blue focus:outline-none"
              value={`${assignment.teamId}|${assignment.sportId}|${assignment.teamName}`}
              onChange={(e) => {
                const [teamId, sportId, teamName] = e.target.value.split('|')
                if (teamId && sportId && teamName) {
                  onReassign({ teamId: parseInt(teamId), sportId: parseInt(sportId), teamName })
                  setEditing(false)
                }
              }}
            >
              {teamOptions
                .sort((a, b) => a.sportId - b.sportId)
                .map((t) => (
                  <option key={t.teamId} value={`${t.teamId}|${t.sportId}|${t.teamName}`}>
                    {t.teamName} ({t.sportName})
                  </option>
                ))}
            </select>
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] text-text-dim hover:text-text"
            >
              cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-accent-green hover:text-accent-blue transition-colors"
              title="Click to change team assignment"
            >
              {assignment.teamName}
            </button>
            <button
              onClick={onRemove}
              className="flex h-4 w-4 items-center justify-center rounded text-text-dim/40 hover:bg-accent-red/10 hover:text-accent-red transition-colors"
              title="Remove assignment"
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function NcaaSection({
  ncaaPlayers,
  ncaaGames,
  ncaaLoading,
  ncaaProgress,
  ncaaError,
  ncaaFetchedAt,
  ncaaFailedSchools,
  ncaaDroppedAwayGames,
  customNcaaAliases,
  fetchNcaaSchedules,
}: {
  ncaaPlayers: RosterPlayer[]
  ncaaGames: GameEvent[]
  ncaaLoading: boolean
  ncaaProgress: { completed: number; total: number } | null
  ncaaError: string | null
  ncaaFetchedAt: number | null
  ncaaFailedSchools: string[]
  ncaaDroppedAwayGames: number
  customNcaaAliases: Record<string, string>
  fetchNcaaSchedules: (playerOrgs: Array<{ playerName: string; org: string }>, opts?: { merge?: boolean }) => Promise<void>
}) {
  // Group players by school
  const schoolGroups = useMemo(() => {
    const groups = new Map<string, { canonical: string; players: RosterPlayer[] }>()
    for (const p of ncaaPlayers) {
      const canonical = resolveNcaaName(p.org, customNcaaAliases)
      const key = canonical ?? p.org
      const existing = groups.get(key)
      if (existing) existing.players.push(p)
      else groups.set(key, { canonical: canonical ?? '', players: [p] })
    }
    return groups
  }, [ncaaPlayers, customNcaaAliases])

  // Compute unique schools and tier-based subsets
  const allPlayerOrgs = useMemo(
    () => ncaaPlayers.map((p) => ({ playerName: p.playerName, org: p.org })),
    [ncaaPlayers],
  )

  const t1t2PlayerOrgs = useMemo(
    () => ncaaPlayers.filter((p) => p.tier <= 2).map((p) => ({ playerName: p.playerName, org: p.org })),
    [ncaaPlayers],
  )

  // Count unique schools for time estimates
  const uniqueSchoolCount = schoolGroups.size
  const t1t2Schools = useMemo(() => {
    const schools = new Set<string>()
    for (const p of ncaaPlayers) {
      if (p.tier <= 2) {
        const canonical = resolveNcaaName(p.org, customNcaaAliases)
        if (canonical) schools.add(canonical)
      }
    }
    return schools
  }, [ncaaPlayers, customNcaaAliases])

  const timeEstimateAll = Math.round(uniqueSchoolCount * 3)
  const timeEstimateT1T2 = Math.round(t1t2Schools.size * 3)

  // Time remaining during loading
  const timeRemaining = ncaaProgress
    ? Math.round((ncaaProgress.total - ncaaProgress.completed) * 3)
    : null

  return (
    <div className="rounded-xl border border-accent-green/30 bg-surface p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-accent-green">College Players</h2>
          <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-medium text-accent-green">
            {ncaaPlayers.length} players
          </span>
          {ncaaFetchedAt && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              Date.now() - ncaaFetchedAt > 24 * 60 * 60 * 1000
                ? 'bg-accent-orange/10 text-accent-orange'
                : 'bg-accent-green/10 text-accent-green'
            }`}>
              loaded {formatTimeAgo(ncaaFetchedAt)}
            </span>
          )}
          {isNcaaSeason(new Date().toISOString().slice(0, 10)) && (
            <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-medium text-accent-green">
              Season Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {t1t2PlayerOrgs.length > 0 && t1t2PlayerOrgs.length < allPlayerOrgs.length && (
            <button
              onClick={() => fetchNcaaSchedules(t1t2PlayerOrgs, { merge: true })}
              disabled={ncaaLoading}
              className="rounded-lg bg-accent-green px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
              title={`~${timeEstimateT1T2}s for ${t1t2Schools.size} schools`}
            >
              {ncaaLoading ? 'Loading...' : `Load T1 & T2`}
            </button>
          )}
          <button
            onClick={() => fetchNcaaSchedules(allPlayerOrgs)}
            disabled={ncaaLoading}
            className="rounded-lg bg-accent-green px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
            title={`~${timeEstimateAll}s for ${uniqueSchoolCount} schools`}
          >
            {ncaaLoading ? 'Loading...' : ncaaGames.length > 0 ? 'Refresh All' : `Load All (~${timeEstimateAll}s)`}
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-text-dim">
        Your college players and their home stadiums. Load schedules from D1Baseball to get real game dates — or load a specific school below. Without real data, the trip planner uses estimated home game days.
      </p>

      {ncaaProgress && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-text-dim">
            Loading schedules: {ncaaProgress.completed}/{ncaaProgress.total} schools
            {timeRemaining !== null && timeRemaining > 0 && (
              <span className="ml-1 text-text-dim/70">(~{timeRemaining}s remaining)</span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-accent-green transition-all"
              style={{ width: `${(ncaaProgress.completed / ncaaProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {ncaaError && (
        <p className="mb-3 text-sm text-accent-red">{ncaaError}</p>
      )}

      {ncaaGames.length > 0 && (
        <p className="mb-3 text-sm text-accent-green">
          Loaded {ncaaGames.length} games ({ncaaGames.filter((g) => g.isHome).length} home, {ncaaGames.filter((g) => !g.isHome).length} away)
          {ncaaDroppedAwayGames > 0 && (
            <span className="ml-1 text-accent-orange">
              — {ncaaDroppedAwayGames} away game{ncaaDroppedAwayGames !== 1 ? 's' : ''} skipped (unknown opponent stadium)
            </span>
          )}
        </p>
      )}

      {ncaaFailedSchools.length > 0 && (
        <div className="mb-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2">
          <p className="text-xs text-accent-red">
            Failed to load schedules for: {ncaaFailedSchools.join(', ')}
          </p>
          <p className="text-[11px] text-text-dim">
            These schools' games won't appear in trip planning. Try loading them individually below or check D1Baseball for availability.
          </p>
        </div>
      )}

      {/* School-grouped player list */}
      <div className="space-y-2">
        {[...schoolGroups.entries()].map(([key, { canonical, players }]) => {
          const venue = canonical ? NCAA_VENUES[canonical] : null
          const slug = canonical ? D1_BASEBALL_SLUGS[canonical] : null
          const schoolHasSchedule = players.some((p) =>
            ncaaGames.some((g) => g.playerNames.includes(p.playerName)),
          )
          const schoolPlayerOrgs = players.map((p) => ({ playerName: p.playerName, org: p.org }))

          return (
            <div key={key} className="rounded-lg border border-border/30 bg-gray-950/30 px-3 py-2">
              {/* School header */}
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{canonical || key}</span>
                  {venue && (
                    <span className="text-[10px] text-text-dim">{venue.venueName}</span>
                  )}
                  {schoolHasSchedule && (
                    <span className="rounded bg-accent-blue/15 px-1 py-0.5 text-[10px] font-medium text-accent-blue">loaded</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {!schoolHasSchedule && !ncaaLoading && canonical && (
                    <button
                      onClick={() => fetchNcaaSchedules(schoolPlayerOrgs, { merge: true })}
                      className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green hover:bg-accent-green/25 transition-colors"
                    >
                      Load
                    </button>
                  )}
                  {slug && (
                    <a
                      href={`https://d1baseball.com/team/${slug}/schedule/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-text transition-colors"
                      title="View on D1Baseball"
                    >
                      D1B
                    </a>
                  )}
                </div>
              </div>
              {/* Players in this school */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {players.map((player) => (
                  <span key={player.playerName} className="text-xs text-text-dim">
                    {player.playerName}
                    <span className="ml-1 text-[10px] text-text-dim/50">T{player.tier}</span>
                  </span>
                ))}
              </div>
              {!venue && canonical === '' && (
                <span className="text-[10px] text-accent-orange">venue not mapped</span>
              )}
            </div>
          )
        })}
      </div>

      {ncaaGames.length === 0 && (
        <div className="mt-3 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
          <p className="text-[11px] text-accent-orange">
            Without real schedules loaded, college games are estimated based on typical home game days.
            Load real schedules above for actual dates including away games.
          </p>
        </div>
      )}
    </div>
  )
}

function HsSection({
  hsPlayers,
  hsGames,
  hsLoading,
  hsProgress,
  hsError,
  hsFetchedAt,
  hsFailedSchools,
  fetchHsSchedules,
}: {
  hsPlayers: RosterPlayer[]
  hsGames: GameEvent[]
  hsLoading: boolean
  hsProgress: { completed: number; total: number } | null
  hsError: string | null
  hsFetchedAt: number | null
  hsFailedSchools: string[]
  fetchHsSchedules: (playerOrgs: Array<{ playerName: string; org: string; state: string }>, opts?: { merge?: boolean }) => Promise<void>
}) {
  // Group players by school (org|state)
  const schoolGroups = useMemo(() => {
    const groups = new Map<string, { org: string; state: string; players: RosterPlayer[] }>()
    for (const p of hsPlayers) {
      const key = `${p.org}|${p.state ?? ''}`
      const existing = groups.get(key)
      if (existing) existing.players.push(p)
      else groups.set(key, { org: p.org, state: p.state ?? '', players: [p] })
    }
    return groups
  }, [hsPlayers])

  // Build player org lists for fetch calls
  const allPlayerOrgs = useMemo(
    () => hsPlayers.map((p) => ({ playerName: p.playerName, org: p.org, state: p.state ?? '' })),
    [hsPlayers],
  )

  const t1t2PlayerOrgs = useMemo(
    () => hsPlayers.filter((p) => p.tier <= 2).map((p) => ({ playerName: p.playerName, org: p.org, state: p.state ?? '' })),
    [hsPlayers],
  )

  // Count schools with slugs for time estimates
  const schoolsWithSlugs = useMemo(() => {
    let count = 0
    for (const [, { org, state }] of schoolGroups) {
      if (resolveMaxPrepsSlug(org, state)) count++
    }
    return count
  }, [schoolGroups])

  const t1t2Schools = useMemo(() => {
    const schools = new Set<string>()
    for (const p of hsPlayers) {
      if (p.tier <= 2 && resolveMaxPrepsSlug(p.org, p.state ?? '')) {
        schools.add(`${p.org}|${p.state ?? ''}`)
      }
    }
    return schools
  }, [hsPlayers])

  const timeEstimateAll = Math.round(schoolsWithSlugs * 3)
  const timeEstimateT1T2 = Math.round(t1t2Schools.size * 3)

  const timeRemaining = hsProgress
    ? Math.round((hsProgress.total - hsProgress.completed) * 3)
    : null

  return (
    <div className="rounded-xl border border-accent-orange/30 bg-surface p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-accent-orange">High School Players</h2>
          <span className="rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
            {hsPlayers.length} players
          </span>
          {hsFetchedAt && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              Date.now() - hsFetchedAt > 24 * 60 * 60 * 1000
                ? 'bg-accent-orange/10 text-accent-orange'
                : 'bg-accent-green/10 text-accent-green'
            }`}>
              loaded {formatTimeAgo(hsFetchedAt)}
            </span>
          )}
          {isHsSeason(new Date().toISOString().slice(0, 10)) && (
            <span className="rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
              Season Active (Feb 14 – May 15)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {t1t2PlayerOrgs.length > 0 && t1t2PlayerOrgs.length < allPlayerOrgs.length && t1t2Schools.size > 0 && (
            <button
              onClick={() => fetchHsSchedules(t1t2PlayerOrgs, { merge: true })}
              disabled={hsLoading}
              className="rounded-lg bg-accent-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
              title={`~${timeEstimateT1T2}s for ${t1t2Schools.size} schools`}
            >
              {hsLoading ? 'Loading...' : `Load T1 & T2`}
            </button>
          )}
          {schoolsWithSlugs > 0 && (
            <button
              onClick={() => fetchHsSchedules(allPlayerOrgs)}
              disabled={hsLoading}
              className="rounded-lg bg-accent-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
              title={`~${timeEstimateAll}s for ${schoolsWithSlugs} schools`}
            >
              {hsLoading ? 'Loading...' : hsGames.length > 0 ? 'Refresh All' : `Load All (~${timeEstimateAll}s)`}
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs text-text-dim">
        Your high school players and their schools. Load schedules from MaxPreps to get real game dates — or load a specific school below.
        Without real data, the trip planner uses estimated game days until real schedules are loaded.
      </p>

      {hsProgress && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-text-dim">
            Loading schedules: {hsProgress.completed}/{hsProgress.total} schools
            {timeRemaining !== null && timeRemaining > 0 && (
              <span className="ml-1 text-text-dim/70">(~{timeRemaining}s remaining)</span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-accent-orange transition-all"
              style={{ width: `${(hsProgress.completed / hsProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {hsError && (
        <p className="mb-3 text-sm text-accent-red">{hsError}</p>
      )}

      {hsGames.length > 0 && (
        <p className="mb-3 text-sm text-accent-green">
          Loaded {hsGames.length} home games from MaxPreps
        </p>
      )}

      {hsFailedSchools.length > 0 && (
        <div className="mb-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2">
          <p className="text-xs text-accent-red">
            Failed to load schedules for: {hsFailedSchools.join(', ')}
          </p>
        </div>
      )}

      {/* School-grouped player list */}
      <div className="space-y-2">
        {[...schoolGroups.entries()].map(([key, { org, state, players }]) => {
          const slug = resolveMaxPrepsSlug(org, state)
          const schoolHasSchedule = players.some((p) =>
            hsGames.some((g) => g.playerNames.includes(p.playerName)),
          )
          const schoolPlayerOrgs = players.map((p) => ({ playerName: p.playerName, org: p.org, state: p.state ?? '' }))

          return (
            <div key={key} className="rounded-lg border border-border/30 bg-gray-950/30 px-3 py-2">
              {/* School header */}
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{org}</span>
                  {state && (
                    <span className="text-[10px] text-text-dim">{state}</span>
                  )}
                  {schoolHasSchedule && (
                    <span className="rounded bg-accent-blue/15 px-1 py-0.5 text-[10px] font-medium text-accent-blue">loaded</span>
                  )}
                  {!slug && (
                    <span className="rounded bg-gray-700 px-1 py-0.5 text-[10px] font-medium text-text-dim">no MaxPreps slug</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {!schoolHasSchedule && !hsLoading && slug && (
                    <button
                      onClick={() => fetchHsSchedules(schoolPlayerOrgs, { merge: true })}
                      className="rounded bg-accent-orange/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-orange hover:bg-accent-orange/25 transition-colors"
                    >
                      Load
                    </button>
                  )}
                  {slug && (
                    <a
                      href={`https://www.maxpreps.com/${slug}/baseball/schedule/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-text transition-colors"
                      title="View on MaxPreps"
                    >
                      MP
                    </a>
                  )}
                </div>
              </div>
              {/* Players in this school */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {players.map((player) => (
                  <span key={player.playerName} className="text-xs text-text-dim">
                    {player.playerName}
                    <span className="ml-1 text-[10px] text-text-dim/50">T{player.tier}</span>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Instructions for missing slugs */}
      {[...schoolGroups.values()].some(({ org, state }) => !resolveMaxPrepsSlug(org, state)) && (
        <div className="mt-3 rounded-lg border border-border/30 bg-gray-950/30 px-3 py-2">
          <p className="text-[11px] text-text-dim">
            <span className="font-medium text-accent-orange">Missing slugs?</span> To add a MaxPreps slug:
            go to maxpreps.com, find the school's baseball schedule page, and copy the URL slug
            (e.g., <code className="text-[10px]">tx/carrollton/hebron-hawks</code>).
            Add it to <code className="text-[10px]">src/data/maxprepsSlugs.ts</code>.
          </p>
        </div>
      )}

      {hsGames.length === 0 && (
        <div className="mt-3 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
          <p className="text-[11px] text-accent-orange">
            Without real schedules loaded, HS games use estimated game days until real schedules are loaded.
            Add MaxPreps slugs and load real schedules for actual dates.
          </p>
        </div>
      )}
    </div>
  )
}

