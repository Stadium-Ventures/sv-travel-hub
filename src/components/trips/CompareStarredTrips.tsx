import { useMemo } from 'react'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { formatDate } from '../../lib/formatters'

/**
 * Side-by-side comparison of all currently-starred trips. Renders only
 * when 2+ trips are starred so it doesn't clutter the planner when only
 * one favorite exists. Shows the differentiating dimensions: dates,
 * unique players, drive time, score, tier breakdown.
 */
export default function CompareStarredTrips() {
  const tripPlan = useTripStore((s) => s.tripPlan)
  const starredTrips = useTripStore((s) => s.starredTrips)
  const toggleTripStar = useTripStore((s) => s.toggleTripStar)

  const starred = useMemo(() => {
    if (!tripPlan) return []
    return tripPlan.trips
      .map((trip, idx) => ({ trip, idx, key: getTripKey(trip) }))
      .filter((r) => starredTrips[r.key])
  }, [tripPlan, starredTrips])

  if (starred.length < 2) return null

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-yellow-300">
          ★ Compare starred trips <span className="font-normal text-yellow-300/70">· {starred.length} trips</span>
        </h3>
        <span className="text-[10px] text-text-dim/60 italic">
          Side-by-side so you can pick. Click ☆ on any column to unstar.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-text-dim/60">
              <th className="px-2 py-1 font-medium">Dimension</th>
              {starred.map((s) => (
                <th key={s.key} className="px-2 py-1 font-medium text-text">
                  <div className="flex items-center gap-1.5">
                    <span>Trip #{s.idx + 1}</span>
                    <button
                      onClick={() => toggleTripStar(s.key)}
                      className="text-yellow-300 hover:text-yellow-200"
                      title="Unstar"
                    >★</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            <Row label="Dates">
              {starred.map((s) => {
                const days = [...s.trip.suggestedDays].sort()
                return <span key={s.key}>{formatDate(days[0]!)}–{formatDate(days[days.length - 1]!)}</span>
              })}
            </Row>
            <Row label="Length">
              {starred.map((s) => <span key={s.key}>{s.trip.suggestedDays.length} day{s.trip.suggestedDays.length === 1 ? '' : 's'}</span>)}
            </Row>
            <Row label="Anchor venue">
              {starred.map((s) => <span key={s.key} className="text-text-dim">{s.trip.anchorGame.venue.name}</span>)}
            </Row>
            <Row label="Unique players">
              {starred.map((s) => {
                const all = new Set([
                  ...s.trip.anchorGame.playerNames,
                  ...s.trip.nearbyGames.flatMap((g) => g.playerNames),
                ])
                return <span key={s.key} className="font-medium text-text">{all.size}</span>
              })}
            </Row>
            <Row label="Score">
              {starred.map((s) => <span key={s.key} className="font-medium text-text">{Math.round(s.trip.visitValue)}</span>)}
            </Row>
            <Row label="Drive from home">
              {starred.map((s) => {
                const m = s.trip.driveFromHomeMinutes
                const h = Math.floor(m / 60); const mm = Math.round(m % 60)
                return <span key={s.key} className="text-text-dim">{h > 0 ? `${h}h${mm > 0 ? ` ${mm}m` : ''}` : `${mm}m`}</span>
              })}
            </Row>
            <Row label="Total driving">
              {starred.map((s) => {
                const m = s.trip.totalDriveMinutes
                const h = Math.floor(m / 60); const mm = Math.round(m % 60)
                return <span key={s.key} className="text-text-dim">{h > 0 ? `${h}h${mm > 0 ? ` ${mm}m` : ''}` : `${mm}m`}</span>
              })}
            </Row>
            <Row label="Players">
              {starred.map((s) => {
                const all = Array.from(new Set([
                  ...s.trip.anchorGame.playerNames,
                  ...s.trip.nearbyGames.flatMap((g) => g.playerNames),
                ]))
                return (
                  <div key={s.key} className="flex flex-wrap gap-1 max-w-[220px]">
                    {all.slice(0, 6).map((n) => (
                      <span key={n} className="text-[10px] text-text-dim/80">{n}</span>
                    ))}
                    {all.length > 6 && <span className="text-[10px] text-text-dim/50">+{all.length - 6}</span>}
                  </div>
                )
              })}
            </Row>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode[] }) {
  return (
    <tr>
      <td className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-text-dim/60 align-top">{label}</td>
      {children.map((c, i) => (
        <td key={i} className="px-2 py-1.5 align-top">{c}</td>
      ))}
    </tr>
  )
}
