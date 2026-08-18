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
 * `content_group: 'marketing'` is stamped on OUR property's tag config and
 * on nobody else's (AGL-1857).
 *
 * The boundary is the whole point: `aglyn.com` is a tenant site pointed at
 * the platform property, so its config carries the group that makes the
 * marketing/docs/console split one click in GA4 — while a CUSTOMER's site,
 * served by the same runtime with their own measurement id, must get a bare
 * config with no opinion of ours stamped into their property. The
 * discriminator is the measurement id itself: same-property IS the
 * definition of "our surface".
 */

import { storeVisitorConsent } from '@aglyn/aglyn'
import { act, render, screen } from '@testing-library/react'
import SiteAnalytics from '../app/[host]/[[...slug]]/site-analytics'

// `next/script` is inert in jsdom; the ga-consent-gate mock made the script's
// EXISTENCE observable, this one also preserves its inline TEXT — the config
// line under test lives in the children.
jest.mock('next/script', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => (
    <script data-testid={props.id} data-gasrc={props.src}>
      {props.children}
    </script>
  ),
}))

const HOST_ID = 'content-group-host-1'

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

const initScriptText = () =>
  screen.queryByTestId('ga-init')?.textContent ?? ''

describe("content_group: 'marketing' on the platform property only (AGL-1857)", () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    delete (global as any).fetch
  })

  it("aglyn.com's own tag config carries content_group: 'marketing'", async () => {
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
    plantRegion('US')
    await renderPage({
      $id: HOST_ID,
      analytics: { gaMeasurementId: 'G-YW5PG16YTM' },
    })
    const script = initScriptText()
    expect(script).toContain(
      "gtag('config', 'G-YW5PG16YTM', {'content_group':'marketing'});",
    )
  })

  it("a customer's property gets a bare config — no group of ours stamped on their reports", async () => {
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US' })
    plantRegion('US')
    await renderPage({
      $id: HOST_ID,
      analytics: { gaMeasurementId: 'G-CUSTOMER1' },
    })
    const script = initScriptText()
    expect(script).toContain("gtag('config', 'G-CUSTOMER1');")
    expect(script).not.toContain('content_group')
  })

  it('the stamp changes nothing about the consent gate — ungated visitors still get no script at all', async () => {
    plantRegion('DE')
    await renderPage({
      $id: HOST_ID,
      analytics: { gaMeasurementId: 'G-YW5PG16YTM' },
    })
    expect(screen.queryByTestId('ga-init')).toBeNull()
  })
})
