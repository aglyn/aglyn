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
 * A Google Tag Manager container obeys the same gate GA does (AGL-2486).
 *
 * A container is not a tag, it is a LOADER — what it carries is decided in
 * Google's UI by whoever owns it, not here. That is precisely why it cannot
 * have a weaker gate than GA: this codebase's position is that analytics may
 * run on implied consent outside the EU/EEA/UK while ADVERTISING is opt-in
 * everywhere, and a container is the likeliest thing on a page to carry an
 * advertising tag.
 *
 * Two failures this file exists to make impossible:
 *
 * 1. A container-only site having NO consent machinery at all.
 *    `consentGatedCategories` read `resolveGaMeasurementId` alone, so a site
 *    with a container and no GA id had no gated category — no banner, and the
 *    container loading for every visitor in every region.
 * 2. The container loading BEFORE its Consent Mode defaults. Defaults set
 *    after `gtm.js` has been requested are defaults its tags have already run
 *    past, which is the whole failure mode Consent Mode v2 exists to prevent.
 *
 * The `<noscript>` iframe of Google's standard snippet is deliberately absent,
 * and that is asserted too: it fires the container with no JavaScript — so no
 * defaults, no gate, nothing to suppress it — inside ISR-cached HTML that is
 * identical for every visitor and every region. A consent bypass with a
 * fallback's reputation.
 */
import {
  hostConsentRequired,
  storeVisitorConsent,
  visitorConsentStorageKey,
} from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src}>
      {props.children}
    </script>
  ),
}))

const HOST_ID = 'gtm-host-1'
/** A container and NO GA property — the shape that had no gate at all. */
const GTM_HOST = {
  $id: HOST_ID,
  analytics: { gtmContainerId: 'GTM-ABCDE12' },
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

const gtmScript = () => screen.queryByTestId('gtm-src')
const gtmInit = () => screen.queryByTestId('gtm-init')
const askBanner = () => document.querySelector('[data-aglyn-consent-banner]')

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

describe('the GTM consent gate (AGL-2486)', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    delete (global as any).fetch
  })

  it('THE HOLE: a container alone makes the site consent-gated', () => {
    // Read through `resolveGaMeasurementId` alone this was `false`, and every
    // downstream decision followed it: no categories, no banner, no gate.
    expect(hostConsentRequired(GTM_HOST as any)).toBe(true)
  })

  it('EU visitor, undecided: the container never loads; the banner asks', async () => {
    plantRegion('DE')
    await renderPage(GTM_HOST)
    await waitFor(() => expect(askBanner()).toBeTruthy())
    expect(gtmScript()).toBeNull()
    expect(gtmInit()).toBeNull()
  })

  it('Allow loads the container in the same pageview', async () => {
    plantRegion('DE')
    await renderPage(GTM_HOST)
    await waitFor(() => expect(askBanner()).toBeTruthy())
    fireEvent.click(screen.getByText('Allow'))
    expect(gtmScript()?.getAttribute('data-gasrc')).toContain('GTM-ABCDE12')
  })

  it('Decline keeps it out, and the choice persists', async () => {
    plantRegion('FR')
    const first = await renderPage(GTM_HOST)
    await waitFor(() => expect(askBanner()).toBeTruthy())
    fireEvent.click(screen.getByText('Decline'))
    expect(gtmScript()).toBeNull()

    // Next pageview: neither asks nor loads. Unmounted first, or the second
    // render would be asserted against the DOM of both.
    first.unmount()
    await renderPage(GTM_HOST)
    expect(gtmScript()).toBeNull()
    expect(askBanner()).toBeNull()
  })

  it('CONSENT MODE COMES FIRST, in the same script, before gtm.js', async () => {
    // Order is the whole of its correctness. Defaults pushed after the
    // container has loaded are defaults its tags have already run past.
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'DE' })
    plantRegion('DE')
    await renderPage(GTM_HOST)
    const init = gtmInit()
    expect(init).toBeTruthy()
    const source = init?.textContent ?? ''
    expect(source).toContain("gtag('consent', 'default'")
    expect(source.indexOf("gtag('consent', 'default'")).toBeLessThan(
      source.indexOf("'gtm.start'"),
    )
    // And the signals themselves, so "defaults were set" is not satisfied by
    // an empty object arriving in the right order.
    expect(source).toContain('"analytics_storage":"granted"')
  })

  it('keeps ADVERTISING denied for a site that never asked about it', async () => {
    // `consent.advertising` is off for every site unless someone turns it on,
    // and a container that loads under analytics consent must not arrive with
    // ad storage granted.
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'DE' })
    plantRegion('DE')
    await renderPage(GTM_HOST)
    const source = gtmInit()?.textContent ?? ''
    expect(source).toContain('"ad_storage":"denied"')
  })

  it('renders NO noscript iframe — the one part of the snippet left out', async () => {
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
    plantRegion('US')
    const view = await renderPage(GTM_HOST)
    // It would fire the container with no JavaScript — no defaults, no gate —
    // inside ISR HTML shared by every visitor.
    expect(view.container.querySelector('noscript')).toBeNull()
    expect(view.container.innerHTML).not.toContain('ns.html')
  })

  it('refuses a malformed container id rather than inlining it', async () => {
    // The id lands inside an inline script; anything not the exact shape must
    // never reach it (AGL-138).
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
    plantRegion('US')
    await renderPage({
      $id: HOST_ID,
      analytics: { gtmContainerId: "GTM-'+alert(1)+'" },
    })
    expect(gtmScript()).toBeNull()
    expect(gtmInit()).toBeNull()
  })
})
