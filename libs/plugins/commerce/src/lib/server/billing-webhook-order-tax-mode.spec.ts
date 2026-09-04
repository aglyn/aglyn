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
 * `taxMode` on the ORDER, at every storefront door the webhook writes one
 * through (AGL-2451).
 *
 * AGL-2440 shipped the merchant's aggregate report off the authoritative
 * `storefrontTaxCollected` record. What it left open is the SINGLE order: the
 * console dialog shows a bare `Tax` line, and a merchant reading one order
 * cannot tell whether that figure was computed by Stripe Tax against Aglyn's
 * registrations or applied from their own configured rate. Those are different
 * facts about who holds the money, and an order that cannot say which one it
 * carried cannot be reconciled or corrected afterwards.
 *
 * The discriminator is `automatic_tax.enabled` and NEVER the presence of tax
 * lines — a manual-mode subscription renewal carries a real Stripe Tax Rate
 * (AGL-1751), so reading the lines books merchant-configured tax as
 * Aglyn-collected. Both shapes are exercised below.
 *
 * Same harness as `billing-webhook-draft.spec.ts`: the handler returns
 * nothing, so every assertion is about what landed in the in-memory Firestore.
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

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
        increment: (value: number) => ({ __increment: value }),
        delete: () => '<delete>',
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
  upsertHostContact: async () => undefined,
  renderHostEmailWithTokens: async () => null,
  /** Update-if-present, the AGL-1767 shape: a missing doc is a no-op. */
  updateExisting: async (ref: any, value: Record<string, any>) => {
    if (!docs.has(ref.path)) return
    docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...value })
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

/**
 * Stripe, as far as this suite is concerned. The only outbound call any of
 * these fixtures makes is `recordStorefrontTax`'s breakdown re-read, which is
 * answered with the delivered object — the shape a real expansion returns.
 */
