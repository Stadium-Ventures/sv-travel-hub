import type { VercelRequest, VercelResponse } from '@vercel/node'

// Vercel serverless CORS proxy — primary proxy for D1Baseball and MaxPreps fetches.
// Falls back to public CORS proxies if this is unavailable.

const ALLOWED_DOMAINS = [
  'd1baseball.com',
  'www.maxpreps.com',
  'maxpreps.com',
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const targetUrl = req.query.url as string | undefined

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' })
  }

  // Validate target domain
  try {
    const parsed = new URL(targetUrl)
    if (!ALLOWED_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
      return res.status(403).json({ error: 'Domain not allowed' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SVTravelHub/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream returned ${response.status}` })
    }

    const html = await response.text()

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET')
    res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour

    return res.status(200).json({ contents: html })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: msg })
  }
}
