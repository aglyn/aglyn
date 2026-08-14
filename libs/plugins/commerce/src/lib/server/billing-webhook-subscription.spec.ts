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

import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * Storefront subscription sale record (AGL-1732).
 *
 * The branch under test used to write one document carrying no money at all,
 * so these tests assert on WHAT LANDED IN THE DATABASE rather than on anything
 * the handler returns — it returns nothing. Firestore is an in-memory map
 * keyed by document path, the same shape `pos-order.spec.ts` uses, which lets
 * a test count documents and read back stored fields.
 *
 * No Stripe boundary is exercised: this webhook handler is given the event
 * object directly and makes no outbound Stripe call. `global.fetch` is still
 * replaced and asserted unused, because localhost carries the LIVE secret key
 * and a stray call would touch a real merchant account.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** Direct children of `path` — a collection `get()` must not return grandchildren. */
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
const contactUpserts: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
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
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
  meterHostEmail: async () => undefined,
  notifyHostManagers: async (hostId: string, notification: any) => {
    notifications.push({ hostId, ...notification })
  },
  upsertHostContact: async (options: any) => {
    contactUpserts.push(options)
  },
  renderHostEmailWithTokens: async () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The completed subscription Checkout Session, as checkout.ts builds it
// ---------------------------------------------------------------------------

/**
 * A $50/month box, quantity 2, with a 10% host coupon priced into the unit
 * amount and $8.25 of manual destination tax sent as an ordinary line item.
 * Both of those are invisible to Stripe's `total_details` BY OUR OWN
 * CONSTRUCTION (see `computeBuyNowOrder`), which is exactly why the metadata
 * snapshot has to be read rather than the session alone.
 *
 *   listUnit         5000
 *   × quantity          2
 *   = itemsCents    10000
 *   - discount       1000  metadata (priced into the 4500 charged unit)
 *   + tax             825  metadata (Stripe line_items[1])
 *   = totalCents     9825  Stripe amount_total
 */
const SUBSCRIPTION_SESSION = {
  id: 'cs_sub_1',
  subscription: 'sub_1',
  customer: 'cus_1',
  amount_total: 9825,
  total_details: {
    amount_tax: 0,
    amount_shipping: 0,
    amount_discount: 0,
  },
  customer_details: { email: 'boxer@example.com', name: 'Bea Oxer' },
  metadata: {
    type: 'commerce-subscription',
    hostId: 'host-1',
    productId: 'product-1',
    variantId: 'large',
    quantity: '2',
    feeCents: '196',
    unitAmountCents: '5000',
    taxCents: '825',
    discountCents: '1000',
    couponCode: 'TENOFF',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

function subscriptionDocs() {
  return childPaths('hosts/host-1/subscriptions').map((path) => docs.get(path))
}

function orderDocs() {
  return childPaths('hosts/host-1/orders').map((path) => docs.get(path))
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    subscription: { interval: 'month' },
    variants: [
      { id: 'large', priceUsd: 50, sku: 'BOX-L', options: { size: 'Large' } },
    ],
  })
})

// ---------------------------------------------------------------------------

