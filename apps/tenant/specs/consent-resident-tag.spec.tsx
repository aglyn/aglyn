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
 * A withdrawal has to stop the tag that is ALREADY RUNNING (AGL-1608).
 *
 * `ga-consent-gate.spec.tsx` proves the script never loads without a grant, and
 * `consent-cookie-cleanup.spec.tsx` proves a withdrawal deletes the cookies a
 * grant allowed. Both are true and neither covers the visitor who withdraws
 * MID-PAGEVIEW: `gtag.js` has already executed, and unmounting the `<script>`
 * element does not unload it. The resident tag re-writes `_ga_<id>` on its next
 * event — after the sweep has run — so the withdrawal silently un-does itself.
 *
 * REPRODUCED on aglyn.com (2026-08-14, production build): implied US grant →
 * Privacy choices → Decline all → recorded `opted-out` → cookies swept to zero
 * by hand → a scroll to 100% depth brought `_ga_YW5PG16YTM` back. A CTA click
 * brought it back a second time AND pushed a `select_content` event, because
 * `installLinkClickTracking` reaches `window.gtag` unconditionally on the
 * documented assumption that an ungranted visitor has no gtag to reach.
 *
 * ## What the fake tag models, and why that is not assuming the conclusion
 *
 * Each spec below installs a fake gtag that honors exactly ONE of the two
 * documented ways to silence a live GA tag, and writes the cookie otherwise:
 *
 * - `residentTagHonoring('ga-disable')` — the `window['ga-disable-G-XXXX']`
 *   flag gtag.js checks before every hit (Google's own opt-out mechanism).
 * - `residentTagHonoring('consent-mode')` — a `gtag('consent', 'update', …)`
 *   carrying `analytics_storage: 'denied'`.
 *
 * Because neither fake honors the other's signal, a fix that issued only one
 * of them would leave the other spec red. That is what makes these assertions
 * about the module's behavior rather than about the fake.
 *
 * Red condition: remove the `setResidentAnalyticsTags(...)` call from
 * `storeVisitorConsent` and every case in "the resident tag is silenced" goes
 * red while the gate and cookie-cleanup specs next door stay green.
 */
import {
  residentGaMeasurementIds,
  setResidentAnalyticsTags,
  storeVisitorConsent,
} from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src} />
  ),
}))

const HOST_ID = 'resident-tag-host'
const GA_ID = 'G-TEST1234'
const GA_HOST = { $id: HOST_ID, analytics: { gaMeasurementId: GA_ID } }

/** The cookie names the jar currently holds, sorted for stable assertions. */
function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter(Boolean)
    .sort()
}

function clearAllCookies() {
  for (const name of cookieNames()) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

const scope = () => window as unknown as Record<string, any>

/**
 * A gtag that behaves like the real one for the property `G-TEST1234`: every
 * event refreshes the session cookie, unless it has been silenced by the one
 * mechanism this fake honors.
 *
 * Returns `fire()` — the enhanced-measurement event the visitor's scroll or
 * outbound click would trigger on its own — and the consent payloads it saw.
 */
function residentTagHonoring(mechanism: 'ga-disable' | 'consent-mode') {
  const consentUpdates: Record<string, string>[] = []
  let deniedByConsentMode = false
  const gtag = (...args: any[]) => {
    if (args[0] === 'consent' && args[1] === 'update') {
      const payload = (args[2] ?? {}) as Record<string, string>
      consentUpdates.push(payload)
      if (payload.analytics_storage === 'denied') deniedByConsentMode = true
      if (payload.analytics_storage === 'granted') deniedByConsentMode = false
      return
    }
    const silenced =
      mechanism === 'ga-disable'
        ? scope()[`ga-disable-${GA_ID}`] === true
        : deniedByConsentMode
    if (silenced) return
    document.cookie = `_ga_TEST1234=GS1.1.${Date.now()}; path=/`
    document.cookie = `_ga=GA1.1.1234567890.1700000000; path=/`
  }
  scope().gtag = gtag
  scope().dataLayer = [['js', new Date()], ['config', GA_ID]]
  // The tag has been running since page load: the cookies exist already.
  gtag('event', 'page_view')
  return {
    fire: () => gtag('event', 'scroll'),
    consentUpdates,
  }
}

async function renderPage(host: Record<string, any>) {
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.includes('/api/consent/region')) {
      throw new Error(`Unexpected fetch in spec: ${url}`)
    }
    return { ok: true, json: async () => ({ country: 'US' }) }
  })
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(<SiteAnalytics host={host as any} />)
  })
  return result
}

const pill = () => document.querySelector('[data-aglyn-consent-pill]')

