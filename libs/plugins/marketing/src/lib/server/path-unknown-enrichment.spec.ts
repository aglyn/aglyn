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
 * What this plugin contributes to a surface with no request path (AGL-2511).
 *
 * The designed 404 body is fetched by host and cached per host — one compose a
 * minute however many dead URLs are hit — so the path that 404'd is not part
 * of the key and must not become part of it. `pathUnknown` says so, and the
 * rule it buys is narrow: contribute what does not depend on a path, drop what
 * does, and never substitute a plausible one.
 *
 * The half that must NOT be dropped is the point of the whole exercise. A
 * nav's hover choreography is authored on nodes, carries no path pattern, and
 * is the reason a designed 404 is enriched at all.
 */

jest.mock('../server/get-overlays', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
}))
jest.mock('../server/get-screen-experiments', () => ({
  __esModule: true,
  getScreenExperiments: jest.fn(async () => []),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('../server/get-client-automations', () => ({
  __esModule: true,
  getClientAutomations: jest.fn(async () => []),
}))

import { getClientAutomations } from '../server/get-client-automations'
import getOverlays from '../server/get-overlays'
import { marketingSitePageEnricher } from './site-page-enricher'

const mockOverlays = getOverlays as unknown as jest.Mock
const mockAutomations = getClientAutomations as unknown as jest.Mock

const SITE_WIDE_BAR = {
  $id: 'bar-everywhere',
  kind: 'bar',
  bar: { text: 'We ship on Fridays' },
}
const PRICING_BAR = {
  $id: 'bar-pricing',
  kind: 'bar',
  pathPatterns: ['/pricing'],
  bar: { text: 'Half price today' },
}
const EXCEPT_BLOG_BAR = {
  $id: 'bar-except-blog',
  kind: 'bar',
  excludePathPatterns: ['/blog/*'],
  bar: { text: 'Not on the blog' },
}

/** An org with every marketing entitlement, so nothing is gated off here. */
const ORG = {
  $id: 'org-1',
  plan: 'business',
  subscriptionStatus: 'active',
}

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    hostId: 'host-1',
    host: { $id: 'host-1' },
    org: ORG,
    path: '/',
    slugSegments: [],
    nodes: { root: {} },
    ...overrides,
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  mockAutomations.mockResolvedValue([])
})

describe('pathUnknown enrichment (AGL-2511)', () => {
  it('keeps an overlay that targets every page', async () => {
    mockOverlays.mockResolvedValue([SITE_WIDE_BAR])

    const props: any = await marketingSitePageEnricher(
      context({ pathUnknown: true }),
    )

    expect(props.announcementBar?.text).toBe('We ship on Fridays')
  })

  it('drops an overlay pinned to a path it cannot check', async () => {
    mockOverlays.mockResolvedValue([PRICING_BAR])

    const props: any = await marketingSitePageEnricher(
      context({ pathUnknown: true }),
    )

    expect(props.announcementBar).toBeNull()
  })

  it('drops an overlay that EXCLUDES paths, too', async () => {
    // An exclusion is a path decision like any other: with no path there is
    // no answer to "is this one of the excluded pages", and defaulting to
    // "no" would show it on exactly the pages the author ruled out.
    mockOverlays.mockResolvedValue([EXCEPT_BLOG_BAR])

    const props: any = await marketingSitePageEnricher(
      context({ pathUnknown: true }),
    )

    expect(props.announcementBar).toBeNull()
  })

  it('asks the automations reader to drop path-scoped ones', async () => {
    await marketingSitePageEnricher(context({ pathUnknown: true }))

    expect(mockAutomations).toHaveBeenCalledWith(
      expect.objectContaining({ dropPathScoped: true }),
    )
  })

  it('changes nothing for a page that has a path', async () => {
    mockOverlays.mockResolvedValue([PRICING_BAR])

    const props: any = await marketingSitePageEnricher(
      context({ path: 'pricing', slugSegments: ['pricing'] }),
    )

    expect(props.announcementBar?.text).toBe('Half price today')
    expect(mockAutomations).toHaveBeenCalledWith(
      expect.not.objectContaining({ dropPathScoped: true }),
    )
  })
})
