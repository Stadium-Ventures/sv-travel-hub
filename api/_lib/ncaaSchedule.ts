// Reads NCAA baseball schedules from official athletics sites (see
// api/_data/ncaaSources.ts for which site each school uses). Pure parsing plus
// a fetch layer that takes an injectable fetch, so the same code runs in the
// serverless endpoint, the schedule generator script and the tests.
//
// Server-side only: it never touches the DOM, so the HTML is read with small,
// tolerant regex passes over two well-defined page shapes (a schedule table
// on SIDEARM sites, schedule-event cards on WMT sites).

import { NCAA_SCHEDULE_SOURCES, NCAA_NO_PUBLIC_SOURCE, type NcaaScheduleSource } from '../_data/ncaaSources.js'

export type NcaaSide = 'home' | 'away' | 'neutral'
export type NcaaGameStatus = 'scheduled' | 'final' | 'canceled' | 'postponed'

/** One game as the school's site publishes it, from that school's side. */
export interface NcaaSourceGame {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  /** Start time as an ISO timestamp when the site gives a time and zone. */
  startTime: string | null
  /** Time exactly as printed ("6:30 p.m. CT", "TBA"); '' when blank. */
  timeText: string
  /** home / away / neutral as the site labels it. A "home" game can still be
   *  played away from the usual park (e.g. a showcase at a big-league
   *  stadium); `location`/`venueName` say where. */
  side: NcaaSide
  opponent: string
  /** "City, State" as printed. */
  location: string
  /** Ballpark name when printed. */
  venueName: string
  /** Fall games (Aug to Dec) and anything the site labels an exhibition or
   *  scrimmage. They count for visits but not for the record. */
  exhibition: boolean
  tournament: string
  status: NcaaGameStatus
}

export type NcaaFetchStatus = 'ok' | 'empty' | 'error' | 'no-source'

export interface NcaaSchoolSchedule {
  school: string
  season: number
  status: NcaaFetchStatus
  /** Plain-English explanation for anything other than 'ok'. */
  message: string
  sourceUrl: string
  games: NcaaSourceGame[]
  fetchedAt: number
}

// ─── Text helpers ───────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', eacute: 'é', ntilde: 'ñ',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m
  })
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function htmlText(fragment: string): string {
  const noComments = fragment.replace(/<!--[\s\S]*?-->/g, '')
  const noHidden = noComments
    .replace(/<(script|style|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<span[^>]*class="[^"]*sr-only[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ')
  return decodeEntities(noHidden.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** The calendar year a month falls in for a given season. College baseball
 *  seasons are named for the spring; fall exhibitions (Aug to Dec) belong to
 *  the next spring's season. */
export function yearForMonth(month: number, season: number): number {
  return month >= 8 ? season - 1 : season
}

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/** "Feb 13 (Fri)", "February 13, 2026 (Friday)", "Fri, Feb 13", "Oct 17".
 *
 *  Most pages print no year. Sites also quietly serve the latest season they
 *  have when asked for one they don't (a request for 2027 can come back with
 *  the 2026 schedule), so the year is never assumed from the request alone:
 *  when a weekday is printed, the year is the one where that date falls on
 *  that weekday. Callers then drop games outside the season they asked for. */
export function parseScheduleDate(text: string, season: number): string | null {
  const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*,\s*(\d{4}))?/i)
  if (!m) return null
  const month = MONTHS[m[1]!.toLowerCase()]!
  const day = parseInt(m[2]!, 10)
  if (day < 1 || day > 31) return null
  let year = m[3] ? parseInt(m[3], 10) : yearForMonth(month, season)
  if (!m[3]) {
    const wd = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i)
    if (wd) {
      const want = WEEKDAYS[wd[1]!.toLowerCase()]!
      const base = yearForMonth(month, season)
      const hit = [base, base - 1, base + 1, base - 2].find((y) => new Date(Date.UTC(y, month - 1, day)).getUTCDay() === want)
      if (hit !== undefined) year = hit
    }
  }
  return `${year}-${pad2(month)}-${pad2(day)}`
}

const ZONES: Record<string, string> = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  HT: 'Pacific/Honolulu', HST: 'Pacific/Honolulu', AKT: 'America/Anchorage',
}

/** Minutes the zone is ahead of UTC at that instant (negative in the US). */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - utcMs) / 60000)
}

