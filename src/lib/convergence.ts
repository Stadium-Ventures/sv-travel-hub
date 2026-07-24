import type { GameEvent } from '../types/schedule'
import { haversineKm, estimateDriveMinutes } from './tripEngine'

/**
 * Convergence scan — answers Kent's "west coast swing" question: given 2+
 * priority players and a (possibly season-long) date range, find the
 * tightest windows where EVERY one of them has a game reachable as one
 * multi-stop swing. This deliberately relaxes the single-trip rules (3-day
 * cap, one anchor area): a swing is a sequence of drive hops between stops,
 * ordered by date. Pairwise double ups stay the domain of doubleUps.ts —
 * this is the all-N generalization.
 */

export interface ConvergenceStop {
  /** Priority players covered by this game (2+ when one game covers several) */
  playerNames: string[]
  date: string
  time: string
  source: GameEvent['source']
  venueName: string
  coords: { lat: number; lng: number }
  gameId: string
  homeTeam: string
  awayTeam: string
}

export interface ConvergenceWindow {
  startDate: string
  endDate: string
  spanDays: number
  /** Date-ordered stops, one per game (a shared game is one stop) */
  stops: ConvergenceStop[]
  /** Drive minutes between consecutive stops (length = stops.length - 1) */
  hopMinutes: number[]
  maxHopMinutes: number
  totalDriveMinutes: number
  /** True when every between-day hop fits maxHopMinutes. False windows are
   *  still returned — Tom 2026-07-24: "it's helpful to surface the closest
   *  opportunities even if they never overlap" — the UI labels them as the
   *  closest the schedules come, not as a doable swing. */
  feasible: boolean
}

export interface ConvergenceOptions {
  /** Longest allowed swing, first game to last, in days (default 5) */
  maxSpanDays?: number
  /** Max drive between stops on DIFFERENT days for a window to count as
   *  feasible (default 360 — pass the user's Drive chip value so the swing
   *  obeys the same range as trips). Longer hops don't drop the window,
   *  they mark it feasible: false. */
  maxHopMinutes?: number
  /** Max drive between stops on the SAME day — the double-up viability cap
   *  (default 120, matching doubleUps.ts) */
  sameDayHopMinutes?: number
  /** How many distinct windows to return (default 3) */
  limit?: number
}

const DEFAULTS = { maxSpanDays: 5, maxHopMinutes: 360, sameDayHopMinutes: 120, limit: 3 }
/** Candidate games per player around each anchor date. Keeps the combo
 *  product bounded (≤6^4 per anchor at 5 priority players). */
const MAX_CANDIDATES = 6

function isPlayable(g: GameEvent, startDate: string, endDate: string): boolean {
  return (
    g.date >= startDate && g.date <= endDate &&
    g.gameStatus !== 'Cancelled' && g.gameStatus !== 'Postponed'
  )
}

/** Priority players with zero games in the range — a convergence is
 *  impossible and the UI must say WHY, not show an empty result. */
export function playersWithoutGames(
  allGames: GameEvent[],
  playerNames: string[],
  startDate: string,
  endDate: string,
): string[] {
  const withGames = new Set<string>()
  for (const g of allGames) {
    if (!isPlayable(g, startDate, endDate)) continue
    for (const n of g.playerNames) if (playerNames.includes(n)) withGames.add(n)
  }
  return playerNames.filter((n) => !withGames.has(n))
}

