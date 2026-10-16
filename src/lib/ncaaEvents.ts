// Turns an NCAA school's published schedule into map/planner GameEvents:
// picks the ballpark for every game and labels fall exhibitions. Pure (no
// network, no storage) so it is unit-tested; ncaaSchedules.ts supplies the
// geocoded-place lookup and fetches.
//
// Where a game is played:
//   home at the usual park      → the school's ballpark from NCAA_VENUES
//   home somewhere else         → that place (showcases at big-league parks)
//   away                        → the opponent's ballpark, unless the site
//                                 prints a known neutral park instead
//   neutral                     → the printed park/city
// Places that aren't in the tables come back as `unresolved` for geocoding.

import type { NcaaSourceGame } from '../../api/_lib/ncaaSchedule'
import type { GameEvent } from '../types/schedule'
import type { Coordinates } from '../types/roster'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { NCAA_TEAM_ALIASES } from '../data/ncaaTeamAliases'
import { resolveNcaaName } from '../data/aliases'

export type NcaaScheduleOrigin = 'official' | 'sheet' | 'bundled'

/** One school's schedule as the app keeps it. */
export interface NcaaSchedule {
  school: string
  season: number
  origin: NcaaScheduleOrigin
  sourceUrl: string
  games: NcaaSourceGame[]
  fetchedAt: number
}

export interface Venue {
  name: string
  coords: Coordinates
}

/** A game whose place isn't known yet: geocode `query`, cache under `key`. */
export interface UnresolvedNcaaGame {
  school: string
  game: NcaaSourceGame
  key: string
  query: string
}

export type PlaceLookup = (key: string) => Venue | null

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** First part of "City, State": what two printed locations are compared on. */
export function cityOf(location: string): string {
  return norm(location.split(',')[0] ?? '')
}

/** Cache key for a printed place: the park when printed, else the city. */
export function placeKey(location: string, venueName: string): string {
  return venueName ? `${norm(venueName)}|${cityOf(location)}` : `|${norm(location)}`
}

