// Every #sv-automation message the daily health monitor can send, in one
// place, so the wording can be read and tested together.
//
// The contract (Tom, 2026-05-28 and since): a non-engineer reads each one
// cold on a phone. One status emoji per message, the product label up front,
// then three lines: What broke / How we know / What to do. No code names,
// setting names, status codes, thresholds or file paths; links are fine.
// Each finding is tagged 🛠️ Code change or 👤 Manual.
// api/_lib/__tests__/monitorCopy.test.ts checks every builder here.
import { joinList, plural } from './csv.js'
import type { Finding, MonitorCheck } from './monitorTypes.js'

export const PRODUCT = 'Travel Hub (sv-travel-hub)'
export const VERCEL_ENV_URL = 'https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables'
export const VERCEL_LOGS_URL = 'https://vercel.com/stadium-ventures/sv-travel-hub/logs'
const HEARTBEAT_URL = 'https://sv-heartbeat.vercel.app'
const REGISTRY_URL = 'https://sv-registry.vercel.app'
const NO_ROSTER = "Travel Hub's daily checks can't read the client roster, so today's client coverage checks didn't run."

type Sev = Finding['severity']

function f(key: string, severity: Sev, code: boolean, title: string, what: string, how: string, todo: string, partial = false): Finding {
  return partial ? { key, severity, code, title, what, how, todo, partial } : { key, severity, code, title, what, how, todo }
}

/** "May 30, 2026" from YYYY-MM-DD; anything else unchanged. */
export function humanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`
}

// ─── The message ─────────────────────────────────────────────────────────────

function tag(x: Finding): string {
  return x.code ? '🛠️ Code change' : '👤 Manual'
}

/** One Slack message for all of a run's findings. One status emoji (red if
 *  anything is critical, else yellow), critical findings first. */
export function buildMessage(findings: Finding[]): string {
  const sorted = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
  const emoji = sorted.some((x) => x.severity === 'critical') ? '🔴' : '🟡'
  if (sorted.length === 1) {
    const x = sorted[0]!
    return [
      `${emoji} *${PRODUCT}: ${x.title}*  ${tag(x)}`,
      `*What broke:* ${x.what}`,
      `*How we know:* ${x.how}`,
      `*What to do:* ${x.todo}`,
    ].join('\n')
  }
  const lines = [`${emoji} *${PRODUCT}: ${sorted.length} problems*`, '']
  for (const x of sorted) {
    lines.push(`*${x.title}*  ${tag(x)}`)
    lines.push(`*What broke:* ${x.what}`)
    lines.push(`*How we know:* ${x.how}`)
    lines.push(`*What to do:* ${x.todo}`)
    lines.push('')
  }
  const code = sorted.filter((x) => x.code).length
  if (code > 0) lines.push(`${code} of ${sorted.length} need a code change: open sv-travel-hub in Claude Code.`)
  else lines.pop()
  return lines.join('\n')
}

// ─── The monitor itself ──────────────────────────────────────────────────────

export function wiringTest(): Finding {
  return f('wiring-test', 'warning', false,
    'Wiring test, please ignore',
    'Nothing. Someone ran a manual test of this alert.',
    'The health check was opened by hand with its test switch.',
    'Nothing to do. This confirms Travel Hub can post here.')
}

export function monitorCrashed(): Finding {
  return f('monitor-crashed', 'critical', true,
    'The daily health check crashed',
    "Travel Hub's daily health check stopped before it finished, so today's problems, if any, went unchecked.",
    'The run hit an unexpected error. The details are in the Vercel logs for this run.',
    `Open sv-travel-hub in Claude Code and ask it to look at today's health check error in the Vercel logs (${VERCEL_LOGS_URL}).`)
}

/** A check that ran too long or threw, on both passes. */
export function checkDidNotFinish(check: Pick<MonitorCheck, 'name' | 'label'>, kind: 'timeout' | 'error'): Finding {
  return kind === 'timeout'
    ? f(`timeout:${check.name}`, 'warning', false,
      `The ${check.label} check didn't finish`,
      `Today's ${check.label} check ran too long and was stopped, so nobody knows yet whether that part of Travel Hub is working.`,
      'It was tried twice this morning and was still waiting on an outside service both times.',
      'Usually a slow outside service that clears by itself. If this shows up again tomorrow, open sv-travel-hub in Claude Code and ask it to look at the health check.',
      true)
    : f(`error:${check.name}`, 'warning', true,
      `The ${check.label} check hit an error`,
      `Today's ${check.label} check stopped with an error, so nobody knows yet whether that part of Travel Hub is working.`,
      'It failed on both tries this morning. The details are in the Vercel logs for this run.',
      `Open sv-travel-hub in Claude Code and ask it to look at the health check error in the Vercel logs (${VERCEL_LOGS_URL}).`,
      true)
}

