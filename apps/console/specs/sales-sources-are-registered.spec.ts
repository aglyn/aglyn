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
 *
 * @jest-environment node
 */

/**
 * THE SALES A PLUGIN MADE THROUGH THE PLATFORM REACH THE OPERATOR'S RETURN
 * AND ITS REVENUE REPORT, FROM THE REAL PLUGINS (AGL-3080).
 *
 * The staff return asks every plugin that sells through the platform's
 * account for its sales, and REFUSES — blocks the filing — when a declared
 * source did not answer. So a refusal in production would mean this app's
 * loader did not register a source, and this is the spec that finds that
 * out first.
 *
 * It runs the sources' REAL registrars, reached the way the app reaches them:
 * through the generated manifest's `load()` and the registrar the manifest
 * names for the `consoleApi` surface — the surface the route awaits. Then it
 * asks the real route, over documents shaped as the plugins' writers store
 * them, and holds the answer to the figures the route used to compute itself:
 * the numbers did not move when the code did.
 */

let mockDocs = new Map<string, Record<string, unknown>>()
const mockVerifyIdToken = jest.fn()

/**
 * In-memory Firestore for what the route and the sources read: a range, an
 * equality probe, a count and a single document. The range compares like the
 * real thing — null never matches one.
 */
function mockQuery(
  name: string,
  filters: Array<(data: Record<string, unknown>) => boolean>,
): any {
  const matched = () =>
    [...mockDocs.entries()]
      .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
      .filter(([, data]) => filters.every((filter) => filter(data)))
  return {
    where: (field: string, op: string, value: unknown) =>
      mockQuery(name, [
        ...filters,
        (data) => {
          const held = data[field]
          if (op === '==') return held === value
          if (!(held instanceof Date)) return false
          if (op === '>=') return held >= (value as Date)
          if (op === '<') return held < (value as Date)
          return false
        },
      ]),
    count: () => ({
      get: async () => ({ data: () => ({ count: matched().length }) }),
    }),
    limit: (count: number) => ({
      get: async () => {
        const rows = matched().slice(0, count)
        return {
          size: rows.length,
          docs: rows.map(([path, data]) => ({
            id: path.split('/').pop(),
            data: () => data,
            get: (key: string) => data[key],
          })),
        }
      },
    }),
    doc: (id: string) => ({
      get: async () => {
        const data = mockDocs.get(`${name}/${id}`)
        return { exists: Boolean(data), data: () => data, get: (key: string) => data?.[key] }
      },
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => mockQuery(name, []),
        collectionGroup: (name: string) => mockQuery(name, []),
      }),
    }),
  },
  isImpersonationSession: () => false,
}))

