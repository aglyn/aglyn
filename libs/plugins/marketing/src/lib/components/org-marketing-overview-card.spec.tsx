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
 */

/**
 * THE ORGANIZATION'S OVERVIEW — what it has to get right.
 *
 *  1. The email figures are the org's: one collection, every site's sends.
 *  2. Overlays and tests are per SITE: one row each, linked to the site's own
 *     Overview, totaled underneath — and a total is never printed over a
 *     column one site did not answer.
 *  3. The per-site read is bounded, and the card says so when it bit.
 *  4. A channel the plan does not carry is not read at all.
 */

import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Each aggregate's answer, keyed `path|filters|field` (`count` for a count). */
const answers = new Map<string, number>()
/** Aggregates the server refuses rather than answers. */
const refused = new Set<string>()
/** Every aggregate asked for, in order — the card's read bill. */
const asked: string[] = []

const keyOf = (target: any, field: string) =>
  `${target.__path}|${(target.__where ?? []).join('&')}|${field}`

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
    __where: [],
  }),
  query: (base: any, ...clauses: any[]) => ({
    __path: base.__path,
    __where: [
      ...(base.__where ?? []),
      ...clauses.filter((clause) => clause?.__where).map((clause) => clause.__where),
    ],
  }),
  where: (field: string, op: string, value: unknown) => ({
    __where: `${field}${op}${String(value)}`,
  }),
  sum: (field: string) => ({ __sum: field }),
  getCountFromServer: async (target: any) => {
    const key = keyOf(target, 'count')
    asked.push(key)
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (refused.has(key)) throw new Error('permission-denied')
    return { data: () => ({ count: answers.get(key) ?? 0 }) }
  },
  getAggregateFromServer: async (target: any, spec: any) => {
    const key = keyOf(target, spec.total.__sum)
    asked.push(key)
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (refused.has(key)) throw new Error('permission-denied')
    return { data: () => ({ total: answers.get(key) ?? 0 }) }
  },
}))

const FIRESTORE = { __firestore: true }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ({ orgId: 'org1', ready: true, scope: ['orgs', 'org1'] }),
}))

/** The plan's answer per flag; both channels on unless a test says otherwise. */
const entitlements: Record<string, boolean> = {}
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  checkEntitlement: (_org: unknown, flag: string) => entitlements[flag] !== false,
  pluginDocsHelp: () => undefined,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/marketing/overview',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ orgSlug: 'acme' }),
}))

import { MarketingOrgMountProvider } from './marketing-org-mount'
import {
  ORG_OVERVIEW_SITE_CAP,
  OrgMarketingOverviewCard,
} from './org-marketing-overview-card'

type Site = { id: string; name: string; subdomain: string | null }

const SHOP: Site = { id: 'shop1', name: 'Shop', subdomain: 'shop' }
const BLOG: Site = { id: 'blog1', name: 'Blog', subdomain: 'blog' }

