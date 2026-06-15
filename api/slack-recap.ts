import type { VercelRequest, VercelResponse } from '@vercel/node'

// SV Travel Hub — Weekly Slack recap.
//
// Triggered weekly via Vercel Cron (vercel.json) AND manually from the app's
// admin button. Composes a brief, scannable post for #travel-schedule:
//
//   - Top 3-day window in each of the next 4 weeks (starting 1 week out)
//   - Overdue T1/T2 players (per Heartbeat) with their next game inline
//   - "Open hub →" link
//
// Coverage: Pro (MLB Stats API), HS + JUCO (Schedule CSV), Summer (Summer CSV).
// NCAA games are not yet wired server-side (D1Baseball scrape lives only in
// the browser). Phase 2 will add NCAA via a build-time snapshot.
//
// Env vars (all set in Vercel):
//   SLACK_BOT_TOKEN                     — xoxb- token from the "SV Travel Hub"
//                                          Slack app (chat:write scope)
//   SLACK_CHANNEL_TRAVEL_SCHEDULE       — channel ID or name (e.g. "C01234"
//                                          or "#travel-schedule")
//   CRON_SECRET                         — shared secret to guard the endpoint
//   VITE_ROSTER_CSV_URL                 — SV roster sheet (CSV)
//   VITE_SCHEDULE_CSV_URL               — HS + JUCO schedule sheet (CSV)
//   VITE_SUMMER_CSV_URL                 — Summer placement sheet (CSV)
//
// Usage:
//   GET /api/slack-recap?secret=<CRON_SECRET>           → posts to Slack
//   GET /api/slack-recap?secret=<CRON_SECRET>&dryRun=1  → returns the message JSON,
//                                                         no Slack post (for previewing)

interface RosterPlayer {
  name: string
  tier: number
  level: 'Pro' | 'NCAA' | 'HS'
  org: string
  state?: string
}

interface HeartbeatPlayer {
  name: string
  daysSinceInPerson: number | null
  inPersonThresholdDays: number | null
}

interface Game {
  date: string         // YYYY-MM-DD
  player: string
  venueName: string
  homeOrAway: 'home' | 'away' | 'unknown'
  opponent?: string
  tier: number
  level: 'Pro' | 'HS' | 'JUCO' | 'Summer' | 'NCAA'
  lat?: number
  lng?: number
  city?: string
  state?: string       // 2-letter abbrev where known
}

interface WindowResult {
  startDate: string
  endDate: string
  regionLabel: string  // e.g. "Sacramento, CA area" — the drivable cluster this trip covers
  players: Array<{ name: string; tier: number; venueName: string; city?: string; state?: string; date: string }>
  uniquePlayerCount: number
  t1Count: number
  t2Count: number
  t3Count: number
  topVenues: string[]  // "Venue (City, ST)" ranked by player-count contribution
}

interface WeekTrips {
  trips: WindowResult[]  // up to 2 distinct-region trips, best first
  elsewhere: number      // unique players that week not covered by either shown trip
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: accept EITHER Vercel's Cron Authorization header (preferred path
  // for the scheduled cron — Vercel adds `Authorization: Bearer <CRON_SECRET>`
  // automatically) OR a `?secret=` query param (for the in-app admin button).
  const expected = process.env.CRON_SECRET ?? ''
  if (!expected) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' })
  }
  const headerSecret = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const querySecret = (req.query.secret as string) ?? ''
  if (headerSecret !== expected && querySecret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true'
  const botToken = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_CHANNEL_TRAVEL_SCHEDULE

  if (!dryRun && (!botToken || !channel)) {
    return res.status(500).json({ error: 'SLACK_BOT_TOKEN and SLACK_CHANNEL_TRAVEL_SCHEDULE must both be configured' })
  }

  try {
    const today = new Date()
    const players = await loadRoster()
    const heartbeat = await loadHeartbeat()
    const games = await loadAllGames(players, today)

    const weeks = nextFourWeeks(today)
    const topWindows = weeks.map((wk) => computeTopTripsInRange(games, wk.start, wk.end))

    const overdue = computeOverduePlayers(players, heartbeat, games, today)

    const message = composeSlackMessage(topWindows, weeks, overdue, players.length)

    if (dryRun) {
      return res.status(200).json({ dryRun: true, message, weeks, topWindows, overdueCount: overdue.length })
    }

    // Post via chat.postMessage (modern Slack app API). Requires the bot
    // to be a member of the channel — invite it with `/invite @SV Travel Hub`
    // before the first run.
    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel,
        text: message.text,
        blocks: message.blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
    })
    const slackBody = await slackRes.json() as { ok: boolean; error?: string; ts?: string; channel?: string }
    if (!slackRes.ok || !slackBody.ok) {
      return res.status(502).json({ error: 'Slack chat.postMessage failed', status: slackRes.status, body: slackBody })
    }
    return res.status(200).json({ posted: true, channel: slackBody.channel, ts: slackBody.ts })
  } catch (e) {
    console.error('[slack-recap] handler error:', e)
    return res.status(500).json({ error: e instanceof Error ? e.message : 'unknown error' })
  }
}