// ─── Weekly recap (only checked while the recap runs) ────────────────────────

export const recap = {
  slackMissing: () => f('recap:slack-missing', 'critical', false,
    "The weekly recap can't post",
    'The Monday trip recap has no Slack sign-in, so it would not post to #travel-schedule.',
    "The recap's Slack bot token or channel is missing from Travel Hub's settings on Vercel.",
    `Add the SV Travel Hub Slack app's bot token and the #travel-schedule channel in Vercel (${VERCEL_ENV_URL}), then redeploy.`),
  misrouted: () => f('recap:misrouted', 'critical', false,
    'The weekly recap is aimed at the alerts channel',
    'The Monday trip recap is set to post in #sv-automation instead of #travel-schedule.',
    "The recap's channel setting on Vercel points at this alerts channel.",
    `Change the recap's channel in Vercel (${VERCEL_ENV_URL}) to #travel-schedule (channel id C08CMDN82CT), redeploy, then re-run the recap from the hub's admin button.`),
  tokenDead: () => f('recap:token', 'critical', false,
    "The weekly recap's Slack sign-in stopped working",
    "Slack no longer accepts the recap's bot token, so Monday's post would fail.",
    'Slack turned the token down when the health check tried it this morning.',
    `Reinstall the SV Travel Hub Slack app (or make a new bot token) at https://api.slack.com/apps, put the new token in Vercel (${VERCEL_ENV_URL}) and redeploy.`),
  channelMissing: () => f('recap:channel', 'critical', false,
    "The weekly recap can't find its channel",
    "Slack can't find the recap's channel, so Monday's post would fail.",
    "Slack said the channel doesn't exist or the bot can't see it when the health check asked this morning.",
    `Check the recap's channel setting in Vercel (${VERCEL_ENV_URL}) points at #travel-schedule, and invite the bot by typing /invite @SV Travel Hub in that channel.`),
  channelArchived: () => f('recap:archived', 'critical', false,
    'The recap channel is archived',
    "#travel-schedule, the recap's channel, is archived, so Monday's post would fail.",
    'Slack reports the channel as archived.',
    'Unarchive #travel-schedule, or point the recap at its replacement channel in Vercel and redeploy.'),
  botNotInChannel: () => f('recap:not-member', 'critical', false,
    "The recap bot isn't in its channel",
    "The SV Travel Hub bot isn't a member of #travel-schedule, so Monday's post would fail.",
    "Slack reports the bot isn't in the channel.",
    'In #travel-schedule, type /invite @SV Travel Hub.'),
  slackUnverified: () => f('recap:slack-unverified', 'warning', false,
    "Couldn't check the recap's Slack sign-in",
    "The health check couldn't confirm the Monday recap can still post.",
    "Slack didn't answer the health check's sign-in test on either try this morning.",
    "Usually a Slack hiccup that clears by itself. If it shows up again tomorrow, check Slack's status page (https://slack-status.com).",
    true),
  buildFailed: () => f('recap:build', 'critical', true,
    "The weekly recap won't build",
    "A practice run of the Monday recap failed, so Monday's post would not go out.",
    'The health check ran the recap without posting this morning and it stopped with an error.',
    `Open sv-travel-hub in Claude Code and ask it to debug the weekly recap. The error is in the Vercel logs (${VERCEL_LOGS_URL}).`),
  emptyRoster: () => f('recap:empty-roster', 'critical', false,
    'The weekly recap has no clients',
    'The roster loaded with zero clients, so the recap would be blank.',
    "This morning's practice run of the recap counted no clients.",
    'Check that the roster in sv-registry (or the roster sheet) still has clients and its column headings are intact.'),
  zeroGames: () => f('recap:zero-games', 'warning', false,
    'The weekly recap found no games',
    'The recap found no games at all in the next five weeks, in the middle of the season.',
    "This morning's practice run of the recap counted zero games for a full roster.",
    "A schedule source has probably broken quietly. Open sv-travel-hub in Claude Code and ask it to check the roster's organization and affiliate columns and the schedule sheets."),
}

// ─── Roster ──────────────────────────────────────────────────────────────────

