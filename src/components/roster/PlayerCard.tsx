import { useState } from 'react'
import type { RosterPlayer } from '../../types/roster'
import { useRosterStore } from '../../store/rosterStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'

const TIER_COLORS: Record<number, string> = {
  1: 'bg-accent-blue/20 text-accent-blue',
  2: 'bg-accent-green/20 text-accent-green',
  3: 'bg-accent-orange/20 text-accent-orange',
  4: 'bg-gray-500/20 text-gray-400',
}

export default function PlayerCard({ player, showHeartbeat }: { player: RosterPlayer; showHeartbeat?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const setVisitOverride = useRosterStore((s) => s.setVisitOverride)
  const visitOverrides = useRosterStore((s) => s.visitOverrides)
  const hasOverride = !!visitOverrides[player.playerName]

  const hbData = useHeartbeatStore((s) => s.getPlayerData)(player.playerName)
  const hbUrgency = useHeartbeatStore((s) => s.getPlayerUrgency)(player.playerName)

  const colSpan = showHeartbeat ? 8 : 7

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
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-text">{player.playerName}</span>
            {hbUrgency?.inPersonOverdue && (
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-red/20 text-[9px] text-accent-red"
                title={`In-person visit overdue — Tier ${player.tier} should be visited every ${player.tier === 1 ? '60' : player.tier === 2 ? '120' : '180'} days`}
              >
                !
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-text-dim">{player.org}</td>
        <td className="px-4 py-2.5 text-text-dim">{player.position}</td>
        <td className="px-4 py-2.5">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${TIER_COLORS[player.tier] ?? TIER_COLORS[4]}`}>
            {player.tier}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className={player.visitsRemaining > 0 ? 'text-accent-orange' : 'text-accent-green'}>
            {player.visitsRemaining}
          </span>
          <span className="text-text-dim">/{player.visitTarget2026}</span>
        </td>
        <td className="px-4 py-2.5 text-text-dim">
          {player.visitsCompleted}/{player.visitTarget2026}
          {hasOverride && <span className="ml-1 text-accent-blue" title="Manually overridden">*</span>}
        </td>
        {showHeartbeat && (
          <td className="px-4 py-2.5">
            {hbData ? (
              <LoveScoreBadge score={hbData.loveScore} status={hbData.status} />
            ) : (
              <span className="text-text-dim/40">-</span>
            )}
          </td>
        )}
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

            {/* Heartbeat data */}
            {hbData && (
              <div className="mt-4 border-t border-border/30 pt-3">
                <h4 className="mb-2 text-xs font-semibold text-text-dim">Client Engagement (via Heartbeat)</h4>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                  <div title="Overall relationship health (0–100). Combines how often you call, text, and visit, plus recency. 60+ = healthy, 30–59 = needs attention, under 30 = at risk.">
                    <span className="text-xs text-text-dim">Love Score: </span>
                    <span className={`font-semibold ${
                      hbData.loveScore >= 60 ? 'text-accent-green' :
                      hbData.loveScore >= 30 ? 'text-accent-orange' :
                      'text-accent-red'
                    }`}>{hbData.loveScore}</span>
                    <span className="text-xs text-text-dim">/100</span>
                  </div>
                  <div title="Red = significantly overdue for contact. Yellow = getting close to overdue. Green = contact is current.">
                    <span className="text-xs text-text-dim">Status: </span>
                    <StatusDot status={hbData.status} />
                  </div>
                  {hbData.daysSinceInPerson !== null && (
                    <div title={`How long since the last in-person visit. Tier 1 = every 60 days, Tier 2 = every 120, Tier 3 = every 180.${hbUrgency?.inPersonOverdue ? ' This player is past their threshold.' : ''}`}>
                      <span className="text-xs text-text-dim">Last In-Person: </span>
                      <span className={`text-text ${hbUrgency?.inPersonOverdue ? 'font-semibold text-accent-red' : ''}`}>
                        {hbData.daysSinceInPerson}d ago
                        {hbUrgency?.inPersonOverdue && ' (overdue)'}
                      </span>
                    </div>
                  )}
                  {hbData.daysSinceLeadContact !== null && (
                    <div>
                      <span className="text-xs text-text-dim">Last Lead Contact: </span>
                      <span className="text-text">{hbData.daysSinceLeadContact}d ago</span>
                    </div>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-x-8 text-sm">
                  <div>
                    <span className="text-xs text-text-dim">Calls: </span>
                    <span className="text-text">{hbData.interactionCounts.calls}</span>
                  </div>
                  <div>
                    <span className="text-xs text-text-dim">Texts: </span>
                    <span className="text-text">{hbData.interactionCounts.texts}</span>
                  </div>
                  <div>
                    <span className="text-xs text-text-dim">In-Person: </span>
                    <span className="text-text">{hbData.interactionCounts.inPerson}</span>
                  </div>
                </div>
                {hbUrgency && hbUrgency.visitUrgencyScore > 0 && (
                  <p className="mt-2 text-[11px] text-text-dim" title="How urgently this player needs a visit (0–100). High urgency players get ranked higher in trip suggestions.">
                    Visit urgency score: <span className="font-semibold text-text">{hbUrgency.visitUrgencyScore}</span>
                    {hbUrgency.visitUrgencyScore >= 50 && (
                      <span className="ml-1 text-accent-red"> — high urgency, prioritize this visit</span>
                    )}
                    {hbUrgency.visitUrgencyScore >= 25 && hbUrgency.visitUrgencyScore < 50 && (
                      <span className="ml-1 text-accent-orange"> — moderate urgency</span>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Manual visit override */}
            <div className="mt-4 border-t border-border/30 pt-3">
              <VisitEditor player={player} onSave={setVisitOverride} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function LoveScoreBadge({ score, status }: { score: number; status: string }) {
  const color =
    status === 'red' ? 'bg-accent-red/15 text-accent-red border-accent-red/30' :
    status === 'yellow' ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/30' :
    score >= 60 ? 'bg-accent-green/15 text-accent-green border-accent-green/30' :
    score >= 30 ? 'bg-accent-orange/15 text-accent-orange border-accent-orange/30' :
    'bg-accent-red/15 text-accent-red border-accent-red/30'

  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${color}`}>
      {score}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'red' ? 'bg-accent-red' :
    status === 'yellow' ? 'bg-accent-orange' :
    'bg-accent-green'

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="text-text capitalize">{status}</span>
    </span>
  )
}

function VisitEditor({
  player,
  onSave,
}: {
  player: RosterPlayer
  onSave: (name: string, visits: number, lastVisit: string | null) => void
}) {
  const [visits, setVisits] = useState(player.visitsCompleted)
  const [lastVisit, setLastVisit] = useState(player.lastVisitDate ?? '')
  const [dirty, setDirty] = useState(false)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs text-text-dim">Visits Completed</label>
        <input
          type="number"
          min={0}
          max={player.visitTarget2026}
          value={visits}
          onChange={(e) => { setVisits(parseInt(e.target.value) || 0); setDirty(true) }}
          className="w-20 rounded-lg border border-border bg-gray-950 px-2 py-1 text-sm text-text"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-text-dim">Last Visit Date</label>
        <input
          type="date"
          value={lastVisit}
          onChange={(e) => { setLastVisit(e.target.value); setDirty(true) }}
          className="rounded-lg border border-border bg-gray-950 px-2 py-1 text-sm text-text"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {dirty && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSave(player.playerName, visits, lastVisit || null)
            setDirty(false)
          }}
          className="rounded-lg bg-accent-blue px-3 py-1 text-xs font-medium text-white hover:bg-accent-blue/80"
        >
          Save
        </button>
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