const expandedById = new Map<string, any>()
const fetchMock = jest.fn(async (url: any) => {
  const href = String(url)
  const match = /\/v1\/checkout\/sessions\/([^?]+)/.exec(href)
  if (match) {
    const body = expandedById.get(decodeURIComponent(match[1]))
    if (body) return { ok: true, json: async () => body } as any
    return { ok: false, json: async () => ({}) } as any
  }
  throw new Error(`Unexpected fetch to ${href}`)
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function deliver(object: any, type = 'checkout.session.completed') {
  expandedById.set(String(object?.id ?? ''), object)
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

/**
 * A cart session on a STRIPE TAX store. Nothing coincides: the tax (825) is
 * neither the fee (146) nor a round fraction of the goods (10000).
 */
const CART_SESSION_STRIPE_TAX = {
  id: 'cs_cart_stripe',
  payment_status: 'paid',
  payment_intent: 'pi_cart_1',
  amount_total: 10825,
  currency: 'usd',
  automatic_tax: { enabled: true, liability: { type: 'self' } },
  total_details: { amount_tax: 825, amount_shipping: 0, amount_discount: 0 },
  customer_details: {
    email: 'shopper@example.com',
    name: 'Cara Tesian',
    address: { country: 'US', state: 'TX', city: 'Austin', postal_code: '73301' },
  },
  metadata: {
    type: 'commerce-cart',
    hostId: 'host-1',
    cartId: 'cart-1',
    feeCents: '146',
  },
}

/**
 * The SAME cart, on a MANUAL store. Since AGL-1953 the manual tax rides a real
 * Stripe Tax Rate, so the session reports a genuine `amount_tax` and carries
 * populated tax lines — byte-indistinguishable from the arm above if you read
 * the lines instead of the flag. That is the whole trap.
 */
const CART_SESSION_MANUAL_TAX = {
  ...CART_SESSION_STRIPE_TAX,
  id: 'cs_cart_manual',
  automatic_tax: { enabled: false },
  total_details: {
    amount_tax: 825,
    amount_shipping: 0,
    amount_discount: 0,
    breakdown: {
      taxes: [
        {
          amount: 825,
          taxable_amount: 10000,
          taxability_reason: 'standard_rated',
          rate: { id: 'txr_manual', percentage: 8.25, jurisdiction: 'Texas' },
        },
      ],
    },
  },
}

/** A store that decided to collect nothing. */
const CART_SESSION_NO_TAX = {
  ...CART_SESSION_STRIPE_TAX,
  id: 'cs_cart_none',
  amount_total: 10000,
  automatic_tax: { enabled: false },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
}

/** Buy-now, whose manual tax is an ordinary line item Stripe never sees as tax. */
const BUY_NOW_SESSION_MANUAL = {
  id: 'cs_buynow_manual',
  payment_status: 'paid',
  payment_intent: 'pi_buynow_1',
  amount_total: 5412,
  currency: 'usd',
  automatic_tax: { enabled: false },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  customer_details: { email: 'buyer@example.com', name: 'Bo Ynow' },
  metadata: {
    type: 'commerce-order',
    hostId: 'host-1',
    productId: 'product-1',
    variantId: 'large',
    feeCents: '162',
    taxCents: '412',
    quantity: '1',
  },
}

const BUY_NOW_SESSION_STRIPE = {
  ...BUY_NOW_SESSION_MANUAL,
  id: 'cs_buynow_stripe',
  automatic_tax: { enabled: true, liability: { type: 'self' } },
  total_details: { amount_tax: 412, amount_shipping: 0, amount_discount: 0 },
  metadata: { ...BUY_NOW_SESSION_MANUAL.metadata, taxCents: '0' },
}

/** The draft order the console pre-created, and the session that pays it. */
const DRAFT_ORDER = {
  number: 7,
  status: 'pending',
  channel: 'draft',
  lineItems: [
    {
      productId: 'product-1',
      variantId: 'large',
      name: 'Monthly box',
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

const DRAFT_SESSION_STRIPE_TAX = {
  id: 'cs_draft_stripe',
  payment_status: 'paid',
  payment_intent: 'pi_draft_1',
  amount_total: 4871,
  currency: 'usd',
  automatic_tax: { enabled: true, liability: { type: 'self' } },
  total_details: { amount_tax: 371, amount_shipping: 0, amount_discount: 0 },
  customer_details: { email: 'paid@example.com', name: 'Ida Voiced' },
  metadata: {
    type: 'commerce-draft',
    hostId: 'host-1',
    orderId: 'order-1',
    productId: 'product-1',
    variantId: 'large',
    feeCents: '146',
  },
}

/** A POS CARD sale completes through the same `commerce-draft` branch. */
const POS_CARD_SESSION = {
  id: 'cs_pos_card',
  payment_status: 'paid',
  payment_intent: 'pi_pos_1',
  amount_total: 4871,
  currency: 'usd',
  automatic_tax: { enabled: false },
  // The register sends the basket as ONE opaque line, so Stripe states no tax
  // at all; `metadata[taxCents]` is the only witness (AGL-1953).
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  customer_details: null,
  metadata: {
    type: 'commerce-draft',
    hostId: 'host-1',
    orderId: 'order-1',
    feeCents: '146',
    taxCents: '371',
  },
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  expandedById.clear()
  notifications.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()
  process.env.STRIPE_SECRET_KEY = 'sk_test_order_tax_mode_spec'

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    variants: [
      { id: 'large', priceUsd: 50, sku: 'BOX-L', inventory: 10 },
    ],
  })
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'product-1', variantId: 'large', quantity: 2 }],
  })
  docs.set('hosts/host-1/orders/order-1', { ...DRAFT_ORDER })
})

// ---------------------------------------------------------------------------

