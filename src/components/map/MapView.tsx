import { useEffect, useMemo, useRef, useState } from 'react'
import { useVenueStore } from '../../store/venueStore'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useTripStore } from '../../store/tripStore'
import { HOME_BASE } from '../../lib/tripEngine'
import { resolveMLBTeamId, resolveNcaaName } from '../../data/aliases'
import { resolveMaxPrepsSlug } from '../../lib/maxpreps'
import { isSpringTraining } from '../../data/springTraining'
import { formatTimeAgo } from '../../lib/formatters'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'

// Build a mapping from venue key → player names at that venue
function useVenuePlayerMap() {
  const players = useRosterStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)

  return useMemo(() => {
    const map = new Map<string, Array<{ name: string; tier: number; level: string }>>()

    function add(key: string, name: string, tier: number, level: string) {
      const existing = map.get(key)
      const entry = { name, tier, level }
      if (existing) {
        if (!existing.some((e) => e.name === name)) existing.push(entry)
      } else {
        map.set(key, [entry])
      }
    }

    // ST venues: key = "st-{teamId}" → Pro players via parent org
    for (const p of players) {
      if (p.level !== 'Pro') continue
      const orgId = resolveMLBTeamId(p.org)
      if (!orgId) continue
      add(`st-${orgId}`, p.playerName, p.tier, 'Pro')
    }

    // NCAA venues: key = "ncaa-{school lowercase}" → NCAA players via canonical name
    for (const p of players) {
      if (p.level !== 'NCAA') continue
      const canonical = resolveNcaaName(p.org)
      if (!canonical) continue
      add(`ncaa-${canonical.toLowerCase()}`, p.playerName, p.tier, 'NCAA')
    }

    // HS venues: key = "hs-{school|state}" → HS players by org+state
    for (const p of players) {
      if (p.level !== 'HS') continue
      const key = `hs-${p.org.toLowerCase().trim()}|${p.state.toLowerCase().trim()}`
      add(key, p.playerName, p.tier, 'HS')
    }

    // Pro venues from schedule: key = "pro-{venue-name}" → players from game data
    const proVenuePlayers = new Map<string, Set<string>>()
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      const existing = proVenuePlayers.get(key)
      if (existing) {
        for (const name of game.playerNames) existing.add(name)
      } else {
        proVenuePlayers.set(key, new Set(game.playerNames))
      }
    }
    for (const [key, names] of proVenuePlayers) {
      for (const name of names) {
        const player = players.find((p) => p.playerName === name)
        add(key, name, player?.tier ?? 4, 'Pro')
      }
    }

    return map
  }, [players, proGames])
}

// B3: CSS for pulsing ring animation
const PULSE_CSS_ID = 'sv-map-pulse-css'
function injectPulseCSS() {
  if (document.getElementById(PULSE_CSS_ID)) return
  const style = document.createElement('style')
  style.id = PULSE_CSS_ID
  style.textContent = `
    @keyframes sv-pulse-ring {
      0% { transform: scale(1); opacity: 0.7; }
      70% { transform: scale(2.2); opacity: 0; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .sv-pulse-ring {
      position: absolute;
      top: 50%; left: 50%;
      width: 14px; height: 14px;
      margin-top: -7px; margin-left: -7px;
      border-radius: 50%;
      border: 2px solid white;
      animation: sv-pulse-ring 2s ease-out infinite;
      pointer-events: none;
    }
    .sv-venue-count-badge {
      position: absolute;
      top: -6px; right: -8px;
      min-width: 14px; height: 14px;
      border-radius: 7px;
      background: #60a5fa;
      color: white;
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 3px;
      pointer-events: none;
    }
  `
  document.head.appendChild(style)
}

