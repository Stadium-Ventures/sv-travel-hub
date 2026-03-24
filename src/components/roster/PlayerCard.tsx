import { useMemo, useState } from 'react'
import type { RosterPlayer } from '../../types/roster'
import type { PlayerTeamAssignment } from '../../store/scheduleStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { resolveMLBTeamId } from '../../data/aliases'

const TIER_COLORS: Record<number, string> = {
  1: 'bg-accent-blue/20 text-accent-blue',
  2: 'bg-accent-green/20 text-accent-green',
  3: 'bg-accent-orange/20 text-accent-orange',
  4: 'bg-gray-500/20 text-gray-400',
}

const SPORT_LABELS: Record<number, string> = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'A' }

interface AffiliateOption {
  teamId: number
  teamName: string
  sportId: number
  parentOrgId: number
}

interface PlayerCardProps {
  player: RosterPlayer
  showAffiliate?: boolean
  affiliate?: PlayerTeamAssignment | null
  affiliateOptions?: AffiliateOption[]
  onAssignAffiliate?: (playerName: string, assignment: PlayerTeamAssignment) => void
}

export default function PlayerCard({ player, showAffiliate, affiliate, affiliateOptions, onAssignAffiliate }: PlayerCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingAffiliate, setEditingAffiliate] = useState(false)
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
  const heartbeatData = useMemo(() => {
    const normalized = player.playerName.trim().toLowerCase()
    return heartbeatPlayers.find((p) => p.name.trim().toLowerCase() === normalized)
  }, [heartbeatPlayers, player.playerName])
  const loveScore = heartbeatData?.loveScore ?? null
  const daysSinceVisit = heartbeatData?.daysSinceInPerson ?? null

  // Filter affiliate options to this player's org
  const orgAffiliates = useMemo(() => {
    if (!affiliateOptions) return []
    const orgId = resolveMLBTeamId(player.org)
    if (!orgId) return affiliateOptions // show all if can't resolve
    return affiliateOptions
      .filter((a) => a.parentOrgId === orgId)
      .sort((a, b) => a.sportId - b.sportId)
  }, [affiliateOptions, player.org])

  let colSpan = 6
  if (showAffiliate) colSpan++

  return (
    <>
      <tr
        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-hover"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } }}
      >
        <td className="px-4 py-2.5">
          <span className="font-medium text-text">{player.playerName}</span>
        </td>
        <td className="px-4 py-2.5 text-text-dim">{player.org}</td>
        {showAffiliate && (
          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
            {editingAffiliate ? (
              <select
                autoFocus
                className="w-full rounded border border-accent-blue bg-gray-950 px-1.5 py-1 text-xs text-text focus:outline-none"
                value={affiliate ? `${affiliate.teamId}` : ''}
                onChange={(e) => {
                  const opt = orgAffiliates.find((a) => a.teamId === Number(e.target.value))
                  if (opt && onAssignAffiliate) {
                    onAssignAffiliate(player.playerName, { teamId: opt.teamId, sportId: opt.sportId, teamName: opt.teamName })
                  }
                  setEditingAffiliate(false)
                }}
                onBlur={() => setEditingAffiliate(false)}
              >
                <option value="">— Select —</option>
                {orgAffiliates.map((a) => (
                  <option key={a.teamId} value={a.teamId}>
                    {a.teamName} ({SPORT_LABELS[a.sportId] ?? `L${a.sportId}`})
                  </option>
                ))}
              </select>
            ) : (
              <button
                className="text-left text-text-dim hover:text-accent-blue hover:underline transition-colors"
                onClick={() => setEditingAffiliate(true)}
                title="Click to change affiliate"
              >
                {affiliate ? (
                  <>
                    {affiliate.teamName}
                    {affiliate.source === 'estimated' && (
                      <span className="ml-1 text-[9px] text-accent-orange" title="Estimated from last year + promotion">~est</span>
                    )}
                  </>
                ) : <span className="text-text-dim/40">— assign —</span>}
              </button>
            )}
          </td>
        )}
        <td className="px-4 py-2.5 text-text-dim">{player.position}</td>
        <td className="px-4 py-2.5">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${TIER_COLORS[player.tier] ?? TIER_COLORS[4]}`}>
            {player.tier}
          </span>
        </td>
        <td className="px-4 py-2.5">
          {daysSinceVisit !== null ? (
            <span className={`text-xs ${daysSinceVisit > 90 ? 'text-accent-red' : daysSinceVisit > 45 ? 'text-accent-orange' : 'text-accent-green'}`}>
              {daysSinceVisit}d
            </span>
          ) : (
            <span className="text-xs text-text-dim/40">—</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          {loveScore !== null ? (
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
              loveScore >= 60 ? 'bg-accent-green/20 text-accent-green' :
              loveScore >= 30 ? 'bg-accent-orange/20 text-accent-orange' :
              'bg-accent-red/20 text-accent-red'
            }`}>
              {loveScore}
            </span>
          ) : (
            <span className="text-xs text-text-dim/40">—</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border/50 bg-surface">
          <td colSpan={colSpan} className="px-4 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <Detail label="State" value={player.state} />
              <Detail label="Draft Class" value={player.draftClass} />
              <Detail label="DOB" value={player.dob} />
              <Detail label="Age" value={player.age?.toString() ?? '-'} />
              <Detail label="Phone" value={player.phone} />
              <Detail label="Email" value={player.email} />
              <Detail label="Father" value={player.father} />
              <Detail label="Mother" value={player.mother} />
            </div>

            <ScheduleStatus playerName={player.playerName} level={player.level} affiliate={affiliate} />
          </td>
        </tr>
      )}
    </>
  )
}

