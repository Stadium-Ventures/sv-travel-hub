import type { VercelRequest, VercelResponse } from '@vercel/node'
// Vercel only compiles api/**/*.ts for functions; imports must stay inside
// api/ and use .js extensions (see api/_data/ncaaSchools.ts).
import { fetchSchoolSchedule } from './_lib/ncaaSchedule.js'
import { NCAA_SCHEDULE_SOURCES, NCAA_NO_PUBLIC_SOURCE } from './_data/ncaaSources.js'
import { resolveNcaaName } from './_data/ncaaSchools.js'

// GET /api/ncaa-schedules?school=Texas[&season=2027]
//
// One NCAA school's baseball schedule, read server-side from the school's
// official athletics site (no browser CORS) and normalized. One school per
// request so each response is cached on its own at the CDN: schedules move
// slowly, so a few hours of s-maxage plus a day of stale-while-revalidate
// keeps the athletics sites from seeing more than a handful of requests a
// day however many people open the app.

export const config = { maxDuration: 60 }

const OK_CACHE = 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400'
const ERROR_CACHE = 'public, max-age=0, s-maxage=600'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'GET only' })
  }
  const raw = typeof req.query.school === 'string' ? req.query.school : ''
  const school = NCAA_SCHEDULE_SOURCES[raw] || NCAA_NO_PUBLIC_SOURCE[raw] ? raw : resolveNcaaName(raw)
  if (!raw || !school) {
    res.setHeader('Cache-Control', ERROR_CACHE)
    return res.status(404).json({ error: `No schedule source is set up for "${raw}".` })
  }
  const seasonParam = typeof req.query.season === 'string' ? parseInt(req.query.season, 10) : NaN
  const now = new Date()
  const season = Number.isFinite(seasonParam) && seasonParam >= 2020 && seasonParam <= now.getUTCFullYear() + 1
    ? seasonParam
    : undefined

  const result = await fetchSchoolSchedule(school, { season, now, timeoutMs: 8000 })
  res.setHeader('Cache-Control', result.status === 'ok' || result.status === 'empty' ? OK_CACHE : ERROR_CACHE)
  return res.status(200).json(result)
}