export const roster = {
  sourceMistyped: () => f('roster:config', 'critical', false,
    "Travel Hub can't tell where its roster lives",
    NO_ROSTER,
    "Travel Hub's roster source setting on Vercel is neither the registry nor the sheet.",
    `In Vercel (${VERCEL_ENV_URL}) set the roster source to registry, then redeploy.`),
  sheetLinkMissing: () => f('roster:config', 'critical', false,
    'The roster sheet link is missing',
    NO_ROSTER,
    "Travel Hub is set to read the roster sheet, but the sheet's link is missing from its settings on Vercel.",
    `Add the published roster sheet link in Vercel (${VERCEL_ENV_URL}), or switch the roster source to registry, then redeploy.`),
  registryKeyMissing: () => f('roster:config', 'critical', false,
    "Travel Hub has no key for the registry's roster",
    NO_ROSTER,
    'Travel Hub is set to read the roster from sv-registry, but its registry key is missing from its settings on Vercel.',
    `Open sv-registry in Claude Code and ask for a read-only roster key for sv-travel-hub, add it in Vercel (${VERCEL_ENV_URL}) and redeploy. To use the roster sheet meanwhile, switch the roster source to sheet.`),
  registryRefused: (kind: 'rejected' | 'not-allowed') => f('roster:refused', 'critical', false,
    "sv-registry turned down Travel Hub's roster key",
    NO_ROSTER,
    kind === 'rejected'
      ? "sv-registry rejected Travel Hub's registry key this morning: it's missing, revoked or mistyped."
      : "sv-registry recognized Travel Hub's registry key, but the key isn't allowed to read the roster.",
    kind === 'rejected'
      ? `Open sv-registry in Claude Code and ask it to revoke and re-make the roster key for sv-travel-hub, then paste the new key in Vercel (${VERCEL_ENV_URL}) and redeploy.`
      : `Open sv-registry in Claude Code and ask it to re-make the sv-travel-hub key with roster read access, then paste it in Vercel (${VERCEL_ENV_URL}) and redeploy. Retrying won't help.`),
  registryDown: () => f('roster:down', 'critical', false,
    "sv-registry didn't send the roster",
    NO_ROSTER,
    "sv-registry didn't answer the roster request on any of three tries this morning.",
    `Check that sv-registry is up (${REGISTRY_URL}). This usually clears by itself; if it shows up again tomorrow, open sv-registry in Claude Code.`),
  tooShort: (clients: number) => f('roster:short', 'critical', false,
    'The roster from sv-registry looks cut short',
    "Travel Hub's daily checks refused today's roster because it had far fewer clients than usual, so the client coverage checks didn't run.",
    `sv-registry sent a roster with only ${clients} ${plural(clients, 'client', 'clients')} this morning.`,
    "Open sv-registry in Claude Code and check today's roster build. Usually a bad overnight build that the next one fixes."),
  sheetUnreadable: () => f('roster:down', 'critical', false,
    "The roster sheet didn't load",
    "Travel Hub can't read the client roster sheet, so the hub and its daily checks have no clients.",
    "The roster sheet didn't load on any of three tries this morning.",
    "Check that the roster sheet is still published to the web and its link hasn't changed."),
}

// ─── Data sources ────────────────────────────────────────────────────────────

export const sources = {
  hsSheetUnreadable: () => f('source:hs-sheet', 'warning', false,
    'High school games are missing',
    'High school and junior college games are missing from Travel Hub.',
    "The Client Game Schedule sheet didn't load on any of three tries this morning.",
    "Check that the sheet is still published to the web (File, Share, Publish to web) and its link hasn't changed."),
  eventsSheetUnreadable: () => f('source:events', 'warning', false,
    'Events are missing',
    'The list of events SV is traveling to is missing from Travel Hub.',
    "The SV Summer Coverage events sheet didn't load on any of three tries this morning.",
    "Check that the events sheet is still published to the web and its link hasn't changed."),
  heartbeatDown: () => f('source:heartbeat', 'warning', false,
    'Visit history from Heartbeat is missing',
    "Travel Hub can't show who is overdue for a visit or how many visits each client has had.",
    "Heartbeat didn't answer on any of three tries this morning.",
    `Check that Heartbeat is up (${HEARTBEAT_URL}). This usually clears by itself; if it shows up again tomorrow, open sv-heartbeat in Claude Code.`),
  heartbeatPartlyDown: (parts: string[]) => f('source:heartbeat-partial', 'warning', false,
    "Part of Heartbeat isn't answering",
    `Travel Hub is missing ${joinList(parts)} from Heartbeat.`,
    'Those pages failed every try this morning and again when re-checked a little later, while the rest of Heartbeat answered.',
    'Open sv-heartbeat in Claude Code and check its logs. If Heartbeat was just redeployed, this may clear by itself.',
    true),
  mlbDown: () => f('source:mlb', 'warning', false,
    'Pro games are missing',
    "Travel Hub can't load MLB and minor league schedules, so pro clients show no games.",
    "MLB's public stats service didn't answer on any of three tries this morning.",
    "Usually an MLB outage that clears by itself. If it shows up again tomorrow, open sv-travel-hub in Claude Code: MLB may have changed its service."),
}

