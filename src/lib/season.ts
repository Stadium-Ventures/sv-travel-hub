// The Pro schedule window: every date range the app asks the MLB Stats API
// for when it pulls a Pro client's games.
//
// Pro schedules are NOT static. They are fetched live and re-checked daily as
// players bounce between affiliates. What has to be fixed is the calendar
// window we ask for, and it has to cover everything a Pro client can appear
// in: spring training (first games early March) through the Arizona Fall
// League championship (mid-November). MLB postseason ends Oct 31.
//
// Why a constant and not the API's season endpoint: /seasons?sportId=17 is a
// shared winter-league bucket that runs into February (Caribbean Series), so
// there is no single call that returns "the AFL ends here". One constant in
// one place beats the seven copies of "03-01"/"09-30" this replaced
// (Tom, 2026-09-18).
export const PRO_SEASON_START_MD = '03-01'
export const PRO_SEASON_END_MD = '11-30'

/** Arizona Fall League sport id in the MLB Stats API. */
export const AFL_SPORT_ID = 17

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]!
}

/** Full Pro fetch window for the current calendar year. */
export function proSeasonWindow(now: Date = new Date()): { start: string; end: string } {
  const y = now.getFullYear()
  return { start: `${y}-${PRO_SEASON_START_MD}`, end: `${y}-${PRO_SEASON_END_MD}` }
}

/** "Rest of season" end date: this year's end, or next year's once we're
 *  past it (December). */
export function restOfSeasonEnd(now: Date = new Date()): string {
  const { end } = proSeasonWindow(now)
  return toISO(now) <= end ? end : `${now.getFullYear() + 1}-${PRO_SEASON_END_MD}`
}

/** AFL rosters are published in early September and the league wraps
 *  mid-November. Outside this window there is nothing to match against, and
 *  stale fall assignments must not leak into the next spring. */
export function isAflSeason(now: Date = new Date()): boolean {
  const m = now.getMonth() + 1
  return m >= 9 && m <= 11
}