// B1: Build interactive popup HTML with action buttons
function buildPopupHtml(
  venueName: string,
  source: string,
  playerList: Array<{ name: string; tier: number; level: string }> | undefined,
  orgLabel?: string,
  priorityPlayers?: string[],
): string {
  const tierColors: Record<number, string> = {
    1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#6b7280',
  }
  let html = `<div style="font-family:system-ui;min-width:180px;max-width:280px">`
  if (orgLabel && orgLabel !== venueName) {
    html += `<div style="font-weight:600;font-size:13px;margin-bottom:2px">${orgLabel}</div>`
    html += `<div style="font-size:11px;color:#aaa;margin-bottom:4px">${venueName}</div>`
  } else {
    html += `<div style="font-weight:600;font-size:13px;margin-bottom:4px">${venueName}</div>`
  }
  html += `<div style="font-size:10px;color:#888;margin-bottom:6px">${source}</div>`

  if (playerList && playerList.length > 0) {
    const sorted = [...playerList].sort((a, b) => a.tier - b.tier)
    for (const p of sorted) {
      const color = tierColors[p.tier] ?? '#6b7280'
      const isPriority = priorityPlayers?.includes(p.name)
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px">`
      html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0" title="Tier ${p.tier}"></span>`
      if (isPriority) {
        html += `<span style="color:#fbbf24;font-size:10px;flex-shrink:0" title="Priority player">&#9733;</span>`
      }
      html += `<span style="flex:1;min-width:0">${p.name}</span>`
      html += `<span style="color:#888;font-size:10px">T${p.tier}</span>`
      html += `</div>`
      // Action buttons row
      html += `<div style="display:flex;gap:4px;margin-left:14px;margin-bottom:6px">`
      html += `<button data-action="priority" data-player="${p.name}" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;font-size:10px;padding:2px 6px;border-radius:4px;cursor:pointer">${isPriority ? '&#9733; Priority' : 'Set Priority'}</button>`
      html += `<button data-action="schedule" data-player="${p.name}" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;font-size:10px;padding:2px 6px;border-radius:4px;cursor:pointer">Schedule</button>`
      html += `<button data-action="visited" data-player="${p.name}" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;font-size:10px;padding:2px 6px;border-radius:4px;cursor:pointer">Visited</button>`
      html += `</div>`
    }
  } else {
    html += `<div style="font-size:11px;color:#666">No players mapped</div>`
  }

  html += `</div>`
  return html
}

// B2: Build a set of venue keys that have games in date range
function useDateFilteredVenueKeys(filterStart: string, filterEnd: string) {
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const venues = useVenueStore((s) => s.venues)

  return useMemo(() => {
    if (!filterStart && !filterEnd) return null // no filter active

    const keys = new Set<string>()

    // Pro games → match by venue coordinate proximity to venue entries
    for (const game of proGames) {
      if (filterStart && game.date < filterStart) continue
      if (filterEnd && game.date > filterEnd) continue
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      keys.add(key)
    }

    // NCAA games
    for (const game of ncaaGames) {
      if (filterStart && game.date < filterStart) continue
      if (filterEnd && game.date > filterEnd) continue
      // Match by coordinate proximity to any ncaa venue
      for (const [vk, v] of Object.entries(venues)) {
        if (!vk.startsWith('ncaa-')) continue
        const dist = Math.abs(v.coords.lat - game.venue.coords.lat) + Math.abs(v.coords.lng - game.venue.coords.lng)
        if (dist < 0.05) { keys.add(vk); break }
      }
    }

    // HS games
    for (const game of hsGames) {
      if (filterStart && game.date < filterStart) continue
      if (filterEnd && game.date > filterEnd) continue
      for (const [vk, v] of Object.entries(venues)) {
        if (!vk.startsWith('hs-')) continue
        const dist = Math.abs(v.coords.lat - game.venue.coords.lat) + Math.abs(v.coords.lng - game.venue.coords.lng)
        if (dist < 0.05) { keys.add(vk); break }
      }
    }

    // ST venues always pass (no date-specific games in scheduleStore for ST)
    for (const vk of Object.keys(venues)) {
      if (vk.startsWith('st-')) keys.add(vk)
    }

    return keys
  }, [filterStart, filterEnd, proGames, ncaaGames, hsGames, venues])
}

