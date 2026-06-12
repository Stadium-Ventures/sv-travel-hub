import { useMemo } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useTripStore } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'
import { formatDate } from '../../lib/formatters'

/**
 * "Who haven't I seen?" panel — Kent's proactive prompt. Lists overdue
 * T1/T2 players (Heartbeat says overdue) with their next upcoming game
 * inline and a "Plan trip" CTA. Closes the loop from "I see who's
 * slipping" to "do something about it" without needing to scroll the
 * full roster.
 *
 * Lives at the top of Roster. Hidden when nobody is overdue.
 */
export default function CoveragePanel() {
  const players = useRosterStore((s) => s.players)
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)

  const rows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const allGames = [...proGames, ...ncaaGames, ...hsGames].filter((g) => g.date >= today)
    // Map name → next upcoming game (sorted by date ascending)
    const nextGameByName = new Map<string, typeof allGames[number]>()
    for (const g of allGames) {
      for (const name of g.playerNames) {
        const existing = nextGameByName.get(name)
        if (!existing || g.date < existing.date) nextGameByName.set(name, g)
      }
    }

    // Heartbeat overdue lookup, keyed by lower-cased name.
    const heartbeatByKey = new Map<string, { days: number | null; threshold: number | null }>()
    for (const p of heartbeatPlayers) {
      heartbeatByKey.set(p.name.trim().toLowerCase(), {
        days: p.daysSinceInPerson,
        threshold: p.inPersonThresholdDays,
      })
    }

    return players
      .filter((p) => p.tier <= 2 && p.tier !== 4) // T1 and T2 only — meaningful targets
      .map((p) => {
        const hb = heartbeatByKey.get(p.playerName.trim().toLowerCase())
        const overdue = hb && hb.days != null && hb.threshold != null && hb.days > hb.threshold
        return {
          player: p,
          daysSince: hb?.days ?? null,
          threshold: hb?.threshold ?? null,
          overdue: !!overdue,
          nextGame: nextGameByName.get(p.playerName) ?? null,
        }
      })
      .filter((r) => r.overdue)
      .sort((a, b) => {
        // Most overdue first; tier 1 ahead of tier 2 on ties.
        if (a.player.tier !== b.player.tier) return a.player.tier - b.player.tier
        return (b.daysSince ?? 0) - (a.daysSince ?? 0)
      })
  }, [players, heartbeatPlayers, proGames, ncaaGames, hsGames])

  if (rows.length === 0) return null

  function planTripFor(playerName: string, gameDate: string) {
    const store = useTripStore.getState()
    store.setPriorityPlayers([playerName])
    const d = new Date(gameDate + 'T12:00:00Z')
    const start = new Date(d); start.setUTCDate(start.getUTCDate() - 2)
    const end = new Date(d); end.setUTCDate(end.getUTCDate() + 5)
    const today = new Date().toISOString().slice(0, 10)
    const startIso = start.toISOString().slice(0, 10)
    store.setDateRange(startIso < today ? today : startIso, end.toISOString().slice(0, 10))
    dispatchMapEvent('app:switch-tab', { tab: 'trips' })
    setTimeout(() => { store.generateTrips().catch((e) => console.warn('[coverage] auto-generate failed:', e)) }, 100)
  }

  return (
    <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-accent-red">
          Who haven't you seen? <span className="text-accent-red/70 font-normal">· {rows.length} overdue T1/T2</span>
        </h3>
        <span className="text-[10px] text-text-dim/60 italic">
          Heartbeat-flagged overdue. Click "Plan trip" to build around their next game.
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.slice(0, 8).map((r) => {
          const tierColor = r.player.tier === 1 ? 'text-accent-red' : 'text-accent-orange'
          const tierDot = r.player.tier === 1 ? 'bg-accent-red' : 'bg-accent-orange'
          return (
            <div key={r.player.playerName} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-950/40 px-3 py-2 text-sm">
              <span className={`inline-block h-2 w-2 rounded-full ${tierDot}`} />
              <span className={`font-medium ${tierColor}`}>T{r.player.tier}</span>
              <span className="text-text font-medium">{r.player.playerName}</span>
              <span className="text-[11px] text-text-dim">{r.player.org}</span>
              <span className="text-[11px] text-text-dim/70">
                {r.daysSince}d since visit · target {r.threshold}d
              </span>
              <span className="ml-auto flex items-center gap-2">
                {r.nextGame ? (
                  <>
                    <span className="text-[11px] text-text-dim">
                      Next: {r.nextGame.isHome ? '🏠' : '✈️'} {formatDate(r.nextGame.date)} · {r.nextGame.venue.name}
                    </span>
                    <button
                      onClick={() => planTripFor(r.player.playerName, r.nextGame!.date)}
                      className="rounded-md bg-accent-blue/15 px-2 py-0.5 text-[10px] font-semibold text-accent-blue hover:bg-accent-blue/25"
                      title={`Build a trip around ${r.player.playerName}'s game on ${r.nextGame.date}`}
                    >
                      Plan trip →
                    </button>
                  </>
                ) : (
                  <span className="text-[11px] text-text-dim/50 italic">No upcoming game in schedule</span>
                )}
              </span>
            </div>
          )
        })}
        {rows.length > 8 && (
          <p className="text-[10px] text-text-dim/50 italic">+{rows.length - 8} more — use the Overdue bucket above to see all.</p>
        )}
      </div>
    </div>
  )
}
