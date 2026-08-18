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
    customerAddress: { country: 'US', state: 'TX', city: 'Jarrell', postalCode: '76537' },
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
})