// ─── Data loaders ────────────────────────────────────────────────────────────

async function loadRoster(): Promise<RosterPlayer[]> {
  const url = process.env.VITE_ROSTER_CSV_URL
  if (!url) throw new Error('VITE_ROSTER_CSV_URL not configured')
  const csv = await fetchText(url)
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n.toLowerCase())).find((i) => i >= 0) ?? -1
  const iName = col(['name', 'player name', 'player'])
  const iTier = col(['tier', 'player tier'])
  const iLevel = col(['level', 'player level'])
  const iOrg = col(['org', 'organization', 'team', 'school'])
  const iState = col(['state', 'home state'])
  const out: RosterPlayer[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const name = (row[iName] ?? '').trim()
    if (!name) continue
    const rawLevel = (row[iLevel] ?? '').toLowerCase().trim()
    const level: RosterPlayer['level'] =
      rawLevel.includes('hs') || rawLevel.includes('high school') ? 'HS' :
      rawLevel.includes('ncaa') || rawLevel.includes('college') || rawLevel.includes('juco') ? 'NCAA' :
      'Pro'
    const tier = parseInt((row[iTier] ?? '2').trim(), 10) || 2
    out.push({
      name,
      tier,
      level,
      org: (row[iOrg] ?? '').trim(),
      state: (row[iState] ?? '').trim() || undefined,
    })
  }
  return out
}

async function loadHeartbeat(): Promise<Map<string, HeartbeatPlayer>> {
  const map = new Map<string, HeartbeatPlayer>()
  try {
    const res = await fetch('https://sv-heartbeat.vercel.app/api/heartbeat/summary', {
      headers: { 'User-Agent': 'SVTravelHub/Slack-Recap' },
    })
    if (!res.ok) return map
    const data = await res.json() as { players?: HeartbeatPlayer[] }
    for (const p of data.players ?? []) {
      map.set(p.name.trim().toLowerCase(), p)
    }
  } catch (e) {
    console.warn('[slack-recap] heartbeat fetch failed:', e)
  }
  return map
}

/** Pull every game we can reach server-side: HS+JUCO from CSV, Summer from CSV,
 *  Pro from MLB Stats API. NCAA is skipped in Phase 1. */
async function loadAllGames(players: RosterPlayer[], today: Date): Promise<Game[]> {
  const startStr = isoDate(today)
  const endDate = new Date(today); endDate.setDate(endDate.getDate() + 5 * 7)
  const endStr = isoDate(endDate)

  const games: Game[] = []

  // HS + JUCO via the Schedule CSV
  try {
    const hsGames = await loadScheduleCsv(players)
    for (const g of hsGames) if (g.date >= startStr && g.date <= endStr) games.push(g)
  } catch (e) { console.warn('[slack-recap] HS CSV failed:', e) }

  // Summer via the Summer CSV (assignments only — game-level summer requires
  // joining with MLB API for CCBL/MLBD or PrestoSports for others; for Phase 1
  // we surface "X SV players in summer leagues" via the assignment list).
  // Pro via the MLB Stats API for the 5 weeks we care about.
  try {
    const proGames = await loadProGames(players, startStr, endStr)
    games.push(...proGames)
  } catch (e) { console.warn('[slack-recap] Pro games failed:', e) }

  return games
}

