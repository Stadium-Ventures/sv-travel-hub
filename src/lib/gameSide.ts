import type { GameEvent } from '../types/schedule'

// Which side of a game a tracked player is on.
//
// GameEvent.isHome is the side of whichever team's schedule produced the
// event. When two clients' clubs meet, the same game appears in both
// schedules and mergeEventPlayers keeps the FIRST event's isHome while
// merging the second club's players in, so for them isHome is backwards.
// playerSides carries the truth per player; read it through these helpers
// instead of game.isHome wherever a name is known (audit 2026-09-18: the
// Arizona Fall League makes head-to-head games weekly).

export type Side = 'home' | 'away'

export function sideFor(game: GameEvent, playerName?: string): Side {
  if (playerName) {
    const s = game.playerSides?.[playerName]
    if (s) return s
  }
  return game.isHome ? 'home' : 'away'
}

export function isHomeFor(game: GameEvent, playerName?: string): boolean {
  return sideFor(game, playerName) === 'home'
}

/** The club the player is on for this game. */
export function teamFor(game: GameEvent, playerName?: string): string {
  return isHomeFor(game, playerName) ? game.homeTeam : game.awayTeam
}

/** The club the player faces in this game. */
export function opponentFor(game: GameEvent, playerName?: string): string {
  return isHomeFor(game, playerName) ? game.awayTeam : game.homeTeam
}

/** True when tracked players sit on both sides of this game. */
export function isHeadToHead(game: GameEvent): boolean {
  const sides = new Set(Object.values(game.playerSides ?? {}))
  return sides.size > 1
}

/** "vs X" / "@ X" for one player, or the neutral "Away at Home" when the
 *  label describes a game with clients on both sides and no single player. */
export function matchupLabel(game: GameEvent, playerName?: string): string | undefined {
  if (!game.homeTeam && !game.awayTeam) return undefined
  if (!playerName && isHeadToHead(game)) return `${game.awayTeam} at ${game.homeTeam}`
  const home = isHomeFor(game, playerName)
  if (home) return game.awayTeam ? `vs ${game.awayTeam}` : undefined
  return game.homeTeam ? `@ ${game.homeTeam}` : undefined
}