/** "6:30 p.m. CT" on 2026-02-13 → ISO UTC. Null without a clock time and a
 *  US zone abbreviation (TBA, TBD, "3:05 P.M." with no zone). */
export function parseStartTime(date: string, timeText: string): string | null {
  const t = timeText.replace(/\s+/g, ' ').trim()
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i)
  const noon = /\bnoon\b/i.test(t)
  if (!m && !noon) return null
  const zoneMatch = t.match(/\b(EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|PST|PDT|PT|HST|HT|AKT)\b/)
  if (!zoneMatch) return null
  const tz = ZONES[zoneMatch[1]!]!
  let hour = noon ? 12 : parseInt(m![1]!, 10) % 12
  const minute = noon ? 0 : parseInt(m![2] ?? '0', 10)
  if (!noon && m![3]!.toLowerCase() === 'p') hour += 12
  const [y, mo, d] = date.split('-').map((x) => parseInt(x, 10)) as [number, number, number]
  const wall = Date.UTC(y, mo - 1, d, hour, minute)
  // Two passes settle the offset across a DST boundary.
  let utc = wall - zoneOffsetMinutes(wall, tz) * 60000
  utc = wall - zoneOffsetMinutes(utc, tz) * 60000
  return new Date(utc).toISOString()
}

/** Strip rankings, conference asterisks and doubleheader notes. */
export function cleanOpponent(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(vs\.?|at|@)\s+/i, '')
    .replace(/^(#\s?\d+|No\.\s?\d+|\(#?\d+\)|RV)\s+/i, '')
    .replace(/\s*\((?:[^()]*\b(?:DH|doubleheader|game \d|innings?|exhibition|exh|scrimmage)\b[^()]*)\)\s*/gi, ' ')
    .replace(/\s*-\s*(fall )?(exhibition|scrimmage)$/i, '')
    // Conference tags some sites append: "North Carolina (ACC)".
    .replace(/\s*\((ACC|SEC|Big Ten|B1G|Big 12|Big East|AAC|American|C-?USA|Sun Belt|SBC|WCC|MWC|Pac-12|ASUN|CAA|MVC|A-?10|OVC|SoCon|Southland|SWAC|MEAC|NEC|Ivy|Patriot|Horizon|Summit|WAC|Big West|Big South|America East|MAAC|MAC|CCAA|Conf\.?)\)\s*$/i, '')
    .replace(/[\s*]+$/g, '')
    .replace(/^\*+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Austin, Texas (UFCU Disch-Falk Field)", "Honolulu, O'ahu / Les Murakami
 *  Stadium", "Dallas, TX" → city part and ballpark part. */
export function splitLocation(raw: string): { location: string; venueName: string } {
  const text = raw.replace(/\s+/g, ' ').trim()
  const paren = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/)
  if (paren) return { location: paren[1]!.trim(), venueName: paren[2]!.trim() }
  // "City / Park" (WMT) and "Park | City, ST" (some SIDEARM sites).
  const slash = text.split(/\s+\/\s+/)
  if (slash.length === 2 && !slash[0]!.includes(',') && slash[1]!.includes(',')) {
    return { location: slash[1]!.trim(), venueName: slash[0]!.trim() } // "Park / City, ST"
  }
  if (slash.length >= 2) return { location: slash[0]!.trim(), venueName: slash.slice(1).join(' / ').trim() }
  // "Nashville, Tenn./First Horizon Park"; a bare "Park A/Park B" stays whole.
  const tight = text.match(/^([^/]+,[^/]+?)\/([^/]+)$/)
  if (tight) return { location: tight[1]!.trim(), venueName: tight[2]!.trim() }
  const pipe = text.split(/\s*\|\s*/)
  if (pipe.length === 2) {
    const [a, b] = pipe as [string, string]
    return a.includes(',') && !b.includes(',') ? { location: a, venueName: b } : { location: b, venueName: a }
  }
  return { location: text, venueName: '' }
}

function sideFrom(text: string): NcaaSide | null {
  const t = text.trim().toLowerCase()
  if (t === 'home' || t === 'vs' || t === 'vs.') return 'home'
  if (t === 'away' || t === 'at' || t === '@') return 'away'
  if (t === 'neutral' || t.startsWith('neutral')) return 'neutral'
  return null
}

function statusFrom(text: string): NcaaGameStatus {
  if (/cancel/i.test(text)) return 'canceled'
  if (/postpone/i.test(text)) return 'postponed'
  if (/^\s*[WLT]\b/.test(text) || /\b(W|L|T),?\s*\d+\s*-\s*\d+/.test(text)) return 'final'
  return 'scheduled'
}

function isExhibition(date: string, ...texts: string[]): boolean {
  const month = parseInt(date.slice(5, 7), 10)
  if (month >= 8) return true
  return texts.some((t) => /exhibition|\bexh\b|scrimmage|fall ball/i.test(t))
}

// ─── SIDEARM: one schedule table ────────────────────────────────────────────

/** Parses the SIDEARM text-only schedule (/schedule/text/{season}) and the
 *  grid view of the classic schedule page (/schedule/{season}?grid=true).
 *  Both are a table with Date, Time, At, Opponent and Location columns. */
export function parseSidearmTable(html: string, season: number): NcaaSourceGame[] {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []
  for (const table of tables) {
    const headerRow = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? ''
    const headers = (headerRow.match(/<th[^>]*>[\s\S]*?<\/th>/gi) ?? []).map((h) => htmlText(h).toLowerCase())
    const col = (name: string) => headers.findIndex((h) => h === name)
    const iDate = col('date')
    const iOpp = col('opponent')
    if (iDate < 0 || iOpp < 0) continue
    const iTime = col('time')
    const iAt = col('at')
    const iLoc = col('location')
    const iTourn = col('tournament')
    const iResult = col('result')

    const games: NcaaSourceGame[] = []
    const body = table.replace(/<thead[\s\S]*?<\/thead>/i, '')
    for (const row of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(htmlText)
      if (cells.length <= Math.max(iDate, iOpp)) continue
      const date = parseScheduleDate(cells[iDate] ?? '', season)
      const opponent = cleanOpponent(cells[iOpp] ?? '')
      if (!date || !opponent) continue
      const timeText = iTime >= 0 ? (cells[iTime] ?? '') : ''
      const side = (iAt >= 0 ? sideFrom(cells[iAt] ?? '') : null) ?? 'home'
      const { location, venueName } = splitLocation(iLoc >= 0 ? (cells[iLoc] ?? '') : '')
      const tournament = iTourn >= 0 ? (cells[iTourn] ?? '') : ''
      const result = iResult >= 0 ? (cells[iResult] ?? '') : ''
      const status = statusFrom(`${result} ${timeText}`)
      games.push({
        date,
        startTime: parseStartTime(date, timeText),
        timeText: timeText === '-' ? '' : timeText,
        side,
        opponent,
        location,
        venueName,
        exhibition: isExhibition(date, cells[iOpp] ?? '', tournament),
        tournament,
        status,
      })
    }
    return games
  }
  return []
}

/** The classic SIDEARM list layout: one `sidearm-schedule-game` item per
 *  game. Some classic sites serve this instead of the grid even when the
 *  grid view is asked for (seen on 2026-27 fall schedules). */
export function parseSidearmList(html: string, season: number): NcaaSourceGame[] {
  const games: NcaaSourceGame[] = []
  for (const item of elementsWhere(html, (cl) => cl.includes('sidearm-schedule-game'))) {
    const sideClass = item.classes.find((c) => /^sidearm-schedule-(home|away|neutral)-game$/.test(c))
    const side = (sideClass?.match(/(home|away|neutral)/)?.[1] ?? 'home') as NcaaSide
    const dateEl = elementsWhere(item.inner, hasClass('sidearm-schedule-game-opponent-date'), 1)[0]
    const spans = dateEl ? [...dateEl.inner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((s) => htmlText(s[1]!)) : []
    const date = parseScheduleDate(spans[0] ?? '', season)
    const opponent = cleanOpponent(textOf(elementsWhere(item.inner, hasClass('sidearm-schedule-game-opponent-name'), 1))[0] ?? '')
    if (!date || !opponent) continue
    const timeText = spans[1] ?? ''
    const loc = elementsWhere(item.inner, hasClass('sidearm-schedule-game-location'), 1)[0]
    const { location, venueName } = splitLocation(loc ? htmlText(loc.inner) : '')
    const resultText = textOf(elementsWhere(item.inner, hasClass('sidearm-schedule-game-result'), 1))[0] ?? ''
    games.push({
      date,
      startTime: parseStartTime(date, timeText),
      timeText,
      side,
      opponent,
      location,
      venueName,
      exhibition: isExhibition(date, htmlText(item.inner)),
      tournament: textOf(elementsWhere(item.inner, (cl) => cl.some((c) => c.includes('tournament')), 1))[0] ?? '',
      status: item.classes.includes('sidearm-schedule-game-completed') || /^[WLT]\b/.test(resultText) ? 'final' : statusFrom(resultText),
    })
  }
  return games
}

export function parseSidearm(html: string, season: number): NcaaSourceGame[] {
  const table = parseSidearmTable(html, season)
  return table.length > 0 ? table : parseSidearmList(html, season)
}

// ─── WMT Digital: one card per game ─────────────────────────────────────────

interface HtmlElement {
  tag: string
  classes: string[]
  /** Inner HTML. */
  inner: string
}

/** Elements whose class list has a token matching `test`, with their full
 *  (balanced) inner HTML. Small and forgiving: enough for the schedule
 *  cards, not a general HTML parser. */
export function elementsWhere(html: string, test: (classes: string[]) => boolean, limit = Infinity): HtmlElement[] {
  const out: HtmlElement[] = []
  const open = /<([a-z][a-z0-9]*)\b[^>]*?\sclass="([^"]*)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = open.exec(html)) && out.length < limit) {
    const classes = m[2]!.split(/\s+/).filter(Boolean)
    if (!test(classes)) continue
    const tag = m[1]!.toLowerCase()
    const start = m.index + m[0].length
    if (/^(img|br|hr|input|meta|link|source)$/.test(tag) || m[0].endsWith('/>')) {
      out.push({ tag, classes, inner: '' })
      continue
    }
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    tagRe.lastIndex = start
    let depth = 1
    let end = html.length
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(html))) {
      if (t[1]) depth--
      else if (!t[0].endsWith('/>')) depth++
      if (depth === 0) { end = t.index; break }
    }
    out.push({ tag, classes, inner: html.slice(start, end) })
  }
  return out
}

