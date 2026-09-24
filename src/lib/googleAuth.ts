/** Google Identity Services sign-in for the registry roster door.
 *
 * The page authenticates as a PERSON: GIS mints a Google ID token for the
 * signed-in @stadium-ventures.com account and we send it to sv-registry as
 * `Authorization: Bearer <id_token>`. No secret lives in this public repo or
 * its bundle, and there is no proxy. The token is held in THIS MODULE'S
 * MEMORY ONLY: never localStorage/sessionStorage/cookies, so it dies with the
 * tab. Google ID tokens last about an hour; an expired one is dropped and
 * GIS re-prompts (auto_select makes that silent for a returning user).
 *
 * The audience must be sv-registry's OAuth client (it verifies `aud`), so the
 * default client id is the registry's (sv-registry api/_lib/auth.js CLIENT_ID).
 * This page's origin must be an Authorized JavaScript origin on that client. */

export const DEFAULT_GOOGLE_CLIENT_ID = '970904391216-emekreu9hdntj6k76qhkr0fjvrvd9fcm.apps.googleusercontent.com'
export const ALLOWED_HD = 'stadium-ventures.com'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface GisCredentialResponse { credential?: string }
interface GisId {
  initialize(config: Record<string, unknown>): void
  prompt(): void
  renderButton(el: HTMLElement, options: Record<string, unknown>): void
  disableAutoSelect(): void
}
declare global {
  interface Window { google?: { accounts?: { id?: GisId } } }
}

let idToken: string | null = null
let initPromise: Promise<GisId | null> | null = null
const listeners = new Set<() => void>()

function clientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || DEFAULT_GOOGLE_CLIENT_ID
}

/** Decode a JWT payload without verifying it. The registry verifies; the page
 *  only needs `exp` (to drop stale tokens) and `hd`/`email` (to show who). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    return JSON.parse(atob(b64)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** True when the token has more than `skewMs` of life left. */
export function isTokenFresh(token: string | null, nowMs = Date.now(), skewMs = 60_000): boolean {
  if (!token) return false
  const exp = decodeJwtPayload(token)?.exp
  return typeof exp === 'number' && exp * 1000 - skewMs > nowMs
}

function notify() {
  for (const l of listeners) {
    try { l() } catch (e) { console.error('[googleAuth] listener failed', e) }
  }
}

function handleCredential(resp: GisCredentialResponse) {
  const token = resp?.credential ?? null
  const payload = token ? decodeJwtPayload(token) : null
  const hd = typeof payload?.hd === 'string' ? payload.hd : ''
  if (!token || hd !== ALLOWED_HD) {
    // The registry would 401 it anyway; refuse early with a clear state.
    idToken = null
    console.warn('[googleAuth] ignored a credential outside', ALLOWED_HD)
  } else {
    idToken = token
  }
  notify()
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    const s = existing ?? document.createElement('script')
    s.addEventListener('load', () => resolve(), { once: true })
    s.addEventListener('error', () => reject(new Error('Google sign-in script failed to load')), { once: true })
    if (!existing) {
      s.src = GIS_SRC
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }
  })
}

/** Load GIS once and initialise it. Resolves null (never rejects) so a
 *  blocked script shows as "not signed in" rather than crashing the page. */
export function initGoogleAuth(): Promise<GisId | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!initPromise) {
    initPromise = loadScript()
      .then(() => {
        const gis = window.google?.accounts?.id ?? null
        if (!gis) return null
        gis.initialize({
          client_id: clientId(),
          callback: handleCredential,
          auto_select: true,
          hd: ALLOWED_HD,
          cancel_on_tap_outside: false,
          use_fedcm_for_prompt: true,
        })
        gis.prompt()
        return gis
      })
      .catch((e) => {
        console.warn('[googleAuth]', e instanceof Error ? e.message : e)
        initPromise = null
        return null
      })
  }
  return initPromise
}

/** The current in-memory ID token if it is still fresh, else null. Kicks off
 *  GIS initialisation (and One Tap) the first time it's called. */
export function getIdToken(): string | null {
  void initGoogleAuth()
  if (idToken && !isTokenFresh(idToken)) {
    idToken = null
    void initGoogleAuth().then((gis) => gis?.prompt())
  }
  return idToken
}

/** The registry said 401: drop the token and ask GIS for a new one. */
export function invalidateIdToken(): void {
  idToken = null
  notify()
  void initGoogleAuth().then((gis) => gis?.prompt())
}

export function signOut(): void {
  idToken = null
  window.google?.accounts?.id?.disableAutoSelect()
  notify()
}

export function onAuthChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export async function renderSignInButton(el: HTMLElement): Promise<boolean> {
  const gis = await initGoogleAuth()
  if (!gis) return false
  gis.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'medium', text: 'signin_with', shape: 'pill' })
  return true
}

/** Signed-in account email, for display only. */
export function currentEmail(): string | null {
  if (!idToken) return null
  const email = decodeJwtPayload(idToken)?.email
  return typeof email === 'string' ? email : null
}

/** Test hook: set/clear the in-memory token without GIS. */
export function __setIdTokenForTests(token: string | null): void {
  idToken = token
}