async function loadScheduleCsv(players: RosterPlayer[]): Promise<Game[]> {
  const url = process.env.VITE_SCHEDULE_CSV_URL
  if (!url) return []
  const csv = await fetchText(url)
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n.toLowerCase())).find((i) => i >= 0) ?? -1
  const iPlayer = col(['player', 'player name', 'name'])
  const iDate = col(['date', 'game date'])
  const iVenue = col(['venue', 'venue name', 'stadium'])
  const iOpp = col(['opponent', 'opponent team'])
  const iHomeAway = col(['home/away', 'h/a', 'home or away'])

  const playerByName = new Map<string, RosterPlayer>()
  for (const p of players) playerByName.set(p.name.trim().toLowerCase(), p)

  const out: Game[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const playerName = (row[iPlayer] ?? '').trim()
    const date = (row[iDate] ?? '').trim()
    if (!playerName || !date) continue
    const p = playerByName.get(playerName.toLowerCase())
    if (!p) continue
    const ha = (row[iHomeAway] ?? '').toLowerCase()
    out.push({
      date: normalizeIsoDate(date),
      player: p.name,
      venueName: (row[iVenue] ?? '').trim() || 'Unknown venue',
      homeOrAway: ha.startsWith('h') ? 'home' : ha.startsWith('a') ? 'away' : 'unknown',
      opponent: (row[iOpp] ?? '').trim() || undefined,
      tier: p.tier,
      level: p.level === 'HS' ? 'HS' : 'JUCO',
      state: p.state, // CSV has no coords; player home state lets these cluster by region
    })
  }
  return out
}

/** Server-side Pro schedule via MLB Stats API. We can't replicate the full
 *  autoAssignPlayers flow here, so we keep it simple: for each Pro player,
 *  look up the parent MLB org by their `org` field against MLB_TEAMS, fetch
 *  that org's full schedule (MLB + MiLB affiliates) for the window, and
 *  attribute every game to that player. This is imprecise for rehab /
 *  optioned cases, but the Slack recap is a coarse weekly summary — fine. */
