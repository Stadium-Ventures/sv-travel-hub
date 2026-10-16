// Where each NCAA school's baseball schedule is read from: the school's own
// official athletics site. Shared by the serverless schedule endpoint
// (api/ncaa-schedules.ts), the health monitor and scripts/generateSchedules.ts.
//
// Why not D1Baseball any more: since fall 2026 its team schedule pages load
// the schedule with JavaScript ("Loading schedule..."), so the HTML has no
// games in it. The official sites still publish the schedule in plain HTML.
//
// Two platforms cover every school here:
//   sidearm  SIDEARM Sports sites. The newer sites publish a text-only table
//            at /sports/baseball/schedule/text/{season}; older ones publish the
//            same table as the grid view of /sports/baseball/schedule/{season}.
//            Both are tried, in that order, so a site that migrates keeps working.
//   wmt      WMT Digital sites. The schedule page is server-rendered HTML at
//            /sports/{sport}/schedule/ (the current season), with past seasons
//            at /schedule/season/{slug}/ where slug is "2026" or "2025-26".
//
// Only public schedule pages are read: no JSON or AJAX endpoints, and every
// path used here is allowed by the site's robots.txt (checked again at fetch
// time). Verified against the 2026 season on 2026-10-16.

export type NcaaSourcePlatform = 'sidearm' | 'wmt'

export interface NcaaScheduleSource {
  platform: NcaaSourcePlatform
  /** Athletics site host, no scheme. */
  host: string
  /** Sport path segment; WMT sites differ ("baseball" vs "m-basebl"). */
  sport: string
}

const sidearm = (host: string): NcaaScheduleSource => ({ platform: 'sidearm', host, sport: 'baseball' })
const wmt = (host: string, sport = 'baseball'): NcaaScheduleSource => ({ platform: 'wmt', host, sport })

/** Canonical school name (same keys as NCAA_ALIASES) → schedule source. */
export const NCAA_SCHEDULE_SOURCES: Record<string, NcaaScheduleSource> = {
  'Texas': sidearm('texaslonghorns.com'),
  'Coastal Carolina': sidearm('goccusports.com'),
  'Florida': sidearm('floridagators.com'),
  'Florida State': sidearm('seminoles.com'),
  'Georgia Tech': wmt('ramblinwreck.com', 'm-basebl'),
  'Virginia': wmt('virginiasports.com'),
  'South Carolina': wmt('gamecocksonline.com'),
  'Alabama': sidearm('rolltide.com'),
  'Vanderbilt': wmt('vucommodores.com'),
  'Wake Forest': sidearm('godeacs.com'),
  'SE Louisiana': sidearm('lionsports.net'),
  'Mercer': sidearm('mercerbears.com'),
  'FIU': sidearm('fiusports.com'),
  'UCF': wmt('ucfknights.com'),
  'Auburn': wmt('auburntigers.com'),
  'Ohio State': sidearm('ohiostatebuckeyes.com'),
  'Southern Miss': sidearm('southernmiss.com'),
  'Fordham': sidearm('fordhamsports.com'),
  'Michigan': sidearm('mgoblue.com'),
  'USF': sidearm('gousfbulls.com'),
  'Duke': sidearm('goduke.com'),
  'North Carolina': sidearm('goheels.com'),
  'Rutgers': sidearm('scarletknights.com'),
  'Sacramento State': sidearm('hornetsports.com'),
  'Saint Josephs': sidearm('sjuhawks.com'),
  'Tulane': sidearm('tulanegreenwave.com'),
  'Tennessee': sidearm('utsports.com'),
  'Hawaii': sidearm('hawaiiathletics.com'),
  'Clemson': wmt('clemsontigers.com'),
  'Dartmouth': sidearm('dartmouthsports.com'),
  'Houston': sidearm('uhcougars.com'),
  'Ole Miss': sidearm('olemisssports.com'),
  'Stetson': sidearm('gohatters.com'),
  'Texas A&M': wmt('12thman.com'),
  'UCLA': wmt('uclabruins.com'),
  'Georgia': sidearm('georgiadogs.com'),
  'Kentucky': wmt('ukathletics.com'),
  'Miami': wmt('miamihurricanes.com'),
  'Portland': sidearm('portlandpilots.com'),
  'South Alabama': sidearm('usajaguars.com'),
}

/** Schools with no public schedule page the server can read, and why. Their
 *  games come from the Client Game Schedule sheet (src/lib/ncaaSheetGames.ts).
 *  Re-check now and then: a fix on the school's side makes them readable. */
export const NCAA_NO_PUBLIC_SOURCE: Record<string, string> = {
  'Notre Dame': 'fightingirish.com builds its schedule in the browser, so the page the server receives has no games in it.',
  'Dallas Baptist': 'dbupatriots.com sends an incomplete security certificate chain, so the server cannot verify the site.',
}