function ScheduleStatus({ playerName, level, affiliate }: {
  playerName: string
  level: string
  affiliate?: PlayerTeamAssignment | null
}) {
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)

  const games = useMemo(() => {
    const allGames = [...proGames, ...ncaaGames, ...hsGames]
    return allGames.filter((g) => g.playerNames.includes(playerName))
  }, [proGames, ncaaGames, hsGames, playerName])

  const homeGames = games.filter((g) => g.isHome)
  const awayGames = games.filter((g) => !g.isHome)
  const highConfidence = games.filter((g) => g.confidence === 'high')
  const estimated = games.filter((g) => g.confidence !== 'high')

  const dateRange = games.length > 0
    ? `${games[0]!.date} to ${games[games.length - 1]!.date}`
    : null

  // Source breakdown
  const sources = new Set(games.map((g) => g.source))

  return (
    <div className="mt-3 rounded-lg border border-border/30 bg-gray-950/30 px-3 py-2">
      <p className="text-xs font-medium text-text-dim mb-1.5">Schedule Data</p>
      {level === 'Pro' && affiliate && (
        <p className="text-[11px] text-text-dim mb-1">
          Assigned: <span className="text-text font-medium">{affiliate.teamName}</span>
          <span className="text-text-dim/50 ml-1">(teamId: {affiliate.teamId}, sportId: {affiliate.sportId})</span>
        </p>
      )}
      {level === 'Pro' && !affiliate && (
        <p className="text-[11px] text-accent-red mb-1">Not assigned to any team — click Verify Assignments</p>
      )}
      {games.length === 0 ? (
        <p className="text-[11px] text-accent-red">No games loaded for this player</p>
      ) : (
        <div className="space-y-0.5 text-[11px]">
          <p className="text-accent-green">
            {games.length} games loaded ({homeGames.length} home, {awayGames.length} away)
          </p>
          {dateRange && <p className="text-text-dim">Range: {dateRange}</p>}
          <p className="text-text-dim">
            Source: {sources.has('mlb-api') && <span className="text-accent-green">MLB API</span>}
            {sources.has('ncaa-lookup') && <span className="text-accent-green">D1Baseball</span>}
            {sources.has('hs-lookup') && <span className="text-accent-green">MaxPreps</span>}
            {highConfidence.length > 0 && <span className="text-accent-green ml-1">({highConfidence.length} verified)</span>}
            {estimated.length > 0 && <span className="text-accent-orange ml-1">({estimated.length} estimated)</span>}
          </p>
          {games.length > 0 && games[0]!.sourceUrl && (
            <a href={games[0]!.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-accent-blue hover:underline">Verify schedule ↗</a>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value || value === '-') return null
  return (
    <div>
      <span className="text-xs text-text-dim">{label}: </span>
      <span className="text-text">{value}</span>
    </div>
  )
}
