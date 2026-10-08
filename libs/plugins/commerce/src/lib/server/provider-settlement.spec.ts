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

import type { PluginContactCaptureRequest } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import type { PluginPaymentSettlement } from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { standInRecordSystem } from '../testing/stand-in-record-system'
import {
  approveProviderCart,
  expireProviderCart,
  providerCartPaymentEvent,
  providerSessionObject,
  settleProviderCart,
} from './provider-settlement'

/**
 * A cart paid through another plugin's payment provider, fulfilled
 * (AGL-3630).
 *
 * The provider's settlement is turned into the shape of a paid Checkout
 * Session and handed to the `commerce-cart` branch of `billing-webhook.ts`
 * — the REAL branch, here, not a stand-in — so an order paid with PayPal is
 * written, totalled, counted against stock and its cart cleared by the very
 * code a card order is. Told twice (the buyer's return and the provider's
 * webhook), it records one order and moves stock once. Then the order is
 * stamped with the provider and its payment id, which is what the refund
 * route sends a refund back through.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** gRPC `Status.NOT_FOUND` — what Firestore's "no entity to update" carries. */
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
let contactUpserts: PluginContactCaptureRequest[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  // The real `updateExisting` (AGL-1767's pattern): the cart branch closes its
  // checkout doc through it, and a stub would have to reproduce the NOT_FOUND
  // discrimination anyway. Taken from the module's own path rather than the
  // barrel, which pulls Next's server internals into a jsdom worker.
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
      org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
    }),
    meterHostEmail: async () => undefined,
    notifyHostManagers: async (hostId: string, notification: any) => {
      notifications.push({ hostId, ...notification })
    },
    renderHostEmailWithTokens: async () => null,
  }
})

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

const CHECKOUT = 'pay_paypal_0123456789abcdef0123456789abcdef'

function settlement(overrides: Partial<PluginPaymentSettlement> = {}): PluginPaymentSettlement {
  return {
    providerId: 'paypal',
    providerLabel: 'PayPal',
    providerCheckoutId: 'ppc_record',
    ownerKind: 'commerce-cart',
    checkoutId: CHECKOUT,
    orgId: 'org-1',
    hostId: 'host-1',
    currency: 'usd',
    metadata: { type: 'commerce-cart', hostId: 'host-1', cartId: 'cart-1', feeCents: '90', paymentProvider: 'paypal' },
    totalCents: 5_302,
    shippingOptionId: 'rate-ground',
    shippingAddress: { name: 'Ada Buyer', line1: '1 Main St', city: 'San Jose', state: 'CA', postalCode: '95131', country: 'US' },
    payer: { email: 'payer@example.com', name: 'Ada Buyer' },
    paymentId: '3C679366HH908993F',
    amountCents: 5_302,
    breakdown: { itemsCents: 4_500, discountCents: 0, taxCents: 371, shippingCents: 431, totalCents: 5_302 },
    platformFeeCents: 90,
    livemode: true,
    settledAtMs: 1_800_000_000_000,
    ...overrides,
  }
}

const order = () => docs.get(`hosts/host-1/orders/${CHECKOUT}`) as any
const inventory = () => (docs.get('hosts/host-1/products/product-1') as any).variants[0].inventory

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts = standInRecordSystem({ reset: false })
  autoIdCounter = 0
  fetchMock.mockClear()
  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    variants: [{ id: 'large', priceUsd: 15, sku: 'BOX-L', inventory: 10 }],
  })
  docs.set('hosts/host-1/carts/cart-1', { lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }] })
  docs.set(`hosts/host-1/checkouts/${CHECKOUT}`, {
    cartId: 'cart-1',
    email: 'ada@example.com',
    resumeUrl: 'https://acme.example/shop',
    status: 'open',
    paymentProvider: 'paypal',
  })
})

