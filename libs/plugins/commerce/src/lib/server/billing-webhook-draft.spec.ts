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
 * The paid-draft branch and its buyer (AGL-1748).
 *
 * `commerce-draft` is not one path but two: a payment link the console sends a
 * customer (`draft-order.ts`), and a POS card sale, whose QR completes through
 * this same branch rather than through `pos-order.ts`. The branch flipped the
 * order to paid, notified managers and decremented stock — and never reached
 * `upsertHostContact`, so neither buyer became a contact at all.
 *
 * These tests assert on WHAT LANDED — the in-memory Firestore, and the captured
 * `upsertHostContact` options — rather than on anything the handler returns; it
 * returns nothing. Same harness shape as `billing-webhook-subscription.spec.ts`.
 *
 * No Stripe boundary is exercised: this handler is handed the event object and
 * makes no outbound call. `global.fetch` is still replaced and asserted unused,
 * because localhost carries the LIVE secret key.
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
// The draft order and the session that pays it
// ---------------------------------------------------------------------------

/**
 * Three $15.00 boxes on a merchant-sent payment link. Nothing here coincides:
 * `totalCents` (4500) is not the unit price (1500), not the quantity (3) and
 * not the platform fee (146), so an assertion that lands on the right number
 * cannot have got there by reaching for the nearest one.
 */
const DRAFT_ORDER = {
  number: 7,
  status: 'pending',
  channel: 'draft',
  lineItems: [
    {
      productId: 'product-1',
      variantId: 'large',
      name: 'Monthly box',
      sku: 'BOX-L',
      productType: 'physical',
      quantity: 3,
      unitAmountCents: 1500,
    },
  ],
  totals: {
    itemsCents: 4500,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 146,
    totalCents: 4500,
  },
  customerEmail: 'drafted@example.com',
  timeline: [{ atMs: 1000, event: 'draft', detail: 'Draft created by staff' }],
  createdAtMs: 1000,
}

const DRAFT_SESSION = {
  id: 'cs_draft_1',
  payment_status: 'paid',
  payment_intent: 'pi_draft_1',
  amount_total: 4500,
  customer_details: { email: 'Paid@Example.com', name: 'Ida Voiced' },
  metadata: {
    type: 'commerce-draft',
    hostId: 'host-1',
    orderId: 'order-1',
    productId: 'product-1',
    variantId: 'large',
    feeCents: '146',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

function storedOrder() {
  return docs.get('hosts/host-1/orders/order-1') as any
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
    variants: [
      { id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 },
    ],
  })
  docs.set('hosts/host-1/orders/order-1', { ...DRAFT_ORDER })
})

// ---------------------------------------------------------------------------