const hasClass = (token: string) => (classes: string[]) => classes.includes(token)
const hasClassEnding = (suffix: string) => (classes: string[]) => classes.some((c) => c.endsWith(suffix))

/** Card wrappers across the WMT themes in use: schedule-event-item and
 *  schedule-item-block (Nuxt themes), schedule-item and schedule-table_row
 *  (older WordPress themes). */
const WMT_CARD = (classes: string[]) =>
  classes.includes('schedule-event-item') || classes.includes('schedule-item-block') ||
  classes.includes('schedule-item') || classes.includes('schedule-table_row')

const SIDE_WORD = /^(home|away|neutral)$/i

function textOf(els: HtmlElement[]): string[] {
  return els.map((e) => htmlText(e.inner)).filter(Boolean)
}

function wmtSide(card: HtmlElement): NcaaSide | null {
  for (const c of card.classes) {
    const m = c.match(/(?:^|--)(home|away|neutral)$/)
    if (m) return m[1] as NcaaSide
  }
  const venueSide = card.inner.match(/schedule-event-date--venue-(home|away|neutral)\b/)
  if (venueSide) return venueSide[1] as NcaaSide
  // A small label element holding just the word (venue-type, venue, or the
  // WordPress theme's location <span>).
  for (const el of elementsWhere(card.inner, (cl) => cl.some((c) => /__venue(-type)?$/.test(c)))) {
    const t = htmlText(el.inner)
    if (SIDE_WORD.test(t)) return t.toLowerCase() as NcaaSide
  }
  const loc = elementsWhere(card.inner, hasClass('schedule-list__location'), 1)[0]
  const locWord = loc?.inner.match(/<span[^>]*>\s*(home|away|neutral)\s*<\/span>/i)?.[1]
  if (locWord) return locWord.toLowerCase() as NcaaSide
  const divider = textOf(elementsWhere(card.inner, (cl) => cl.some((c) => /__(divider|opponent-vs)$/.test(c) || c === 'prefix'), 1))[0]
  if (divider) return sideFrom(divider)
  return null
}

