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
 */

/**
 * Withdrawing consent CLEANS UP (AGL-1606).
 *
 * `ga-consent-gate.spec.tsx` next door proves the gate stops the script from
 * loading again. That is only half of what the module promises: a withdrawal
 * that leaves the `_ga` identifier in the browser for its full two-year life
 * has not honored the withdrawal. These specs assert on the COOKIES, which is
 * where the promise was being broken — the gate was already green while the
 * cookies survived every decline.
 *
 * Red condition: remove the `clearAnalyticsCookies()` call from
 * `storeVisitorConsent` and the withdrawal cases below go red while every
 * gate spec next door stays green.
 *
 * The two halves are tested differently ON PURPOSE. jsdom will only accept a
 * cookie write for its own origin (`localhost`), so the end-to-end "the cookie
 * is really gone" case runs there — where the registrable domain is `null` and
 * the host-only deletion is the whole answer. The registrable-domain ladder,
 * which is the part that silently no-ops in production when it is wrong, is
 * therefore proven against the derivation and against the exact `domain=`
 * attributes written, not against jsdom's cookie jar.
 */
import {
  analyticsCookieDomains,
  clearAnalyticsCookies,
  registrableCookieDomain,
  storeVisitorConsent,
  VISITOR_ID_STORAGE_KEY,
} from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src} />
  ),
}))

const HOST_ID = 'consent-cookie-host'
const GA_HOST = {
  $id: HOST_ID,
  analytics: { gaMeasurementId: 'G-TEST1234' },
}

function plantRegion(country: string | null) {
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.includes('/api/consent/region')) {
      throw new Error(`Unexpected fetch in spec: ${url}`)
    }
    return { ok: true, json: async () => ({ country }) }
  })
}

async function renderPage(host: Record<string, any>) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(<SiteAnalytics host={host as any} />)
  })
  return result
}

/** The cookie names the jar currently holds, sorted for stable assertions. */
function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter(Boolean)
    .sort()
}

/** What GA leaves behind for `G-TEST1234`, plus a bystander that must survive. */
function plantAnalyticsCookies() {
  document.cookie = '_ga=GA1.1.1234567890.1700000000; path=/'
  document.cookie = '_ga_TEST1234=GS1.1.1700000000; path=/'
  document.cookie = '_gid=GA1.1.99; path=/'
  document.cookie = '_gac_UA-1=1.170; path=/'
  document.cookie = 'aglyn_cart_x=abc; path=/'
}

