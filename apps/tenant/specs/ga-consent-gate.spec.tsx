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
 * The GA consent gate (AGL-1498): enforcement at the source, proven at the
 * source. A banner that does not gate is decoration — so these specs assert
 * on the SCRIPT ELEMENTS, not the banner. The planted regions are the red
 * conditions: remove `analyticsAllowed` from the render condition in
 * `site-analytics.tsx` and the prior-consent cases go red; break the posture
 * resolution (EU or unknown region treated as opt-out) and the
 * planted-region cases go red on their own.
 *
 * RE-ASSERTED AT THE NEW MOUNT POINT (AGL-1550). The gate used to be
 * evaluated inside `CatchAllClient`, below the site-plugin gate, and this
 * file rendered that component — which is why it had to settle
 * `sitePluginLoader` before it could ask a question about consent. The
 * mounts moved to `SiteAnalytics`, a sibling above the gate; every case
 * below is unchanged in substance and still holds, because hoisting moved
 * WHERE the gate is evaluated and never WHEN. That this file no longer
 * imports the plugin loader at all is itself the decoupling evidence: the
 * consent gate and the plugin system now have nothing to say to each other.
 */
import {
  storeVisitorConsent,
  VISITOR_ID_STORAGE_KEY,
  visitorConsentStorageKey,
} from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

// `next/script` is inert in jsdom; a marker element makes "did the GA
// script render at all" directly observable. The gate under test decides
// whether these markers exist, which is exactly the production question —
// the script must never LOAD, not load-and-be-suppressed.
jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src} />
  ),
}))

const HOST_ID = 'consent-host-1'
const GA_HOST = {
  $id: HOST_ID,
  analytics: { gaMeasurementId: 'G-TEST1234' },
}

/** Plants the region the /api/consent/region endpoint reports. */
function plantRegion(country: string | null) {
  ;(global as any).fetch = jest.fn(async (input: any) => {
    const url = String(input)
    if (!url.includes('/api/consent/region')) {
      throw new Error(`Unexpected fetch in spec: ${url}`)
    }
    return {
      ok: true,
      json: async () => ({ country }),
    }
  })
}

async function renderPage(host: Record<string, any>) {
  let result!: ReturnType<typeof render>
  // Awaited act: the consent hook resolves asynchronously after mount (the
  // region fetch), and settles inside this scope. Nothing here suspends any
  // more — the mount no longer sits behind the plugin gate (AGL-1550).
  await act(async () => {
    result = render(<SiteAnalytics host={host as any} />)
  })
  return result
}

const gaScript = () => screen.queryByTestId('ga-src')
const gaInit = () => screen.queryByTestId('ga-init')
const askBanner = () =>
  document.querySelector('[data-aglyn-consent-banner]')
const pill = () => document.querySelector('[data-aglyn-consent-pill]')

const storedRecord = () =>
  JSON.parse(window.localStorage.getItem(visitorConsentStorageKey(HOST_ID)) ?? 'null')


/**
 * These cases describe a PRODUCTION deployment, and now have to say so
 * (AGL-2067): outside one, `analyticsMayEmit()` is false and no tag is
 * created at all. Declared per file rather than in a jest setup, because
 * `NODE_ENV` changes far more than analytics and a global override would
 * quietly move other behaviour under every spec in the repo.
 */
/**
 * `process.env` is typed read-only for `NODE_ENV` in this app (Next ships that
 * declaration), and these cases have to state which deployment they describe
 * — see AGL-2067. One narrow cast, named, rather than one per assignment.
 */
const mutableEnv = process.env as Record<string, string | undefined>

const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}
beforeAll(() => {
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
})
afterAll(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
})