function wmtOpponent(card: HtmlElement): string {
  const named = elementsWhere(card.inner, (cl) => cl.some((c) => c.endsWith('opponent-name')) && !cl.some((c) => c.endsWith('--school')))
  if (named.length) return htmlText(named[0]!.inner)
  const direct = textOf(elementsWhere(card.inner, (cl) => cl.some((c) => c.endsWith('team__opponent')), 1))[0]
  if (direct) return direct
  const heading = elementsWhere(card.inner, hasClass('schedule-item-team__heading'), 1)[0]
  if (heading) return htmlText(heading.inner.replace(/<strong[^>]*__divider[^>]*>[\s\S]*?<\/strong>/i, ''))
  const listOpp = elementsWhere(card.inner, hasClass('schedule-list__opponent'), 1)[0]
  if (listOpp) return htmlText(listOpp.inner.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] ?? listOpp.inner)
  const team = elementsWhere(card.inner, hasClass('schedule-item__team'), 1)[0]
  if (team) return htmlText(team.inner.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/)?.[1] ?? '')
  // Themes that print both clubs: skip ours (marked --current) and take the
  // last name, which is the opponent.
  const names = elementsWhere(card.inner, (cl) => cl.some((c) => c.endsWith('__name')) && !cl.some((c) => c.endsWith('--current')))
    .filter((e) => !/__name--current/.test(e.inner))
  const ours = elementsWhere(card.inner, hasClassEnding('__team--current'))
  const candidates = names.filter((n) => !ours.some((o) => o.inner.includes(n.inner)))
  const pick = candidates[candidates.length - 1] ?? names[names.length - 1]
  return pick ? htmlText(pick.inner) : ''
}