function clearAllCookies() {
  for (const name of cookieNames()) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

const askBanner = () => document.querySelector('[data-aglyn-consent-banner]')
const pill = () => document.querySelector('[data-aglyn-consent-pill]')

describe('withdrawing consent removes the analytics cookies (AGL-1606)', () => {
  afterEach(() => {
    clearAllCookies()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    delete (navigator as Record<string, any>)['globalPrivacyControl']
    delete (global as any).fetch
  })

  describe('the registrable domain the deletion has to target', () => {
    it('is the last two labels of an ordinary name', () => {
      expect(registrableCookieDomain('acme.com')).toBe('acme.com')
      expect(registrableCookieDomain('www.acme.com')).toBe('acme.com')
      expect(registrableCookieDomain('shop.eu.acme.com')).toBe('acme.com')
    })

    it('is THREE labels under a multi-label public suffix', () => {
      // The case that makes a two-label rule delete nothing: aiming at
      // `.co.uk` is a write every browser refuses, so the real cookie on
      // `.acme.co.uk` would survive the withdrawal untouched.
      expect(registrableCookieDomain('acme.co.uk')).toBe('acme.co.uk')
      expect(registrableCookieDomain('www.acme.co.uk')).toBe('acme.co.uk')
      expect(registrableCookieDomain('shop.acme.com.au')).toBe('acme.com.au')
      expect(registrableCookieDomain('store.acme.co.jp')).toBe('acme.co.jp')
    })

    it('is null where there is nothing above the host to write at', () => {
      // A bare public suffix is not a domain; localhost and IP literals take
      // host-only cookies, which the undecorated deletion already covers.
      expect(registrableCookieDomain('co.uk')).toBeNull()
      expect(registrableCookieDomain('localhost')).toBeNull()
      expect(registrableCookieDomain('127.0.0.1')).toBeNull()
      expect(registrableCookieDomain('[::1]')).toBeNull()
      expect(registrableCookieDomain('')).toBeNull()
      expect(registrableCookieDomain(null)).toBeNull()
    })

    it('tolerates the trailing root dot and mixed case', () => {
      expect(registrableCookieDomain('WWW.Acme.CO.UK.')).toBe('acme.co.uk')
    })
  })

  describe('the ladder of domains a deletion walks', () => {
    it('runs from the exact host up to the registrable domain, inclusive', () => {
      expect(analyticsCookieDomains('www.shop.acme.co.uk')).toEqual([
        '.www.shop.acme.co.uk',
        '.shop.acme.co.uk',
        '.acme.co.uk',
      ])
      expect(analyticsCookieDomains('acme.com')).toEqual(['.acme.com'])
    })

    it('never climbs to the public suffix itself', () => {
      // `.co.uk` and `.com` must never appear: a cookie there would belong to
      // every site under the suffix, and the browser refuses the write anyway.
      for (const host of ['www.acme.co.uk', 'shop.acme.com']) {
        const domains = analyticsCookieDomains(host)
        expect(domains).not.toContain('.co.uk')
        expect(domains).not.toContain('.com')
      }
    })

    it('is empty where cookies are host-only', () => {
      expect(analyticsCookieDomains('localhost')).toEqual([])
      expect(analyticsCookieDomains('127.0.0.1')).toEqual([])
    })
  })

  describe('what the sweep actually writes', () => {
    /** Captures every `document.cookie` assignment instead of applying it. */
    function captureCookieWrites(): { writes: string[]; restore: () => void } {
      const writes: string[] = []
      const held = '_ga=1; _ga_TEST1234=2; _gid=3; aglyn_cart_x=4'
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => held,
        set: (value: string) => {
          writes.push(value)
        },
      })
      return {
        writes,
        restore: () => delete (document as any).cookie,
      }
    }

    it('expires every analytics cookie at every rung, and touches nothing else', () => {
      const { writes, restore } = captureCookieWrites()
      let cleared: string[] = []
      try {
        cleared = clearAnalyticsCookies('www.acme.co.uk')
      } finally {
        restore()
      }

      // Derived by prefix, never hardcoded: `_ga_TEST1234` is found without
      // anyone telling the sweep the measurement id.
      expect(cleared.sort()).toEqual(['_ga', '_ga_TEST1234', '_gid'])
      // The strictly-necessary cart cookie is not ours to delete.
      expect(writes.join(' ')).not.toContain('aglyn_cart_x')

      for (const name of ['_ga', '_ga_TEST1234', '_gid']) {
        const mine = writes.filter((w) => w.startsWith(`${name}=;`))
        // Host-only plus one write per rung of the ladder.
        expect(mine).toHaveLength(3)
        expect(mine.some((w) => !w.includes('domain='))).toBe(true)
        expect(mine.some((w) => w.includes('domain=.acme.co.uk'))).toBe(true)
        expect(mine.some((w) => w.includes('domain=.www.acme.co.uk'))).toBe(true)
        // Every write expires the cookie and covers the whole site.
        for (const write of mine) {
          expect(write).toContain('path=/')
          expect(write).toContain('Max-Age=0')
        }
      }
    })

    it('does nothing at all when there is no analytics cookie to clear', () => {
      const writes: string[] = []
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => 'aglyn_cart_x=4; aglyn_member_x=5',
        set: (value: string) => void writes.push(value),
      })
      try {
        expect(clearAnalyticsCookies('acme.com')).toEqual([])
      } finally {
        delete (document as any).cookie
      }
      expect(writes).toEqual([])
    })
  })

  describe('end to end, through the visitor-facing controls', () => {
    it('Decline removes the GA cookies the implied grant allowed', async () => {
      // The exact production sequence from the AGL-1606 report: an implied US
      // grant leaves cookies behind, then the visitor declines.
      plantAnalyticsCookies()
      window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, 'v-legacy')
      window.history.replaceState(null, '', '/?aglynConsent=ask')
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())

      fireEvent.click(screen.getByText('Decline'))

      expect(cookieNames()).toEqual(['aglyn_cart_x'])
      // The pre-existing half of the promise still holds.
      expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeNull()
    })

    it('Privacy choices opt-out removes them too', async () => {
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(pill()).toBeTruthy())
      // GA is live in this posture; plant what it would have written.
      plantAnalyticsCookies()

      fireEvent.click(pill() as Element)
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByText('Save choices'))

      expect(cookieNames()).toEqual(['aglyn_cart_x'])
    })

    it('GPC, an automatic withdrawal, cleans up the same way', async () => {
      plantAnalyticsCookies()
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      })
      plantRegion('US')
      await renderPage(GA_HOST)

      expect(cookieNames()).toEqual(['aglyn_cart_x'])
    })

    it('a GRANT leaves them alone — cleanup is the withdrawal path only', async () => {
      plantAnalyticsCookies()
      plantRegion('DE')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())

      fireEvent.click(screen.getByText('Allow'))

      expect(cookieNames()).toEqual([
        '_ga',
        '_ga_TEST1234',
        '_gac_UA-1',
        '_gid',
        'aglyn_cart_x',
      ])
    })

    it('storeVisitorConsent clears on every non-granting status', async () => {
      for (const status of ['declined', 'opted-out', 'gpc-opt-out'] as const) {
        plantAnalyticsCookies()
        storeVisitorConsent(HOST_ID, { status })
        expect(cookieNames()).toEqual(['aglyn_cart_x'])
      }
    })
  })
})