async function renderCard(hosts: Site[]): Promise<void> {
  render(
    (
      <MarketingOrgMountProvider
        value={{
          orgId: 'org1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
          basePath: '/acme/marketing',
        }}
      >
        <OrgMarketingOverviewCard org={{ plan: 'business' } as never} />
      </MarketingOrgMountProvider>
    ) as ReactNode as never,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The cells of the site table's row whose first cell reads `name`. */
function rowCells(name: string): string[] {
  const table = screen.getByRole('table', { name: 'Figures by site' })
  const row = within(table).getByText(name).closest('tr') as HTMLElement
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '')
}

beforeEach(() => {
  answers.clear()
  refused.clear()
  asked.length = 0
  for (const flag of Object.keys(entitlements)) delete entitlements[flag]
})

describe('the email figures', () => {
  it('are summed over every site’s sends in the org’s one collection', async () => {
    answers.set('orgs/org1/campaigns||stats.sent', 1200)
    answers.set('orgs/org1/campaigns||stats.opens', 300)
    answers.set('orgs/org1/campaigns||stats.clicks', 40)
    answers.set('orgs/org1/campaigns|status==scheduled|count', 2)
    await renderCard([SHOP, BLOG])

    expect(screen.getByText('1,200')).toBeTruthy()
    expect(screen.getByText('300 / 40')).toBeTruthy()
    expect(screen.getByText('Scheduled sends')).toBeTruthy()
    // Not one query per site: the sends are the organization's.
    expect(asked.filter((key) => key.startsWith('orgs/'))).toHaveLength(4)
  })
})

describe('the figures by site', () => {
  it('gives each site a row that opens the site’s own Overview', async () => {
    await renderCard([SHOP, BLOG])
    const link = screen.getByRole('link', { name: 'Shop' })
    expect(link.getAttribute('href')).toBe('/acme/hosts/shop/marketing/overview')
    expect(screen.getByRole('link', { name: 'Blog' }).getAttribute('href')).toBe(
      '/acme/hosts/blog/marketing/overview',
    )
  })

  it('names a site with no address and does not link it', async () => {
    await renderCard([SHOP, { id: 'lost1', name: 'Lost', subdomain: null }])
    expect(rowCells('Lost')[0]).toBe('Lost')
    expect(screen.queryByRole('link', { name: 'Lost' })).toBeNull()
  })

  it('totals every column across the sites', async () => {
    answers.set('hosts/shop1/overlays||stats.impressions', 1000)
    answers.set('hosts/shop1/overlays||stats.clicks', 30)
    answers.set('hosts/shop1/experiments|status==running|count', 1)
    answers.set('hosts/shop1/experiments|winnerVariantId!=null|count', 2)
    answers.set('hosts/blog1/overlays||stats.impressions', 500)
    answers.set('hosts/blog1/overlays||stats.clicks', 5)
    answers.set('hosts/blog1/experiments|status==running|count', 3)
    await renderCard([SHOP, BLOG])

    expect(rowCells('Shop')).toEqual(['Shop', '1,000', '30', '1', '2'])
    expect(rowCells('Blog')).toEqual(['Blog', '500', '5', '3', '0'])
    expect(rowCells('All sites')).toEqual(['All sites', '1,500', '35', '4', '2'])
  })

  /*
   * A column one site did not answer has no total. Summing the sites that
   * did would print the organization's figure with a site quietly missing
   * from it.
   */
  it('draws a refused figure as a dash, and withholds its column’s total', async () => {
    answers.set('hosts/shop1/overlays||stats.impressions', 1000)
    refused.add('hosts/blog1/overlays||stats.impressions')
    answers.set('hosts/blog1/overlays||stats.clicks', 5)
    await renderCard([SHOP, BLOG])

    expect(rowCells('Blog')[1]).toBe('—')
    expect(rowCells('All sites')[1]).toBe('—')
    // The columns everyone answered still total.
    expect(rowCells('All sites')[2]).toBe('5')
  })

  it('reads the first sites up to the cap, and says so', async () => {
    const sites: Site[] = Array.from(
      { length: ORG_OVERVIEW_SITE_CAP + 3 },
      (_, index) => ({
        id: `site${index + 1}`,
        name: `Site ${index + 1}`,
        subdomain: `site-${index + 1}`,
      }),
    )
    await renderCard(sites)

    const perSite = asked.filter((key) => key.startsWith('hosts/'))
    expect(perSite).toHaveLength(4 * ORG_OVERVIEW_SITE_CAP)
    expect(
      perSite.some((key) => key.startsWith(`hosts/site${ORG_OVERVIEW_SITE_CAP + 1}/`)),
    ).toBe(false)
    expect(
      screen.getByText(
        new RegExp(`has ${ORG_OVERVIEW_SITE_CAP + 3} sites.*first ${ORG_OVERVIEW_SITE_CAP}`),
      ),
    ).toBeTruthy()
    // The totals say which sites they cover.
    expect(screen.getByText(`These ${ORG_OVERVIEW_SITE_CAP} sites`)).toBeTruthy()
  })

  it('pages the site rows and keeps the totals under every page', async () => {
    const sites: Site[] = Array.from({ length: 12 }, (_, index) => ({
      id: `site${index + 1}`,
      name: `Site ${index + 1}`,
      subdomain: `site-${index + 1}`,
    }))
    await renderCard(sites)
    expect(screen.getByRole('link', { name: 'Site 10' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Site 11' })).toBeNull()
    expect(screen.getByText('All sites')).toBeTruthy()
    // Every capped site was read on arrival, not just the first page.
    expect(
      new Set(asked.filter((key) => key.startsWith('hosts/')).map((key) => key.split('/')[1]))
        .size,
    ).toBe(12)
  })
})

describe('the plan', () => {
  it('reads no A/B figures without the A/B plan, and draws no column for them', async () => {
    entitlements.abTesting = false
    await renderCard([SHOP])
    expect(asked.some((key) => key.includes('/experiments'))).toBe(false)
    expect(screen.queryByText('Tests running')).toBeNull()
    expect(screen.getByText('Overlay views')).toBeTruthy()
  })

  it('reads nothing per site when the plan carries neither channel', async () => {
    entitlements.abTesting = false
    entitlements.marketingOverlays = false
    await renderCard([SHOP, BLOG])
    expect(asked.every((key) => key.startsWith('orgs/'))).toBe(true)
    expect(screen.queryByRole('table', { name: 'Figures by site' })).toBeNull()
  })
})
