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
 * The storefront `purchase` lookup (AGL-1641), and what a SUBSCRIPTION sale
 * answers with (AGL-1746).
 *
 * A subscription writes no order document, so this route missed forever on
 * every subscription sale and the merchant's GA4 property recorded a 100%
 * abandonment rate on the product. It now resolves the Checkout Session to the
 * subscription that session created, and answers from that subscription's
 * OPENING invoice.
 *
 * ## What is mocked, and what is deliberately not
 *
 * Firestore is an in-memory map keyed by document path, so the tests can state
 * exactly which documents exist at the moment of the call — which is the whole
 * subject here, since every 404 on this route is a claim about a webhook that
 * has not landed yet.
 *
 * There is NO Stripe boundary on this path at all: the handler reads Firestore
 * and returns a projection. Nothing here may acquire one — localhost carries
 * the LIVE secret key — so `global.fetch` is replaced with a throwing stub for
 * the whole file, and a handler that ever grew a network call would fail
 * loudly rather than reach api.stripe.com.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { buildStorefrontPurchaseParams } from '../model/purchase-analytics'
import { orderAnalyticsHandler } from './order-analytics'

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    // A query result carries its own ref, which is how the handler descends
    // from the subscription it found into that subscription's `invoices`.
    get ref() {
      return makeDocRef(path)
    },
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

/**
 * Only what the handler uses: a single equality `where` and a `limit`. Written
 * as a chain that records its constraints and applies them at `get()`, so a
 * query that filtered on the wrong field would return nothing rather than
 * quietly returning everything.
 */
function makeQuery(path: string, filters: [string, any][], max: number): any {
  return {
    where: (field: string, op: string, value: any) => {
      if (op !== '==') throw new Error(`Unsupported operator ${op}`)
      return makeQuery(path, [...filters, [field, value]], max)
    },
    limit: (count: number) => makeQuery(path, filters, count),
    get: async () => {
      const matched = childPaths(path)
        .filter((child) =>
          filters.every(([field, value]) => docs.get(child)?.[field] === value),
        )
        .slice(0, max)
      return { docs: matched.map(makeSnapshot), empty: matched.length === 0 }
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    ...makeQuery(path, [], Infinity),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => makeCollectionRef(name),
      }),
    }),
  },
}))

// ---------------------------------------------------------------------------
// Stripe must never be reached from this route
// ---------------------------------------------------------------------------