function wmtLocation(card: HtmlElement): { location: string; venueName: string } {
  const locs = textOf(elementsWhere(card.inner, hasClass('schedule-event-location')))
  const withVenue = locs.find((l) => / \/ |\(/.test(l))
  if (withVenue || locs[0]) {
    const split = splitLocation(withVenue ?? locs[0]!)
    if (!split.venueName) {
      const venue = textOf(elementsWhere(card.inner, (cl) => cl.some((c) => /__venue$/.test(c))))
        .find((v) => !SIDE_WORD.test(v))
      if (venue) split.venueName = venue
    }
    return split
  }
  const listLoc = elementsWhere(card.inner, hasClass('schedule-list__location'), 1)[0]
  if (listLoc) {
    const strong = htmlText(listLoc.inner.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] ?? '')
    const split = splitLocation(strong)
    // A bare park name (home games) has no comma; keep it as the venue.
    return split.location.includes(',') || split.venueName ? split : { location: '', venueName: strong }
  }
  const team = elementsWhere(card.inner, hasClass('schedule-item__team'), 1)[0]
  const p = team ? htmlText(team.inner.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '') : ''
  return splitLocation(p)
}

/** Parses a WMT Digital schedule page (any of the themes in use). */
export function parseWmtSchedule(html: string, season: number): NcaaSourceGame[] {
  const games: NcaaSourceGame[] = []
  for (const card of elementsWhere(html, WMT_CARD)) {
    // Date and time: an ISO datetime when the theme prints one, the
    // WordPress theme's data-order timestamp, else the printed date text.
    const iso = card.inner.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})(T[^"]*)?"/)
    let date: string | null = null
    let startTime: string | null = null
    if (iso) {
      date = iso[1]!
      if (iso[2] && /T\d{2}:\d{2}/.test(iso[2]) && /[+-]\d{2}:\d{2}$|Z$/.test(iso[2])) {
        const parsed = Date.parse(iso[1]! + iso[2])
        if (Number.isFinite(parsed)) startTime = new Date(parsed).toISOString()
      }
    } else {
      // Some themes split the date over several <time> tags ("Fri" + "Feb 13").
      const timeEls = [...card.inner.matchAll(/<time[^>]*>([\s\S]*?)<\/time>/g)].slice(0, 3)
      const dateText = timeEls.length ? timeEls.map((t) => htmlText(t[1]!)).join(' ') : htmlText(card.inner.slice(0, 1500))
      date = parseScheduleDate(dateText, season)
    }
    if (!date) continue

    const rawOpponent = wmtOpponent(card)
    const opponent = cleanOpponent(rawOpponent)
    if (!opponent) continue

    const side = wmtSide(card) ?? 'home'
    const { location, venueName } = wmtLocation(card)

    const clock = textOf(elementsWhere(card.inner, hasClassEnding('__clock'), 1))[0] ?? ''
    const result = textOf(elementsWhere(card.inner, (cl) => cl.some((c) => /-result__label$|__result$|^schedule-list__result$/.test(c)), 1))[0] ?? ''
    const timeText = startTime ? '' : (clock || (result.match(/\b\d{1,2}(:\d{2})?\s*[ap]\.?m\.?(\s*[A-Z]{2,3}\b)?|\bTB[AD]\b/i)?.[0] ?? ''))
    const cardText = htmlText(card.inner)
    const tournament = textOf(elementsWhere(card.inner, (cl) => cl.some((c) => /tournament.*title|__tournament$/.test(c)), 1))[0] ?? ''

    games.push({
      date,
      startTime: startTime ?? parseStartTime(date, timeText),
      timeText: startTime ? '' : timeText,
      side,
      opponent,
      location,
      venueName,
      exhibition: /schedule-event-exhibition/.test(card.inner) || isExhibition(date, rawOpponent, tournament),
      tournament,
      status: /\bcancell?ed\b/i.test(cardText) ? 'canceled'
        : /\bpostponed\b/i.test(cardText) ? 'postponed'
          : /result__(win|loss|tie)|class="(win|loss|tie)"|^\s*[WLT],?\s+\d+-\d+/.test(card.inner) || /^[WLT],?\s*\d+-\d+/.test(result) ? 'final' : 'scheduled',
    })
  }
  return dedupeGames(games)
}