describe('the GA consent gate (AGL-1498)', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    delete (navigator as Record<string, any>)['globalPrivacyControl']
    delete (global as any).fetch
  })

  describe('opt-in posture (prior consent)', () => {
    it('EU visitor, undecided: the GA script never renders; the banner asks', async () => {
      plantRegion('DE')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(gaScript()).toBeNull()
      expect(gaInit()).toBeNull()
      expect(storedRecord()).toBeNull()
    })

    it('UNKNOWN region falls to opt-in: no signal is not a license to track', async () => {
      plantRegion(null)
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(gaScript()).toBeNull()
    })

    it("host 'strict' mode: even a US visitor is asked first", async () => {
      plantRegion('US')
      await renderPage({ ...GA_HOST, consent: { mode: 'strict' } })
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(gaScript()).toBeNull()
    })

    it('Allow loads GA in the same pageview and records `accepted` + country', async () => {
      plantRegion('DE')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      fireEvent.click(screen.getByText('Allow'))
      expect(gaScript()?.getAttribute('data-gasrc')).toContain('G-TEST1234')
      expect(askBanner()).toBeNull()
      expect(storedRecord()).toMatchObject({
        status: 'accepted',
        analytics: true,
        country: 'DE',
      })
    })

    it('Decline records `declined`, keeps GA out, and clears the visitor id', async () => {
      window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, 'v-legacy')
      plantRegion('FR')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      fireEvent.click(screen.getByText('Decline'))
      expect(gaScript()).toBeNull()
      expect(askBanner()).toBeNull()
      expect(storedRecord()).toMatchObject({ status: 'declined', analytics: false })
      expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeNull()
    })

    it('a declined choice persists: the next pageview neither asks nor loads', async () => {
      storeVisitorConsent(HOST_ID, { status: 'declined', country: 'DE' })
      plantRegion('DE')
      await renderPage(GA_HOST)
      expect(gaScript()).toBeNull()
      expect(askBanner()).toBeNull()
      // The pill remains — the way back in either direction.
      await waitFor(() => expect(pill()).toBeTruthy())
    })

    it('a choice is per host — another site on the origin still asks', async () => {
      storeVisitorConsent('some-other-host', { status: 'accepted' })
      plantRegion('DE')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(gaScript()).toBeNull()
    })
  })

  describe('opt-out posture (implied consent — the Squarespace shape)', () => {
    it('US visitor: GA is live from first paint, records implied,US — and NO banner, NO notice', async () => {
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() =>
        expect(gaScript()?.getAttribute('data-gasrc')).toContain('G-TEST1234'),
      )
      expect(askBanner()).toBeNull()
      expect(storedRecord()).toMatchObject({
        status: 'implied',
        analytics: true,
        country: 'US',
      })
      // The ONLY discoverable opt-out surface — it must be there.
      expect(pill()).toBeTruthy()
    })

    it('opting out via Privacy choices stops GA and records `opted-out`', async () => {
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(gaScript()).toBeTruthy())
      fireEvent.click(pill() as Element)
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement
      expect(checkbox.checked).toBe(true) // implied = currently granted
      fireEvent.click(checkbox)
      fireEvent.click(screen.getByText('Save choices'))
      expect(gaScript()).toBeNull()
      expect(storedRecord()).toMatchObject({ status: 'opted-out', analytics: false })
      // And the opt-out sticks on the next pageview.
    })

    it('an opted-out visitor stays out on later pageviews', async () => {
      storeVisitorConsent(HOST_ID, { status: 'opted-out', country: 'US' })
      plantRegion('US')
      await renderPage(GA_HOST)
      expect(gaScript()).toBeNull()
      expect(askBanner()).toBeNull()
      await waitFor(() => expect(pill()).toBeTruthy())
    })

    it('accepting after opting out works — the control runs BOTH directions', async () => {
      storeVisitorConsent(HOST_ID, { status: 'opted-out', country: 'US' })
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(pill()).toBeTruthy())
      fireEvent.click(pill() as Element)
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByText('Save choices'))
      expect(gaScript()).toBeTruthy()
      expect(storedRecord()).toMatchObject({ status: 'accepted' })
    })
  })

  describe('Global Privacy Control', () => {
    it('GPC is an automatic opt-out — even where implied consent would apply', async () => {
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      })
      plantRegion('US')
      await renderPage(GA_HOST)
      expect(gaScript()).toBeNull()
      expect(askBanner()).toBeNull()
      expect(storedRecord()).toMatchObject({
        status: 'gpc-opt-out',
        analytics: false,
      })
      await waitFor(() => expect(pill()).toBeTruthy())
    })

    it('GPC overrides a previously recorded implied default', async () => {
      storeVisitorConsent(HOST_ID, { status: 'implied', country: 'US' })
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      })
      plantRegion('US')
      await renderPage(GA_HOST)
      expect(gaScript()).toBeNull()
      expect(storedRecord()).toMatchObject({ status: 'gpc-opt-out' })
    })

    it('an explicit accept outranks GPC — a specific choice beats a blanket signal', async () => {
      storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      })
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(gaScript()).toBeTruthy())
      expect(storedRecord()).toMatchObject({ status: 'accepted' })
    })
  })

  describe('machinery boundaries', () => {
    it('host opt-out of the tool: GA loads ungated, no consent UI at all', async () => {
      plantRegion('DE')
      await renderPage({ ...GA_HOST, consent: { disabled: true } })
      expect(gaScript()).toBeTruthy()
      expect(askBanner()).toBeNull()
      expect(pill()).toBeNull()
    })

    it('no analytics configured: no gate, no banner, no pill — nothing to consent to', async () => {
      plantRegion('DE')
      await renderPage({ $id: HOST_ID })
      expect(gaScript()).toBeNull()
      expect(askBanner()).toBeNull()
      expect(pill()).toBeNull()
    })

    it('a malformed GA id renders neither script nor consent UI (AGL-138 format gate)', async () => {
      plantRegion('US')
      await renderPage({
        $id: HOST_ID,
        analytics: { gaMeasurementId: 'G-1"</script><script>alert(1)' },
      })
      expect(gaScript()).toBeNull()
      expect(askBanner()).toBeNull()
    })

    it('?aglynConsent=ask simulates a prior-consent first visit — strictness-only override', async () => {
      // Even with an implied grant recorded, the override shows the banner
      // and holds the script: it can only ever ADD the ask, never strip it.
      storeVisitorConsent(HOST_ID, { status: 'implied', country: 'US' })
      window.history.replaceState(null, '', '/?aglynConsent=ask')
      plantRegion('US')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      expect(gaScript()).toBeNull()
    })
  })

  describe('the persistent Privacy choices surface', () => {
    it('renders in every resolved state the machinery is active for', async () => {
      // Implied (US), declined (EU), accepted — the pill is always there;
      // with no notice in the implied posture it is the ONE opt-out surface.
      for (const status of ['implied', 'accepted', 'declined'] as const) {
        window.localStorage.clear()
        storeVisitorConsent(HOST_ID, { status, country: 'US' })
        plantRegion('US')
        const view = await renderPage(GA_HOST)
        await waitFor(() => expect(pill()).toBeTruthy())
        view.unmount()
      }
    })

    it('symmetric preferences: Decline all sits beside Save choices', async () => {
      plantRegion('DE')
      await renderPage(GA_HOST)
      await waitFor(() => expect(askBanner()).toBeTruthy())
      fireEvent.click(screen.getByText('Preferences'))
      expect(screen.getByText('Decline all')).toBeTruthy()
      expect(screen.getByText('Save choices')).toBeTruthy()
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByText('Save choices'))
      expect(gaScript()).toBeTruthy()
      expect(storedRecord()).toMatchObject({ status: 'accepted' })
    })
  })
})
