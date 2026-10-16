// HOOK: the college (NCAA) next-season schedule check plugs in here.
//
// The old version searched each client school's D1Baseball page for game
// links dated in the upcoming season. D1Baseball now loads schedules with
// JavaScript, so that search would have found nothing and flagged every
// school every December. It was removed (2026-10-16).
//
// The new NCAA schedule source brings its own check. Wire it in by replacing
// the body below; the monitor already runs this on its weekly pass (Mondays,
// or ?force=1) and re-checks any partial finding before posting. Window and
// wording are this function's job: return [] outside its season window, and
// write findings to the plain-English contract in monitorCopy.ts (mark a
// finding `partial: true` when it covers only some schools, so a one-off blip
// never posts).
import type { CheckContext, Finding } from './monitorTypes.js'

export async function ncaaSeasonCheck(_ctx: CheckContext): Promise<Finding[]> {
  return []
}
