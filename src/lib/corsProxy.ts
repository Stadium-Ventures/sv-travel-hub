// Fetches a public page through a CORS proxy: the app's own /api/cors-proxy
// first, then public proxies. Used by the MaxPreps HS loader. NCAA schedules
// no longer go through here: the server reads them (api/ncaa-schedules.ts).
import { fetchWithTimeout } from './fetchWithTimeout'

// CORS proxies with fallback — if the primary goes down, try alternatives
export interface CorsProxy {
  url: string
  // How to extract HTML from the response
  extract: (res: Response) => Promise<string>
}

export const CORS_PROXIES: CorsProxy[] = [
  {
    // Own Vercel serverless proxy — most reliable, no third-party dependency
    url: '/api/cors-proxy?url=',
    extract: async (res) => {
      const data = await res.json()
      return data.contents as string
    },
  },
  {
    url: 'https://api.allorigins.win/get?url=',
    extract: async (res) => {
      const data = await res.json()
      return data.contents as string
    },
  },
  {
    url: 'https://corsproxy.io/?url=',
    extract: async (res) => res.text(),
  },
  {
    url: 'https://api.codetabs.com/v1/proxy?quest=',
    extract: async (res) => res.text(),
  },
]

// Fetch URL through CORS proxies with fallback
export async function fetchWithCorsProxy(targetUrl: string): Promise<string> {
  const errors: string[] = []

  for (const proxy of CORS_PROXIES) {
    try {
      const res = await fetchWithTimeout(`${proxy.url}${encodeURIComponent(targetUrl)}`, { timeoutMs: 20000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await proxy.extract(res)
      if (!html) throw new Error('Empty response')
      return html
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${proxy.url.split('/')[2]}: ${msg}`)
    }
  }

  throw new Error(`All CORS proxies failed: ${errors.join('; ')}`)
}