describe('paid draft order (AGL-1748)', () => {
  /** Unchanged behavior, pinned so the guard rewrite cannot quietly drop it. */
  it('flips the order to paid and stamps the payment intent', async () => {
    await deliver(DRAFT_SESSION)
    const order = storedOrder()
    expect(order.status).toBe('paid')
    expect(order.paymentIntentId).toBe('pi_draft_1')
    expect(order.timeline.map((event: any) => event.event)).toEqual([
      'draft',
      'paid',
    ])
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Draft order paid — #7')
  })

  /**
   * THE DEFECT. Before the fix this branch never called `upsertHostContact` at
   * all, so a buyer who only ever paid a merchant-sent payment link — or a POS
   * card customer, whose QR completes here — did not become a contact. Every
   * assertion in this test failed on an empty array.
   */
  it('creates the buyer as a contact', async () => {
    await deliver(DRAFT_SESSION)
    expect(contactUpserts).toHaveLength(1)
    const upsert = contactUpserts[0]
    expect(upsert.hostId).toBe('host-1')
    expect(upsert.source).toBe('order')
    expect(upsert.name).toBe('Ida Voiced')
    expect(upsert.interaction.refId).toBe('order-1')
    expect(upsert.interaction.summary).toBe('Paid #7 ($45.00)')
  })

  /**
   * The money, on its own. `purchaseCents` is the field `ltvCents` accumulates
   * through, and 4500 is what Stripe charged — per AGL-1698/AGL-1711 the figure
   * comes from what was actually paid, not from the product doc.
   */
  it('passes the charged amount as purchaseCents', async () => {
    await deliver(DRAFT_SESSION)
    const { purchaseCents } = contactUpserts[0]
    expect(purchaseCents).toBe(4500)
    expect(purchaseCents).not.toBe(1500) // unit price
    expect(purchaseCents).not.toBe(146) // platform fee
  })

  /**
   * The session's buyer wins over the address the draft was created with — the
   * same precedence the status write already applies, so the contact and the
   * order can never disagree about who bought it. Normalization to lower case
   * happens inside `upsertHostContact`; what matters here is which one is sent.
   */
  it('prefers the paying buyer over the drafted address', async () => {
    await deliver(DRAFT_SESSION)
    expect(contactUpserts[0].email).toBe('Paid@Example.com')
    expect(storedOrder().customerEmail).toBe('Paid@Example.com')
  })

  /** A session with no buyer details falls back to the address on the draft. */
  it('falls back to the address the draft carried', async () => {
    await deliver({ ...DRAFT_SESSION, customer_details: null })
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].email).toBe('drafted@example.com')
  })

  /** No email anywhere is not a contact — and must not throw. */
  it('records no contact when there is no address at all', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...DRAFT_ORDER,
      customerEmail: null,
    })
    await deliver({ ...DRAFT_SESSION, customer_details: null })
    expect(contactUpserts).toHaveLength(0)
    expect(storedOrder().status).toBe('paid')
  })

  /**
   * Stripe delivers at least once and `purchaseCents` is a
   * `FieldValue.increment`, so a replay that reached it would inflate the
   * buyer's lifetime value and order count on every retry. The `pending` to
   * `paid` transition is the guard, and it now runs inside a transaction: a
   * read-then-write let two concurrent deliveries both observe `pending`.
   * Counting the side effects is the assertion — the order document is a
   * merge-set and looks identical either way.
   */
  it('absorbs a redelivered event without double-counting', async () => {
    await deliver(DRAFT_SESSION)
    await deliver(DRAFT_SESSION)

    expect(contactUpserts).toHaveLength(1)
    expect(notifications).toHaveLength(1)
    // And the stock moved once: 10 - 3, not 10 - 6.
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBe(7)
  })

  /** An order that is not pending is not this event's to complete. */
  it('does nothing for an order that is already paid', async () => {
    docs.set('hosts/host-1/orders/order-1', {
      ...DRAFT_ORDER,
      status: 'paid',
    })
    await deliver(DRAFT_SESSION)
    expect(contactUpserts).toHaveLength(0)
    expect(notifications).toHaveLength(0)
  })

  /** A metadata orderId pointing at nothing must not manufacture a contact. */
  it('does nothing when the draft order is missing', async () => {
    docs.delete('hosts/host-1/orders/order-1')
    await deliver(DRAFT_SESSION)
    expect(contactUpserts).toHaveLength(0)
    expect(notifications).toHaveLength(0)
  })

  /**
   * The stock decrement is the other side effect hanging off the guard, kept
   * here so the transaction rewrite is pinned end to end rather than only at
   * the contact.
   */
  it('decrements the sold quantity, not one unit', async () => {
    await deliver(DRAFT_SESSION)
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBe(7)
  })

  it('never calls Stripe', async () => {
    await deliver(DRAFT_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * The shipping a paid draft was charged (AGL-1792).
 *
 * This branch never wrote `totals` at all — it flipped the status and merged
 * the payment intent, the buyer and the timeline over the figures the console
 * froze when the draft was composed. That was harmless only while no draft
 * session could charge shipping. Once `draft-order.ts` declares
 * `shipping_options`, the buyer pays postage that lands in `amount_total` and
 * NOWHERE in the stored order — the exact AGL-1698 defect, on real money, and
 * the ordering constraint AGL-1707 wrote down. So this lands with (and is
 * pinned ahead of) the charging half.
 *
 * A session that charged no shipping is left byte-identical, which is every
 * draft that exists today AND every POS card sale — `pos-order.ts` completes
 * its QR through this same branch, and a counter sale must not acquire a
 * shipping line or an address it never had.
 */
describe('paid draft order shipping (AGL-1792)', () => {
  /** $7.99 postage on the three boxes: 4500 items + 799 shipping = 5299. */
  const SHIPPED_SESSION = {
    ...DRAFT_SESSION,
    amount_total: 5299,
    total_details: { amount_shipping: 799 },
    shipping_details: {
      name: 'Ida Voiced',
      address: {
        line1: '14 Kiln Row',
        line2: 'Unit 3',
        city: 'Leeds',
        state: 'WY',
        postal_code: 'LS1 4AB',
        country: 'GB',
      },
    },
  }

  /**
   * THE DEFECT. Before the fix the stored order kept `shippingCents: 0` and
   * `totalCents: 4500` while the buyer had paid 5299, so the merchant's own
   * record understated the sale by exactly the postage they collected.
   */
  it('records what Stripe charged for shipping', async () => {
    await deliver(SHIPPED_SESSION)
    expect(storedOrder().totals).toEqual({
      itemsCents: 4500,
      shippingCents: 799,
      taxCents: 0,
      discountCents: 0,
      feeCents: 146,
      totalCents: 5299,
    })
  })

  /** AGL-1698's invariant: the stored parts sum to the stored total. */
  it('keeps the parts summing to the total', async () => {
    await deliver(SHIPPED_SESSION)
    const totals = storedOrder().totals
    expect(
      totals.itemsCents +
        totals.shippingCents +
        totals.taxCents -
        totals.discountCents,
    ).toBe(totals.totalCents)
  })

  /** The merchant collected postage, so they must be told where to post it. */
  it('records the address Stripe collected', async () => {
    await deliver(SHIPPED_SESSION)
    expect(storedOrder().shippingAddress).toEqual({
      name: 'Ida Voiced',
      line1: '14 Kiln Row',
      line2: 'Unit 3',
      city: 'Leeds',
      state: 'WY',
      postalCode: 'LS1 4AB',
      country: 'GB',
    })
  })

  /**
   * Every draft that exists today, and every POS card sale. The totals are
   * compared whole rather than field by field: a handler that rebuilt them
   * from the session would zero the tax and discount a POS sale prices into
   * its single "In-store purchase" line, and a per-field assertion on
   * `shippingCents` alone would pass straight through that.
   */
  it('leaves a session that charged no shipping untouched', async () => {
    await deliver(DRAFT_SESSION)
    expect(storedOrder().totals).toEqual(DRAFT_ORDER.totals)
    expect(storedOrder().shippingAddress).toBeUndefined()
    // ...including one that reports the field as an explicit zero.
    docs.set('hosts/host-1/orders/order-1', { ...DRAFT_ORDER })
    await deliver({ ...DRAFT_SESSION, total_details: { amount_shipping: 0 } })
    expect(storedOrder().totals).toEqual(DRAFT_ORDER.totals)
  })

  /**
   * `shipping_details` ONLY — unlike the cart branch, which falls back to
   * `customer_details`. That fallback is a billing address, and this branch
   * also serves the register: a card sale rung up at a counter would otherwise
   * acquire a "shipping address" nobody ever asked for and nothing will ship
   * to. Stripe populates `shipping_details` exactly when the session declared
   * `shipping_address_collection`, which is exactly when we priced a parcel.
   */
  it('does not mistake a billing address for a destination', async () => {
    await deliver({
      ...DRAFT_SESSION,
      customer_details: {
        email: 'Paid@Example.com',
        name: 'Ida Voiced',
        address: { line1: '1 Card Street', country: 'US' },
      },
    })
    expect(storedOrder().shippingAddress).toBeUndefined()
  })

  /** A shipped draft is still a draft: nothing else about the branch moves. */
  it('leaves the rest of the branch alone', async () => {
    await deliver(SHIPPED_SESSION)
    const order = storedOrder()
    expect(order.status).toBe('paid')
    expect(order.paymentIntentId).toBe('pi_draft_1')
    expect(order.lineItems).toEqual(DRAFT_ORDER.lineItems)
    expect(contactUpserts).toHaveLength(1)
    // The contact's lifetime value is what Stripe charged, postage included.
    expect(contactUpserts[0].purchaseCents).toBe(5299)
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBe(7)
  })
})

/**
 * The ledger row the decrement never wrote (AGL-1807).
 *
 * This branch was the one stock writer of four that moved the count and logged
 * nothing: the cart loop, the buy-now branch and `pos-order.ts` all pair the
 * variant decrement with an `inventoryAdjustments` row, so a draft-link sale
 * was the only movement the products hub's stock history could not explain —
 * and the reason AGL-1797's restock flag could not use the ledger as its
 * source of truth.
 */
describe('paid draft order inventory ledger (AGL-1807)', () => {
  function ledgerRows() {
    return [...docs.entries()]
      .filter(([path]) => path.startsWith('hosts/host-1/inventoryAdjustments/'))
      .map(([, value]) => value)
  }

  /**
   * THE DEFECT: before the fix this array was empty — the decrement two tests
   * up landed with no history behind it. The shape matches the sibling
   * writers' byte for byte, so `products-hub-card.component.tsx` renders it
   * with no reader change.
   */
  it('logs the sale in the inventory ledger', async () => {
    await deliver(DRAFT_SESSION)
    expect(ledgerRows()).toEqual([
      {
        productId: 'product-1',
        variantId: 'large',
        delta: -3,
        reason: 'sale',
        orderId: 'order-1',
        atMs: expect.any(Number),
      },
    ])
  })

  /**
   * The row references the ORDER document. The siblings write
   * `String(object.id)` because their order doc id IS the session id; here the
   * draft was pre-created under `metadata.orderId`, and a row keyed to
   * `cs_draft_1` would join to nothing — invisible next to the order, useless
   * to AGL-1797's `where('orderId', '==', …)` shape.
   */
  it('references the order document, not the checkout session', async () => {
    await deliver(DRAFT_SESSION)
    expect(ledgerRows()[0]?.orderId).toBe('order-1')
    expect(ledgerRows()[0]?.orderId).not.toBe('cs_draft_1')
  })

  /**
   * `-quantity`, not `-1` — the AGL-1711 defect this same branch's neighbour
   * had, pinned here so the ledger can never disagree with the decrement it
   * explains.
   */
  it('logs the sold quantity, not one unit', async () => {
    await deliver(DRAFT_SESSION)
    expect(ledgerRows()[0]?.delta).toBe(-3)
  })

  /** The redelivery guard covers the ledger exactly as it covers the count. */
  it('logs once on a redelivered event', async () => {
    await deliver(DRAFT_SESSION)
    await deliver(DRAFT_SESSION)
    expect(ledgerRows()).toHaveLength(1)
  })

  /**
   * An untracked variant decrements nothing, so it must log nothing — a row
   * for stock that did not move would corrupt the very history this fix
   * completes (AGL-1797's argument, in the other direction). Passes before the
   * fix too: it pins the row to the decrement's own guard.
   */
  it('logs nothing for an untracked variant', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Monthly box',
      type: 'physical',
      variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L' }],
    })
    await deliver(DRAFT_SESSION)
    expect(ledgerRows()).toHaveLength(0)
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBeUndefined()
  })
})