// The registrars run below, explicitly; the route's own await is a no-op so
// what is registered is exactly what this spec registered.
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  listRevenueSources,
  PLUGIN_REVENUE_SOURCES,
  readRevenueSources,
} from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import {
  listTaxReturnSources,
  PLUGIN_TAX_RETURN_SOURCES,
  type TaxReturnSection,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { GET } from '../app/api/admin/tax-return/route'
import { CONSOLE_PLUGIN_SERVER_MANIFEST } from '../constants/plugins.server.generated'
import {
  taxReturnAttention,
  taxReturnCsv,
  taxReturnFilingLines,
  type TaxReturnPayload,
} from '../utils/tx-return-webfile'
import {
  TAX_RETURN_SOURCE_DOCS,
  TAX_RETURN_SOURCE_SECTIONS,
} from './fixtures/tax-return-sources.fixture'

async function registerEverySurface(): Promise<string[]> {
  const ran: string[] = []
  for (const entry of CONSOLE_PLUGIN_SERVER_MANIFEST) {
    const registrar = (entry.register as Record<string, string | undefined>)['consoleApi']
    if (!registrar) continue
    const mod = (await entry.load()) as Record<string, unknown>
    const fn = mod[registrar]
    if (typeof fn !== 'function') {
      throw new Error(`"${entry.id}" names ${registrar}, which its server entry does not export`)
    }
    await (fn as () => void | Promise<void>)()
    ran.push(entry.id)
  }
  return ran
}

const returnFor = async (period = '2026-Q3'): Promise<TaxReturnPayload> => {
  const response = await GET(
    new Request(`https://app.aglyn.com/api/admin/tax-return?period=${period}`, {
      method: 'GET',
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as TaxReturnPayload
}

const section = (payload: TaxReturnPayload, id: string): any =>
  (payload.sources ?? []).find((entry) => entry.id === id)

/** The operator's own measured TX invoice, so the return is not empty. */
const seedInvoice = () =>
  mockDocs.set('platformRevenue/in_q3', {
    orgId: 'org-1',
    grossCents: 10660,
    taxCents: 660,
    netCents: 10000,
    currency: 'usd',
    automaticTax: true,
    customerAddress: { country: 'US', state: 'TX' },
    taxLines: [{ amountCents: 660, taxabilityReason: 'taxable_basis_reduced', taxableAmountCents: 8000 }],
    paidAt: new Date('2026-09-15T12:00:00Z'),
  })

describe('the facilitated-sales sources, after this app’s loader has run', () => {
  let ran: string[] = []

  beforeAll(async () => {
    resetPluginServicesForTests()
    ran = await registerEverySurface()
  })

  beforeEach(() => {
    mockDocs = new Map()
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('THE CONTROL: the loader ran the plugins that sell through the platform', () => {
    // Otherwise everything below passes on a loop that registered nothing.
    expect(ran).toEqual(expect.arrayContaining(['commerce', 'marketplace']))
  })

  it('registers a source for every plugin that declares one', () => {
    expect(PLUGIN_TAX_RETURN_SOURCES.length).toBeGreaterThan(0)
    expect(listTaxReturnSources()).toEqual(expect.arrayContaining([...PLUGIN_TAX_RETURN_SOURCES]))
  })

  it('answers every declared source, none refused', async () => {
    const payload = await returnFor()
    expect(payload.sources?.map((entry) => [entry.pluginId, entry.outcome])).toEqual([
      ['commerce', 'answered'],
      ['marketplace', 'answered'],
    ])
    expect(taxReturnAttention(payload).clean).toBe(true)
  })

  /**
   * AGL-1904. Storefront tax: the tax Stripe computed against the platform's
   * registrations, split from a merchant's own rate — the figures the route
   * asserted on its own response before the storefront answered for itself.
   */
  it('serves storefront tax as its own section, never merged into the summary', async () => {
    seedInvoice()
    mockDocs.set('storefrontTaxCollected/cs_q3', {
      hostId: 'host-1',
      orgId: 'org-2',
      taxMode: 'stripe-automatic',
      taxLiability: 'platform',
      grossCents: 10825,
      taxCents: 825,
      currency: 'usd',
      customerAddress: { country: 'US', state: 'TX' },
      taxLines: [{ amountCents: 825, taxableAmountCents: 10000 }],
      paidAt: new Date('2026-09-16T12:00:00Z'),
    })
    mockDocs.set('storefrontTaxCollected/cs_manual', {
      hostId: 'host-2',
      orgId: 'org-3',
      taxMode: 'manual',
      taxLiability: null,
      grossCents: 10800,
      taxCents: 800,
      currency: 'usd',
      customerAddress: { country: 'US', state: 'TX' },
      taxLines: [],
      paidAt: new Date('2026-09-17T12:00:00Z'),
    })
    const payload = await returnFor()
    // The operator's OWN figures are untouched by the storefront rows.
    expect(payload.summary.transactionCount).toBe(1)
    expect(payload.summary.taxCollectedCents).toBe(660)
    // …and the storefront money is present, split by who computed it.
    const storefront = section(payload, 'storefront')
    expect(storefront.summary.aglynLiable.taxCollectedCents).toBe(825)
    expect(storefront.summary.aglynLiable.taxableSalesCents).toBe(10000)
    expect(storefront.summary.merchantManual.taxCollectedCents).toBe(800)
    expect(storefront.rows).toHaveLength(2)

    // THROUGH TO THE FILING: it blocks, and it is stated beside Items 1–3.
    const verdict = taxReturnAttention(payload)
    expect(verdict.items.find((item) => item.id === 'storefrontAglynLiableTax')).toMatchObject({
      severity: 'blocking',
      count: 825,
    })
    const lines = Object.fromEntries(
      taxReturnFilingLines(payload).map((line) => [line.label, line.dollars]),
    )
    expect(lines['Total Texas sales']).toBe('100.00')
    expect(lines['Taxable sales']).toBe('80.00')
    expect(lines['Texas storefront tax under Aglyn’s registration (NOT in Items 1–3)']).toBe('8.25')
    expect(lines['Texas storefront tax under the MERCHANT’s own rate (not Aglyn’s)']).toBe('8.00')
    expect(taxReturnCsv(payload)).toContain(
      '—,Texas storefront tax under Aglyn’s registration (NOT in Items 1–3),8.25,',
    )
  })

  /** AGL-2137. Marketplace tax, net of refunds, stated beside the charge. */
  it('serves marketplace tax as its own section, net of refunds', async () => {
    seedInvoice()
    mockDocs.set('marketplacePurchases/cs_mkt_1', {
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      taxCents: 825,
      feeCents: 2000,
      transferCents: 8000,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    mockDocs.set('marketplacePurchases/cs_mkt_2', {
      listingId: 'listing-2',
      buyerUid: 'buyer-2',
      sellerOrgId: 'seller-org',
      amountCents: 2165,
      taxCents: 165,
      transferCents: 1600,
      refundedCents: 1083,
      createdAt: new Date('2026-09-19T12:00:00Z'),
    })
    const payload = await returnFor()
    expect(payload.summary.taxCollectedCents).toBe(660)
    expect(section(payload, 'storefront').summary.transactionCount).toBe(0)

    const marketplace = section(payload, 'marketplace')
    expect(marketplace.summary.transactionCount).toBe(2)
    expect(marketplace.summary.taxChargedCents).toBe(990)
    expect(marketplace.summary.taxRefundedCents).toBe(83)
    expect(marketplace.summary.taxCollectedCents).toBe(907)
    expect(marketplace.rows).toHaveLength(2)
    expect(
      taxReturnAttention(payload).items.find((item) => item.id === 'marketplaceTaxCollected'),
    ).toMatchObject({ severity: 'blocking', count: 907 })
    expect(taxReturnCsv(payload)).toContain('"Tax collected, net",$9.07,')
  })

  it('answers the page’s fixture exactly as the fixture says', async () => {
    // The page spec renders these sections; this is what makes them the real
    // sources' answer rather than a hand-written one.
    mockDocs = new Map(Object.entries(TAX_RETURN_SOURCE_DOCS))
    const payload = await returnFor()
    expect(payload.sources).toEqual(TAX_RETURN_SOURCE_SECTIONS)
  })

  it('THE NEGATIVE CONTROL: a declared source that registered nothing blocks the filing', async () => {
    // What production looks like when one surface failed to register: the
    // other source still answers, and the return refuses to be filed.
    resetPluginServicesForTests()
    const commerce = CONSOLE_PLUGIN_SERVER_MANIFEST.find((entry) => entry.id === 'commerce')
    const mod = (await commerce!.load()) as Record<string, () => void>
    mod[(commerce!.register as Record<string, string>)['consoleApi']]()
    try {
      const payload = await returnFor()
      const refused = (payload.sources ?? []).find(
        (entry): entry is Extract<TaxReturnSection, { outcome: 'refused' }> =>
          entry.outcome === 'refused',
      )
      expect(refused?.pluginId).toBe('marketplace')
      const verdict = taxReturnAttention(payload)
      expect(verdict.clean).toBe(false)
      expect(verdict.items[0]).toMatchObject({ id: 'marketplaceUnavailable', severity: 'blocking' })
    } finally {
      resetPluginServicesForTests()
      ran = await registerEverySurface()
    }
  })
})

/**
 * The revenue report's sources, registered by the same loader run. Their
 * folds are proved in each plugin; this is where the REAL registration is
 * held, because an app's spec is the one place that can reach both.
 */
describe('the revenue sources, after this app’s loader has run', () => {
  beforeAll(async () => {
    resetPluginServicesForTests()
    await registerEverySurface()
  })

  it('registers a source for every plugin that declares one', () => {
    expect(PLUGIN_REVENUE_SOURCES).toEqual(['commerce', 'marketplace'])
    expect(listRevenueSources()).toEqual(expect.arrayContaining([...PLUGIN_REVENUE_SOURCES]))
  })

  it('answers every declared source, none refused', async () => {
    const sections = await readRevenueSources({
      period: '2026-08',
      start: new Date(Date.UTC(2026, 7, 1)),
      end: new Date(Date.UTC(2026, 8, 1)),
      attributionLimit: 100,
      sweep: (async () => ({ docs: [], truncated: false })) as never,
      orgNames: async () => new Map(),
      nameRows: async () => undefined,
    })
    expect(sections.map((section) => [section.pluginId, section.outcome, section.id])).toEqual([
      ['commerce', 'answered', 'commerce'],
      ['marketplace', 'answered', 'marketplace'],
    ])
  })
})
