import { useMemo, useState } from 'react'
import type { RosterPlayer } from '../../types/roster'
import type { PlayerTeamAssignment } from '../../store/scheduleStore'
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

  // Filter affiliate options to this player's org
  const orgAffiliates = useMemo(() => {
    if (!affiliateOptions) return []
    const orgId = resolveMLBTeamId(player.org)
    if (!orgId) return affiliateOptions // show all if can't resolve
    return affiliateOptions
      .filter((a) => a.parentOrgId === orgId)
      .sort((a, b) => a.sportId - b.sportId)
  }, [affiliateOptions, player.org])

  let colSpan = 5
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
                {affiliate ? affiliate.teamName : <span className="text-text-dim/40">— assign —</span>}
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
        <td className="px-4 py-2.5 text-text-dim">{player.leadAgent}</td>
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

          </td>
        </tr>
      )}
    </>
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
