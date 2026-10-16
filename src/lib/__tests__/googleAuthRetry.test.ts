import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Review 2026-10-16, item 8: after one failed load of the Google sign-in
// script, every later attempt reused the dead <script> tag and waited forever,
// so sign-in could not be retried without reloading the page.

const GIS_SRC = 'https://accounts.google.com/gsi/client'

class FakeScript {
  src = ''
  async = false
  defer = false
  private listeners: Record<string, Array<() => void>> = {}
  addEventListener(type: string, fn: () => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  fire(type: string) {
    const fns = this.listeners[type] ?? []
    this.listeners[type] = []
    for (const fn of fns) fn()
  }
  remove() {
    head.children = head.children.filter((c) => c !== this)
  }
}
const head = {
  children: [] as FakeScript[],
  appendChild(el: FakeScript) { this.children.push(el) },
}
const fakeDocument = {
  head,
  createElement: () => new FakeScript(),
  querySelector: (sel: string) => head.children.find((c) => c.src && sel.includes(c.src)) ?? null,
}
let fakeWindow: { google?: unknown }

beforeEach(() => {
  vi.resetModules()
  head.children = []
  fakeWindow = {}
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('window', fakeWindow)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fakeGis() {
  return { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn(), disableAutoSelect: vi.fn() }
}

describe('Google sign-in script retry', () => {
  it('a failed load removes the dead tag, and the next attempt downloads it again and succeeds', async () => {
    const g = await import('../googleAuth')
    const first = g.initGoogleAuth()
    expect(head.children).toHaveLength(1)
    expect(head.children[0]!.src).toBe(GIS_SRC)
    head.children[0]!.fire('error')
    expect(await first).toBeNull()
    expect(head.children).toHaveLength(0)

    const second = g.initGoogleAuth()
    expect(head.children).toHaveLength(1)
    const gis = fakeGis()
    fakeWindow.google = { accounts: { id: gis } }
    head.children[0]!.fire('load')
    expect(await second).toBe(gis)
    expect(gis.initialize).toHaveBeenCalledTimes(1)
  })

  it('a load that never answers times out, removes the tag and can be retried', async () => {
    vi.useFakeTimers()
    const g = await import('../googleAuth')
    const first = g.initGoogleAuth()
    expect(head.children).toHaveLength(1)
    vi.advanceTimersByTime(g.GIS_SCRIPT_TIMEOUT_MS + 1)
    expect(await first).toBeNull()
    expect(head.children).toHaveLength(0)

    void g.initGoogleAuth()
    expect(head.children).toHaveLength(1)
  })

  it('renderSignInButton reports failure so the bar can offer Try again', async () => {
    const g = await import('../googleAuth')
    const result = g.renderSignInButton({} as HTMLElement)
    // renderSignInButton awaits initGoogleAuth, which appended the tag.
    await Promise.resolve()
    head.children[0]!.fire('error')
    expect(await result).toBe(false)
  })
})