describe('settling a provider-paid cart (AGL-3630)', () => {
  it('writes the order through the card branch and stamps the provider on it', async () => {
    await settleProviderCart(settlement())
    expect(order()).toMatchObject({
      status: 'paid',
      channel: 'online',
      lineItems: [{ productId: 'product-1', variantId: 'large', name: 'Monthly box', quantity: 3, unitAmountCents: 1_500 }],
      amountCents: 5_302,
      feeCents: 90,
      checkoutSessionId: CHECKOUT,
      paymentIntentId: null,
      livemode: true,
      // The email the shopper typed in the cart, over PayPal's account email.
      customerEmail: 'ada@example.com',
      customerName: 'Ada Buyer',
      shippingAddress: { line1: '1 Main St', city: 'San Jose', state: 'CA', postalCode: '95131', country: 'US' },
      taxMode: 'manual',
      paymentProvider: 'paypal',
      providerPaymentId: '3C679366HH908993F',
      providerCheckoutId: 'ppc_record',
    })
    expect(order().totals).toMatchObject({ shippingCents: 431, taxCents: 371, totalCents: 5_302 })
    expect(inventory()).toBe(7)
    expect(docs.has('hosts/host-1/carts/cart-1')).toBe(false)
    expect(docs.get(`hosts/host-1/checkouts/${CHECKOUT}`)).toMatchObject({ status: 'completed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records one order and moves stock once when told twice', async () => {
    await settleProviderCart(settlement())
    docs.set('hosts/host-1/carts/cart-1', { lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }] })
    await settleProviderCart(settlement())
    expect(inventory()).toBe(7)
    expect(childPaths('hosts/host-1/orders')).toEqual([`hosts/host-1/orders/${CHECKOUT}`])
    expect(notifications.filter((one) => one.type === 'content.order')).toHaveLength(1)
  })

  it('takes the payer’s email when the shopper typed none', () => {
    const object = providerSessionObject(settlement(), { resumeUrl: 'https://acme.example/shop?x=1' })
    expect(object.customer_details).toEqual({ email: 'payer@example.com', name: 'Ada Buyer' })
    expect(object.success_url).toBe('https://acme.example/shop?x=1&order=success')
    expect(object.automatic_tax).toEqual({ enabled: false })
    expect(object.total_details).toEqual({ amount_discount: 0, amount_shipping: 431, amount_tax: 371 })
  })

  it('refuses a settlement that is not a commerce cart, and throws when no order resolves', async () => {
    await expect(settleProviderCart(settlement({ metadata: { type: 'commerce-order', hostId: 'host-1' } }))).rejects.toThrow()
    await expect(settleProviderCart(settlement({ checkoutId: 'cs_not_ours' }))).rejects.toThrow()
    docs.delete('hosts/host-1/carts/cart-1')
    docs.delete('hosts/host-1/products/product-1')
    await expect(settleProviderCart(settlement({ metadata: { type: 'commerce-cart', hostId: 'host-1' } }))).rejects.toThrow(/recorded no order/)
  })
})

describe('approving before money moves (AGL-3630)', () => {
  const approval = (overrides: Record<string, unknown> = {}) => ({ ...settlement(), ...overrides }) as any

  it('approves an open checkout with a delivery address', async () => {
    expect(await approveProviderCart(approval())).toEqual({ ok: true })
  })

  it('refuses a checkout already paid', async () => {
    await settleProviderCart(settlement())
    expect(await approveProviderCart(approval())).toEqual({ ok: false, reason: 'This order is already paid.' })
  })

  it('refuses a posted order with no address', async () => {
    expect(await approveProviderCart(approval({ shippingAddress: undefined }))).toMatchObject({ ok: false })
  })

  it('refuses an address outside the postal code a carrier rate was quoted for', async () => {
    const quoted = approval({ metadata: { ...settlement().metadata, shippingQuotePostalCode: '10001' } })
    expect(await approveProviderCart(quoted)).toMatchObject({ ok: false, reason: expect.stringMatching(/10001/) })
    const same = approval({
      metadata: { ...settlement().metadata, shippingQuotePostalCode: '95131' },
    })
    expect(await approveProviderCart(same)).toEqual({ ok: true })
  })
})

describe('an abandoned provider checkout (AGL-3630)', () => {
  it('is handed to the card path’s expiry branch, which releases its stock hold', async () => {
    docs.set('hosts/host-1/stockHolds/hold-1', { lines: [{ productId: 'product-1', variantId: 'large', quantity: 3 }] })
    await expireProviderCart({ ...settlement(), metadata: { ...settlement().metadata, stockHoldKey: 'hold-1' } })
    expect(order()).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('what the provider reports afterwards (AGL-3630)', () => {
  const event = (overrides: Record<string, unknown>) =>
    ({ ...settlement(), eventId: 'WH-1', atMs: 1_800_000_100_000, ...overrides }) as any

  beforeEach(async () => {
    await settleProviderCart(settlement())
  })

  it('records a refund made in PayPal once, on top of the console’s own', async () => {
    docs.set(`hosts/host-1/orders/${CHECKOUT}`, { ...order(), refundedCents: 1_000 })
    await providerCartPaymentEvent(event({ kind: 'refunded', refundedCents: 1_500 }))
    await providerCartPaymentEvent(event({ kind: 'refunded', refundedCents: 1_500 }))
    expect(order().externalRefundedCents).toBe(500)
    expect(order().timeline.filter((line: any) => line.event === 'refund')).toEqual([
      expect.objectContaining({ detail: '$5.00 refunded outside the dashboard (in PayPal)' }),
    ])
  })

  it('records nothing for the console’s own refund coming back', async () => {
    docs.set(`hosts/host-1/orders/${CHECKOUT}`, { ...order(), refundedCents: 1_500 })
    await providerCartPaymentEvent(event({ kind: 'refunded', refundedCents: 1_500 }))
    expect(order().externalRefundedCents).toBeUndefined()
  })

  it('opens and closes a dispute on the order, which holds refunds while open', async () => {
    await providerCartPaymentEvent(event({ kind: 'disputed', amountCents: 5_302, detail: 'merchandise or service not received' }))
    expect(order().dispute).toMatchObject({ id: 'paypal:3C679366HH908993F', status: 'needs_response', amountCents: 5_302 })
    expect(notifications.some((one) => one.title === 'PayPal dispute on order #1')).toBe(true)
    await providerCartPaymentEvent(event({ kind: 'dispute-closed', detail: 'resolved seller favour', eventId: 'WH-2' }))
    expect(order().dispute).toMatchObject({ outcome: 'won', closedAtMs: 1_800_000_100_000 })
  })

  it('writes a reversal on the order and tells the managers', async () => {
    await providerCartPaymentEvent(event({ kind: 'reversed', amountCents: 5_302 }))
    expect(order().timeline.slice(-1)[0].detail).toMatch(/PayPal took back \$53\.02/)
    expect(notifications.some((one) => /reversed a payment/.test(one.title))).toBe(true)
  })
})
