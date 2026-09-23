/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://docs.example.com/guide?utm_source=newsletter"}
 */

import {
  createFirstTouchKit,
  decodeFirstTouch,
  FIRST_TOUCH_COOKIE,
  type FirstTouch,
} from './first-touch'
import { setPageFirstTouchStorage } from './first-touch-page'

/**
 * The capture in a browser: where the record lands, what consent does to it,
 * and how a hop between hosts carries it. Each test builds its own kit, the
 * way each page load does.
 */

const HOSTS = ['example.com', '*.example.com', 'other-apex.test']
const T0 = Date.UTC(2026, 8, 1, 9, 0, 0)

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', { value, configurable: true })
}

function storedCookie(): FirstTouch | null {
  const part = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${FIRST_TOUCH_COOKIE}=`))
  return part ? decodeFirstTouch(part.slice(FIRST_TOUCH_COOKIE.length + 1)) : null
}

function clearCookies(): void {
  for (const domain of ['', '; Domain=example.com']) {
    document.cookie = `${FIRST_TOUCH_COOKIE}=; Path=/; Max-Age=0${domain}`
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let now = T0
beforeEach(() => {
  now = T0
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  clearCookies()
  sessionStorage.clear()
  delete (window as unknown as Record<string, unknown>)['__aglynFirstTouch']
  delete (window as unknown as Record<string, unknown>)['__aglynFirstTouchStorage']
  history.replaceState(null, '', '/guide?utm_source=newsletter')
  setReferrer('')
})

afterEach(() => {
  jest.restoreAllMocks()
  delete (globalThis as { fetch?: unknown }).fetch
})

describe('where the record lands', () => {
  it('captures an external first visit into a cookie every subdomain reads', () => {
    setReferrer('https://www.g2.com/products/aglyn/reviews')
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS })
    expect(runtime.tier()).toBe('cookie')
    expect(storedCookie()).toEqual({
      v: 1,
      at: T0,
      host: 'docs.example.com',
      path: '/guide',
      ref: 'www.g2.com',
      utm: { source: 'newsletter' },
    })
    // A second surface on the same page load — the console's form, say —
    // reads the same value without having booted anything.
    expect(createFirstTouchKit().read()).toEqual(runtime.read())
  })

  it('never lets a later visit replace the first touch', () => {
    setReferrer('https://www.g2.com/')
    createFirstTouchKit().boot({ hosts: HOSTS })
    now = T0 + 86_400_000
    setReferrer('https://www.google.com/')
    history.replaceState(null, '', '/pricing')
    const later = createFirstTouchKit().boot({ hosts: HOSTS })
    expect(later.read()?.ref).toBe('www.g2.com')
    expect(later.read()?.at).toBe(T0)
  })

  it('keeps an internal referrer as `via` when nothing captured the visit earlier', () => {
    setReferrer('https://app.example.com/signin')
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS })
    expect(runtime.read()?.ref).toBeNull()
    expect(runtime.read()?.via).toBe('app.example.com')
  })

  it('captures nothing on a host the install does not name', () => {
    setReferrer('https://www.g2.com/')
    const runtime = createFirstTouchKit().boot({ hosts: ['somewhere-else.test'] })
    expect(runtime.read()).toBeNull()
    expect(runtime.tier()).toBeNull()
    expect(storedCookie()).toBeNull()
  })

  it('falls back to sessionStorage when the browser refuses the cookie', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => undefined,
    })
    try {
      setReferrer('https://www.g2.com/')
      const runtime = createFirstTouchKit().boot({ hosts: HOSTS })
      expect(runtime.tier()).toBe('session')
      expect(JSON.parse(sessionStorage.getItem('aglyn:first-touch') ?? 'null')?.ref).toBe('www.g2.com')
    } finally {
      delete (document as unknown as Record<string, unknown>)['cookie']
    }
  })
})

describe('what consent does to it', () => {
  it('holds the record in memory while consent is pending, and writes it once granted', () => {
    setReferrer('https://www.g2.com/')
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS, storage: null })
    expect(runtime.tier()).toBe('memory')
    expect(storedCookie()).toBeNull()
    expect(sessionStorage.length).toBe(0)
    runtime.setStorage(true)
    expect(runtime.tier()).toBe('cookie')
    expect(storedCookie()?.ref).toBe('www.g2.com')
  })

  it('erases what it kept when storage is refused, and still answers from memory', () => {
    setReferrer('https://www.g2.com/')
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS })
    expect(storedCookie()).not.toBeNull()
    runtime.setStorage(false)
    expect(storedCookie()).toBeNull()
    expect(runtime.tier()).toBe('memory')
    expect(runtime.read()?.ref).toBe('www.g2.com')
  })

  it('reaches a runtime a served script left on the page', () => {
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS, storage: null })
    ;(window as unknown as Record<string, unknown>)['aglynFirstTouch'] = runtime
    setPageFirstTouchStorage(true)
    expect(runtime.tier()).toBe('cookie')
    expect((window as unknown as Record<string, unknown>)['__aglynFirstTouchStorage']).toBe(true)
    delete (window as unknown as Record<string, unknown>)['aglynFirstTouch']
  })
})

describe('the hand-off between hosts', () => {
  const sealed = { token: 'SEALED.TOKEN', exp: T0 + 30 * 60_000 }

  function mockFetch(respond: (body: Record<string, unknown>) => unknown): jest.Mock {
    const fetchMock = jest.fn(async (_url: string, init: { body: string }) => ({
      ok: true,
      json: async () => respond(JSON.parse(init.body)),
    }))
    ;(globalThis as { fetch?: unknown }).fetch = fetchMock
    return fetchMock
  }

  function link(href: string): HTMLAnchorElement {
    const anchor = document.createElement('a')
    anchor.href = href
    document.body.appendChild(anchor)
    return anchor
  }

  function follow(anchor: HTMLAnchorElement): string {
    const stop = (event: Event) => event.preventDefault()
    document.addEventListener('click', stop)
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    document.removeEventListener('click', stop)
    return anchor.getAttribute('href') ?? ''
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('strips a hand-off from the address bar at once and adopts the earlier record', async () => {
    const earlier: FirstTouch = {
      v: 1,
      at: T0 - 3_600_000,
      host: 'other-apex.test',
      path: '/',
      ref: 'www.g2.com',
    }
    const fetchMock = mockFetch((body) => (body['open'] === 'HANDED' ? { touch: earlier } : null))
    history.replaceState(null, '', '/signup?keep=1&_ft=HANDED#top')
    setReferrer('https://other-apex.test/')
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS, handoffUrl: '/api/first-touch' })
    // Before the platform has even answered: a copied URL no longer carries it.
    expect(location.search).toBe('?keep=1')
    expect(location.hash).toBe('#top')
    await flush()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/first-touch',
      expect.objectContaining({ method: 'POST', credentials: 'omit' }),
    )
    expect(runtime.read()).toEqual(earlier)
    expect(storedCookie()).toEqual(earlier)
  })

  it('adopts nothing the platform will not open', async () => {
    mockFetch(() => null)
    history.replaceState(null, '', '/signup?_ft=FORGED')
    setReferrer('https://www.google.com/')
    const runtime = createFirstTouchKit().boot({ hosts: HOSTS, handoffUrl: '/api/first-touch' })
    await flush()
    expect(runtime.read()?.ref).toBe('www.google.com')
  })

  it('seals the record onto a link the cookie cannot reach, and only that link', async () => {
    const fetchMock = mockFetch((body) => (body['seal'] ? sealed : null))
    const crossSite = link('https://other-apex.test/signup')
    const sameSite = link('https://app.example.com/signup')
    const elsewhere = link('https://www.g2.com/')
    setReferrer('https://www.g2.com/')
    createFirstTouchKit().boot({ hosts: HOSTS, handoffUrl: '/api/first-touch' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(follow(crossSite)).searchParams.get('_ft')).toBe('SEALED.TOKEN')
    // The cookie already reaches every host under the registrable domain.
    expect(follow(sameSite)).toBe('https://app.example.com/signup')
    // And nothing of ours ever rides to a host that is not ours.
    expect(follow(elsewhere)).toBe('https://www.g2.com/')
  })

  it('carries the record to every first-party host while it is held in memory', async () => {
    mockFetch((body) => (body['seal'] ? sealed : null))
    const sameSite = link('https://app.example.com/signup')
    setReferrer('https://www.g2.com/')
    createFirstTouchKit().boot({ hosts: HOSTS, storage: null, handoffUrl: '/api/first-touch' })
    await flush()
    expect(new URL(follow(sameSite)).searchParams.get('_ft')).toBe('SEALED.TOKEN')
  })

  it('never decorates with a token that has expired', async () => {
    mockFetch((body) => (body['seal'] ? sealed : null))
    const crossSite = link('https://other-apex.test/signup')
    setReferrer('https://www.g2.com/')
    createFirstTouchKit().boot({ hosts: HOSTS, handoffUrl: '/api/first-touch' })
    await flush()
    now = sealed.exp
    expect(follow(crossSite)).toBe('https://other-apex.test/signup')
  })
})
