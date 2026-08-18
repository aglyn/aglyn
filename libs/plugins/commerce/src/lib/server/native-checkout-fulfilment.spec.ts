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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { checkoutHandler } from './checkout'
import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * WEBHOOK-ONLY FULFILMENT for the storefront Payment Element (AGL-1944).
 *
 * AGL-1132 asked for this to be proved by killing the client success callback
 * and checking fulfilment still happens. This file proves it in the strongest
 * available form: **there is no client in it at all.** It drives the real
 * `checkoutHandler` in native mode, reads back the metadata that was actually
 * sent to Stripe, builds `checkout.session.completed` from that exact metadata,
 * hands it to the real `commerceBillingWebhookHandler`, and asserts a paid
 * order with the right money and a decremented variant.
 *
 * That is a stronger statement than mocking a callback away, because a mocked
 * callback still admits the reading "the callback exists and we disabled it".
 * Nothing in the path exercised below can be reached from a browser.
 *
 * ## Why both halves matter
 *
 * A flow that fulfils on the client's success callback fails in two opposite
 * directions, and only testing both catches a design that trades one for the
 * other:
 *
 *   - a shopper who pays and closes the tab is never fulfilled — money taken,
 *     nothing shipped. The webhook direction below covers this: the order
 *     appears with no client participation whatsoever;
 *   - a shopper who refreshes the return page fulfils twice — two orders, or
 *     one order with inventory decremented twice. The redelivery direction
 *     covers this: the same event twice leaves one order and one decrement.
 *
 * The linkage is the point of building it as one file. `native-checkout.spec.ts`
 * proves the two checkout paths send the same metadata; this proves the webhook
 * reads that metadata into a correct order. A change to either that broke the
 * join would pass both of those separately and fail here.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

const GRPC_NOT_FOUND = 5

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    /** `create()` rejecting on an existing doc IS the dedupe primitive. */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      docs.set(path, value)
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`5 NOT_FOUND: No document to update: ${path}`),
          { code: GRPC_NOT_FOUND },
        )
      }
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
    where: () => ref,
    limit: () => ref,
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
}

const notifications: any[] = []
let flagOn = true

jest.mock('@aglyn/tenant-data-admin', () => {
  const { updateExisting } = jest.requireActual(
    '@aglyn/tenant-data-admin/server/update-existing',
  )
  return {
    updateExisting,
    firebaseAdmin: {
      app: () => ({ firestore: () => fakeFirestore }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => '<server-timestamp>',
          arrayUnion: (value: any) => ({ __arrayUnion: value }),
          increment: (value: number) => ({ __increment: value }),
        },
      },
    },
    findUserByUidAcrossPools: async () => null,
    getOrgForHost: async () => ({
      org: {
        id: 'org-1',
        plan: 'business',
        subscriptionStatus: 'active',
        ownerUid: 'owner-1',
        slug: 'acme',
      },
    }),
    isServerReleaseFlagOnForOrg: async () => flagOn,
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, notification: any) => {
      notifications.push({ hostId, ...notification })
    },
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — a native session, recorded
// ---------------------------------------------------------------------------

let lastSessionParams: URLSearchParams | null = null
let sessionCounter = 0

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  const params = new URLSearchParams(String(init?.body ?? ''))
  lastSessionParams = params
  const id = `cs_native_${++sessionCounter}`
  return {
    ok: true,
    json: async () =>
      params.get('ui_mode')
        ? { id, client_secret: `${id}_secret_xyz`, ui_mode: 'custom' }
        : { id, url: `https://checkout.stripe.com/pay/${id}` },
  }
})

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as PluginApiResponse
  return { res, result }
}

async function buyNow(idempotencyKey = 'attempt-1') {
  const { res, result } = makeResponse()
  await checkoutHandler(
    {
      method: 'POST',
      query: {},
      body: {
        hostId: 'host-1',
        productId: 'product-1',
        variantId: 'large',
        quantity: 3,
        shippingCountry: 'US',
      },
      headers: {
        host: 'acme.aglyn.app',
        referer: 'https://acme.aglyn.app/products/box',
        'idempotency-key': idempotencyKey,
      },
      cookies: {},
      socket: {},
    } as PluginApiRequest,
    res,
  )
  return result
}

/**
 * The event Stripe sends after the shopper confirms in the Payment Element.
 *
 * Built from the metadata the HANDLER actually sent, never hand-written: a
 * hand-written event would keep passing after a rename that broke the real
 * join, which is the failure mode a fixture-based version of this test has.
 * `total_details` is Stripe's own view of the sale and is stated here because
 * only Stripe can know it — the shipping charge is the one figure in the order
 * that this codebase never computes.
 */
function completedEvent(sessionId: string) {
  const metadata = Object.fromEntries(
    [...(lastSessionParams as URLSearchParams).entries()]
      .filter(([key]) => key.startsWith('metadata['))
      .map(([key, value]) => [key.slice('metadata['.length, -1), value]),
  )
  return {
    id: sessionId,
    payment_status: 'paid',
    payment_intent: `pi_${sessionId}`,
    amount_total: 5335,
    customer_details: { email: 'buyer@example.com', name: 'Ada Cartwright' },
    total_details: { amount_tax: 0, amount_shipping: 799, amount_discount: 0 },
    metadata,
  }
}