describe('storefront subscription sale record (AGL-1732)', () => {
  /**
   * THE DEFECT. Before the fix the stored subscription carried productId,
   * email, name, stripeCustomerId, status and createdAtMs — and no amount,
   * no line item, no totals. Every one of these assertions failed.
   */
  it('records what was bought and for how much', async () => {
    await deliver(SUBSCRIPTION_SESSION)

    expect(subscriptionDocs()).toHaveLength(1)
    const stored = subscriptionDocs()[0] as any
    expect(stored.lineItems).toEqual([
      {
        productId: 'product-1',
        variantId: 'large',
        name: 'Monthly box',
        variantLabel: 'Large',
        sku: 'BOX-L',
        productType: 'physical',
        quantity: 2,
        unitAmountCents: 5000,
      },
    ])
    expect(stored.totals).toEqual({
      itemsCents: 10000,
      shippingCents: 0,
      taxCents: 825,
      discountCents: 1000,
      feeCents: 196,
      totalCents: 9825,
    })
    // The amount alone is ambiguous — $50 a month and $50 a year are the
    // same number — so the interval is stored beside it.
    expect(stored.interval).toBe('month')
    expect(stored.checkoutSessionId).toBe('cs_sub_1')
    // Still the buyer's identity, unchanged.
    expect(stored.customerEmail).toBe('boxer@example.com')
    expect(stored.stripeCustomerId).toBe('cus_1')
    expect(stored.status).toBe('active')
  })

  /**
   * The parts must sum to what Stripe charged. AGL-1698's failure shape was a
   * decomposition that silently did not, so the invariant is asserted rather
   * than assumed — a future part left unread shows up here.
   */
  it('stores parts that reconcile against Stripe amount_total', async () => {
    await deliver(SUBSCRIPTION_SESSION)
    const { totals } = subscriptionDocs()[0] as any
    expect(
      totals.itemsCents +
        totals.shippingCents +
        totals.taxCents -
        totals.discountCents,
    ).toBe(SUBSCRIPTION_SESSION.amount_total)
  })

  /**
   * Shipping is read even though `checkout.ts` declares no `shipping_options`
   * on a subscription session today (AGL-1720): the read is not conditioned on
   * that, so the figure lands on its own if recurring shipping is ever turned
   * on. Same guarantee AGL-1698 bought for orders.
   */
  it('reads amount_shipping if Stripe ever reports one', async () => {
    await deliver({
      ...SUBSCRIPTION_SESSION,
      amount_total: 10425,
      total_details: {
        amount_tax: 0,
        amount_shipping: 600,
        amount_discount: 0,
      },
    })
    expect((subscriptionDocs()[0] as any).totals.shippingCents).toBe(600)
  })

  /**
   * Product intent, pinned. Subscriptions are deliberately NOT orders — the
   * docs say so, the console keeps them apart, and the tenant account page
   * renders them in their own section. This fix records the sale on the
   * subscription; it must not start manufacturing order documents, which
   * would double-count against every revenue surface that reads `orders`.
   */
  it('creates no order document', async () => {
    await deliver(SUBSCRIPTION_SESSION)
    expect(orderDocs()).toHaveLength(0)
    expect(docs.has('hosts/host-1/counters/orders')).toBe(false)
  })

  it('puts the amount in the manager notification', async () => {
    await deliver(SUBSCRIPTION_SESSION)
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('New subscriber — $98.25/month')
    expect(notifications[0].body).toBe('boxer@example.com')
  })

  /**
   * RFM (AGL-328) counted a subscriber as having spent nothing, so the
   * customer paying every month ranked colder than a one-off buyer.
   */
  it('rolls the charge into the contact lifetime value', async () => {
    await deliver(SUBSCRIPTION_SESSION)
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].purchaseCents).toBe(9825)
    expect(contactUpserts[0].email).toBe('boxer@example.com')
  })

  /**
   * Stripe delivers at least once, and `purchaseCents` is a
   * `FieldValue.increment` — a replay that reached it would inflate the
   * subscriber's lifetime value and order count on every retry. Counting the
   * side effects is the assertion; the subscription document is a merge-set
   * and would look identical either way.
   */
  it('absorbs a redelivered event without double-counting', async () => {
    await deliver(SUBSCRIPTION_SESSION)
    await deliver(SUBSCRIPTION_SESSION)

    expect(subscriptionDocs()).toHaveLength(1)
    expect(contactUpserts).toHaveLength(1)
    expect(notifications).toHaveLength(1)
  })

  /**
   * The guard's other half, and the reason it keys on `checkoutSessionId`
   * rather than on the document existing: `customer.subscription.created`
   * writes the SAME document path (status and period end only) and Stripe does
   * not order the two events. An existence check would discard the entire sale
   * record whenever that event arrived first — which is the very bug being
   * fixed, reintroduced by the fix.
   */
  it('still records the sale when the status event lands first', async () => {
    await deliver(
      {
        id: 'sub_1',
        status: 'active',
        current_period_end: 1800000000,
        metadata: { type: 'commerce-subscription', hostId: 'host-1' },
      },
      'customer.subscription.created',
    )
    expect(subscriptionDocs()).toHaveLength(1)
    expect((subscriptionDocs()[0] as any).totals).toBeUndefined()

    await deliver(SUBSCRIPTION_SESSION)

    expect(subscriptionDocs()).toHaveLength(1)
    const stored = subscriptionDocs()[0] as any
    expect(stored.totals.totalCents).toBe(9825)
    // And the status event's own fields survive the merge.
    expect(stored.currentPeriodEndMs).toBe(1800000000000)
  })

  /**
   * A subscription session created before the AGL-1711 metadata snapshot
   * existed carries `quantity` and nothing else, so the unit price falls back
   * to what Stripe charged per unit. It must still store a coherent record
   * rather than throwing or storing zero.
   */
  it('decomposes a session predating the metadata snapshot', async () => {
    await deliver({
      ...SUBSCRIPTION_SESSION,
      amount_total: 9000,
      metadata: {
        type: 'commerce-subscription',
        hostId: 'host-1',
        productId: 'product-1',
        quantity: '2',
      },
    })
    const stored = subscriptionDocs()[0] as any
    expect(stored.lineItems[0].quantity).toBe(2)
    expect(stored.lineItems[0].unitAmountCents).toBe(4500)
    expect(stored.totals.totalCents).toBe(9000)
  })

  it('never calls Stripe', async () => {
    await deliver(SUBSCRIPTION_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