export default function MapView() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showPro, setShowPro] = useState(true)
  const [showSt, setShowSt] = useState(true)
  const [showNcaa, setShowNcaa] = useState(true)
  const [showHs, setShowHs] = useState(true)
  const [showTrips, setShowTrips] = useState(true)

  // B2: Date filter state
  const [filterStart, setFilterStart] = useState('')
  const [filterEnd, setFilterEnd] = useState('')

  // B4: Schedule panel state
  const [schedulePanelPlayer, setSchedulePanelPlayer] = useState<string | null>(null)

  const venues = useVenueStore((s) => s.venues)
  const hsGeocodingProgress = useVenueStore((s) => s.hsGeocodingProgress)
  const hsGeocodingError = useVenueStore((s) => s.hsGeocodingError)
  const proGames = useScheduleStore((s) => s.proGames)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const ncaaFetchedAt = useScheduleStore((s) => s.ncaaFetchedAt)
  const hsFetchedAt = useScheduleStore((s) => s.hsFetchedAt)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaProgress = useScheduleStore((s) => s.ncaaProgress)
  const hsLoading = useScheduleStore((s) => s.hsLoading)
  const hsProgress = useScheduleStore((s) => s.hsProgress)
  const fetchProSchedules = useScheduleStore((s) => s.fetchProSchedules)
  const fetchNcaaSchedules = useScheduleStore((s) => s.fetchNcaaSchedules)
  const fetchHsSchedules = useScheduleStore((s) => s.fetchHsSchedules)
  const autoAssignPlayers = useScheduleStore((s) => s.autoAssignPlayers)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)
  const customNcaaAliases = useScheduleStore((s) => s.customNcaaAliases)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const selectedTripIndex = useTripStore((s) => s.selectedTripIndex)
  const setSelectedTripIndex = useTripStore((s) => s.setSelectedTripIndex)
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const players = useRosterStore((s) => s.players)
  const loadNcaaVenues = useVenueStore((s) => s.loadNcaaVenues)
  const loadSpringTrainingVenues = useVenueStore((s) => s.loadSpringTrainingVenues)
  const addProVenue = useVenueStore((s) => s.addProVenue)
  const geocodeHsVenues = useVenueStore((s) => s.geocodeHsVenues)

  const venuePlayerMap = useVenuePlayerMap()
  const dateFilteredVenueKeys = useDateFilteredVenueKeys(filterStart, filterEnd)

  // Venue counts by type — only count venues that have players
  const venueCounts = useMemo(() => {
    const counts = { pro: 0, st: 0, ncaa: 0, hs: 0 }
    for (const [key, v] of Object.entries(venues)) {
      const hasPlayers = venuePlayerMap.has(key) && venuePlayerMap.get(key)!.length > 0
      if (!hasPlayers) continue
      if (v.source === 'mlb-api') counts.pro++
      else if (v.source === 'spring-training') counts.st++
      else if (v.source === 'ncaa-hardcoded') counts.ncaa++
      else if (v.source === 'hs-geocoded') counts.hs++
    }
    return counts
  }, [venues, venuePlayerMap])

  const isStActive = isSpringTraining(new Date().toISOString().slice(0, 10))
  const hasProPlayers = players.some((p) => p.level === 'Pro')
  const hasNcaaPlayers = players.some((p) => p.level === 'NCAA')
  const hasHsPlayers = players.some((p) => p.level === 'HS')

  // Schedule freshness
  const proStale = proFetchedAt && (Date.now() - proFetchedAt > 24 * 60 * 60 * 1000)
  const needsProSchedules = hasProPlayers && !proFetchedAt
  const needsNcaaSchedules = hasNcaaPlayers && !ncaaFetchedAt
  const needsHsSchedules = hasHsPlayers && !hsFetchedAt
  const hsVenueCount = Object.values(venues).filter((v) => v.source === 'hs-geocoded').length
  const hsVenueMissing = hasHsPlayers && hsVenueCount === 0
  const anyScheduleNeeded = needsProSchedules || needsNcaaSchedules || needsHsSchedules

  // Player org lists for schedule loading
  const ncaaPlayerOrgs = useMemo(() =>
    players.filter((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
      .map((p) => ({ playerName: p.playerName, org: p.org })),
    [players],
  )
  const ncaaSchoolCount = useMemo(() => {
    const schools = new Set<string>()
    for (const { org } of ncaaPlayerOrgs) {
      const canonical = resolveNcaaName(org, customNcaaAliases)
      if (canonical) schools.add(canonical)
    }
    return schools.size
  }, [ncaaPlayerOrgs, customNcaaAliases])
  const hsPlayerOrgs = useMemo(() =>
    players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
      .map((p) => ({ playerName: p.playerName, org: p.org, state: p.state })),
    [players],
  )
  const hsSchoolCount = useMemo(() => {
    const schools = new Set<string>()
    for (const { org, state } of hsPlayerOrgs) {
      if (resolveMaxPrepsSlug(org, state)) schools.add(`${org}|${state}`)
    }
    return schools.size
  }, [hsPlayerOrgs])

  // Load NCAA + Spring Training venues once
  const venuesLoaded = useRef(false)
  useEffect(() => {
    if (venuesLoaded.current) return
    venuesLoaded.current = true
    loadNcaaVenues()
    loadSpringTrainingVenues()
  }, [loadNcaaVenues, loadSpringTrainingVenues])

  // Geocode HS venues once when players are available
  // Skip if HS venues already exist from localStorage persistence
  const hsGeocodeStarted = useRef(false)
  useEffect(() => {
    if (hsGeocodeStarted.current) return
    const hsPlayers = players.filter((p) => p.level === 'HS')
    if (hsPlayers.length === 0) return
    // Check if HS venues are already hydrated from persistence
    const hasHsVenues = Object.keys(venues).some((k) => k.startsWith('hs-'))
    if (hasHsVenues) { hsGeocodeStarted.current = true; return }
    hsGeocodeStarted.current = true
    const schools = hsPlayers.map((p) => ({
      schoolName: p.org,
      city: '',
      state: p.state,
    }))
    geocodeHsVenues(schools)
  }, [players, venues, geocodeHsVenues])

  // Add pro venues from schedule data
  const lastProGamesLen = useRef(0)
  useEffect(() => {
    if (proGames.length === lastProGamesLen.current) return
    lastProGamesLen.current = proGames.length
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      addProVenue(key, game.venue.name, game.venue.coords)
    }
  }, [proGames, addProVenue])

  // B4: Listen for CustomEvent from popup action handler
  useEffect(() => {
    function handleScheduleEvent(e: Event) {
      const detail = (e as CustomEvent<{ player: string }>).detail
      if (detail?.player) setSchedulePanelPlayer(detail.player)
    }
    window.addEventListener('map:open-schedule', handleScheduleEvent)
    return () => window.removeEventListener('map:open-schedule', handleScheduleEvent)
  }, [])

  // Initialize Leaflet
  const mapInitialized = useRef(false)
  useEffect(() => {
    if (mapInitialized.current) return
    mapInitialized.current = true

    let cancelled = false

    async function init() {
      const L = await import('leaflet')
      leafletRef.current = L

      // Add CSS
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      // B3: Inject pulse animation CSS
      injectPulseCSS()

      if (cancelled || !mapRef.current) return

      const map = L.map(mapRef.current).setView([HOME_BASE.lat, HOME_BASE.lng], 6)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(map)

      // B1: Wire popup action handler once at init
      map.on('popupopen', (e: import('leaflet').PopupEvent) => {
        const container = e.popup.getElement()
        if (!container) return

        container.addEventListener('click', (evt: Event) => {
          const target = evt.target as HTMLElement
          const btn = target.closest('button[data-action]') as HTMLElement | null
          if (!btn) return

          const action = btn.dataset.action
          const playerName = btn.dataset.player
          if (!action || !playerName) return

          if (action === 'priority') {
            const store = useTripStore.getState()
            const current = store.priorityPlayers
            if (current.includes(playerName)) {
              store.setPriorityPlayers(current.filter((n) => n !== playerName))
            } else {
              store.setPriorityPlayers([...current.slice(0, 1), playerName])
            }
          } else if (action === 'schedule') {
            window.dispatchEvent(new CustomEvent('map:open-schedule', { detail: { player: playerName } }))
          } else if (action === 'visited') {
            const rosterStore = useRosterStore.getState()
            const player = rosterStore.players.find((p) => p.playerName === playerName)
            if (player) {
              const today = new Date().toISOString().slice(0, 10)
              rosterStore.setVisitOverride(playerName, player.visitsCompleted + 1, today)
            }
          }
        })
      })

      mapInstance.current = map
      setLoaded(true)
    }

    init()
    return () => { cancelled = true }
  }, [])

  // B3: Build set of priority venue keys
  const priorityVenueKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [key, playerList] of venuePlayerMap) {
      if (playerList.some((p) => priorityPlayers.includes(p.name))) {
        keys.add(key)
      }
    }
    return keys
  }, [venuePlayerMap, priorityPlayers])

  // B3: Build set of all-visited venue keys
  const allVisitedVenueKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [key, playerList] of venuePlayerMap) {
      if (playerList.length > 0 && playerList.every((p) => {
        const player = players.find((pl) => pl.playerName === p.name)
        return player ? player.visitsRemaining === 0 : false
      })) {
        keys.add(key)
      }
    }
    return keys
  }, [venuePlayerMap, players])

  // Update markers when data/filters change
  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance.current || !L || !loaded) return

    const map = mapInstance.current

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.Circle) {
        map.removeLayer(layer)
      }
    })

    // Home base star
    const homeIcon = L.divIcon({
      html: '<div style="font-size:20px;text-align:center;line-height:1">&#9733;</div>',
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
    L.marker([HOME_BASE.lat, HOME_BASE.lng], { icon: homeIcon })
      .bindPopup('Orlando, FL (Home Base)')
      .addTo(map)

    // Venue markers — only show venues that have players mapped
    for (const [key, venue] of Object.entries(venues)) {
      const isPro = venue.source === 'mlb-api'
      const isSt = venue.source === 'spring-training'
      const isNcaa = venue.source === 'ncaa-hardcoded'
      const isHs = venue.source === 'hs-geocoded'

      if (isPro && !showPro) continue
      if (isSt && !showSt) continue
      if (isNcaa && !showNcaa) continue
      if (isHs && !showHs) continue

      const playerList = venuePlayerMap.get(key)

      // Skip venues with no players (e.g. ST sites for orgs Kent has no clients in)
      if (!playerList || playerList.length === 0) continue

      // B2: Skip venues that don't match date filter
      if (dateFilteredVenueKeys && !dateFilteredVenueKeys.has(key)) continue

      const color = isPro ? '#60a5fa' : isSt ? '#f472b6' : isNcaa ? '#34d399' : '#fb923c'
      const size = isSt ? 12 : 10
      const isPriorityVenue = priorityVenueKeys.has(key)
      const isAllVisited = allVisitedVenueKeys.has(key)

      // B3: Richer marker HTML
      let markerHtml = `<div style="position:relative;width:${size}px;height:${size}px;${isAllVisited ? 'opacity:0.4;' : ''}">`
      markerHtml += `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid ${color}44;cursor:pointer"></div>`
      if (isPriorityVenue) {
        markerHtml += `<div class="sv-pulse-ring"></div>`
      }
      if (playerList.length > 1) {
        markerHtml += `<div class="sv-venue-count-badge">${playerList.length}</div>`
      }
      markerHtml += `</div>`

      const icon = L.divIcon({
        html: markerHtml,
        className: '',
        iconSize: [size + 16, size + 12],
        iconAnchor: [(size + 16) / 2, (size + 12) / 2],
      })

      const sourceLabel = isPro ? 'Pro Venue' : isSt ? 'Spring Training Site' : isNcaa ? 'College Venue' : 'High School'

      // Derive org label from players at this venue
      let orgLabel: string | undefined
      const firstPlayer = players.find((p) => p.playerName === playerList[0]!.name)
      if (firstPlayer) {
        if (isHs) {
          orgLabel = `${firstPlayer.org}, ${firstPlayer.state}`
        } else {
          orgLabel = firstPlayer.org
        }
      }

      const popup = buildPopupHtml(venue.name, sourceLabel, playerList, orgLabel, priorityPlayers)

      L.marker([venue.coords.lat, venue.coords.lng], { icon })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(map)
    }

    // Trip routes
    if (showTrips && tripPlan) {
      for (let ti = 0; ti < tripPlan.trips.length; ti++) {
        const trip = tripPlan.trips[ti]!
        const isSelected = selectedTripIndex === ti
        const points: [number, number][] = [
          [HOME_BASE.lat, HOME_BASE.lng],
          [trip.anchorGame.venue.coords.lat, trip.anchorGame.venue.coords.lng],
        ]

        for (const game of trip.nearbyGames) {
          points.push([game.venue.coords.lat, game.venue.coords.lng])
        }

        points.push([HOME_BASE.lat, HOME_BASE.lng])

        L.polyline(points, {
          color: isSelected ? '#60a5fa' : '#a78bfa',
          weight: isSelected ? 3 : 2,
          opacity: isSelected ? 1 : 0.5,
          dashArray: isSelected ? undefined : '8 4',
        }).addTo(map)

        if (isSelected) {
          // Numbered stop markers for the selected trip
          const stops: Array<{ lat: number; lng: number; label: string }> = [
            { lat: trip.anchorGame.venue.coords.lat, lng: trip.anchorGame.venue.coords.lng, label: trip.anchorGame.venue.name },
          ]
          for (const game of trip.nearbyGames) {
            if (!stops.some((s) => Math.abs(s.lat - game.venue.coords.lat) < 0.001 && Math.abs(s.lng - game.venue.coords.lng) < 0.001)) {
              stops.push({ lat: game.venue.coords.lat, lng: game.venue.coords.lng, label: game.venue.name })
            }
          }

          for (let si = 0; si < stops.length; si++) {
            const stop = stops[si]!
            const stopIcon = L.divIcon({
              html: `<div style="width:24px;height:24px;border-radius:50%;background:#60a5fa;color:white;font-weight:bold;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.5)">${si + 1}</div>`,
              className: '',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            })
            L.marker([stop.lat, stop.lng], { icon: stopIcon })
              .bindPopup(`<b>Stop ${si + 1}:</b> ${stop.label}`)
              .addTo(map)
          }

          // Zoom to fit the selected trip
          const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng] as [number, number]))
          map.fitBounds(bounds, { padding: [50, 50] })
        } else {
          // Small radius circle for non-selected trips
          L.circle([trip.anchorGame.venue.coords.lat, trip.anchorGame.venue.coords.lng], {
            radius: 240000,
            color: '#a78bfa',
            weight: 1,
            opacity: 0.2,
            fillOpacity: 0.02,
          }).addTo(map)
        }
      }
    }
  }, [venues, venuePlayerMap, tripPlan, selectedTripIndex, showPro, showSt, showNcaa, showHs, showTrips, loaded, dateFilteredVenueKeys, priorityVenueKeys, allVisitedVenueKeys, priorityPlayers, players])

  return (
    <div className="space-y-4">
      {/* Layer toggles — only show categories that are relevant */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-3">
        {(venueCounts.pro > 0 || (hasProPlayers && proGames.length > 0)) && (
          <Toggle label={`Pro (${venueCounts.pro})`} color="bg-accent-blue" checked={showPro} onChange={setShowPro} />
        )}
        {(venueCounts.st > 0 || (hasProPlayers && isStActive)) && (
          <Toggle label={`Spring Training (${venueCounts.st})`} color="bg-pink-500" checked={showSt} onChange={setShowSt} />
        )}
        {venueCounts.ncaa > 0 && (
          <Toggle label={`College (${venueCounts.ncaa})`} color="bg-accent-green" checked={showNcaa} onChange={setShowNcaa} />
        )}
        {(venueCounts.hs > 0 || hasHsPlayers) && (
          <Toggle label={`High School (${venueCounts.hs})`} color="bg-accent-orange" checked={showHs} onChange={setShowHs} />
        )}
        {tripPlan && tripPlan.trips.length > 0 && (
          <Toggle label="Trip Routes" color="bg-accent-purple" checked={showTrips} onChange={setShowTrips} />
        )}
      </div>

      {/* B2: Date range filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
        <span className="text-xs font-medium text-text-dim">Date filter:</span>
        <input
          type="date"
          value={filterStart}
          onChange={(e) => setFilterStart(e.target.value)}
          className="rounded-lg border border-border bg-gray-950 px-2 py-1 text-xs text-text"
          placeholder="Start"
        />
        <span className="text-text-dim/40">–</span>
        <input
          type="date"
          value={filterEnd}
          onChange={(e) => setFilterEnd(e.target.value)}
          className="rounded-lg border border-border bg-gray-950 px-2 py-1 text-xs text-text"
          placeholder="End"
        />
        {startDate && endDate && (
          <button
            onClick={() => { setFilterStart(startDate); setFilterEnd(endDate) }}
            className="rounded-lg bg-accent-blue/10 px-2.5 py-1 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/20 transition-colors"
          >
            Use Trip Planner dates
          </button>
        )}
        {(filterStart || filterEnd) && (
          <button
            onClick={() => { setFilterStart(''); setFilterEnd('') }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            Clear
          </button>
        )}
        {(filterStart || filterEnd) && (
          <span className="text-[10px] text-text-dim/60">
            Showing only venues with games in range
          </span>
        )}
      </div>

      {/* Selected trip indicator */}
      {selectedTripIndex !== null && tripPlan?.trips[selectedTripIndex] && (
        <div className="flex items-center justify-between rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-3">
          <span className="text-sm text-accent-blue">
            Showing Trip #{selectedTripIndex + 1} — numbered stops mark the driving order
          </span>
          <button
            onClick={() => setSelectedTripIndex(null)}
            className="rounded-lg bg-gray-800 px-3 py-1 text-xs font-medium text-text-dim hover:text-text"
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Schedule loading — show when any schedules are missing */}
      {players.length > 0 && anyScheduleNeeded && (
        <div className="rounded-xl border border-accent-orange/20 bg-accent-orange/5 p-3">
          <p className="mb-2 text-[11px] text-accent-orange">
            Load game schedules to see all venues and enable the date filter.
            {isStActive && ' During spring training, Pro players show at ST sites (pink dots).'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Load All button */}
            {(() => {
              const needsPro = hasProPlayers && !proFetchedAt && Object.keys(playerTeamAssignments).length > 0
              const needsNcaa = hasNcaaPlayers && !ncaaFetchedAt
              const needsHs = hasHsPlayers && !hsFetchedAt
              const sectionsNeeded = [needsPro, needsNcaa, needsHs].filter(Boolean).length
              if (sectionsNeeded < 2) return null
              const anyLoading = schedulesLoading || ncaaLoading || hsLoading || !!hsGeocodingProgress
              return (
                <button
                  onClick={() => {
                    const y = new Date().getFullYear()
                    if (needsPro) fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
                    if (needsNcaa) fetchNcaaSchedules(ncaaPlayerOrgs)
                    if (needsHs && hsVenueMissing) {
                      const hsPlayers = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
                      geocodeHsVenues(hsPlayers.map((p) => ({ schoolName: p.org, city: '', state: p.state })))
                    }
                    if (needsHs) fetchHsSchedules(hsPlayerOrgs)
                  }}
                  disabled={anyLoading}
                  className="rounded-lg bg-white px-3 py-1 text-[11px] font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-50"
                >
                  {anyLoading ? 'Loading...' : 'Load All Schedules'}
                </button>
              )
            })()}

            {/* Pro */}
            {hasProPlayers && !proFetchedAt && (
              <>
                {Object.keys(playerTeamAssignments).length === 0 && (
                  <button
                    onClick={autoAssignPlayers}
                    disabled={autoAssignLoading}
                    className="rounded-lg bg-accent-green px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
                  >
                    {autoAssignLoading ? 'Scanning...' : '1. Auto-Assign Players'}
                  </button>
                )}
                <button
                  onClick={() => { const y = new Date().getFullYear(); fetchProSchedules(`${y}-03-01`, `${y}-09-30`) }}
                  disabled={schedulesLoading || Object.keys(playerTeamAssignments).length === 0}
                  className="rounded-lg bg-accent-blue px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
                >
                  {schedulesLoading ? 'Loading...' : Object.keys(playerTeamAssignments).length === 0 ? 'Assign first' : 'Load Pro Schedules'}
                </button>
              </>
            )}

            {/* NCAA */}
            {hasNcaaPlayers && !ncaaFetchedAt && ncaaSchoolCount > 0 && (
              <button
                onClick={() => fetchNcaaSchedules(ncaaPlayerOrgs)}
                disabled={ncaaLoading}
                className="rounded-lg bg-accent-green px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
              >
                {ncaaLoading ? 'Loading...' : `Load College (~${ncaaSchoolCount * 5}s)`}
              </button>
            )}

            {/* HS */}
            {hasHsPlayers && !hsFetchedAt && (
              <>
                {hsVenueMissing && (
                  <button
                    onClick={() => {
                      const hsPlayers = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
                      geocodeHsVenues(hsPlayers.map((p) => ({ schoolName: p.org, city: '', state: p.state })))
                    }}
                    disabled={!!hsGeocodingProgress}
                    className="rounded-lg bg-accent-orange px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
                  >
                    {hsGeocodingProgress ? `Geocoding... ${hsGeocodingProgress.completed}/${hsGeocodingProgress.total}` : `1. Geocode HS Schools`}
                  </button>
                )}
                {hsSchoolCount > 0 && (
                  <button
                    onClick={() => fetchHsSchedules(hsPlayerOrgs)}
                    disabled={hsLoading}
                    className="rounded-lg bg-accent-orange px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
                  >
                    {hsLoading ? 'Loading...' : `${hsVenueMissing ? '2. ' : ''}Load HS (~${hsSchoolCount * 5}s)`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Progress indicators */}
          {(schedulesProgress || ncaaProgress || hsProgress) && (
            <div className="mt-2 space-y-0.5">
              {schedulesProgress && (
                <div className="text-[10px] text-text-dim">
                  Pro: {schedulesProgress.completed}/{schedulesProgress.total} teams
                </div>
              )}
              {ncaaProgress && (
                <div className="text-[10px] text-text-dim">
                  College: {ncaaProgress.completed}/{ncaaProgress.total} schools
                </div>
              )}
              {hsProgress && (
                <div className="text-[10px] text-text-dim">
                  HS: {hsProgress.completed}/{hsProgress.total} schools
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Schedule freshness badges — show when loaded */}
      {players.length > 0 && !anyScheduleNeeded && (proFetchedAt || ncaaFetchedAt || hsFetchedAt) && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {proFetchedAt && (
            <span className={`rounded px-2 py-0.5 ${proStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'}`}>
              Pro: loaded {formatTimeAgo(proFetchedAt)}
            </span>
          )}
          {ncaaFetchedAt && (
            <span className="rounded bg-accent-green/10 px-2 py-0.5 text-accent-green">
              College: loaded {formatTimeAgo(ncaaFetchedAt)}
            </span>
          )}
          {hsFetchedAt && (
            <span className="rounded bg-accent-green/10 px-2 py-0.5 text-accent-green">
              HS: loaded {formatTimeAgo(hsFetchedAt)}
            </span>
          )}
        </div>
      )}

      {/* HS geocoding error */}
      {hasHsPlayers && venueCounts.hs === 0 && !hsGeocodingProgress && hsGeocodingError && (
        <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5 text-[11px] text-accent-orange">
          Couldn't locate high school addresses: {hsGeocodingError}. Try refreshing the page.
        </div>
      )}

      {/* Map container */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div ref={mapRef} className="h-[600px] w-full bg-gray-900" />
      </div>

      {/* Geocoding progress */}
      {hsGeocodingProgress && (
        <div className="flex items-center gap-2 text-xs text-text-dim">
          <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
          Looking up high school locations: {hsGeocodingProgress.completed}/{hsGeocodingProgress.total}
        </div>
      )}

      {/* Venue summary */}
      <p className="text-xs text-text-dim">
        {venueCounts.pro + venueCounts.st + venueCounts.ncaa + venueCounts.hs} venues with your players — click any dot to see who's there
      </p>

      {/* B4: Schedule panel from popup */}
      {schedulePanelPlayer && (
        <PlayerSchedulePanel
          playerName={schedulePanelPlayer}
          onClose={() => setSchedulePanelPlayer(null)}
        />
      )}
    </div>
  )
}

function Toggle({ label, color, checked, onChange }: { label: string; color: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dim">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
          aria-label={label}
        />
        <div className={`h-4 w-8 rounded-full transition-colors ${checked ? color : 'bg-gray-700'}`} />
        <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-4.5' : 'left-0.5'}`} />
      </div>
      {label}
    </label>
  )
}