/** Some WMT themes render each card twice (desktop and mobile copies). */
function dedupeGames(games: NcaaSourceGame[]): NcaaSourceGame[] {
  const seen = new Set<string>()
  const out: NcaaSourceGame[] = []
  for (const g of games) {
    const k = `${g.date}|${g.opponent.toLowerCase()}|${g.startTime ?? g.timeText}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(g)
  }
  return out
}

// ─── Seasons and URLs ───────────────────────────────────────────────────────

/** The season whose games are coming up: from August on, next spring's
 *  schedule (which also holds this fall's exhibitions). */
export function upcomingSeason(now: Date = new Date()): number {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

/** Candidate URLs for one school's season, tried in order. */
export function scheduleUrls(source: NcaaScheduleSource, season: number, current: boolean): string[] {
  const base = `https://${source.host}/sports/${source.sport}/schedule`
  if (source.platform === 'sidearm') {
    return [`${base}/text/${season}`, `${base}/${season}?grid=true`]
  }
  // Season slugs differ by school: "2026", "2025-26", and on some sites the
  // spring 2027 season lives under "2026" (labelled 2026-27).
  const slugs = [`${season}`, `${season - 1}-${String(season).slice(2)}`, `${season - 1}`]
  const seasonUrls = slugs.map((s) => `${base}/season/${s}/`)
  // WMT's undated page is the current season; use it when that is the one
  // being asked for, and as the fallback when the season slug is unknown.
  return current ? [`${base}/`, ...seasonUrls] : [...seasonUrls, `${base}/`]
}

export function parseSchedule(source: NcaaScheduleSource, html: string, season: number): NcaaSourceGame[] {
  return source.platform === 'sidearm' ? parseSidearm(html, season) : parseWmtSchedule(html, season)
}

/** Whether a page that yielded no games is a real schedule page with nothing
 *  on it (offseason, season not published) rather than a page we can't
 *  read. Pages that build the schedule in the browser show a skeleton or a
 *  "Loading schedule" placeholder and count as unreadable. */
export function isUnreadableSchedulePage(html: string): boolean {
  if (/schedule-skeleton|Loading schedule/i.test(html)) return true
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  const headings = (html.match(/<h[12][^>]*>[\s\S]*?<\/h[12]>/gi) ?? []).join(' ')
  return !/schedule/i.test(htmlText(title + ' ' + headings))
}

/** Keep only games that belong to the season (a WMT undated page can still
 *  show last season during the summer). */
export function inSeason(game: NcaaSourceGame, season: number): boolean {
  const from = `${season - 1}-08-01`
  const to = `${season}-07-31`
  return game.date >= from && game.date <= to
}

// ─── robots.txt ─────────────────────────────────────────────────────────────

/** Disallow rules that apply to every crawler ("User-agent: *"). */
export function robotsDisallows(robotsTxt: string): string[] {
  const rules: string[] = []
  let applies = false
  let lastWasAgent = false
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [k, ...rest] = line.split(':')
    const key = k!.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      applies = lastWasAgent ? applies || value === '*' : value === '*'
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (applies && key === 'disallow' && value) rules.push(value)
  }
  return rules
}

/** True when a path (with query) is blocked by any of the rules. Supports
 *  the * wildcard and the $ end anchor. */