// ─── Weekly and seasonal ─────────────────────────────────────────────────────

export const weekly = {
  ncaaSchoolsUnmatched: (rows: Array<{ school: string; names: string[] }>) => {
    const clients = rows.reduce((n, r) => n + r.names.length, 0)
    return f('weekly:ncaa-names', 'warning', true,
      `${clients} college ${plural(clients, "client's school isn't", "clients' schools aren't")} recognized`,
      `The hub doesn't recognize the school for ${joinList(rows.map((r) => `${joinList(r.names)} ("${r.school}")`))}, so ${plural(clients, 'that client has', 'those clients have')} no college games in the hub.`,
      "This week's roster check couldn't match the school name to any college program the hub knows.",
      "Open sv-travel-hub in Claude Code and add the school to the hub's college list, or fix the school's spelling in sv-registry.")
  },
  hsSeasonNotEntered: (season: number, newest: string) => f('weekly:hs-season', 'warning', false,
    `No ${season} high school games yet`,
    `The high school and junior college schedule sheet has no ${season} games yet, so high school clients show nothing.`,
    `This week's check found only last season's games in the sheet (newest: ${newest ? humanDate(newest) : 'no readable date'}).`,
    "Enter the new season's games in the Client Game Schedule sheet as schools release them (usually November to February)."),
  hsStillLastSeason: (season: number, newest: string) => f('weekly:hs-season', 'warning', false,
    "Travel Hub is still reading last season's high school schedule",
    `High school and junior college clients show no ${season} games because the hub is still reading last season's schedule.`,
    `This week's check found only last season's games in the schedule the hub reads (newest: ${newest ? humanDate(newest) : 'no readable date'}).`,
    `Point the hub at this year's schedule tab: in the Client Game Schedule sheet, publish the ${season} tab to the web as CSV, put that link in Vercel (${VERCEL_ENV_URL}) and redeploy. If the ${season} games aren't entered yet, enter them first.`),
  summerSheetNotConnected: () => f('weekly:summer-sheet', 'warning', false,
    'Summer ball is missing',
    "The summer placement sheet isn't connected, so no client has a summer team in Travel Hub.",
    "Travel Hub's settings on Vercel have no link to the Summer Ball Placement sheet.",
    `Publish the Summer Ball Placement sheet to the web as CSV, add the link in Vercel (${VERCEL_ENV_URL}) and redeploy.`),
  summerSheetUnreadable: () => f('weekly:summer-sheet', 'warning', false,
    "The summer placement sheet didn't load",
    "Summer ball is missing from Travel Hub because the placement sheet can't be read.",
    "The Summer Ball Placement sheet didn't load on any of three tries this morning.",
    "Check that the placement sheet is still published to the web and its link hasn't changed."),
  summerMisspelled: (items: string[]) => f('weekly:summer-misspelled', 'warning', false,
    `${items.length} summer ${plural(items.length, 'placement is', 'placements are')} spelled differently from the roster`,
    `The hub drops ${plural(items.length, 'this placement', 'these placements')} because the name doesn't match the roster: ${joinList(items)}.`,
    'The hub only links a placement to a client when the name matches the roster exactly.',
    'Change the name on the Summer Ball Placement sheet to match the roster.'),
  summerNoPlacements: (college: number) => f('weekly:summer-none', 'warning', false,
    'No summer placements yet',
    'No summer placements are on the sheet yet, so college clients show no summer games.',
    `The Summer Ball Placement sheet has no player with a team, league or status, and the roster has ${college} college ${plural(college, 'client', 'clients')}.`,
    "Enter each college client's summer team and league on the Summer Ball Placement sheet. This reminder repeats every Monday through June."),
  summerUnplaced: (names: string[]) => f('weekly:summer-unplaced', 'warning', false,
    `${names.length} college ${plural(names.length, 'client has', 'clients have')} no summer team`,
    `${joinList(names)} ${plural(names.length, 'has', 'have')} no summer team on the placement sheet.`,
    "This week's check didn't find them on the Summer Ball Placement sheet with a team, league or status.",
    'Add them to the placement sheet with their team and league. If a player isn\'t playing summer ball, give them a row with a status like "Shut Down" so this stops flagging them.'),
  summerNoFeedMissing: (items: string[], manual: 'ok' | 'not-connected' | 'unreadable', season: number) => {
    const n = items.length
    const how = manual === 'ok'
      ? `The placement sheet puts them in a league with no schedule feed, and the manual summer games sheet has no ${season} games for them.`
      : manual === 'unreadable'
        ? "The manual summer games sheet didn't load on any of three tries this morning."
        : "Travel Hub's settings on Vercel have no link to a manual summer games sheet, so there's nowhere to enter these games yet."
    const todo = manual === 'not-connected'
      ? `Create a manual summer games sheet with the columns Player, Team, League, Date, Time, Home/Away, Opponent, Venue, VenueLat, VenueLng; publish it to the web as CSV, add the link in Vercel (${VERCEL_ENV_URL}), redeploy, then enter their games.`
      : "Copy their team schedules into the manual summer games sheet (Player, Team, League, Date, Time, Home/Away, Opponent, Venue, VenueLat, VenueLng). This reminder repeats every Monday until they're entered."
    return f('weekly:summer-no-feed', 'warning', false,
      `${n} summer ${plural(n, 'client has', 'clients have')} no games entered`,
      `${joinList(items)} ${plural(n, 'plays', 'play')} in a league the hub can't pull automatically, and no games are entered for them.`,
      how, todo)
  },
  summerTeamUnmatched: (items: string[]) => f('weekly:summer-team', 'warning', false,
    `${items.length} summer ${plural(items.length, "placement can't", "placements can't")} be matched to a team`,
    `No games are pulled for ${joinList(items)} because the team name on the placement sheet doesn't match the league's team list.`,
    "The team name doesn't match any team MLB's stats service lists for that league this season.",
    'Fix the team name on the placement sheet to the official club name (for example "Hyannis Harbor Hawks").'),
  summerLeaguesBlind: (leagues: string[], season: number) => f('weekly:summer-blind', 'warning', true,
    "Summer schedules can't be pulled for some leagues",
    `Summer schedules can't be pulled for ${joinList(leagues)}, where SV clients are placed.`,
    `MLB's stats service returned no ${season} teams for ${plural(leagues.length, 'that league', 'those leagues')} on both tries this morning.`,
    "Open sv-travel-hub in Claude Code: the league may have moved or changed its id in MLB's system.",
    true),
  aflNoClubs: (season: number) => f('weekly:afl-clubs', 'warning', true,
    "Fall league clients won't show",
    "Arizona Fall League clients won't show in Travel Hub.",
    `MLB's stats service lists no Arizona Fall League clubs for ${season}, and that's how the hub finds the six clubs.`,
    'Open sv-travel-hub in Claude Code and ask it to check how fall league clubs are found: the league may have been renamed in MLB\'s system. Until then, check the rosters on mlb.com/arizona-fall-league for SV clients by hand.'),
  aflRostersEmpty: (clubs: number) => f('weekly:afl-rosters', 'warning', false,
    'Fall league rosters are empty',
    "Arizona Fall League clients won't show in Travel Hub because the fall league rosters are empty.",
    `All ${clubs} fall league club rosters in MLB's records have no players, and fall league games are underway.`,
    'MLB usually fills these by the first week of October. If it lasts past mid-October, check the rosters on mlb.com/arizona-fall-league and tell the team who is playing where. If the rosters are there on mlb.com, open sv-travel-hub in Claude Code.',
    true),
  springTrainingMissing: (season: number, orgs: string[], othersHaveGames: boolean) => f('weekly:spring', 'warning', true,
    `${season} spring training is missing for ${orgs.length} client ${plural(orgs.length, 'organization', 'organizations')}`,
    `MLB's schedule has no ${season} spring training games for ${joinList(orgs)}, so clients in ${plural(orgs.length, 'that organization', 'those organizations')} will show no spring games.`,
    othersHaveGames
      ? `This week's check asked MLB for each client organization's ${season} spring training games and found none for ${plural(orgs.length, 'it', 'them')}, while other clubs' games are there.`
      : `This week's check asked MLB for each client organization's ${season} spring training games and found none at all.`,
    'Spring schedules usually post in the fall. If this lasts another week, open sv-travel-hub in Claude Code: MLB may list these games differently this year.',
    true),
}