const originalFetch = global.fetch
beforeAll(() => {
  global.fetch = (async (url: any) => {
    throw new Error(`Unexpected network call to ${String(url)}`)
  }) as any
})
afterAll(() => {
  global.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HOST_ID = 'host-1'
const SESSION_ID = 'cs_test_subscription_abc123'
const OPENING_INVOICE_ID = 'in_opening_1'
const RENEWAL_INVOICE_ID = 'in_renewal_2'

interface Captured {
  status: number
  body: any
  headers: Record<string, string>
}

async function callHandler(
  query: Record<string, string>,
): Promise<Captured> {
  const captured: Captured = { status: 0, body: undefined, headers: {} }
  const res: any = {
    status(code: number) {
      captured.status = code
      return res
    },
    json(payload: any) {
      captured.body = payload
      return res
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value
    },
  }
  await orderAnalyticsHandler(
    { query } as unknown as PluginApiRequest,
    res as PluginApiResponse,
  )
  return captured
}

/**
 * A $30.00/month subscription: $2.48 tax, and a 5% ($1.50) Aglyn fee.
 *
 * The three figures are deliberately distinct so the `value` assertion can
 * only be satisfied one way — 30.00 is the merchant's revenue, 28.50 would be
 * the fee wrongly subtracted (the marketplace rule applied to a storefront),
 * and 32.48 would be tax wrongly included.
 */
const OPENING_INVOICE = {
  invoiceId: OPENING_INVOICE_ID,
  subscriptionId: 'sub_1',
  billingReason: 'subscription_create',
  paidCents: 3248,
  invoiceTotalCents: 3248,
  lineItems: [
    {
      productId: 'prod-coffee',
      name: 'Coffee Club',
      quantity: 1,
      unitAmountCents: 3000,
    },
  ],
  totals: {
    itemsCents: 3000,
    taxCents: 248,
    shippingCents: 0,
    discountCents: 0,
    feeCents: 150,
    totalCents: 3248,
  },
  // Present on the stored document, and must never cross the wire.
  customerEmail: 'subscriber@example.com',
  hostedInvoiceUrl: 'https://invoice.stripe.com/i/secret',
}

function seedSubscriptionSale(
  options: { invoices?: Record<string, any>[]; hostId?: string } = {},
): void {
  const hostId = options.hostId ?? HOST_ID
  docs.set(`hosts/${hostId}/subscriptions/sub_1`, {
    productId: 'prod-coffee',
    status: 'active',
    checkoutSessionId: SESSION_ID,
    customerEmail: 'subscriber@example.com',
    customerName: 'A Subscriber',
  })
  for (const invoice of options.invoices ?? [OPENING_INVOICE]) {
    docs.set(
      `hosts/${hostId}/subscriptions/sub_1/invoices/${invoice.invoiceId}`,
      invoice,
    )
  }
}

beforeEach(() => {
  docs.clear()
})

// ---------------------------------------------------------------------------

describe('the one-time order path still answers (AGL-1641)', () => {
  it('returns the paid order under its session id', async () => {
    docs.set(`hosts/${HOST_ID}/orders/${SESSION_ID}`, {
      status: 'paid',
      lineItems: [
        {
          productId: 'prod-mug',
          name: 'Mug',
          quantity: 2,
          unitAmountCents: 1200,
        },
      ],
      totals: { totalCents: 2600, taxCents: 200 },
    })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(200)
    expect(result.body.transactionId).toBe(SESSION_ID)
    expect(result.body.totalCents).toBe(2600)
    expect(result.body.taxCents).toBe(200)
    expect(result.body.lineItems).toHaveLength(1)
    expect(result.body.lineItems[0].productId).toBe('prod-mug')
    expect(result.body.lineItems[0].quantity).toBe(2)
  })

  it('refuses an order that is not paid', async () => {
    docs.set(`hosts/${HOST_ID}/orders/${SESSION_ID}`, {
      status: 'draft',
      lineItems: [],
      totals: { totalCents: 2600, taxCents: 200 },
    })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(409)
  })
})

describe('a subscription sale answers from its opening invoice (AGL-1746)', () => {
  it('resolves the session to the subscription and returns 200', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(200)
  })

  it('uses the INVOICE id as the transaction id, not the session id', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.body.transactionId).toBe(OPENING_INVOICE_ID)
    expect(result.body.transactionId).not.toBe(SESSION_ID)
  })

  it('carries the invoice totals, field by field', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.body.totalCents).toBe(3248)
    expect(result.body.taxCents).toBe(248)
  })

  it('carries the invoice line items, field by field', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.body.lineItems).toHaveLength(1)
    expect(result.body.lineItems[0].productId).toBe('prod-coffee')
    expect(result.body.lineItems[0].name).toBe('Coffee Club')
    expect(result.body.lineItems[0].quantity).toBe(1)
    expect(result.body.lineItems[0].unitAmountCents).toBe(3000)
  })

  it('withholds everything the projection exists to withhold', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.body.customerEmail).toBeUndefined()
    expect(result.body.customerName).toBeUndefined()
    expect(result.body.hostedInvoiceUrl).toBeUndefined()
    // Not our cut either — a buyer learns only what they bought.
    expect(result.body.feeCents).toBeUndefined()
    expect(Object.keys(result.body).sort()).toEqual([
      'lineItems',
      'taxCents',
      'totalCents',
      'transactionId',
    ])
  })

  it('is never cached, so a raced 404 cannot be stored in front of it', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.headers['Cache-Control']).toBe('no-store')
  })
})