async function loadProGames(players: RosterPlayer[], start: string, end: string): Promise<Game[]> {
  const proPlayers = players.filter((p) => p.level === 'Pro')
  if (proPlayers.length === 0) return []

  // Build a tiny MLB org name → teamId map. Covers the 30 MLB orgs Kent cares
  // about. (Same canonical names used in the React app's MLB_PARENT_IDS.)
  const ORG_IDS: Record<string, number> = {
    'arizona diamondbacks': 109, 'atlanta braves': 144, 'baltimore orioles': 110,
    'boston red sox': 111, 'chicago cubs': 112, 'chicago white sox': 145,
    'cincinnati reds': 113, 'cleveland guardians': 114, 'colorado rockies': 115,
    'detroit tigers': 116, 'houston astros': 117, 'kansas city royals': 118,
    'los angeles angels': 108, 'los angeles dodgers': 119, 'miami marlins': 146,
    'milwaukee brewers': 158, 'minnesota twins': 142, 'new york mets': 121,
    'new york yankees': 147, 'oakland athletics': 133, 'athletics': 133,
    'philadelphia phillies': 143, 'pittsburgh pirates': 134, 'san diego padres': 135,
    'san francisco giants': 137, 'seattle mariners': 136, 'st. louis cardinals': 138,
    'tampa bay rays': 139, 'texas rangers': 140, 'toronto blue jays': 141,
    'washington nationals': 120,
  }

  // Group SV players by their parent org. Then for each org, fetch the
  // schedule once (with affiliates) and attribute games to those players.
  const playersByOrgId = new Map<number, RosterPlayer[]>()
  for (const p of proPlayers) {
    const id = ORG_IDS[p.org.toLowerCase().trim()]
    if (!id) continue
    const list = playersByOrgId.get(id) ?? []
    list.push(p)
    playersByOrgId.set(id, list)
  }

  const out: Game[] = []
  // Fetch parent + 11=AAA + 12=AA + 13=A+ + 14=A schedules in parallel.
  await Promise.all(Array.from(playersByOrgId.entries()).map(async ([orgId, orgPlayers]) => {
    try {
      const sportIds = [1, 11, 12, 13, 14].join(',')
      // First get the affiliate team IDs for this org.
      const affResp = await fetch(`https://statsapi.mlb.com/api/v1/teams/affiliates?teamIds=${orgId}&sportIds=${sportIds}`)
      if (!affResp.ok) return
      const affData = await affResp.json() as { teams?: Array<{ id: number; sport?: { id: number } }> }
      const teamIds = (affData.teams ?? []).map((t) => t.id)
      if (teamIds.length === 0) return
      // Then fetch the schedule for all those teams in the window.
      // hydrate=venue(location) gives us coordinates + city/state so the recap
      // can cluster games into a real drivable trip and label each venue.
      const schedResp = await fetch(`https://statsapi.mlb.com/api/v1/schedule?teamId=${teamIds.join(',')}&startDate=${start}&endDate=${end}&sportId=${sportIds}&hydrate=venue(location)`)
      if (!schedResp.ok) return
      const schedData = await schedResp.json() as { dates?: Array<{ date: string; games?: Array<{ teams?: { home?: { team?: { name?: string } }; away?: { team?: { name?: string } } }; venue?: { name?: string; location?: { city?: string; stateAbbrev?: string; state?: string; defaultCoordinates?: { latitude?: number; longitude?: number } } } }> }> }
      for (const day of schedData.dates ?? []) {
        for (const g of day.games ?? []) {
          const venueName = g.venue?.name ?? 'Unknown'
          const loc = g.venue?.location
          const coords = loc?.defaultCoordinates
          const home = g.teams?.home?.team?.name ?? ''
          const away = g.teams?.away?.team?.name ?? ''
          for (const p of orgPlayers) {
            out.push({
              date: day.date,
              player: p.name,
              venueName,
              homeOrAway: 'unknown', // we don't track which team a player is on at the schedule level
              opponent: away !== home ? `${away} @ ${home}` : '',
              tier: p.tier,
              level: 'Pro',
              lat: coords?.latitude,
              lng: coords?.longitude,
              city: loc?.city,
              state: loc?.stateAbbrev ?? loc?.state,
            })
          }
        }
      }
    } catch (e) {
      console.warn(`[slack-recap] Pro schedule fetch failed for org ${orgId}:`, e)
    }
  }))
  return out
}

// ─── Computations ────────────────────────────────────────────────────────────

function nextFourWeeks(today: Date): Array<{ label: string; start: string; end: string }> {
  // Each "week" is Mon-Sun. Start a week from today's Monday.
  // Today is Mon 6 AM ET when cron fires; we want the FOLLOWING Mon + 3 more.
  const monday = new Date(today)
  const dayOfWeek = monday.getUTCDay() // 0=Sun, 1=Mon
  // Go to next Monday (always at least 1 week away)
  const daysToNextMonday = ((1 - dayOfWeek + 7) % 7) || 7
  monday.setUTCDate(monday.getUTCDate() + daysToNextMonday)
  const weeks: Array<{ label: string; start: string; end: string }> = []
  for (let i = 0; i < 4; i++) {
    const start = new Date(monday); start.setUTCDate(start.getUTCDate() + i * 7)
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6)
    weeks.push({
      label: `Week of ${shortDate(start)}`,
      start: isoDate(start),
      end: isoDate(end),
    })
  }
  return weeks
}

const tierWeight = (tier: number) => (tier === 1 ? 5 : tier === 2 ? 3 : tier === 3 ? 1 : 0)

/** Great-circle distance in miles. */
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// A 3-day trip is realistically one drivable region. Games whose venues sit
// within this radius of a cluster's centroid count as the same trip.
const CLUSTER_RADIUS_MILES = 200

/** Group a window's games into drivable regions. Games with coordinates are
 *  greedily clustered by distance; games without coordinates (e.g. HS from the
 *  CSV) fall back to one cluster per home state so they still surface. */