describe('cart orders carry the resolved taxMode (AGL-2451)', () => {
  it('stamps stripe-automatic when Stripe Tax computed the figure', async () => {
    await deliver(CART_SESSION_STRIPE_TAX)
    const order = docs.get('hosts/host-1/orders/cs_cart_stripe') as any
    expect(order.totals.taxCents).toBe(825)
    expect(order.taxMode).toBe('stripe-automatic')
  })

  /**
   * THE TRAP. This session's tax lines are identical to the arm above — same
   * amount, same `taxable_amount`, a real rate object — and only
   * `automatic_tax.enabled` tells them apart. An implementation that read the
   * lines books the merchant's own tax as Aglyn-collected.
   */
  it('stamps manual for a merchant-configured rate that rides a real Tax Rate', async () => {
    await deliver(CART_SESSION_MANUAL_TAX)
    const order = docs.get('hosts/host-1/orders/cs_cart_manual') as any
    expect(order.totals.taxCents).toBe(825)
    expect(order.taxMode).toBe('manual')
    expect(order.taxMode).not.toBe('stripe-automatic')
  })

  it('stamps none when the store collected no tax', async () => {
    await deliver(CART_SESSION_NO_TAX)
    const order = docs.get('hosts/host-1/orders/cs_cart_none') as any
    expect(order.taxMode).toBe('none')
  })

  /**
   * The order and the authoritative `storefrontTaxCollected` record must agree
   * — the point of the field is that one order can be reconciled against the
   * return, and two derivations that can drift are not one fact.
   */
  it('agrees with the storefrontTaxCollected record for the same sale', async () => {
    await deliver(CART_SESSION_MANUAL_TAX)
    const order = docs.get('hosts/host-1/orders/cs_cart_manual') as any
    const record = docs.get('storefrontTaxCollected/cs_cart_manual') as any
    expect(record).toBeDefined()
    expect(order.taxMode).toBe(record.taxMode)
  })
})

describe('buy-now orders carry the resolved taxMode (AGL-2451)', () => {
  it('stamps manual for the line-item tax construction', async () => {
    await deliver(BUY_NOW_SESSION_MANUAL)
    const order = docs.get('hosts/host-1/orders/cs_buynow_manual') as any
    expect(order.taxMode).toBe('manual')
  })

  it('stamps stripe-automatic when the flag is set', async () => {
    await deliver(BUY_NOW_SESSION_STRIPE)
    const order = docs.get('hosts/host-1/orders/cs_buynow_stripe') as any
    expect(order.taxMode).toBe('stripe-automatic')
  })
})

describe('paid draft and POS card orders carry the resolved taxMode (AGL-2451)', () => {
  it('stamps stripe-automatic on the draft the shopper paid', async () => {
    await deliver(DRAFT_SESSION_STRIPE_TAX)
    const order = docs.get('hosts/host-1/orders/order-1') as any
    expect(order.status).toBe('paid')
    expect(order.taxMode).toBe('stripe-automatic')
  })

  /**
   * The register's sale reaches Stripe as one opaque line with no tax on it at
   * all, so `metadata[taxCents]` is the only witness — the same witness
   * `recordStorefrontTax` reads. Without it every POS card sale would read
   * `none` while the order plainly carries tax.
   */
  it('stamps manual for a POS card sale, from the metadata witness', async () => {
    await deliver(POS_CARD_SESSION)
    const order = docs.get('hosts/host-1/orders/order-1') as any
    expect(order.status).toBe('paid')
    expect(order.taxMode).toBe('manual')
  })

  /**
   * A redelivery finds the order no longer `pending` and writes nothing, so
   * the stamp from the first delivery must survive rather than be replaced by
   * a re-derivation against a different guard.
   */
  it('keeps the stamp across a redelivery', async () => {
    await deliver(DRAFT_SESSION_STRIPE_TAX)
    await deliver(DRAFT_SESSION_STRIPE_TAX)
    const order = docs.get('hosts/host-1/orders/order-1') as any
    expect(order.taxMode).toBe('stripe-automatic')
  })
})