export function robotsBlocks(rules: string[], pathAndQuery: string): boolean {
  return rules.some((rule) => {
    const anchored = rule.endsWith('$')
    const body = anchored ? rule.slice(0, -1) : rule
    const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''))
    return re.test(pathAndQuery)
  })
}

// ─── Fetching ───────────────────────────────────────────────────────────────

export const NCAA_USER_AGENT = 'SVTravelHub/1.0 (+https://sv-travel-hub.vercel.app; reads public team schedules)'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

async function getText(fetchFn: FetchFn, url: string, timeoutMs: number): Promise<{ status: number; text: string; finalUrl: string }> {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': NCAA_USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = res.ok ? await res.text() : ''
  return { status: res.status, text, finalUrl: res.url || url }
}

export interface FetchScheduleOptions {
  season?: number
  now?: Date
  fetchFn?: FetchFn
  timeoutMs?: number
}

/** Fetch and parse one school's schedule. Never throws: problems come back
 *  as status 'error' / 'empty' / 'no-source' with a plain-English message. */
export async function fetchSchoolSchedule(school: string, opts: FetchScheduleOptions = {}): Promise<NcaaSchoolSchedule> {
  const now = opts.now ?? new Date()
  const current = upcomingSeason(now)
  const season = opts.season ?? current
  const fetchFn = opts.fetchFn ?? fetch
  const timeoutMs = opts.timeoutMs ?? 12000
  const base = { school, season, games: [] as NcaaSourceGame[], fetchedAt: now.getTime() }

  const source = NCAA_SCHEDULE_SOURCES[school]
  if (!source) {
    const why = NCAA_NO_PUBLIC_SOURCE[school]
    return {
      ...base,
      status: 'no-source',
      sourceUrl: '',
      message: why
        ? `${school} has no schedule page the app can read: ${why}`
        : `No schedule source is set up for ${school}.`,
    }
  }

  let disallow: string[] = []
  try {
    const robots = await getText(fetchFn, `https://${source.host}/robots.txt`, timeoutMs)
    if (robots.status === 200) disallow = robotsDisallows(robots.text)
  } catch {
    // No robots.txt reachable: nothing is disallowed.
  }

  const errors: string[] = []
  let readablePage = ''
  let unreadablePage = ''
  for (const url of scheduleUrls(source, season, season === current)) {
    const u = new URL(url)
    if (robotsBlocks(disallow, u.pathname + u.search)) {
      errors.push(`its robots.txt does not allow reading ${u.pathname}`)
      continue
    }
    try {
      const page = await getText(fetchFn, url, timeoutMs)
      if (page.status === 404) continue
      if (page.status !== 200) {
        errors.push('the site returned an error')
        continue
      }
      const all = parseSchedule(source, page.text, season)
      const games = all.filter((g) => inSeason(g, season))
      if (games.length > 0) {
        games.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
        return { ...base, status: 'ok', sourceUrl: url, message: '', games }
      }
      // Games from another season, or a schedule page with nothing on it,
      // both mean "this season isn't published yet". A page with no
      // schedule we can read at all is a broken source.
      if (all.length > 0 || !isUnreadableSchedulePage(page.text)) readablePage ||= url
      else unreadablePage ||= url
    } catch (err) {
      errors.push(describeFetchError(err))
    }
  }

  if (readablePage) {
    return {
      ...base,
      status: 'empty',
      sourceUrl: readablePage,
      message: `${school} has no ${season} games published yet.`,
    }
  }
  if (unreadablePage) {
    return {
      ...base,
      status: 'error',
      sourceUrl: unreadablePage,
      message: `The ${school} schedule page on ${source.host} loaded, but no games could be read from it. The site may have changed its layout or now builds the schedule in the browser.`,
    }
  }
  return {
    ...base,
    status: 'error',
    sourceUrl: scheduleUrls(source, season, season === current)[0]!,
    message: errors.length > 0
      ? `Could not read the ${school} schedule from ${source.host}: ${[...new Set(errors)].join('; ')}.`
      : `The ${school} schedule page on ${source.host} was not found.`,
  }
}

function describeFetchError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } }
  const code = e?.cause?.code ?? ''
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'the site took too long to answer'
  if (/CERT|SIGNATURE|SSL|TLS/i.test(code)) return "the site's security certificate could not be verified"
  if (code === 'ENOTFOUND') return 'the site address did not resolve'
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'the site refused the connection'
  return e?.message ? `the request failed (${e.message})` : 'the request failed'
}