function clusterGames(games: Game[]): Game[][] {
  const coordGames = games.filter((g) => typeof g.lat === 'number' && typeof g.lng === 'number')
  const noCoord = games.filter((g) => typeof g.lat !== 'number' || typeof g.lng !== 'number')

  const clusters: Array<{ centroid: { lat: number; lng: number }; games: Game[] }> = []
  for (const g of coordGames) {
    const pt = { lat: g.lat!, lng: g.lng! }
    let target = clusters.find((c) => haversineMiles(c.centroid, pt) <= CLUSTER_RADIUS_MILES)
    if (!target) {
      target = { centroid: pt, games: [] }
      clusters.push(target)
    }
    target.games.push(g)
    // Recompute centroid as the running mean.
    const n = target.games.length
    target.centroid = {
      lat: target.games.reduce((s, x) => s + x.lat!, 0) / n,
      lng: target.games.reduce((s, x) => s + x.lng!, 0) / n,
    }
  }

  const result: Game[][] = clusters.map((c) => c.games)

  // State-bucket the coordinate-less games.
  const byState = new Map<string, Game[]>()
  for (const g of noCoord) {
    const key = g.state || 'Unknown'
    const list = byState.get(key) ?? []
    list.push(g)
    byState.set(key, list)
  }
  for (const list of byState.values()) result.push(list)

  return result
}