/** The city a school plays most home games in, from its own schedule. */
export function homeCityOf(games: NcaaSourceGame[]): string {
  const counts = new Map<string, number>()
  for (const g of games) {
    if (g.side !== 'home' || !g.location) continue
    const c = cityOf(g.location)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = ''
  let n = 0
  for (const [c, k] of counts) if (k > n) { best = c; n = k }
  return best
}

const VENUE_KEYS_BY_NORM = new Map(Object.keys(NCAA_VENUES).map((k) => [norm(k).replace(/\bst\b/g, 'state'), k]))
const ALIASES_BY_NORM = new Map(Object.entries(NCAA_TEAM_ALIASES).map(([k, v]) => [norm(k), v]))

const VENUES_BY_PARK = new Map(Object.values(NCAA_VENUES).map((v) => [norm(v.venueName), v]))

/** A college ballpark by its printed name ("Sewell-Thomas Stadium"), for
 *  tournament and regional games one school hosts for others. */
export function resolveParkVenue(venueName: string): Venue | null {
  if (!venueName) return null
  const n = norm(venueName)
  const v = VENUES_BY_PARK.get(n)
    ?? [...VENUES_BY_PARK.entries()].find(([k]) => k.length > 8 && (n.includes(k) || k.includes(n)))?.[1]
  return v ? { name: v.venueName, coords: v.coords } : null
}

/** An opponent's home ballpark, if the team is in NCAA_VENUES. */
export function resolveTeamVenue(name: string): Venue | null {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const candidates = [
    resolveNcaaName(clean),
    ALIASES_BY_NORM.get(norm(clean)),
    NCAA_VENUES[clean] ? clean : null,
    VENUE_KEYS_BY_NORM.get(norm(clean).replace(/\bst\b/g, 'state').replace(/^(university of|the) /, '')),
  ]
  for (const key of candidates) {
    const v = key ? NCAA_VENUES[key] : undefined
    if (v) return { name: v.venueName, coords: v.coords }
  }
  return null
}

function slugPart(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-')
}

function describePlace(venue: string, location: string): string {
  return [venue, location].filter(Boolean).join(', ')
}

/** GameEvents for one school's games; games whose place still needs
 *  geocoding are returned in `unresolved` instead. Canceled and postponed
 *  games are left out: nobody plays on that date. */
export function ncaaScheduleToEvents(
  schedule: NcaaSchedule,
  playerNames: string[],
  places: PlaceLookup,
): { events: GameEvent[]; unresolved: UnresolvedNcaaGame[] } {
  const events: GameEvent[] = []
  const unresolved: UnresolvedNcaaGame[] = []
  const school = schedule.school
  const home = NCAA_VENUES[school]
  const homeCity = homeCityOf(schedule.games)
  const seen = new Map<string, number>()

  for (const game of schedule.games) {
    if (game.status === 'canceled' || game.status === 'postponed') continue

    const printed = describePlace(game.venueName, game.location)
    const key = placeKey(game.location, game.venueName)
    let venue: Venue | null = null
    let confidence: 'high' | 'medium' = 'high'
    let where = ''

    const namesHomePark = !!home && [game.venueName, game.location].some((t) => t && sharesWord(t, home.venueName))
    const atHomePark = game.side === 'home' && (namesHomePark || !game.location || !homeCity || cityOf(game.location) === homeCity)
    if (atHomePark && home) {
      venue = { name: home.venueName, coords: home.coords }
    } else if (game.side === 'away') {
      // "Away" also covers games where the school is the designated visitor
      // at a neutral park (Texas "at" Virginia at Globe Life Field), so a
      // printed park that isn't the opponent's wins over the opponent's.
      // A park name that differs from our table can also just be a rename,
      // so a printed park within 25 km of the opponent's counts as theirs.
      const opp = resolveTeamVenue(game.opponent)
      const printedPark = game.venueName ? resolveParkVenue(game.venueName) : null
      const place = printedPark ?? places(key) ?? (game.venueName ? places(placeKey(game.location, '')) : null)
      const elsewhere = !!opp && !!game.venueName && !sharesWord(game.venueName, opp.name) &&
        !(place && distanceKm(place.coords, opp.coords) < 25)
      if (opp && !elsewhere) {
        venue = opp
        where = `at ${game.opponent}`
      } else {
        venue = place
        confidence = 'medium'
        where = printed ? `at ${printed}` : `at ${game.opponent}`
      }
    } else {
      // Neutral sites and home games away from the usual park.
      venue = resolveParkVenue(game.venueName) ?? resolveParkVenue(game.location) ?? places(key) ?? (game.venueName ? places(placeKey(game.location, '')) : null)
      confidence = 'medium'
      where = game.side === 'neutral' ? `Neutral site: ${printed || 'location not listed'}` : `Home game played at ${printed}`
    }

    if (!venue) {
      // "Location TBD" can't be looked up; the game appears once the site
      // names the place.
      const tbd = /\b(TBD|TBA|to be determined|to be announced)\b/i.test(printed)
      if (!tbd && (printed || game.side === 'away')) {
        unresolved.push({
          school,
          game,
          key: printed ? key : `team|${norm(game.opponent)}`,
          query: printed || `${game.opponent} baseball`,
        })
      }
      continue
    }

    const baseId = `ncaa-${slugPart(school)}-${game.date}-${slugPart(game.opponent)}`
    const n = (seen.get(baseId) ?? 0) + 1
    seen.set(baseId, n)
    const isHome = game.side !== 'away'
    const label = game.exhibition ? 'Fall exhibition. ' : ''
    const origin = schedule.origin === 'sheet' ? ' (from the Client Game Schedule sheet)'
      : schedule.origin === 'bundled' ? ' (from a saved copy)' : ''
    const note = (game.side === 'home' && atHomePark
      ? `${label}Home game`
      : `${label}${where.charAt(0).toUpperCase()}${where.slice(1)}`) + origin

    events.push({
      id: n === 1 ? baseId : `${baseId}-g${n}`,
      date: game.date,
      dayOfWeek: new Date(game.date + 'T12:00:00Z').getUTCDay(),
      time: game.startTime ?? `${game.date}T14:00:00Z`,
      homeTeam: isHome ? school : game.opponent,
      awayTeam: isHome ? game.opponent : school,
      isHome,
      venue,
      source: 'ncaa-lookup',
      playerNames: [...playerNames],
      // Only the live official schedule counts as confirmed.
      confidence: schedule.origin === 'official' ? confidence : 'medium',
      confidenceNote: note,
      sourceUrl: schedule.sourceUrl || undefined,
    })
  }
  return { events, unresolved }
}

function distanceKm(a: Coordinates, b: Coordinates): number {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** True when two ballpark names share a distinctive word ("Kingsmore"). */
export function sharesWord(a: string, b: string): boolean {
  const stop = new Set(['field', 'park', 'stadium', 'ballpark', 'baseball', 'the', 'at', 'and', 'of', 'complex', 'sports'])
  const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 2 && !stop.has(w))
  const bw = new Set(words(b))
  return words(a).some((w) => bw.has(w))
}
