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
import { standInRecordSystem } from '../testing/stand-in-record-system'
import { commerceBillingWebhookHandler } from './billing-webhook'

/**
 * A quote paid through its pay link (AGL-4094), through the `commerce-draft`
 * branch it shares with draft orders: the same document becomes the order
 * with every field order readers ask, stock moves for catalog lines only, and
 * a payment the quote cannot take is recorded and told, never fulfilled.
 *
 * Asserted on what landed in the in-memory Firestore, the notifications and
 * the contact captures; the handler returns nothing. `fetch` is replaced and
 * asserted unused: this branch makes no outbound call.
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
let contactUpserts: PluginContactCaptureRequest[] = []

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
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// The quote and the session that pays it
// ---------------------------------------------------------------------------

/**
 * Two canopies (tracked stock), installation typed for the job, and a carry
 * bag from the catalog included at no charge (tracked stock too).
 */
const QUOTE_ORDER = {
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [
    { productId: 'canopy', variantId: 'red', name: 'Canopy 10x10', productType: 'physical', quantity: 2, unitAmountCents: 120_000 },
    { productId: '', custom: true, name: 'Installation', sku: 'INSTALL', productType: 'service', quantity: 1, unitAmountCents: 30_000 },
    { productId: 'bag', name: 'Carry bag', productType: 'physical', quantity: 1, unitAmountCents: 0, included: true },
  ],
  totals: { itemsCents: 270_000, discountCents: 0, shippingCents: 4_500, taxCents: 22_275, feeCents: 0, totalCents: 296_775 },
  taxMode: 'manual',
  timeline: [{ atMs: 1_000, event: 'quote', detail: 'Quote created by owner@example.com' }],
  checkoutSessionId: 'cs_quote_1',
  quote: {
    stage: 'draft',
    revision: 1,
    customer: { name: 'Jordan Lee', email: 'jordan@example.com', emailLower: 'jordan@example.com', record: { kind: 'contact', id: 'c-1' } },
    shipTo: { name: 'Jordan Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
    shipping: { amountCents: 4_500 },
    tax: { kind: 'rate', pct: 8.25 },
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
    createdBy: 'owner@example.com',
    updatedBy: 'owner@example.com',
  },
}

const QUOTE_SESSION = {
  id: 'cs_quote_1',
  payment_status: 'paid',
  payment_intent: 'pi_quote_1',
  amount_total: 296_775,
  total_details: { amount_shipping: 4_500, amount_tax: 22_275 },
  customer_details: { email: 'jordan@example.com', name: 'Jordan Lee' },
  metadata: {
    type: 'commerce-draft',
    hostId: 'host-1',
    orderId: 'q-1',
    quoteId: 'q-1',
    quoteLinkVersion: '1',
    quoteUpdatedAtMs: '2000',
    feeCents: '8907',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({ type, object, requestHost: 'acme.aglyn.app' } as any)
}

const stored = () => docs.get('hosts/host-1/orders/q-1') as any
const stock = (productId: string, variantId: string) =>
  (docs.get(`hosts/host-1/products/${productId}`) as any).variants.find((variant: any) => variant.id === variantId).inventory

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts = standInRecordSystem({ reset: false })
  autoIdCounter = 0
  fetchMock.mockClear()
  docs.set('hosts/host-1', { displayName: 'Acme Tents' })
  docs.set('hosts/host-1/products/canopy', {
    name: 'Canopy 10x10',
    type: 'physical',
    variants: [{ id: 'red', priceUsd: 1_200, inventory: 10 }],
  })
  docs.set('hosts/host-1/products/bag', {
    name: 'Carry bag',
    type: 'physical',
    variants: [{ id: 'default', priceUsd: 25, inventory: 5 }],
  })
  docs.set('hosts/host-1/orders/q-1', JSON.parse(JSON.stringify(QUOTE_ORDER)))
})

// ---------------------------------------------------------------------------

