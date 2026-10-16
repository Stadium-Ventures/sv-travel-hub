// The college (NCAA) schedule check: every client school's schedule source
// still reads (Sep 1 to Nov 30 for fall ball, Jan 15 to Jun 30 for the
// season), and a school with no readable source has games in the Client Game
// Schedule sheet. Runs daily; the window and wording live in ncaaHealth.ts.
//
// Replaced the D1Baseball search (2026-10-16): D1Baseball now loads
// schedules with JavaScript, so that search found nothing and would have
// flagged every school every December.
import type { CheckContext, Finding } from './monitorTypes.js'
import { checkNcaaSchedules } from './ncaaHealth.js'
import { resolveNcaaName } from '../_data/ncaaSchools.js'

export interface NcaaCheckContext extends CheckContext {
  /** The published Client Game Schedule sheet, when the monitor has it. */
  scheduleSheet?: () => Promise<{ ok: boolean; text?: string | null } | null>
}

const INACTIVE = /retired|free agent/i

export async function ncaaSeasonCheck(ctx: NcaaCheckContext): Promise<Finding[]> {
  const roster = await ctx.roster()
  if (!roster.ok) return []
  const schools = [...new Set(
    roster.clients
      .filter((c) => c.level === 'NCAA' && !c.isCoach && !INACTIVE.test(c.status))
      .map((c) => resolveNcaaName(c.org))
      .filter((s): s is string => !!s),
  )]
  if (schools.length === 0) return []
  const sheet = ctx.scheduleSheet ? await ctx.scheduleSheet() : null
  const found = await checkNcaaSchedules(ctx.now, {
    schools,
    sheetCsvText: sheet?.ok ? sheet.text ?? undefined : undefined,
  })
  // Partial: a school's site can blip, so each school must fail on both
  // passes before it posts. On the re-check pass keep only schools seen twice.
  const out: Finding[] = []
  for (const f of found) {
    const issueKeys = f.schools.map((s) => `ncaa:${f.kind}:${s}`)
    const kept = ctx.confirmKeys ? issueKeys.filter((k) => ctx.confirmKeys!.has(k)) : issueKeys
    if (kept.length === 0) continue
    out.push({
      key: `ncaa:${f.kind}`,
      severity: f.severity,
      code: f.code,
      title: f.title,
      what: f.what,
      how: f.how,
      todo: f.todo,
      partial: true,
      issueKeys: kept,
    })
  }
  return out
}