describe('a withdrawal silences the already-loaded tag (AGL-1608)', () => {
  afterEach(() => {
    clearAllCookies()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    delete scope().gtag
    delete scope().dataLayer
    delete scope()[`ga-disable-${GA_ID}`]
    delete (global as any).fetch
    document.head.innerHTML = ''
  })

  describe('which tags are resident', () => {
    it('reads the measurement id off a loaded gtag.js script', () => {
      const script = document.createElement('script')
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
      document.head.appendChild(script)

      expect(residentGaMeasurementIds()).toEqual([GA_ID])
    })

    it('also reads it off a dataLayer config, which is what GTM leaves', () => {
      // The script element is not the only way a tag arrives, and it is the
      // dataLayer that says which properties the resident tag is configured
      // for — a page can carry an id no <script src> mentions.
      scope().dataLayer = [['js', new Date()], ['config', 'G-FROMLAYER']]

      expect(residentGaMeasurementIds()).toEqual(['G-FROMLAYER'])
    })

    it('refuses a malformed id rather than writing a junk window flag', () => {
      const script = document.createElement('script')
      script.src = 'https://www.googletagmanager.com/gtag/js?id=not-an-id'
      document.head.appendChild(script)
      scope().dataLayer = [['config', 'javascript:evil']]

      expect(residentGaMeasurementIds()).toEqual([])
    })

    it('is empty on the common pageview where the gate held the script out', () => {
      expect(residentGaMeasurementIds()).toEqual([])
    })
  })

  describe('the resident tag is silenced', () => {
    it('cannot re-write the cookies after an opt-out — ga-disable tag', () => {
      const tag = residentTagHonoring('ga-disable')
      expect(cookieNames()).toContain('_ga')

      storeVisitorConsent(HOST_ID, { status: 'opted-out' })
      // Enhanced measurement fires on its own AFTER the withdrawal.
      tag.fire()

      expect(cookieNames()).toEqual([])
    })

    it('cannot re-write the cookies after an opt-out — consent-mode tag', () => {
      const tag = residentTagHonoring('consent-mode')
      expect(cookieNames()).toContain('_ga')

      storeVisitorConsent(HOST_ID, { status: 'opted-out' })
      tag.fire()

      expect(cookieNames()).toEqual([])
    })

    it('holds for every non-granting status, not just the one that was clicked', () => {
      for (const status of ['declined', 'opted-out', 'gpc-opt-out'] as const) {
        const tag = residentTagHonoring('ga-disable')
        storeVisitorConsent(HOST_ID, { status })
        tag.fire()
        expect(cookieNames()).toEqual([])
        delete scope()[`ga-disable-${GA_ID}`]
      }
    })

    it('sets the ga-disable flag and denies storage in the consent update', () => {
      const tag = residentTagHonoring('consent-mode')

      storeVisitorConsent(HOST_ID, { status: 'declined' })

      expect(scope()[`ga-disable-${GA_ID}`]).toBe(true)
      expect(tag.consentUpdates).toHaveLength(1)
      expect(tag.consentUpdates[0]).toEqual({
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      })
    })

    it('silences BEFORE it sweeps, so nothing can be written in between', () => {
      // Order is the whole difference between a clean withdrawal and one that
      // deletes three cookies and immediately gets one back.
      const order: string[] = []
      const tag = (...args: any[]) => {
        if (args[0] === 'consent') order.push('silence')
      }
      scope().gtag = tag
      scope().dataLayer = [['config', GA_ID]]
      document.cookie = '_ga=GA1.1.1; path=/'
      const jar = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '_ga=GA1.1.1',
        set: () => void order.push('sweep'),
      })
      try {
        storeVisitorConsent(HOST_ID, { status: 'opted-out' })
      } finally {
        delete (document as any).cookie
        if (jar) Object.defineProperty(Document.prototype, 'cookie', jar)
      }

      expect(order[0]).toBe('silence')
      expect(order).toContain('sweep')
    })
  })

  describe('what it does NOT do', () => {
    it('leaves a granting state able to measure', () => {
      const tag = residentTagHonoring('ga-disable')
      clearAllCookies()

      storeVisitorConsent(HOST_ID, { status: 'accepted' })
      tag.fire()

      expect(scope()[`ga-disable-${GA_ID}`]).toBe(false)
      expect(cookieNames()).toEqual(['_ga', '_ga_TEST1234'])
    })

    it('re-grants ANALYTICS only — advertising was never asked about', () => {
      const tag = residentTagHonoring('consent-mode')

      storeVisitorConsent(HOST_ID, { status: 'accepted' })

      expect(tag.consentUpdates[0]).toEqual({
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      })
    })

    it('survives the common case where no tag ever loaded', () => {
      // `window.gtag` does not exist on a pageview the gate held the script out
      // of, which is most of them. A withdrawal must not throw there.
      expect(() =>
        storeVisitorConsent(HOST_ID, { status: 'declined' }),
      ).not.toThrow()
      expect(setResidentAnalyticsTags(false)).toEqual([])
    })

    it('does not load a script, or change the gate, on the way past', () => {
      // The AGL-1498 property this fix had to stay inside: silencing acts on a
      // tag that is ALREADY resident. It never introduces one, and it never
      // declares a pre-load consent default that would turn the gate into
      // load-then-restrict.
      const before = document.querySelectorAll('script').length
      setResidentAnalyticsTags(false)
      expect(document.querySelectorAll('script').length).toBe(before)
    })
  })

  describe('end to end, through the Privacy choices control', () => {
    it('the opt-out the visitor clicks silences the tag they are opting out of', async () => {
      await renderPage(GA_HOST)
      await waitFor(() => expect(pill()).toBeTruthy())
      const tag = residentTagHonoring('ga-disable')

      fireEvent.click(pill() as Element)
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByText('Save choices'))
      tag.fire()

      expect(cookieNames()).toEqual([])
    })
  })
})