export function findConvergenceWindows(
  allGames: GameEvent[],
  playerNames: string[],
  startDate: string,
  endDate: string,
  options: ConvergenceOptions = {},
): ConvergenceWindow[] {
  const { maxSpanDays, maxHopMinutes, sameDayHopMinutes, limit } = { ...DEFAULTS, ...options }
  if (playerNames.length < 2) return []

  // Per-player playable games, date-sorted
  const gamesByPlayer = playerNames.map((name) =>
    allGames
      .filter((g) => isPlayable(g, startDate, endDate) && g.playerNames.includes(name))
      .sort((a, b) => a.date.localeCompare(b.date)),
  )
  if (gamesByPlayer.some((gs) => gs.length === 0)) return []

  // Anchor on the player with the FEWEST games — every valid combo contains
  // one of their games, so windows around each of those games cover the
  // whole search space without a full cartesian over the season.
  let rarestIdx = 0
  for (let i = 1; i < gamesByPlayer.length; i++) {
    if (gamesByPlayer[i]!.length < gamesByPlayer[rarestIdx]!.length) rarestIdx = i
  }
  const otherIdxs = playerNames.map((_, i) => i).filter((i) => i !== rarestIdx)

  const windows: ConvergenceWindow[] = []
  for (const anchor of gamesByPlayer[rarestIdx]!) {
    // Each other player's nearest-in-time games around the anchor
    const candidateLists = otherIdxs.map((pi) =>
      gamesByPlayer[pi]!
        .filter((g) => Math.abs(daysBetween(anchor.date, g.date)) <= maxSpanDays - 1)
        .sort((a, b) => Math.abs(daysBetween(anchor.date, a.date)) - Math.abs(daysBetween(anchor.date, b.date)))
        .slice(0, MAX_CANDIDATES),
    )
    if (candidateLists.some((l) => l.length === 0)) continue

    for (const combo of cartesian(candidateLists)) {
      const w = buildWindow(anchor, rarestIdx, combo, otherIdxs, playerNames, {
        maxSpanDays, maxHopMinutes, sameDayHopMinutes,
      })
      if (w) windows.push(w)
    }
  }

  // Doable swings first, then tightest cluster, then shortest swing, then
  // least total driving, then soonest. A series produces near-identical
  // combos on many dates — collapse to the best window per venue set.
  windows.sort(
    (a, b) =>
      Number(b.feasible) - Number(a.feasible) ||
      a.maxHopMinutes - b.maxHopMinutes ||
      a.spanDays - b.spanDays ||
      a.totalDriveMinutes - b.totalDriveMinutes ||
      a.startDate.localeCompare(b.startDate),
  )
  const seen = new Set<string>()
  const out: ConvergenceWindow[] = []
  for (const w of windows) {
    const key = w.stops.map((s) => s.venueName).sort().join('~')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
    if (out.length >= limit) break
  }
  return out
}

function buildWindow(
  anchor: GameEvent,
  anchorIdx: number,
  combo: GameEvent[],
  otherIdxs: number[],
  playerNames: string[],
  caps: { maxSpanDays: number; maxHopMinutes: number; sameDayHopMinutes: number },
): ConvergenceWindow | null {
  // One game covering several priority players is ONE stop (e.g. a
  // head-to-head matchup) — dedupe by game id.
  const byGame = new Map<string, { game: GameEvent; players: string[] }>()
  const add = (g: GameEvent, name: string) => {
    const entry = byGame.get(g.id) ?? { game: g, players: [] }
    if (!entry.players.includes(name)) entry.players.push(name)
    byGame.set(g.id, entry)
  }
  add(anchor, playerNames[anchorIdx]!)
  combo.forEach((g, i) => add(g, playerNames[otherIdxs[i]!]!))

  const stops: ConvergenceStop[] = [...byGame.values()]
    .map(({ game, players }) => ({
      playerNames: players,
      date: game.date,
      time: game.time,
      source: game.source,
      venueName: game.venue.name,
      coords: game.venue.coords,
      gameId: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || startMillis(a) - startMillis(b))

  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const spanDays = daysBetween(first.date, last.date) + 1
  if (spanDays > caps.maxSpanDays) return null

  const hopMinutes: number[] = []
  let feasible = true
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!
    const b = stops[i]!
    const hop = haversineKm(a.coords, b.coords) < 1 ? 0 : estimateDriveMinutes(a.coords, b.coords)
    if (a.date === b.date) {
      // Two different players' games on the SAME day beyond double-up range
      // can't both be attended — this combo is physically impossible, not
      // merely far. (Another date combo for the same players may still work.)
      if (hop > Math.min(caps.sameDayHopMinutes, caps.maxHopMinutes)) return null
    } else if (hop > caps.maxHopMinutes) {
      // Long between-day hops stay in as INFEASIBLE — the closest the
      // schedules come is information Kent wants even when it's a bad drive.
      feasible = false
    }
    hopMinutes.push(hop)
  }

  return {
    startDate: first.date,
    endDate: last.date,
    spanDays,
    stops,
    hopMinutes,
    maxHopMinutes: hopMinutes.length > 0 ? Math.max(...hopMinutes) : 0,
    totalDriveMinutes: hopMinutes.reduce((s, m) => s + m, 0),
    feasible,
  }
}

/** Same non-MLB-sorts-last convention as DoubleUpSection.byStartTime. */
function startMillis(s: { time: string; source: GameEvent['source'] }): number {
  if (s.source !== 'mlb-api') return Infinity
  const t = new Date(s.time).getTime()
  return isNaN(t) ? Infinity : t
}

function cartesian<T>(lists: T[][]): T[][] {
  let combos: T[][] = [[]]
  for (const list of lists) {
    const next: T[][] = []
    for (const combo of combos) for (const item of list) next.push([...combo, item])
    combos = next
  }
  return combos
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000,
  )
}
