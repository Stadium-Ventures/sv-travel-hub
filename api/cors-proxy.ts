import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vercel serverless CORS proxy — primary proxy for D1Baseball and MaxPreps fetches.
// Falls back to public CORS proxies if this is unavailable.
//
// Hardening:
//   - Target domain allowlist, re-validated on the FINAL URL after redirects
//     (an allowed host could otherwise 302 us into fetching anywhere).
//   - 10s fetch timeout so a hung upstream can't pin the function.
//   - Access-Control-Allow-Origin restricted to the app's own origins instead
//     of `*` — this proxy exists for the Travel Hub frontend, nobody else.

const ALLOWED_DOMAINS = [
  'd1baseball.com',
  'www.maxpreps.com',
  'maxpreps.com',
]

// Origins allowed to call this proxy from a browser. localhost:5173 is the
// Vite dev server.
const ALLOWED_ORIGINS = [
  'https://sv-travel-hub.vercel.app',
  'http://localhost:5173',
]

function isAllowedTarget(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    return ALLOWED_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS: echo the origin back only if it's ours. Set on every response
  // (including errors) so the frontend can read failure bodies too.
  const origin = (req.headers.origin as string | undefined) ?? ''
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const targetUrl = req.query.url as string | undefined

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' })
  }

  // Validate target domain
  try {
    new URL(targetUrl)
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }
  if (!isAllowedTarget(targetUrl)) {
    return res.status(403).json({ error: 'Domain not allowed' })
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SVTravelHub/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })

    // Redirects were followed — make sure we didn't get bounced off the
    // allowlist (open-redirect on an allowed host → arbitrary fetch otherwise).
    if (!isAllowedTarget(response.url)) {
      return res.status(403).json({ error: 'Redirected outside allowed domains' })
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream returned ${response.status}` })
    }

    const html = await response.text()

    res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour

    return res.status(200).json({ contents: html })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Upstream timed out' })
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: msg })
  }
}
