/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * The staff tax-return route serves the filable figures and refuses everyone
 * else (AGL-1811).
 *
 * The aggregation itself is `tx-return.spec.ts`'s subject; this file pins the
 * ASSEMBLY — the staff gate in front of the platform's most sensitive revenue
 * listing, the period parse refusing garbage, and the undated-rows probe that
 * keeps a range-invisible row from silently understating a filing.
 */

export {}

/** Every document, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()

const mockVerifyIdToken = jest.fn()

/**
 * In-memory Firestore for the two queries the route runs: a `paidAt` range
 * and a `paidAt == null` equality probe. The range compares like the real
 * thing — null never matches a range — which is the exact semantic the
 * probe exists for.
 */
function mockMakeFirestore() {
  const query = (name: string, filters: Array<(data: Record<string, unknown>) => boolean>) => ({
    where: (field: string, op: string, value: unknown) =>
      query(name, [
        ...filters,
        (data) => {
          const held = data[field]
          if (op === '==') return held === value
          if (held == null || !(held instanceof Date)) return false
          if (op === '>=') return held >= (value as Date)
          if (op === '<') return held < (value as Date)
          return false
        },
      ]),
    limit: (count: number) => ({
      get: async () => {
        const matched = [...docs.entries()]
          .filter(([path]) => path.startsWith(`${name}/`))
          .filter(([, data]) => filters.every((filter) => filter(data)))
          .slice(0, count)
        return {
          size: matched.length,
          docs: matched.map(([path, data]) => ({
            id: path.split('/').pop(),
            data: () => data,
            get: (key: string) => data[key],
          })),
        }
      },
    }),
  })
  return {
    collection: (name: string) => query(name, []),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockMakeFirestore(),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: null,
    headers: Object.fromEntries(request.headers),
  }),
}))

const { GET } = require('./route') as {
  GET: (request: Request) => Promise<Response>
}

