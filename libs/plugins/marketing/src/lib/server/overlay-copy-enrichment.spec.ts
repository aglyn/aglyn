/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * Overlay copy reaches the published page resolved, on every path (AGL-2887).
 *
 * The site runtime renders a bar's text and a popup's headline and body as it
 * receives them, so these payloads ARE what a visitor reads. Two paths carry
 * overlay copy: the bar and popup a page shows on load, and the overlays an
 * automation's `showOverlay` step opens later. An overlay must read the same
 * on both.
 */

jest.mock('./get-overlays', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
}))
jest.mock('./get-screen-experiments', () => ({
  __esModule: true,
  getScreenExperiments: jest.fn(async () => []),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('./get-client-automations', () => ({
  __esModule: true,
  getClientAutomations: jest.fn(async () => []),
}))

import getVariables from '@aglyn/tenant-runtime/get-variables'
import { getClientAutomations } from './get-client-automations'
import getOverlays from './get-overlays'
import { marketingSitePageEnricher } from './site-page-enricher'

const mockOverlays = getOverlays as unknown as jest.Mock
const mockAutomations = getClientAutomations as unknown as jest.Mock
const mockVariables = getVariables as unknown as jest.Mock

/** The site's variables, keyed by document id as `getVariables` returns them. */
const VARIABLES = {
  'var-sale': { name: 'saleEndsAt', type: 'text', value: 'Sunday at midnight' },
}

const SITE = {
  $id: 'host-1',
  displayName: 'Northwind Coffee',
  subdomain: 'northwind',
}

/** An org with every marketing entitlement, so nothing is gated off here. */
const ORG = { $id: 'org-1', plan: 'business', subscriptionStatus: 'active' }

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    hostId: 'host-1',
    host: SITE,
    org: ORG,
    path: '/',
    slugSegments: [],
    nodes: { root: {} },
    ...overrides,
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  mockOverlays.mockResolvedValue([])
  mockAutomations.mockResolvedValue([])
  mockVariables.mockResolvedValue(VARIABLES)
})

describe('the bar and popup a page shows on load (AGL-2887)', () => {
  it("fills a bar's variables and site details in", async () => {
    mockOverlays.mockResolvedValue([
      {
        $id: 'ov-bar',
        kind: 'bar',
        bar: { text: '{{host.businessName}} sale ends {{var:var-sale}}' },
      },
    ])

    const props: any = await marketingSitePageEnricher(context())

    expect(props.announcementBar.text).toBe(
      'Northwind Coffee sale ends Sunday at midnight',
    )
  })

  it("fills a popup's headline and body in", async () => {
    mockOverlays.mockResolvedValue([
      {
        $id: 'ov-popup',
        kind: 'popup',
        popup: {
          headline: 'A note from {{host.businessName}}',
          body: 'Everything is ten percent off until {{var:var-sale}}.',
        },
      },
    ])

    const props: any = await marketingSitePageEnricher(context())

    expect(props.popup.headline).toBe('A note from Northwind Coffee')
    expect(props.popup.body).toBe(
      'Everything is ten percent off until Sunday at midnight.',
    )
  })

  it("resolves the site's single default bar the same way", async () => {
    const props: any = await marketingSitePageEnricher(
      context({
        host: {
          ...SITE,
          announcementBar: {
            enabled: true,
            text: 'Sale ends {{var:var-sale}} at {{host.businessName}}',
          },
        },
      }),
    )

    expect(props.announcementBar.text).toBe(
      'Sale ends Sunday at midnight at Northwind Coffee',
    )
  })

  it('reads no variables for copy that holds no token', async () => {
    mockOverlays.mockResolvedValue([
      { $id: 'ov-bar', kind: 'bar', bar: { text: 'Free shipping this week' } },
    ])

    const props: any = await marketingSitePageEnricher(context())

    expect(props.announcementBar.text).toBe('Free shipping this week')
    expect(mockVariables).not.toHaveBeenCalled()
  })
})

describe('an overlay an automation shows (AGL-2887)', () => {
  /**
   * Pinned to another page, so it is NOT the bar this page shows on load: the
   * only copy of it on this page is the automation's payload.
   */
  const FLASH_BAR = {
    $id: 'ov-flash',
    kind: 'bar',
    pathPatterns: ['/pricing'],
    bar: {
      text: '{{host.businessName}}: flash sale until {{var:var-sale}}',
      href: '/sale',
      dismissible: false,
    },
  }
  const EXIT_POPUP = {
    $id: 'ov-exit',
    kind: 'popup',
    pathPatterns: ['/pricing'],
    popup: {
      headline: 'Leaving {{host.businessName}}?',
      body: 'The sale ends {{var:var-sale}}.',
      ctaLabel: 'Shop now',
    },
  }
  const automationShowing = (overlayId: string) => ({
    id: `auto-${overlayId}`,
    event: 'pageView',
    steps: [{ type: 'showOverlay', overlayId }],
    hasServerSteps: false,
  })

  it('hands the site runtime a bar whose copy is resolved', async () => {
    mockOverlays.mockResolvedValue([FLASH_BAR])
    mockAutomations.mockResolvedValue([automationShowing('ov-flash')])

    const props: any = await marketingSitePageEnricher(context())

    // Control: the overlay does not match this page on load.
    expect(props.announcementBar).toBeNull()
    expect(props.automationOverlays['ov-flash']).toEqual({
      kind: 'bar',
      bar: {
        text: 'Northwind Coffee: flash sale until Sunday at midnight',
        // Everything that is not copy arrives as stored.
        href: '/sale',
        dismissible: false,
      },
    })
  })

  it("hands the site runtime a popup whose headline and body are resolved", async () => {
    mockOverlays.mockResolvedValue([EXIT_POPUP])
    mockAutomations.mockResolvedValue([automationShowing('ov-exit')])

    const props: any = await marketingSitePageEnricher(context())

    expect(props.automationOverlays['ov-exit'].popup).toEqual({
      headline: 'Leaving Northwind Coffee?',
      body: 'The sale ends Sunday at midnight.',
      ctaLabel: 'Shop now',
    })
  })

  it('reads the variables once, however many overlays need them', async () => {
    mockOverlays.mockResolvedValue([FLASH_BAR, EXIT_POPUP])
    mockAutomations.mockResolvedValue([
      automationShowing('ov-flash'),
      automationShowing('ov-exit'),
    ])

    await marketingSitePageEnricher(context())

    expect(mockVariables).toHaveBeenCalledTimes(1)
  })
})
