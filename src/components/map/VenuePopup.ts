import type { TierMarker } from './hooks/useTierMarkers'
import { TIER_COLORS } from './hooks/useTierMarkers'

/**
 * Build popup HTML string for a venue marker.
 * Leaflet requires raw HTML strings for bindPopup.
 */
export function buildVenuePopupHtml(marker: TierMarker): string {
  const sorted = [...marker.players].sort((a, b) => a.tier - b.tier)

  let html = `<div style="font-family:system-ui,sans-serif;min-width:180px;max-width:300px">`

  // Venue name
  html += `<div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#f1f5f9">${marker.venueName}</div>`

  // Players sorted by tier
  for (const p of sorted) {
    const color = TIER_COLORS[p.tier] ?? TIER_COLORS[4]!
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px">`
    html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>`
    html += `<span data-action="schedule" data-player="${p.name}" style="flex:1;min-width:0;cursor:pointer;color:#e2e8f0;text-decoration:underline;text-decoration-color:rgba(226,232,240,0.3);text-underline-offset:2px">${p.name}</span>`
    html += `<span style="color:#94a3b8;font-size:10px;font-weight:600;white-space:nowrap">T${p.tier} &middot; ${p.level}</span>`
    html += `</div>`
  }

  // Game dates in window — expandable
  if (marker.gameDates.length > 0) {
    const formatDate = (d: string) => {
      const date = new Date(d + 'T12:00:00Z')
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
    }

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