describe('a quote paid through its pay link', () => {
  it('becomes the order on the same document, with the fields order lists read', async () => {
    await deliver(QUOTE_SESSION)
    const order = stored()
    expect(order).toMatchObject({
      status: 'paid',
      channel: 'quote',
      number: 1042,
      customerEmail: 'jordan@example.com',
      customerName: 'Jordan Lee',
      customerRecord: { kind: 'contact', id: 'c-1' },
      shippingAddress: { line1: '1 Main St', country: 'US' },
      paymentIntentId: 'pi_quote_1',
      checkoutSessionId: 'cs_quote_1',
      taxMode: 'manual',
      totals: { itemsCents: 270_000, shippingCents: 4_500, taxCents: 22_275, feeCents: 8_907, totalCents: 296_775 },
      customerEmailLower: 'jordan@example.com',
      productIds: ['canopy', 'bag'],
      requiresShipping: true,
      createdAt: '<server-timestamp>',
    })
    expect(order.createdAtMs).toBeGreaterThan(2_000)
    expect(order.updatedAtMs).toBe(order.createdAtMs)
    expect(order.quote.paidAtMs).toBe(order.createdAtMs)
    expect(order.searchTokens).toEqual(expect.arrayContaining(['#1042']))
    expect(order.timeline.map((entry: any) => entry.event)).toEqual(['quote', 'paid'])
  })

  it('tells the business, and keeps the payer as a contact', async () => {
    await deliver(QUOTE_SESSION)
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Quote paid — Quote #1042')
    expect(notifications[0].body).toContain('It is order #1042 now.')
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0]).toMatchObject({
      identity: { email: 'jordan@example.com', name: 'Jordan Lee' },
      purchaseCents: 296_775,
      interaction: { source: 'order', refId: 'q-1' },
    })
  })

  it('moves stock for catalog lines, the included one too, and never for a typed line', async () => {
    await deliver(QUOTE_SESSION)
    expect(stock('canopy', 'red')).toBe(8)
    expect(stock('bag', 'default')).toBe(4)
    const ledger = [...docs.entries()].filter(([path]) => path.startsWith('hosts/host-1/inventoryAdjustments/'))
    expect(ledger.map(([, row]) => row.productId).sort()).toEqual(['bag', 'canopy'])
    expect(JSON.stringify(ledger)).not.toContain('INSTALL')
  })

  it('does nothing more when Stripe sends the same payment again', async () => {
    await deliver(QUOTE_SESSION)
    const first = JSON.stringify(stored())
    await deliver(QUOTE_SESSION)
    expect(JSON.stringify(stored())).toBe(first)
    expect(stock('canopy', 'red')).toBe(8)
    expect(notifications).toHaveLength(1)
    expect(contactUpserts).toHaveLength(1)
  })

  it('records a second payment and tells the business, without a second sale', async () => {
    await deliver(QUOTE_SESSION)
    await deliver({ ...QUOTE_SESSION, id: 'cs_quote_2', payment_intent: 'pi_quote_2' })
    const order = stored()
    expect(order.paymentIntentId).toBe('pi_quote_1')
    expect(order.quote.unmatchedPayments).toEqual([
      expect.objectContaining({ sessionId: 'cs_quote_2', paymentIntentId: 'pi_quote_2', amountCents: 296_775, reason: 'already-paid' }),
    ])
    expect(order.timeline.at(-1).event).toBe('quote-payment-unmatched')
    expect(stock('canopy', 'red')).toBe(8)
    expect(notifications.map((entry) => entry.title)).toEqual(['Quote paid — Quote #1042', 'Quote #1042 was paid twice'])
    expect(contactUpserts).toHaveLength(1)
    // …once, however often Stripe sends it.
    await deliver({ ...QUOTE_SESSION, id: 'cs_quote_2', payment_intent: 'pi_quote_2' })
    expect(stored().quote.unmatchedPayments).toHaveLength(1)
    expect(notifications).toHaveLength(2)
  })

  it('takes no payment made through a replaced link, and says so', async () => {
    const replaced = JSON.parse(JSON.stringify(QUOTE_ORDER))
    replaced.quote.linkVersion = 2
    docs.set('hosts/host-1/orders/q-1', replaced)
    await deliver(QUOTE_SESSION)
    const order = stored()
    expect(order.status).toBe('pending')
    expect(order.createdAtMs).toBeUndefined()
    expect(order.customerEmail).toBeUndefined()
    expect(order.quote.unmatchedPayments).toEqual([expect.objectContaining({ sessionId: 'cs_quote_1', reason: 'superseded' })])
    expect(stock('canopy', 'red')).toBe(10)
    expect(notifications.map((entry) => entry.title)).toEqual(['A replaced link for Quote #1042 was paid'])
    expect(contactUpserts).toHaveLength(0)
  })

  it('takes no payment priced from an earlier edit of the quote', async () => {
    const edited = JSON.parse(JSON.stringify(QUOTE_ORDER))
    edited.quote.updatedAtMs = 3_000
    docs.set('hosts/host-1/orders/q-1', edited)
    await deliver(QUOTE_SESSION)
    expect(stored().status).toBe('pending')
    expect(stored().quote.unmatchedPayments).toHaveLength(1)
  })

  it('keeps Stripe’s own tax under Stripe Tax, and the address it collected', async () => {
    const atPayment = JSON.parse(JSON.stringify(QUOTE_ORDER))
    atPayment.quote.tax = { kind: 'at-payment' }
    atPayment.totals.taxCents = 0
    docs.set('hosts/host-1/orders/q-1', atPayment)
    await deliver({
      ...QUOTE_SESSION,
      amount_total: 293_000,
      total_details: { amount_shipping: 4_500, amount_tax: 18_500 },
      automatic_tax: { enabled: true, status: 'complete' },
      shipping_details: { name: 'Pat', address: { line1: '2 Other Rd', city: 'Austin', state: 'TX', postal_code: '78703', country: 'US' } },
    })
    expect(stored()).toMatchObject({
      totals: { taxCents: 18_500, totalCents: 293_000 },
      taxMode: 'stripe-automatic',
      shippingAddress: { name: 'Pat', line1: '2 Other Rd', postalCode: '78703', country: 'US' },
    })
  })

  it('never calls Stripe', async () => {
    await deliver(QUOTE_SESSION)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
