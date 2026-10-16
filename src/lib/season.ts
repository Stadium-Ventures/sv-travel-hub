// The Pro schedule window: every date range the app asks the MLB Stats API
// for when it pulls a Pro client's games.
//
// Pro schedules are NOT static. They are fetched live and re-checked daily as
// players bounce between affiliates. What has to be fixed is the calendar
// window we ask for, and it has to cover everything a Pro client can appear
// in: spring training (big-league camp games start around Feb 19) through
// the Arizona Fall League championship (mid-November). MLB postseason ends
// Oct 31.
//
// Why a constant and not the API's season endpoint: /seasons?sportId=17 is a
// shared winter-league bucket that runs into February (Caribbean Series), so
// there is no single call that returns "the AFL ends here". One constant in
// one place beats the seven copies of "03-01"/"09-30" this replaced
// (Tom, 2026-09-18).
import { SPRING_TRAINING_START } from '../data/springTraining'

/** Window start: the first day of spring training. Starting on Mar 1 used
 *  to drop every late-February camp game (158 of 465 in 2027). */
export const PRO_SEASON_START_MD = SPRING_TRAINING_START
export const PRO_SEASON_END_MD = '11-30'
/** Last day the app treats as the current Pro season: the day of the AFL
 *  championship. From the next day on, the window, the default date range
 *  and "Full season" all point at NEXT season, whose MLB and MiLB
 *  schedules are already published by then. */
export const PRO_SEASON_ROLLOVER_MD = '11-15'

/** Arizona Fall League sport id in the MLB Stats API. */
export const AFL_SPORT_ID = 17

function monthDay(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The season the app is planning for: this calendar year through the AFL
 *  championship, next year after it. */
export function proSeasonYear(now: Date = new Date()): number {
  const y = now.getFullYear()
  return monthDay(now) > PRO_SEASON_ROLLOVER_MD ? y + 1 : y
}

/** Full Pro fetch window for the season being planned. */
export function proSeasonWindow(now: Date = new Date()): { start: string; end: string } {
  const y = proSeasonYear(now)
  return { start: `${y}-${PRO_SEASON_START_MD}`, end: `${y}-${PRO_SEASON_END_MD}` }
}

/** "Rest of season" end date: the end of the season being planned, so the
 *  default range and the Pro fetch window always describe the same season. */
export function restOfSeasonEnd(now: Date = new Date()): string {
  return proSeasonWindow(now).end
}

/** AFL rosters are published in early September and the league wraps
 *  mid-November. Outside this window there is nothing to match against, and
 *  stale fall assignments must not leak into the next spring. */
export function isAflSeason(now: Date = new Date()): boolean {
  const m = now.getMonth() + 1
  return m >= 9 && m <= 11
}