describe('the value reported to the MERCHANT (AGL-1641 rule, AGL-1746 path)', () => {
  it('reports the merchant revenue: fee NOT subtracted, tax excluded', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })
    const purchase = buildStorefrontPurchaseParams(result.body)

    // 3248 collected - 248 tax = 3000. The 150 fee is the merchant's cost of
    // sale on their own storefront, not a deduction from their revenue.
    expect(purchase?.value).toBe(30)
    expect(purchase?.value).not.toBe(28.5) // fee wrongly subtracted
    expect(purchase?.value).not.toBe(32.48) // tax wrongly included
  })

  it('sends no GA4 tax param beside an ex-tax value', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })
    const purchase = buildStorefrontPurchaseParams(result.body) as any

    expect('tax' in purchase).toBe(false)
  })

  it('names the transaction and the product for GA to join on', async () => {
    seedSubscriptionSale()

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })
    const purchase = buildStorefrontPurchaseParams(result.body)

    expect(purchase?.transaction_id).toBe(OPENING_INVOICE_ID)
    expect(purchase?.currency).toBe('USD')
    expect(purchase?.items?.[0]?.item_id).toBe('prod-coffee')
    expect(purchase?.items?.[0]?.price).toBe(30)
    expect(purchase?.items?.[0]?.quantity).toBe(1)
  })
})

describe('renewals are not reported as purchases (AGL-1746)', () => {
  /**
   * The decision, pinned. A renewal cannot reach the merchant's property from
   * here anyway — it has no browser and there is no per-host Measurement
   * Protocol secret — and firing one would credit a single acquisition to its
   * campaign once per cycle.
   */
  it('answers with the opening invoice even when renewals exist', async () => {
    seedSubscriptionSale({
      invoices: [
        OPENING_INVOICE,
        {
          invoiceId: RENEWAL_INVOICE_ID,
          subscriptionId: 'sub_1',
          billingReason: 'subscription_cycle',
          paidCents: 3500,
          lineItems: [
            {
              productId: 'prod-coffee',
              name: 'Coffee Club',
              quantity: 1,
              unitAmountCents: 3500,
            },
          ],
          totals: { totalCents: 3500, taxCents: 0 },
        },
      ],
    })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.body.transactionId).toBe(OPENING_INVOICE_ID)
    expect(result.body.totalCents).toBe(3248)
  })

  it('reports nothing at all when only a renewal has been recorded', async () => {
    seedSubscriptionSale({
      invoices: [
        {
          invoiceId: RENEWAL_INVOICE_ID,
          subscriptionId: 'sub_1',
          billingReason: 'subscription_cycle',
          paidCents: 3500,
          lineItems: [],
          totals: { totalCents: 3500, taxCents: 0 },
        },
      ],
    })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(404)
  })
})

describe('the webhook race, one step further along (AGL-1746)', () => {
  it('is retryable while no subscription has been written yet', async () => {
    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(404)
    expect(result.body.retryable).toBe(true)
  })

  it('is retryable while the subscription exists but its invoice does not', async () => {
    seedSubscriptionSale({ invoices: [] })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(404)
    expect(result.body.retryable).toBe(true)
  })
})

describe('a trial opens on no money (AGL-1746)', () => {
  it('refuses a $0 opening invoice, terminally', async () => {
    seedSubscriptionSale({
      invoices: [{ ...OPENING_INVOICE, paidCents: 0 }],
    })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(409)
    // Terminal, not retryable: the client stops rather than polling out a
    // window that will never produce a charge for THIS invoice.
    expect(result.body.retryable).toBeUndefined()
  })
})

describe('the session id stays scoped to its host (AGL-1641)', () => {
  it('will not read another host subscription with the same session id', async () => {
    seedSubscriptionSale({ hostId: 'host-2' })

    const result = await callHandler({ hostId: HOST_ID, sessionId: SESSION_ID })

    expect(result.status).toBe(404)
  })
})

describe('the id is shape-checked before it reaches Firestore', () => {
  it('rejects a traversal attempt rather than pathing on it', async () => {
    const result = await callHandler({
      hostId: HOST_ID,
      sessionId: '../../orders/cs_other',
    })

    expect(result.status).toBe(400)
  })

  it('requires both parameters', async () => {
    expect((await callHandler({ hostId: HOST_ID })).status).toBe(400)
    expect((await callHandler({ sessionId: SESSION_ID })).status).toBe(400)
  })
})