async function deliver(object: any) {
  await commerceBillingWebhookHandler({
    type: 'checkout.session.completed',
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

const orders = () =>
  childPaths('hosts/host-1/orders').map((path) => docs.get(path) as any)

const inventory = () =>
  (docs.get('hosts/host-1/products/product-1') as any).variants[0].inventory

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  autoIdCounter = 0
  sessionCounter = 0
  lastSessionParams = null
  fetchMock.mockClear()
  flagOn = true
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    variants: [
      { id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10, weightGrams: 400 },
    ],
  })
  docs.set('hosts/host-1/settings/store', {
    shipping: {
      zones: [{ id: 'us', name: 'United States', countries: ['US'] }],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
      ],
    },
  })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_merchant',
    stripeChargesEnabled: true,
  })
})

// ---------------------------------------------------------------------------
// Direction 1: the client is never consulted
// ---------------------------------------------------------------------------

describe('the webhook fulfils a Payment Element sale with no client at all', () => {
  it('creates the paid order and decrements stock from the event alone', async () => {
    const checkout = await buyNow()
    // The shopper was handed a client secret, NOT a url — this really is the
    // native path, so the assertions below are about the flow under test.
    expect(checkout.status).toBe(200)
    expect(checkout.body.clientSecret).toBeTruthy()
    expect(checkout.body.url).toBeUndefined()

    // Nothing is fulfilled yet. The session exists; the money has not moved.
    expect(orders()).toHaveLength(0)
    expect(inventory()).toBe(10)

    await deliver(completedEvent(checkout.body.sessionId))

    expect(orders()).toHaveLength(1)
    const order = orders()[0]
    expect(order.status).toBe('paid')
    expect(order.totals.totalCents).toBe(5335)
    expect(order.totals.shippingCents).toBe(799)
    expect(inventory()).toBe(7)
  })

  it('the order id IS the session id the return url carries', async () => {
    // This is what lets the storefront SHOW a result without being TOLD one.
    // The page reads `session_id` off its own query and looks the order up;
    // the client never asserts that anything was paid.
    const checkout = await buyNow()
    await deliver(completedEvent(checkout.body.sessionId))
    expect(childPaths('hosts/host-1/orders')).toEqual([
      `hosts/host-1/orders/${checkout.body.sessionId}`,
    ])
  })

  it('fulfils identically whether the session was hosted or native', async () => {
    // The parity that makes the flag safe to flip: the SAME event body fulfils
    // the same way, because the metadata is the same. If native mode ever
    // needed its own webhook branch, this is where that would surface.
    const native = await buyNow()
    await deliver(completedEvent(native.body.sessionId))
    const fromNative = orders()[0]

    docs.delete(`hosts/host-1/orders/${native.body.sessionId}`)
    docs.set('hosts/host-1/products/product-1', {
      name: 'Monthly box',
      type: 'physical',
      variants: [
        { id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10, weightGrams: 400 },
      ],
    })
    flagOn = false
    const hosted = await buyNow('attempt-2')
    expect(hosted.body.url).toContain('checkout.stripe.com')
    await deliver(completedEvent(hosted.body.sessionId))
    const fromHosted = orders()[0]

    const comparable = (order: any) => ({
      status: order.status,
      totals: order.totals,
      items: order.items,
    })
    expect(comparable(fromNative)).toEqual(comparable(fromHosted))
    expect(inventory()).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Direction 2: fulfilling twice is what a client callback would do
// ---------------------------------------------------------------------------

describe('a redelivered event does not fulfil twice', () => {
  it('leaves one order and one decrement', async () => {
    // Stripe delivers at least once, and a shopper refreshing the return page
    // is the other way this used to double up. Both land here as a second
    // delivery of the same event.
    const checkout = await buyNow()
    const event = completedEvent(checkout.body.sessionId)
    await deliver(event)
    await deliver(event)
    expect(orders()).toHaveLength(1)
    expect(inventory()).toBe(7)
  })

  it('does not double the merchant notification either', async () => {
    // Inventory is the loud half; a doubled "you sold something" email is the
    // quiet half, and it is the one that survives a partial fix.
    const checkout = await buyNow()
    const event = completedEvent(checkout.body.sessionId)
    await deliver(event)
    await deliver(event)
    const sold = notifications.filter((entry) => entry.type === 'content.order')
    expect(sold).toHaveLength(1)
    // And it really is the sale notification, not some other event that
    // happens to be filed under the same type — an assertion counting an empty
    // set to 1 would have failed, but one counting the WRONG set to 1 passes.
    expect(sold[0].title).toBe('New order — $53.35')
  })
})

// ---------------------------------------------------------------------------
// Direction 3: a double-submitted payment cannot open two sessions
// ---------------------------------------------------------------------------

describe('a double-submitted payment opens one session, not two', () => {
  it('replays the first attempt under the same idempotency key', async () => {
    const first = await buyNow('same-attempt')
    const second = await buyNow('same-attempt')
    // The claim replays the recorded response rather than pricing the sale
    // again — so the shopper's second click mounts the SAME Payment Element
    // against the SAME session, and there is only ever one thing to fulfil.
    expect(second.status).toBe(200)
    expect(second.body.clientSecret).toBe(first.body.clientSecret)
    expect(second.body.sessionId).toBe(first.body.sessionId)
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('checkout/sessions'),
      ),
    ).toHaveLength(1)
  })

  it('and one session means one order even after both are delivered', async () => {
    const first = await buyNow('same-attempt')
    const second = await buyNow('same-attempt')
    await deliver(completedEvent(first.body.sessionId))
    await deliver(completedEvent(second.body.sessionId))
    expect(orders()).toHaveLength(1)
    expect(inventory()).toBe(7)
  })
})