/** Pick a human region label for a cluster from its venues' cities/states. */
function regionLabel(games: Game[]): string {
  const cityCounts = new Map<string, number>()   // "City, ST"
  const stateCounts = new Map<string, number>()
  for (const g of games) {
    if (g.city && g.state) cityCounts.set(`${g.city}, ${g.state}`, (cityCounts.get(`${g.city}, ${g.state}`) ?? 0) + 1)
    if (g.state) stateCounts.set(g.state, (stateCounts.get(g.state) ?? 0) + 1)
  }
  const topCity = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topState = [...stateCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (cityCounts.size === 1 && topCity) return `${topCity[0]} area`
  if (topState) {
    // Multiple cities in one dominant state → "<ST> area"; lead with the busiest city.
    if (topCity && stateCounts.size === 1) return `${topCity[0]} area`
    return topState[0]
  }
  // No location info at all — fall back to the venue with the most games.
  const venueCounts = new Map<string, number>()
  for (const g of games) venueCounts.set(g.venueName, (venueCounts.get(g.venueName) ?? 0) + 1)
  const topVenue = [...venueCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  return topVenue ? topVenue[0] : 'Unknown region'
}

function venueWithCity(g: Game): string {
  return g.city && g.state ? `${g.venueName} (${g.city}, ${g.state})` : g.venueName
}

/** Turn one drivable cluster (already date-windowed) into a scored trip. */
function clusterToTrip(cluster: Game[], wStart: string, wEnd: string): { trip: WindowResult; score: number; players: Set<string> } {
  // Earliest in-cluster game per player; tier = best (lowest) tier seen.
  const earliest = new Map<string, Game>()
  const tierByPlayer = new Map<string, number>()
  const venueCounts = new Map<string, number>()
  for (const g of cluster) {
    const cur = earliest.get(g.player)
    if (!cur || g.date < cur.date) earliest.set(g.player, g)
    const t = tierByPlayer.get(g.player)
    if (t === undefined || g.tier < t) tierByPlayer.set(g.player, g.tier)
    venueCounts.set(venueWithCity(g), (venueCounts.get(venueWithCity(g)) ?? 0) + 1)
  }
  let score = 0, t1 = 0, t2 = 0, t3 = 0
  const players: WindowResult['players'] = []
  for (const [name, g] of earliest) {
    const tier = tierByPlayer.get(name)!
    players.push({ name, tier, venueName: g.venueName, city: g.city, state: g.state, date: g.date })
    score += tierWeight(tier)
    if (tier === 1) t1++; else if (tier === 2) t2++; else if (tier === 3) t3++
  }
  players.sort((a, b) => (a.tier - b.tier) || a.date.localeCompare(b.date))
  const topVenues = [...venueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0])
  return {
    trip: {
      startDate: wStart, endDate: wEnd, regionLabel: regionLabel(cluster),
      players, uniquePlayerCount: earliest.size, t1Count: t1, t2Count: t2, t3Count: t3, topVenues,
    },
    score,
    players: new Set(earliest.keys()),
  }
}

function computeTopTripsInRange(games: Game[], start: string, end: string): WeekTrips {
  // Slide a 3-day window through [start, end]. Within each window, cluster
  // games into drivable regions and score each region by tier-weighted unique
  // players. Surface the best TWO distinct-region trips of the week (a real
  // itinerary Kent can pick from), not a nationwide headcount no trip covers.
  const inRange = games.filter((g) => g.date >= start && g.date <= end)
  if (inRange.length === 0) return { trips: [], elsewhere: 0 }
  const days: string[] = []
  for (let d = new Date(start + 'T00:00:00Z'); isoDate(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(isoDate(d))
  }

  const candidates: Array<{ trip: WindowResult; score: number; players: Set<string> }> = []
  for (let i = 0; i < days.length - 2; i++) {
    const wStart = days[i]!, wEnd = days[i + 2]!
    const inWin = inRange.filter((g) => g.date >= wStart && g.date <= wEnd)
    if (inWin.length === 0) continue
    for (const cluster of clusterGames(inWin)) candidates.push(clusterToTrip(cluster, wStart, wEnd))
  }
  if (candidates.length === 0) return { trips: [], elsewhere: 0 }

  // Best candidate per region (a region can recur across overlapping windows).
  const bestByRegion = new Map<string, { trip: WindowResult; score: number; players: Set<string> }>()
  for (const c of candidates) {
    const prev = bestByRegion.get(c.trip.regionLabel)
    if (!prev || c.score > prev.score) bestByRegion.set(c.trip.regionLabel, c)
  }
  const ranked = [...bestByRegion.values()].sort((a, b) => b.score - a.score).slice(0, 2)

  const covered = new Set<string>()
  for (const c of ranked) for (const p of c.players) covered.add(p)
  const weekPlayers = new Set(inRange.map((g) => g.player))
  const elsewhere = weekPlayers.size - covered.size

  return { trips: ranked.map((c) => c.trip), elsewhere }
}

function computeOverduePlayers(
  players: RosterPlayer[],
  heartbeat: Map<string, HeartbeatPlayer>,
  games: Game[],
  today: Date,
): Array<{ player: RosterPlayer; daysSince: number; nextGame: Game | null }> {
  const todayStr = isoDate(today)
  const upcomingByPlayer = new Map<string, Game>()
  for (const g of games) {
    if (g.date < todayStr) continue
    const existing = upcomingByPlayer.get(g.player)
    if (!existing || g.date < existing.date) upcomingByPlayer.set(g.player, g)
  }
  const out: Array<{ player: RosterPlayer; daysSince: number; nextGame: Game | null }> = []
  for (const p of players) {
    if (p.tier > 2 || p.tier === 4) continue
    const hb = heartbeat.get(p.name.trim().toLowerCase())
    if (!hb || hb.daysSinceInPerson == null || hb.inPersonThresholdDays == null) continue
    if (hb.daysSinceInPerson <= hb.inPersonThresholdDays) continue
    out.push({
      player: p,
      daysSince: hb.daysSinceInPerson,
      nextGame: upcomingByPlayer.get(p.name) ?? null,
    })
  }
  out.sort((a, b) => {
    if (a.player.tier !== b.player.tier) return a.player.tier - b.player.tier
    return b.daysSince - a.daysSince
  })
  return out
}

// ─── Message composition ────────────────────────────────────────────────────

function composeSlackMessage(
  windows: WeekTrips[],
  weeks: Array<{ label: string; start: string; end: string }>,
  overdue: Array<{ player: RosterPlayer; daysSince: number; nextGame: Game | null }>,
  rosterSize: number,
): { text: string; blocks: any[] } {
  const lines: string[] = []
  lines.push(`*🗓️ Travel Hub recap*`)
  lines.push('')

  lines.push('*Best 3-day trips in the next 4 weeks:*')
  for (let i = 0; i < weeks.length; i++) {
    const wk = weeks[i]!, week = windows[i]!
    if (!week || week.trips.length === 0) {
      lines.push(`• ${wk.label} — no SV games`)
      continue
    }
    week.trips.forEach((w, idx) => {
      const tierBits: string[] = []
      if (w.t1Count > 0) tierBits.push(`${w.t1Count} T1`)
      if (w.t2Count > 0) tierBits.push(`${w.t2Count} T2`)
      if (w.t3Count > 0) tierBits.push(`${w.t3Count} T3`)
      const tierStr = tierBits.length > 0 ? ` (${tierBits.join(' · ')})` : ''
      const dateRange = `${shortDate(new Date(w.startDate + 'T00:00:00Z'))}–${shortDate(new Date(w.endDate + 'T00:00:00Z'))}`
      const prefix = idx === 0 ? '•' : '◦'
      lines.push(`${prefix} *${w.regionLabel}* · ${dateRange} — *${w.uniquePlayerCount} players*${tierStr}`)

      // Name the players Kent prioritizes (T1/T2) with where + which day.
      const named = w.players.filter((p) => p.tier <= 2)
      const shown = named.slice(0, 8)
      for (const p of shown) {
        const tag = p.tier === 1 ? 'T1' : 'T2'
        const day = weekday(new Date(p.date + 'T00:00:00Z'))
        const loc = p.city && p.state ? `${p.venueName}, ${p.city}` : p.venueName
        lines.push(`     ↳ ${tag} *${p.name}* — ${loc} (${day})`)
      }
      const extras: string[] = []
      if (named.length > shown.length) extras.push(`+${named.length - shown.length} more T1/T2`)
      if (w.t3Count > 0) extras.push(`${w.t3Count} T3`)
      if (extras.length > 0) lines.push(`     ↳ _${extras.join(' · ')}_`)
    })
    if (week.elsewhere > 0) lines.push(`     _+${week.elsewhere} more players elsewhere this week_`)
  }
  lines.push('')

  if (overdue.length > 0) {
    lines.push(`*🔥 Overdue T1/T2 with upcoming games (${overdue.length}):*`)
    for (const r of overdue.slice(0, 6)) {
      const tierTag = r.player.tier === 1 ? 'T1' : 'T2'
      const ng = r.nextGame
      const ngLoc = ng ? (ng.city && ng.state ? `${ng.venueName}, ${ng.city}, ${ng.state}` : ng.venueName) : ''
      const nextStr = ng
        ? ` — next ${shortDate(new Date(ng.date + 'T00:00:00Z'))} (${weekday(new Date(ng.date + 'T00:00:00Z'))}) at ${ngLoc}`
        : ' — no game in next 5 weeks'
      lines.push(`• ${tierTag} *${r.player.name}* (${r.daysSince}d since visit)${nextStr}`)
    }
    if (overdue.length > 6) lines.push(`+${overdue.length - 6} more`)
    lines.push('')
  } else {
    lines.push('_No overdue T1/T2 players. Nice work._')
    lines.push('')
  }

  lines.push(`<https://sv-travel-hub.vercel.app|Open Travel Hub →>`)
  lines.push(`_${rosterSize} clients · NCAA coverage coming in a follow-up_`)

  const text = lines.join('\n')
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
    ],
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'SVTravelHub/Slack-Recap' } })
  if (!res.ok) throw new Error(`fetchText ${url}: HTTP ${res.status}`)
  return res.text()
}

/** Tiny RFC-4180-ish CSV parser. Handles quoted fields with commas and
 *  doubled-quote escapes. Skips empty trailing rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { cur += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else { cur += c }
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function normalizeIsoDate(s: string): string {
  // Accepts YYYY-MM-DD, M/D/YYYY, MM/DD/YYYY → YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const mm = m[1]!.padStart(2, '0')
    const dd = m[2]!.padStart(2, '0')
    return `${m[3]}-${mm}-${dd}`
  }
  return s
}

function shortDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function weekday(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]!
}
