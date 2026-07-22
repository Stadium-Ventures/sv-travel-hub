import type { TierMarker } from './hooks/useTierMarkers'
import { TIER_COLORS } from './hooks/useTierMarkers'

/** Heartbeat days-since-visit + planned-visit info, keyed by normalized player name. */
export interface PopupEnrichment {
  daysByPlayer: Map<string, number | null>
  plannedByPlayer: Map<string, { date: string; agent: string | null }>
}

function heartbeatBadgeColor(days: number | null): string {
  if (days == null) return '#6b7280'
  if (days > 90) return '#ef4444'
  if (days > 45) return '#f97316'
  return '#22c55e'
}

/**
 * Build popup HTML string for a venue marker.
 * Leaflet requires raw HTML strings for bindPopup.
 */
export function buildVenuePopupHtml(marker: TierMarker, enrich?: PopupEnrichment): string {
  const sorted = [...marker.players].sort((a, b) => a.tier - b.tier)

  const formatDate = (d: string) => {
    const date = new Date(d + 'T12:00:00Z')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
  }

  let html = `<div style="font-family:system-ui,sans-serif;min-width:180px;max-width:320px">`

  // Venue name
  html += `<div style="font-weight:700;font-size:13px;color:#f1f5f9">${marker.venueName}</div>`

  // WHEN, right under the name — the question a scout asks first
  // (Tom 2026-07-22: dates were buried at the bottom)
  if (marker.gameDates.length > 0) {
    const first = formatDate(marker.gameDates[0]!)
    const last = formatDate(marker.gameDates[marker.gameDates.length - 1]!)
    const range = marker.gameDates.length === 1 ? first : `${first} &ndash; ${last}`
    html += `<div style="font-size:11px;color:#94a3b8;margin-bottom:6px">${marker.gameDates.length} game${marker.gameDates.length === 1 ? '' : 's'} &middot; ${range}</div>`
  } else {
    html += `<div style="margin-bottom:6px"></div>`
  }

  // Players sorted by tier
  for (const p of sorted) {
    const color = TIER_COLORS[p.tier] ?? TIER_COLORS[4]!
    const key = p.name.trim().toLowerCase()
    const days = enrich?.daysByPlayer.get(key) ?? undefined
    const planned = enrich?.plannedByPlayer.get(key)
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px">`
    html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>`
    html += `<span data-action="schedule" data-player="${p.name}" style="flex:1;min-width:0;cursor:pointer;color:#e2e8f0;text-decoration:underline;text-decoration-color:rgba(226,232,240,0.3);text-underline-offset:2px">${p.name}</span>`
    html += `<span style="color:#94a3b8;font-size:10px;font-weight:600;white-space:nowrap">T${p.tier} &middot; ${p.level}</span>`
    html += `</div>`
    // Heartbeat + planned visit metadata row — only when we have data
    if (days !== undefined || planned) {
      html += `<div style="margin:-2px 0 4px 14px;display:flex;flex-wrap:wrap;gap:6px;font-size:10px;color:#94a3b8">`
      if (days !== undefined) {
        const dotColor = heartbeatBadgeColor(days ?? null)
        const label = days == null ? 'no visit on record' : `last visit ${days}d ago`
        html += `<span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor}"></span>${label}</span>`
      }
      if (planned) {
        const dateStr = planned.date.length > 10 ? planned.date.slice(0, 10) : planned.date
        const agentPrefix = planned.agent ? `${planned.agent.split(' ')[0]} ` : ''
        html += `<span style="color:#60a5fa">${agentPrefix}visiting ${dateStr}</span>`
      }
      html += `</div>`
    }
  }

  // Action row — plan a trip around these players
  html += `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.15)">`
  html += `<button data-action="plan-trip" data-players="${sorted.map(p => p.name).join('||')}" data-lat="${marker.coords.lat}" data-lng="${marker.coords.lng}" data-venue="${marker.venueName}" `
  html += `style="width:100%;background:#3b82f6;color:white;border:none;border-radius:4px;padding:5px 8px;font-size:11px;font-weight:600;cursor:pointer">`
  html += `Plan trip with ${sorted.length === 1 ? 'this player' : `these ${sorted.length} players`} &rarr;`
  html += `</button>`
  html += `</div>`

  // Full game-date list — expandable
  if (marker.gameDates.length > 0) {
    const visibleCount = 5
    const visible = marker.gameDates.slice(0, visibleCount).map(formatDate)
    const hidden = marker.gameDates.slice(visibleCount).map(formatDate)
    const uid = `sv-dates-${marker.key.replace(/[^a-z0-9]/gi, '-')}`

    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.15);font-size:10px;color:#94a3b8">`
    html += `Games: ${visible.join(', ')}`

    if (hidden.length > 0) {
      html += `<span id="${uid}-hidden" style="display:inline">`
      html += ` <span onclick="document.getElementById('${uid}-hidden').style.display='none';document.getElementById('${uid}-full').style.display='inline'" style="cursor:pointer;color:#60a5fa;text-decoration:underline">+${hidden.length} more</span>`
      html += `</span>`
      html += `<span id="${uid}-full" style="display:none">, ${hidden.join(', ')}</span>`
    }

    html += `</div>`
  }

  html += `</div>`
  return html
}