/**
 * The POS card sale's stock (AGL-1825).
 *
 * `commerce-draft` completes two sales: the console payment link, whose
 * metadata names one `productId`, and the POS card (QR) sale, whose metadata is
 * `{type, hostId, orderId}` and nothing else. The branch's only decrement sat
 * under `if (productId)`, so a card sale flipped to paid, notified, fed
 * contacts — and never took a unit off the shelf. The same basket paid in cash
 * decrements per line, location-aware, with a ledger row; `cancel-order.ts`
 * then releases a paid order's stock on cancel, so a cancelled card sale
 * RESTOCKED units that were never taken.
 *
 * The order document already holds `lineItems`; these cases pin the per-line
 * loop that decrements from it — location-aware via the `locationId` that
 * `pos-order.ts` now stores on the pending card order, with the AGL-1807
 * ledger row beside every movement.
 */
describe('POS card sale stock (AGL-1825)', () => {
  /**
   * Two tracked lines of ONE product (a located bucket and a flat count) plus
   * an untracked line. Nothing coincides: quantities 2/1/5, stocks 9(6+3)/4,
   * and 7700 = 2×2200 + 1×1800 + 5×300.
   */
  const POS_ORDER = {
    number: 12,
    status: 'pending',
    channel: 'pos',
    registerId: 'register-1',
    locationId: 'loc-front',
    lineItems: [
      {
        productId: 'product-2',
        variantId: 'wool',
        name: 'Beanie',
        variantLabel: 'Wool',
        productType: 'physical',
        quantity: 2,
        unitAmountCents: 2200,
      },
      {
        productId: 'product-2',
        variantId: 'cotton',
        name: 'Beanie',
        variantLabel: 'Cotton',
        productType: 'physical',
        quantity: 1,
        unitAmountCents: 1800,
      },
      {
        productId: 'product-3',
        variantId: 'default',
        name: 'Sticker',
        productType: 'physical',
        quantity: 5,
        unitAmountCents: 300,
      },
    ],
    totals: {
      itemsCents: 7700,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: 0,
      totalCents: 7700,
    },
    customerEmail: null,
    timeline: [{ atMs: 2000, event: 'pos-card-pending' }],
    createdAtMs: 2000,
  }

  /** The register's session: `{type, hostId, orderId}` and NO productId. */
  const POS_SESSION = {
    id: 'cs_pos_1',
    payment_status: 'paid',
    payment_intent: 'pi_pos_1',
    amount_total: 7700,
    customer_details: null,
    metadata: {
      type: 'commerce-draft',
      hostId: 'host-1',
      orderId: 'order-pos',
    },
  }

  function posLedgerRows() {
    return [...docs.entries()]
      .filter(([path]) => path.startsWith('hosts/host-1/inventoryAdjustments/'))
      .map(([, value]) => value)
  }

  function beanie() {
    return docs.get('hosts/host-1/products/product-2') as any
  }

  function beanieVariant(id: string) {
    return beanie().variants.find((variant: any) => variant.id === id)
  }

  beforeEach(() => {
    docs.set('hosts/host-1/products/product-2', {
      name: 'Beanie',
      type: 'physical',
      variants: [
        {
          id: 'wool',
          priceUsd: 22,
          inventory: 9,
          inventoryByLocation: { 'loc-front': 6, 'loc-back': 3 },
        },
        { id: 'cotton', priceUsd: 18, inventory: 4 },
      ],
    })
    docs.set('hosts/host-1/products/product-3', {
      name: 'Sticker',
      type: 'physical',
      variants: [{ id: 'default', priceUsd: 3 }],
    })
    docs.set('hosts/host-1/orders/order-pos', { ...POS_ORDER })
  })

  /**
   * THE DEFECT. Before the fix a card sale decremented NOTHING — the branch's
   * only decrement read `metadata.productId`, which the POS session does not
   * carry. Both counts stood still while the cash path moved them.
   */
  it('decrements every tracked line when the card sale pays', async () => {
    await deliver(POS_SESSION)
    expect((docs.get('hosts/host-1/orders/order-pos') as any).status).toBe(
      'paid',
    )
    expect(beanieVariant('wool').inventory).toBe(7)
    expect(beanieVariant('cotton').inventory).toBe(3)
  })

  /**
   * The units come out of the register's own bucket (AGL-286): the sale's
   * `locationId` rides on the order, so the webhook decrements `loc-front`
   * and leaves `loc-back` alone — not the flat total the next location-aware
   * write would recompute away.
   */
  it('takes the units from the location the register sold from', async () => {
    await deliver(POS_SESSION)
    expect(beanieVariant('wool').inventoryByLocation).toEqual({
      'loc-front': 4,
      'loc-back': 3,
    })
  })

  /**
   * Two lines of ONE product must compound: a loop that recomputed each line
   * from the product as first read would erase the wool decrement when the
   * cotton write landed. The denormalized flat total is the sum of both.
   */
  it('folds two lines of one product into one final count', async () => {
    await deliver(POS_SESSION)
    expect(beanieVariant('wool').inventory).toBe(7)
    expect(beanieVariant('cotton').inventory).toBe(3)
    expect(beanie().inventory).toBe(10)
  })

  /**
   * The AGL-1807 ledger, from day one of this decrement: one `sale` row per
   * tracked line, joined to the ORDER document (the session id names no order)
   * and carrying the location the units left.
   */
  it('logs a sale ledger row per tracked line, joined to the order', async () => {
    await deliver(POS_SESSION)
    expect(posLedgerRows()).toEqual([
      {
        productId: 'product-2',
        variantId: 'wool',
        delta: -2,
        reason: 'sale',
        orderId: 'order-pos',
        locationId: 'loc-front',
        atMs: expect.any(Number),
      },
      {
        productId: 'product-2',
        variantId: 'cotton',
        delta: -1,
        reason: 'sale',
        orderId: 'order-pos',
        locationId: 'loc-front',
        atMs: expect.any(Number),
      },
    ])
  })

  /** An untracked line moves nothing and logs nothing, like every sibling. */
  it('skips untracked lines entirely', async () => {
    await deliver(POS_SESSION)
    expect(
      (docs.get('hosts/host-1/products/product-3') as any).variants[0]
        .inventory,
    ).toBeUndefined()
    expect(posLedgerRows()).toHaveLength(2)
  })

  /** The `pending` → `paid` guard bounds this exactly as it bounds contacts. */
  it('decrements once on a redelivered event', async () => {
    await deliver(POS_SESSION)
    await deliver(POS_SESSION)
    expect(beanieVariant('wool').inventoryByLocation).toEqual({
      'loc-front': 4,
      'loc-back': 3,
    })
    expect(posLedgerRows()).toHaveLength(2)
  })

  /**
   * An order minted before the fix stored no `locationId` (the `link` pending
   * write predates it), so the decrement falls back to the flat count — the
   * same fallback `adjustVariantInventory` applies everywhere — and the row
   * carries no location it does not know.
   */
  it('decrements the flat count when the order carries no location', async () => {
    docs.set('hosts/host-1/orders/order-pos', {
      ...POS_ORDER,
      locationId: undefined,
      lineItems: [POS_ORDER.lineItems[1]],
    })
    await deliver(POS_SESSION)
    expect(beanieVariant('cotton').inventory).toBe(3)
    expect(posLedgerRows()).toEqual([
      {
        productId: 'product-2',
        variantId: 'cotton',
        delta: -1,
        reason: 'sale',
        orderId: 'order-pos',
        atMs: expect.any(Number),
      },
    ])
  })

  /**
   * The console draft path is the OTHER tenant of this branch: its metadata
   * names a product and its decrement already works. The line-items loop must
   * be its `else`, or every draft sale would decrement twice.
   */
  it('still decrements a single-product draft exactly once', async () => {
    await deliver(DRAFT_SESSION)
    expect(
      (docs.get('hosts/host-1/products/product-1') as any).variants[0]
        .inventory,
    ).toBe(7)
    expect(
      posLedgerRows().filter((row) => row.productId === 'product-1'),
    ).toHaveLength(1)
  })

  it('never calls Stripe', async () => {
    await deliver(POS_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * The low-stock crossing alert on this branch's two tenants (AGL-1826).
 *
 * THE DEFECT. Only buy-now followed its decrement with the AGL-281 crossing
 * check, so a payment-link sale — and a POS card sale, which completes through
 * this same branch — sold a product down to its threshold in silence while the
 * storefront button notified every manager. The shared `alertLowStockCrossing`
 * now sits beside both of this branch's decrements, fed the pre/post pair each
 * caller just computed.
 *
 * `notifications` also carries this branch's `content.order` "Draft order
 * paid" nudge, so every case filters to `content.lowStock`.
 */
describe('low-stock crossing alerts (AGL-1826)', () => {
  const lowStockAlerts = () =>
    notifications.filter(
      (notification) => notification.type === 'content.lowStock',
    )

  /** product-1 at 10 with a threshold of 8: selling 3 crosses to 7. */
  function trackProductOne(lowStockThreshold: number | undefined) {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Monthly box',
      type: 'physical',
      ...(lowStockThreshold != null ? { lowStockThreshold } : {}),
      variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 }],
    })
  }

  /**
   * THE DEFECT, draft-link shape: before the fix this array was empty on the
   * exact decrement (10 - 3 = 7, at the threshold of 8) that alerts from the buy-now button.
   */
  it('alerts when a draft-link sale crosses the threshold', async () => {
    trackProductOne(8)
    await deliver(DRAFT_SESSION)
    expect(lowStockAlerts()).toEqual([
      {
        hostId: 'host-1',
        type: 'content.lowStock',
        title: 'Low stock — Monthly box',
        body: '7 left across tracked variants',
        link: '/host-1/products',
      },
    ])
  })

  /** The pending-to-paid flip bounds the alert as it bounds the count. */
  it('alerts once on a redelivered draft event', async () => {
    trackProductOne(8)
    await deliver(DRAFT_SESSION)
    await deliver(DRAFT_SESSION)
    expect(lowStockAlerts()).toHaveLength(1)
  })

  /**
   * One nudge per breach, not one per order after it — the buy-now dedupe,
   * preserved verbatim. Holds either side of the fix.
   */
  it('does not re-alert a product already below its threshold', async () => {
    trackProductOne(20)
    await deliver(DRAFT_SESSION)
    expect(lowStockAlerts()).toHaveLength(0)
  })

  /** No threshold configured means no alert, ever. Holds either side. */
  it('does not alert a product with no threshold', async () => {
    trackProductOne(undefined)
    await deliver(DRAFT_SESSION)
    expect(lowStockAlerts()).toHaveLength(0)
  })

  /**
   * The POS card tenant of this branch. The beanie's tracked total walks
   * 13 down to 11 (wool line) down to 10 (cotton line): the compounded pair
   * from the AGL-1825 loop means the crossing lands on the line that actually
   * breaches, exactly once.
   */
  describe('for a POS card sale', () => {
    const POS_LOW_ORDER = {
      number: 13,
      status: 'pending',
      channel: 'pos',
      registerId: 'register-1',
      lineItems: [
        {
          productId: 'product-2',
          variantId: 'wool',
          name: 'Beanie',
          productType: 'physical',
          quantity: 2,
          unitAmountCents: 2200,
        },
        {
          productId: 'product-2',
          variantId: 'cotton',
          name: 'Beanie',
          productType: 'physical',
          quantity: 1,
          unitAmountCents: 1800,
        },
      ],
      totals: {
        itemsCents: 6200,
        shippingCents: 0,
        taxCents: 0,
        discountCents: 0,
        feeCents: 0,
        totalCents: 6200,
      },
      customerEmail: null,
      timeline: [{ atMs: 2000, event: 'pos-card-pending' }],
      createdAtMs: 2000,
    }

    const POS_LOW_SESSION = {
      id: 'cs_pos_low',
      payment_status: 'paid',
      payment_intent: 'pi_pos_low',
      amount_total: 6200,
      customer_details: null,
      metadata: {
        type: 'commerce-draft',
        hostId: 'host-1',
        orderId: 'order-pos-low',
      },
    }

    function trackBeanie(lowStockThreshold: number) {
      docs.set('hosts/host-1/products/product-2', {
        name: 'Beanie',
        type: 'physical',
        lowStockThreshold,
        variants: [
          { id: 'wool', priceUsd: 22, inventory: 9 },
          { id: 'cotton', priceUsd: 18, inventory: 4 },
        ],
      })
    }

    beforeEach(() => {
      docs.set('hosts/host-1/orders/order-pos-low', { ...POS_LOW_ORDER })
    })

    /**
     * THE DEFECT, register shape: the channel most likely to be selling the
     * last few units of shelf stock crossed silently. Threshold 10 is
     * breached by the SECOND line (11 becomes 10), so the single alert also
     * pins that sibling lines compound before the check runs.
     */
    it('alerts once, on the line that breaches', async () => {
      trackBeanie(10)
      await deliver(POS_LOW_SESSION)
      expect(lowStockAlerts()).toEqual([
        {
          hostId: 'host-1',
          type: 'content.lowStock',
          title: 'Low stock — Beanie',
          body: '10 left across tracked variants',
          link: '/host-1/products',
        },
      ])
    })

    /**
     * Threshold 11 is breached by the FIRST line (13 becomes 11) and the
     * second line starts already-low — the crossing fires there and only
     * there. Paired with the threshold-10 case above, which a stale
     * read-once pair would MISS entirely (13 to 11 and 13 to 12, neither
     * low), the two pin that the check consumes the compounded pair.
     */
    it('alerts on the first line when that is the crossing one', async () => {
      trackBeanie(11)
      await deliver(POS_LOW_SESSION)
      expect(lowStockAlerts()).toHaveLength(1)
      expect(lowStockAlerts()[0].body).toBe('11 left across tracked variants')
    })

    /** The pending-to-paid flip bounds the register's alert too. */
    it('alerts once on a redelivered card event', async () => {
      trackBeanie(10)
      await deliver(POS_LOW_SESSION)
      await deliver(POS_LOW_SESSION)
      expect(lowStockAlerts()).toHaveLength(1)
    })
  })
})