function get(period: string, token: string | null = 'staff-token') {
  return new Request(
    `https://app.aglyn.com/api/admin/tax-return?period=${encodeURIComponent(period)}`,
    {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
  )
}

/** The measured TX row shape, as the webhook stores it. */
function seedRow(
  invoiceId: string,
  overrides: Record<string, unknown> = {},
): void {
  docs.set(`platformRevenue/${invoiceId}`, {
    orgId: 'org-1',
    grossCents: 10660,
    taxCents: 660,
    netCents: 10000,
    currency: 'usd',
    automaticTax: true,
    customerAddress: { country: 'US', state: 'TX', city: 'Testville', postalCode: '00000' },
    taxLines: [
      {
        amountCents: 660,
        taxabilityReason: 'taxable_basis_reduced',
        taxRateId: 'txr_tx_state',
        taxableAmountCents: 8000,
      },
    ],
    paidAt: new Date('2026-09-15T12:00:00Z'),
    ...overrides,
  })
}

describe('GET /api/admin/tax-return (AGL-1811)', () => {
  beforeEach(() => {
    docs = new Map()
    mockVerifyIdToken.mockReset()
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
  })

  it('THE GATE: no token 401s, a non-staff token 403s — before any read', async () => {
    expect((await GET(get('2026-Q3', null))).status).toBe(401)
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
    expect((await GET(get('2026-Q3'))).status).toBe(403)
  })

  it('a malformed period 400s instead of summing the wrong window', async () => {
    for (const bad of ['', '2026', 'Q3', '2026-Q5']) {
      expect([bad, (await GET(get(bad))).status]).toEqual([bad, 400])
    }
  })

  it('serves the period figures: only rows paid inside the quarter', async () => {
    seedRow('in_q3')
    seedRow('in_q4', { paidAt: new Date('2026-11-01T00:00:00Z') })
    const response = await GET(get('2026-Q3'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.summary.transactionCount).toBe(1)
    expect(body.summary.totalSalesCents).toBe(10000)
    expect(body.summary.taxableSalesCents).toBe(8000)
    expect(body.summary.taxCollectedCents).toBe(660)
    expect(body.summary.byJurisdiction['US-TX'].taxCollectedCents).toBe(660)
    expect(body.rows).toEqual([
      {
        invoiceId: 'in_q3',
        orgId: 'org-1',
        paidAt: '2026-09-15T12:00:00.000Z',
        grossCents: 10660,
        taxCents: 660,
        taxableSalesCents: 8000,
        state: 'TX',
        country: 'US',
        automaticTax: true,
        refundedCents: 0,
        // Read with the revenue report's own `=== true`, so the seeded row's
        // absent flag is a real sale rather than an exclusion.
        internalTraffic: false,
        // Empty because this row is clean — the array is what lets a count on
        // the screen resolve to the invoices behind it.
        findings: [],
      },
    ])
  })

  it('counts rows a range query can never see — undated rows must be zero before filing', async () => {
    seedRow('in_q3')
    seedRow('in_undated', { paidAt: null })
    const body = await (await GET(get('2026-Q3'))).json()
    // Invisible to the period sum…
    expect(body.summary.transactionCount).toBe(1)
    // …and said out loud instead of silently absent.
    expect(body.undatedRows).toBe(1)
  })

  /**
   * AGL-1904. Storefront tax is a SECOND collection and a second query — the
   * route used to read `platformRevenue` alone, so tax charged to shoppers
   * under Aglyn's own registration reached no response field at all.
   */
  it('serves storefront tax as its own section, never merged into the summary', async () => {
    seedRow('in_q3')
    docs.set('storefrontTaxCollected/cs_q3', {
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
    docs.set('storefrontTaxCollected/cs_manual', {
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
    const body = await (await GET(get('2026-Q3'))).json()
    // Aglyn's OWN figures are untouched by the storefront rows.
    expect(body.summary.transactionCount).toBe(1)
    expect(body.summary.taxCollectedCents).toBe(660)
    // …and the storefront money is present, split by who computed it.
    expect(body.storefront.summary.aglynLiable.taxCollectedCents).toBe(825)
    expect(body.storefront.summary.aglynLiable.taxableSalesCents).toBe(10000)
    expect(body.storefront.summary.merchantManual.taxCollectedCents).toBe(800)
    expect(body.storefront.rows).toHaveLength(2)
  })

  /**
   * AGL-2137. Marketplace sales tax is a THIRD collection and a third query,
   * and it was missing entirely.
   *
   * Marketplace checkout enables `automatic_tax` on the PLATFORM's own charge,
   * adds the tax `exclusive` on top, and transfers the publisher a FIXED
   * amount computed from the pre-tax price — so the tax stays platform-side
   * and is Aglyn's to remit in full. Nothing anywhere read
   * `marketplacePurchases.taxCents`: every dollar of it was collected and then
   * absent from the return.
   *
   * Forced red by removing the third query from the route: `body.marketplace`
   * is undefined and all four expectations fail.
   */
  it('serves marketplace tax as its own section, net of refunds', async () => {
    seedRow('in_q3')
    docs.set('marketplacePurchases/cs_mkt_1', {
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      taxCents: 825,
      feeCents: 2000,
      transferCents: 8000,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    // Half refunded: half the tax goes back and is not remittable.
    docs.set('marketplacePurchases/cs_mkt_2', {
      listingId: 'listing-2',
      buyerUid: 'buyer-2',
      sellerOrgId: 'seller-org',
      amountCents: 2165,
      taxCents: 165,
      transferCents: 1600,
      refundedCents: 1083,
      createdAt: new Date('2026-09-19T12:00:00Z'),
    })
    const body = await (await GET(get('2026-Q3'))).json()

    // Aglyn's own subscription figures are untouched — three sources, three
    // totals, never summed.
    expect(body.summary.taxCollectedCents).toBe(660)
    expect(body.storefront.summary.transactionCount).toBe(0)

    expect(body.marketplace.summary.transactionCount).toBe(2)
    // Charged 825 + 165 = 990.
    expect(body.marketplace.summary.taxChargedCents).toBe(990)
    // Refunded: 165 × 1083/2165 = 82.5 → 83 (Math.round).
    expect(body.marketplace.summary.taxRefundedCents).toBe(83)
    // Remittable is charged − refunded, and it is the headline figure.
    expect(body.marketplace.summary.taxCollectedCents).toBe(907)
    expect(body.marketplace.rows).toHaveLength(2)
  })

  /**
   * A FULLY refunded marketplace sale nets to exactly zero tax — the case a
   * pro-rata calculation gets wrong by a cent if it is written carelessly, and
   * the one where "we collected this" would be plainly false.
   */
  it('a fully refunded marketplace sale remits no tax at all', async () => {
    docs.set('marketplacePurchases/cs_mkt_full', {
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      taxCents: 825,
      refundedCents: 10825,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    const body = await (await GET(get('2026-Q3'))).json()
    expect(body.marketplace.summary.taxChargedCents).toBe(825)
    expect(body.marketplace.summary.taxRefundedCents).toBe(825)
    expect(body.marketplace.summary.taxCollectedCents).toBe(0)
    // And the row is still REPORTED — a refunded sale that vanished from the
    // return would be indistinguishable from one that never happened.
    expect(body.marketplace.rows).toHaveLength(1)
  })

  /**
   * A refund LARGER than the charge is a data fault. It must not net the
   * remittable figure below zero, because understating what is owed is the
   * one direction with a filing consequence — it is clamped and counted.
   */
  it('never nets marketplace tax below zero on an over-refunded row', async () => {
    docs.set('marketplacePurchases/cs_mkt_bad', {
      sellerOrgId: 'seller-org',
      amountCents: 1000,
      taxCents: 80,
      refundedCents: 5000,
      createdAt: new Date('2026-09-18T12:00:00Z'),
    })
    const body = await (await GET(get('2026-Q3'))).json()
    expect(body.marketplace.summary.taxCollectedCents).toBe(0)
    expect(body.marketplace.summary.attention.rowsOverRefunded).toBe(1)
  })
})

/**
 * THE REGISTRATION IS KEYED BY JURISDICTION, AND THE TEXAS NAMES STILL WORK.
 *
 * Two things have to hold at once. A deployment filing somewhere other than
 * Texas must be able to state its own registration without borrowing a
 * Comptroller's vocabulary — and the deployment already filing in Texas, whose
 * variables are set against a live obligation, must not have them read as
 * unset by the rename that made the first possible. An unset registration on a
 * return is not a cosmetic regression.
 *
 * Every identifier here is SYNTHETIC and must stay that way: this repository is
 * public and `check-no-tax-identifiers` refuses the real ones in tracked
 * source. The assertions prove the WIRING — that whatever is configured
 * arrives, under the right jurisdiction — never a value.
 */
describe('the filing registration on the response', () => {
  const KEYS = [
    'AGLYN_TAX_JURISDICTION',
    'AGLYN_TAX_REGISTRATION_ID',
    'AGLYN_TAX_FILING_ID',
    'TX_TAXPAYER_NUMBER',
    'TX_WEBFILE_NUMBER',
  ]
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    docs = new Map()
    mockVerifyIdToken.mockReset()
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    // The process this suite runs in may already carry a real deployment's
    // variables. They are cleared per test and restored after, so a developer
    // with a configured `.env` gets the same result as a bare CI runner.
    for (const key of KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  const registration = async () =>
    (await (await GET(get('2026-Q3'))).json()).registration

  it('defaults to Texas, so an unset jurisdiction changes nothing', async () => {
    process.env['TX_TAXPAYER_NUMBER'] = '00000000000'
    process.env['TX_WEBFILE_NUMBER'] = 'RT000000'
    expect(await registration()).toMatchObject({
      jurisdiction: 'US-TX',
      registrationId: '00000000000',
      filingId: 'RT000000',
      // Mirrored under the old names as well, so a client chunk cached from
      // before the rename does not spend a rollout reporting a configured
      // registration as missing.
      taxpayerNumber: '00000000000',
      webfileNumber: 'RT000000',
    })
  })

  it('lets the generic names win when both pairs are set', async () => {
    process.env['TX_TAXPAYER_NUMBER'] = '00000000000'
    process.env['TX_WEBFILE_NUMBER'] = 'RT000000'
    process.env['AGLYN_TAX_REGISTRATION_ID'] = '11111111111'
    process.env['AGLYN_TAX_FILING_ID'] = 'RT111111'
    expect(await registration()).toMatchObject({
      registrationId: '11111111111',
      filingId: 'RT111111',
    })
  })

  it('carries a non-Texas jurisdiction with its own registration', async () => {
    process.env['AGLYN_TAX_JURISDICTION'] = 'GB'
    process.env['AGLYN_TAX_REGISTRATION_ID'] = 'GB-VAT-000000'
    const body = await registration()
    expect(body).toMatchObject({
      jurisdiction: 'GB',
      registrationId: 'GB-VAT-000000',
      // No second identifier, and none required: most authorities issue one
      // number, and demanding a Texas-shaped pair would leave a correctly
      // configured deployment reading "not configured" forever.
      filingId: null,
    })
    // The Texas-named mirrors are Texas's alone. A VAT number under a field
    // called `webfileNumber` is the confusion this change exists to remove.
    expect(body.webfileNumber).toBeUndefined()
    expect(body.taxpayerNumber).toBeUndefined()
  })

  it('does NOT let a non-Texas deployment inherit the Texas variables', async () => {
    // The failure this prevents: an operator sets a jurisdiction, leaves the
    // TX vars from a copied `.env` in place, and files another company's
    // registration number.
    process.env['AGLYN_TAX_JURISDICTION'] = 'US-CA'
    process.env['TX_TAXPAYER_NUMBER'] = '00000000000'
    process.env['TX_WEBFILE_NUMBER'] = 'RT000000'
    expect(await registration()).toMatchObject({
      jurisdiction: 'US-CA',
      registrationId: null,
      filingId: null,
    })
  })

  it('normalizes the jurisdiction so casing and spacing are not a fault', async () => {
    process.env['AGLYN_TAX_JURISDICTION'] = '  us-ca '
    expect((await registration()).jurisdiction).toBe('US-CA')
  })

  it('reports absent rather than inventing a registration', async () => {
    expect(await registration()).toMatchObject({
      jurisdiction: 'US-TX',
      registrationId: null,
      filingId: null,
    })
  })
})
