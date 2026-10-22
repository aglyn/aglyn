/**
 * @jest-environment node
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
 * THE BILLING HISTORY'S FILTERS ARE STRIPE'S (AGL-3321).
 *
 * The invoices are not in Firestore, so this list is the sweep's Stripe
 * exception: every Filters-panel clause and the search are asked of Stripe's
 * own list, search and retrieve, and nothing is matched over the invoices a
 * page happened to load. These pin both halves — the plan the page writes,
 * and the Stripe request the route makes from it.
 */

import {
  invoiceQueryString,
  planInvoiceQuery,
  readInvoiceQueryParams,
  stripeInvoiceSearchQuery,
} from '../utils/billing-invoice-query'

export {}

const CUSTOMER = 'cus_Live01'

let mockDecoded: Record<string, unknown>

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { role: 'owner' } }),
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_Live01' }),
  readOrgBillingCustomerModes: async () => ({ live: true, test: false }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
    }
  },
}))

const ORIGINAL_ENV = process.env

/** Three years of invoices; the one sought is far past the first page. */
const OLD_INVOICE = {
  id: 'in_old',
  customer: CUSTOMER,
  number: 'AGL-0003',
  status: 'paid',
  amount_due: 1900,
  total: 1900,
  currency: 'usd',
  created: 1_690_000_000,
}

let stripeCalls: string[] = []

function loadRoute() {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV, STRIPE_SECRET_KEY: 'sk_live_fake' } as NodeJS.ProcessEnv
  return require('../app/api/billing/invoices/route').GET as (
    request: Request,
  ) => Promise<Response>
}

const ask = (get: (request: Request) => Promise<Response>, params: string) =>
  get(
    new Request(`https://app.aglyn.com/api/billing/invoices?orgId=org-1${params}`, {
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
    }),
  )

beforeEach(() => {
  mockDecoded = { uid: 'u1', email_verified: true }
  stripeCalls = []
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    stripeCalls.push(url)
    if (url.includes('/v1/invoices/search')) {
      return Response.json({ data: [OLD_INVOICE], has_more: true, next_page: 'page_2' })
    }
    if (url.includes('/v1/invoices/in_old')) return Response.json(OLD_INVOICE)
    if (url.includes('/v1/invoices/in_theirs')) {
      return Response.json({ ...OLD_INVOICE, id: 'in_theirs', customer: 'cus_Other' })
    }
    if (url.includes('/v1/invoices/in_missing')) {
      return Response.json({ error: { message: 'No such invoice' } }, { status: 404 })
    }
    return Response.json({ data: [OLD_INVOICE], has_more: false })
  }) as any
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('the page asks only what Stripe can answer', () => {
  it('turns status, a date and a number into Stripe parameters', () => {
    const plan = planInvoiceQuery([
      { field: 'status', op: 'equals', value: 'paid' },
      { field: 'created', op: 'onOrAfter', value: '2023-07-01' },
      { field: 'number', op: 'equals', value: 'AGL-0003' },
    ])
    expect(plan.refused).toEqual([])
    expect(plan.params).toMatchObject({ status: 'paid', number: 'AGL-0003' })
    expect(plan.params.createdGte).toBe(Math.floor(new Date(2023, 6, 1).getTime() / 1000))
    expect(invoiceQueryString(plan.params)).toContain('&status=paid')
  })

  it('reads the search as an invoice ID or a whole number', () => {
    expect(planInvoiceQuery([], ['in_abc123']).params).toEqual({ id: 'in_abc123' })
    expect(planInvoiceQuery([], ['AGL-0003']).params).toEqual({ number: 'AGL-0003' })
  })

  it('refuses by name what Stripe cannot combine, and applies nothing of it', () => {
    const plan = planInvoiceQuery(
      [
        { field: 'number', op: 'equals', value: 'AGL-0003' },
        { field: 'status', op: 'isAnyOf', value: 'paid,open' },
      ],
      ['AGL-0004'],
    )
    expect(plan.params).toEqual({ number: 'AGL-0003' })
    expect(plan.refused.map((entry) => entry.clause)).toEqual([
      { field: 'status', op: 'isAnyOf', value: 'paid,open' },
      'search',
    ])
  })

  it('drops a parameter the route was not meant to receive', () => {
    expect(
      readInvoiceQueryParams({ status: 'draft', createdGte: 'soon', id: 'cus_1', number: 'A-1' }),
    ).toEqual({ number: 'A-1' })
  })

  it('quotes a number inside Stripe search', () => {
    expect(stripeInvoiceSearchQuery(CUSTOMER, { number: "O'Brien-1", status: 'paid' })).toBe(
      "customer:'cus_Live01' AND number:'O\\'Brien-1' AND status:'paid'",
    )
  })
})

describe('the route asks Stripe, and matches nothing over a loaded page', () => {
  it('puts status and dates on the invoice list', async () => {
    const get = loadRoute()
    const response = await ask(get, '&status=paid&createdGte=1690000000&createdLt=1700000000')
    expect(response.status).toBe(200)
    expect(stripeCalls[0]).toContain('/v1/invoices?customer=cus_Live01')
    expect(stripeCalls[0]).toContain('&status=paid')
    expect(stripeCalls[0]).toContain('&created[gte]=1690000000')
    expect(stripeCalls[0]).toContain('&created[lt]=1700000000')
  })

  it('finds an old invoice by number through Stripe search, paged by its token', async () => {
    const get = loadRoute()
    const body = await (await ask(get, '&number=AGL-0003')).json()
    expect(decodeURIComponent(stripeCalls[0])).toContain(
      "/v1/invoices/search?query=customer:'cus_Live01' AND number:'AGL-0003'",
    )
    expect(body.invoices.map((invoice: { id: string }) => invoice.id)).toEqual(['in_old'])
    expect(body.nextCursor).toBe('page_2')
    await ask(get, '&number=AGL-0003&cursor=page_2')
    expect(stripeCalls[1]).toContain('&page=page_2')
  })

  it('retrieves an invoice ID, and only this organization’s', async () => {
    const get = loadRoute()
    const found = await (await ask(get, '&id=in_old')).json()
    expect(found.invoices.map((invoice: { id: string }) => invoice.id)).toEqual(['in_old'])
    const theirs = await (await ask(get, '&id=in_theirs')).json()
    expect(theirs.invoices).toEqual([])
    const missing = await ask(get, '&id=in_missing')
    expect(missing.status).toBe(200)
    expect((await missing.json()).invoices).toEqual([])
  })
})
